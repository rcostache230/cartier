from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - optional dependency for local sqlite-only runs
    psycopg = None
    dict_row = None

PARKING_TYPES = {"above_ground", "underground"}
DEFAULT_RESIDENT_PASSWORD = "10blocuri"
DEFAULT_ADMIN_PASSWORD = "adex123#"
DEFAULT_ADMIN_USERNAME = "admin"
UNDERGROUND_CAPACITY_PER_BUILDING = 10
ABOVE_GROUND_CAPACITY_PER_BUILDING = 6
TOTAL_BUILDINGS = 10


class ParkingModuleError(Exception):
    """Base error for parking module operations."""


class UserNotFoundError(ParkingModuleError):
    """Raised when a user does not exist."""


class SlotValidationError(ParkingModuleError):
    """Raised for invalid slot inputs or state transitions."""


class SlotNotFoundError(ParkingModuleError):
    """Raised when a slot cannot be found for an operation."""


class AuthenticationError(ParkingModuleError):
    """Raised when authentication fails."""


class AuthorizationError(ParkingModuleError):
    """Raised when an operation is not authorized."""


@dataclass(frozen=True)
class UserAccount:
    id: int
    username: str
    role: str
    building_number: int
    apartment_number: int
    phone_number: str


@dataclass(frozen=True)
class ParkingSlot:
    id: int
    building_number: int
    owner_username: str
    owner_phone_number: str
    parking_space_number: str
    parking_type: str
    available_from: str
    available_until: str
    status: str
    reserved_by_username: Optional[str]
    reserved_by_phone_number: str
    reservation_contact_phone: str
    reservation_from: Optional[str]
    reservation_until: Optional[str]


class _PGExecutionResult:
    def __init__(self, cursor, lastrowid: Optional[int] = None) -> None:
        self._cursor = cursor
        self.lastrowid = lastrowid
        self.rowcount = cursor.rowcount

    def fetchone(self):
        row = self._cursor.fetchone()
        self._cursor.close()
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        self._cursor.close()
        return rows


class _PostgresConnectionWrapper:
    def __init__(self, connection, close_on_exit: bool) -> None:
        self._conn = connection
        self._close_on_exit = close_on_exit

    @staticmethod
    def _convert_sql(query: str) -> str:
        return query.replace("?", "%s")

    def execute(self, query: str, params=()):
        cursor = self._conn.cursor()
        cursor.execute(self._convert_sql(query), params)
        lastrowid: Optional[int] = None
        if query.lstrip().lower().startswith("insert") and "returning" not in query.lower():
            # Some INSERT statements target tables without sequence-backed IDs
            # (for example app_meta). In that case LASTVAL is undefined.
            id_cursor = self._conn.cursor()
            try:
                id_cursor.execute("SELECT LASTVAL() AS id")
                row = id_cursor.fetchone()
                if row and row.get("id") is not None:
                    lastrowid = int(row["id"])
            except Exception:
                lastrowid = None
            finally:
                id_cursor.close()
        return _PGExecutionResult(cursor, lastrowid=lastrowid)

    def executescript(self, script: str) -> None:
        for statement in script.split(";"):
            stmt = statement.strip()
            if stmt:
                self.execute(stmt)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()
        if self._close_on_exit:
            self._conn.close()


class ParkingService:
    """Database-backed parking slot sharing and reservation service."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._is_postgres = self.db_path.startswith(("postgres://", "postgresql://"))
        self._initialize_db()

    @staticmethod
    def _default_db_path() -> str:
        configured = (
            os.getenv("PARKING_DB_PATH")
            or os.getenv("POSTGRES_URL")
            or os.getenv("DATABASE_URL")
            or os.getenv("POSTGRES_URL_NON_POOLING")
        )
        if configured:
            return configured
        if os.getenv("VERCEL"):
            return "/tmp/parking_module.db"
        return "parking_module.db"

    def _connect(self):
        if self._is_postgres:
            if psycopg is None or dict_row is None:
                raise RuntimeError(
                    "psycopg is required for PostgreSQL. Install dependencies from requirements.txt"
                )
            conn = psycopg.connect(self.db_path, row_factory=dict_row)
            return _PostgresConnectionWrapper(conn, close_on_exit=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize_db(self) -> None:
        if self._is_postgres:
            with self._connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id BIGSERIAL PRIMARY KEY,
                        username TEXT NOT NULL UNIQUE,
                        password_hash TEXT,
                        role TEXT NOT NULL DEFAULT 'resident',
                        building_number INTEGER NOT NULL,
                        apartment_number INTEGER NOT NULL,
                        phone_number TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS parking_slots (
                        id BIGSERIAL PRIMARY KEY,
                        building_number INTEGER NOT NULL,
                        owner_user_id BIGINT NOT NULL REFERENCES users(id),
                        parking_space_number TEXT NOT NULL,
                        parking_type TEXT NOT NULL,
                        available_from TEXT NOT NULL,
                        available_until TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'OPEN',
                        reserved_by_user_id BIGINT REFERENCES users(id),
                        reserved_at TEXT,
                        claim_phone_number TEXT NOT NULL DEFAULT '',
                        reservation_from TEXT,
                        reservation_until TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

                    CREATE TABLE IF NOT EXISTS app_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
                    CREATE INDEX IF NOT EXISTS idx_slots_status_building_time
                        ON parking_slots(status, building_number, available_from, available_until);
                    CREATE INDEX IF NOT EXISTS idx_slots_owner_status
                        ON parking_slots(owner_user_id, status);
                    CREATE INDEX IF NOT EXISTS idx_slots_reserver_status
                        ON parking_slots(reserved_by_user_id, status);
                    """
                )
                self._run_user_migrations_postgres(conn)
            return

        db_dir = Path(self.db_path).parent
        if str(db_dir) not in ("", "."):
            db_dir.mkdir(parents=True, exist_ok=True)

        with self._connect() as conn:
            conn.executescript(
                """
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT,
                    role TEXT NOT NULL DEFAULT 'resident',
                    building_number INTEGER NOT NULL,
                    apartment_number INTEGER NOT NULL,
                    phone_number TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS parking_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    building_number INTEGER NOT NULL,
                    owner_user_id INTEGER NOT NULL,
                    parking_space_number TEXT NOT NULL,
                    parking_type TEXT NOT NULL,
                    available_from TEXT NOT NULL,
                    available_until TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'OPEN',
                    reserved_by_user_id INTEGER,
                    reserved_at TEXT,
                    claim_phone_number TEXT NOT NULL DEFAULT '',
                    reservation_from TEXT,
                    reservation_until TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY(owner_user_id) REFERENCES users(id),
                    FOREIGN KEY(reserved_by_user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS app_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
                CREATE INDEX IF NOT EXISTS idx_slots_status_building_time
                    ON parking_slots(status, building_number, available_from, available_until);
                CREATE INDEX IF NOT EXISTS idx_slots_owner_status
                    ON parking_slots(owner_user_id, status);
                CREATE INDEX IF NOT EXISTS idx_slots_reserver_status
                    ON parking_slots(reserved_by_user_id, status);
                """
            )
            self._run_user_migrations_sqlite(conn)

    def _run_user_migrations_sqlite(self, conn: sqlite3.Connection) -> None:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}

        if "password_hash" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "role" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'resident'")
        if "phone_number" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN phone_number TEXT DEFAULT ''")
        slot_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(parking_slots)").fetchall()
        }
        if "claim_phone_number" not in slot_cols:
            conn.execute(
                "ALTER TABLE parking_slots ADD COLUMN claim_phone_number TEXT NOT NULL DEFAULT ''"
            )

        # Normalize usernames to lowercase.
        rows = conn.execute("SELECT id, username FROM users").fetchall()
        for row in rows:
            normalized = self._normalize_username(str(row["username"]))
            if normalized == row["username"]:
                continue
            duplicate = conn.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?",
                (normalized, int(row["id"])),
            ).fetchone()
            if duplicate:
                continue
            conn.execute(
                "UPDATE users SET username = ? WHERE id = ?",
                (normalized, int(row["id"])),
            )

        default_hash = self._hash_password(DEFAULT_RESIDENT_PASSWORD)
        conn.execute(
            """
            UPDATE users
            SET password_hash = COALESCE(password_hash, ?),
                role = COALESCE(role, 'resident'),
                phone_number = COALESCE(phone_number, '')
            WHERE role != 'admin'
            """,
            (default_hash,),
        )

    def _run_user_migrations_postgres(self, conn: _PostgresConnectionWrapper) -> None:
        # Serialize schema/data migrations across concurrent cold starts.
        conn.execute("SELECT pg_advisory_xact_lock(?)", (7040101,))
        if self._meta_get(conn, "migrations_v1_done") == "1":
            return

        user_cols = self._postgres_columns(conn, "users")
        if "password_hash" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "role" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'resident'")
        if "phone_number" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN phone_number TEXT NOT NULL DEFAULT ''")

        slot_cols = self._postgres_columns(conn, "parking_slots")
        if "claim_phone_number" not in slot_cols:
            conn.execute(
                "ALTER TABLE parking_slots ADD COLUMN claim_phone_number TEXT NOT NULL DEFAULT ''"
            )

        rows = conn.execute("SELECT id, username FROM users").fetchall()
        for row in rows:
            normalized = self._normalize_username(str(row["username"]))
            if normalized == row["username"]:
                continue
            duplicate = conn.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?",
                (normalized, int(row["id"])),
            ).fetchone()
            if duplicate:
                continue
            conn.execute(
                "UPDATE users SET username = ? WHERE id = ?",
                (normalized, int(row["id"])),
            )

        default_hash = self._hash_password(DEFAULT_RESIDENT_PASSWORD)
        conn.execute(
            """
            UPDATE users
            SET password_hash = COALESCE(password_hash, ?),
                role = COALESCE(role, 'resident'),
                phone_number = COALESCE(phone_number, '')
            WHERE role != 'admin'
              AND (password_hash IS NULL OR role IS NULL OR phone_number IS NULL)
            """,
            (default_hash,),
        )
        self._meta_set(conn, "migrations_v1_done", "1")

    def seed_default_users(
        self,
        default_password: str = DEFAULT_RESIDENT_PASSWORD,
        force: bool = False,
    ) -> int:
        inserted = 0

        with self._connect() as conn:
            if not force and self._meta_get(conn, "default_users_seeded") == "1":
                return 0

            password_hash = self._hash_password(default_password)

            if self._is_postgres:
                result = conn.execute(
                    """
                    INSERT INTO users (
                        username,
                        password_hash,
                        role,
                        building_number,
                        apartment_number,
                        phone_number
                    )
                    SELECT
                        'bloc' || b::text || '_apt' || a::text AS username,
                        %s,
                        'resident',
                        b,
                        a,
                        ''
                    FROM generate_series(1, %s) AS b
                    CROSS JOIN generate_series(1, 16) AS a
                    ON CONFLICT (username) DO UPDATE
                    SET role = 'resident',
                        building_number = EXCLUDED.building_number,
                        apartment_number = EXCLUDED.apartment_number,
                        password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
                    """,
                    (password_hash, TOTAL_BUILDINGS),
                )
                inserted = max(int(result.rowcount or 0), 0)
                self._meta_set(conn, "default_users_seeded", "1")
                return inserted

            for building in range(1, TOTAL_BUILDINGS + 1):
                for apartment in range(1, 17):
                    username = f"bloc{building}_apt{apartment}"
                    row = conn.execute(
                        "SELECT id, password_hash, role FROM users WHERE username = ?",
                        (username,),
                    ).fetchone()
                    if row:
                        conn.execute(
                            """
                            UPDATE users
                            SET role = 'resident',
                                building_number = ?,
                                apartment_number = ?,
                                password_hash = COALESCE(password_hash, ?)
                            WHERE id = ?
                            """,
                            (building, apartment, password_hash, int(row["id"])),
                        )
                        continue

                    conn.execute(
                        """
                        INSERT INTO users (
                            username,
                            password_hash,
                            role,
                            building_number,
                            apartment_number,
                            phone_number
                        )
                        VALUES (?, ?, 'resident', ?, ?, '')
                        """,
                        (username, password_hash, building, apartment),
                    )
                    inserted += 1

            self._meta_set(conn, "default_users_seeded", "1")

        return inserted

    def ensure_admin_user(
        self,
        username: str = DEFAULT_ADMIN_USERNAME,
        password: str = DEFAULT_ADMIN_PASSWORD,
        reset_password: bool = False,
    ) -> None:
        username = self._normalize_username(username)
        if not username:
            raise SlotValidationError("admin username cannot be empty")
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            if existing:
                password_hash = str(existing["password_hash"] or "")
                update_password = reset_password or not password_hash
                if update_password:
                    password_hash = self._hash_password(password)
                    conn.execute(
                        """
                        UPDATE users
                        SET role = 'admin',
                            building_number = 0,
                            apartment_number = 0,
                            password_hash = ?
                        WHERE id = ?
                        """,
                        (password_hash, int(existing["id"])),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE users
                        SET role = 'admin',
                            building_number = 0,
                            apartment_number = 0
                        WHERE id = ?
                        """,
                        (int(existing["id"]),),
                    )
                return

            password_hash = self._hash_password(password)
            conn.execute(
                """
                INSERT INTO users (
                    username,
                    password_hash,
                    role,
                    building_number,
                    apartment_number,
                    phone_number
                )
                VALUES (?, ?, 'admin', 0, 0, '')
                """,
                (username, password_hash),
            )

    @staticmethod
    def _meta_get(conn, key: str) -> Optional[str]:
        row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
        if not row:
            return None
        return str(row["value"])

    @staticmethod
    def _meta_set(conn, key: str, value: str) -> None:
        conn.execute(
            """
            INSERT INTO app_meta (key, value)
            VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (key, value),
        )

    @staticmethod
    def _postgres_columns(conn, table_name: str) -> set[str]:
        rows = conn.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            """,
            (table_name,),
        ).fetchall()
        return {str(row["column_name"]) for row in rows}

    def authenticate_user(self, username: str, password: str) -> UserAccount:
        username = self._normalize_username(username)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, username, password_hash, role, building_number, apartment_number, phone_number
                FROM users
                WHERE username = ?
                """,
                (username,),
            ).fetchone()

        if not row:
            raise AuthenticationError("invalid username or password")

        password_hash = row["password_hash"]
        if not password_hash or not self._verify_password(password, str(password_hash)):
            raise AuthenticationError("invalid username or password")

        return self._user_from_row(row)

    def list_users(self, building_number: Optional[int] = None) -> list[UserAccount]:
        params: list[object] = []
        where = ""
        if building_number is not None:
            self._validate_building_number(building_number)
            where = "WHERE building_number = ?"
            params.append(building_number)

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, username, role, building_number, apartment_number, phone_number
                FROM users
                {where}
                ORDER BY role DESC, building_number ASC, apartment_number ASC
                """,
                params,
            ).fetchall()

        return [self._user_from_row(row) for row in rows]

    def create_user(
        self,
        username: str,
        password: str,
        building_number: int,
        apartment_number: int,
        role: str = "resident",
        phone_number: str = "",
    ) -> UserAccount:
        username = self._normalize_username(username)
        if not username:
            raise SlotValidationError("username cannot be empty")
        if role not in {"resident", "admin"}:
            raise SlotValidationError("role must be resident or admin")

        if role == "admin":
            building_number = 0
            apartment_number = 0
        else:
            inferred_building = self._infer_building_from_username(username)
            if inferred_building is not None:
                building_number = inferred_building
            self._validate_building_number(building_number)
            if apartment_number < 1 or apartment_number > 16:
                raise SlotValidationError("apartment_number must be between 1 and 16")

        if not password:
            raise SlotValidationError("password cannot be empty")
        phone_number = phone_number.strip()

        with self._connect() as conn:
            try:
                user_id = conn.execute(
                    """
                    INSERT INTO users (
                        username,
                        password_hash,
                        role,
                        building_number,
                        apartment_number,
                        phone_number
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        username,
                        self._hash_password(password),
                        role,
                        building_number,
                        apartment_number,
                        phone_number,
                    ),
                ).lastrowid
            except Exception as exc:
                if isinstance(exc, sqlite3.IntegrityError) or "unique" in str(exc).lower():
                    raise SlotValidationError("username already exists") from exc
                raise

        return UserAccount(
            id=int(user_id),
            username=username,
            role=role,
            building_number=building_number,
            apartment_number=apartment_number,
            phone_number=phone_number,
        )

    def get_user_by_id(self, user_id: int) -> UserAccount:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, username, role, building_number, apartment_number, phone_number
                FROM users
                WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
        if not row:
            raise UserNotFoundError(f"user {user_id} not found")
        return self._user_from_row(row)

    def get_user_by_username(self, username: str) -> UserAccount:
        username = self._normalize_username(username)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, username, role, building_number, apartment_number, phone_number
                FROM users
                WHERE username = ?
                """,
                (username,),
            ).fetchone()
        if not row:
            raise UserNotFoundError(f"user '{username}' not found")
        return self._user_from_row(row)

    def create_availability_slot(
        self,
        owner_username: str,
        parking_space_number: str,
        parking_type: str,
        available_from: str,
        available_until: str,
        owner_user: Optional[UserAccount] = None,
    ) -> ParkingSlot:
        owner = owner_user or self.get_user_by_username(owner_username)
        if owner.role == "admin":
            raise AuthorizationError("admin cannot share parking spots directly")
        self._validate_building_number(owner.building_number)

        self._validate_parking_type(parking_type)
        from_dt = self._parse_iso_datetime(available_from)
        until_dt = self._parse_iso_datetime(available_until)
        if from_dt >= until_dt:
            raise SlotValidationError("available_from must be before available_until")

        space_number = parking_space_number.strip()
        if not space_number:
            raise SlotValidationError("parking_space_number cannot be empty")

        with self._connect() as conn:
            overlap = conn.execute(
                """
                SELECT id
                FROM parking_slots
                WHERE owner_user_id = ?
                  AND parking_space_number = ?
                  AND status IN ('OPEN', 'RESERVED')
                  AND NOT (available_until <= ? OR available_from >= ?)
                LIMIT 1
                """,
                (
                    owner.id,
                    space_number,
                    available_from,
                    available_until,
                ),
            ).fetchone()
            if overlap:
                raise SlotValidationError(
                    "owner already has an overlapping slot for this parking space"
                )

            slot_id = conn.execute(
                """
                INSERT INTO parking_slots (
                    building_number,
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    owner.building_number,
                    owner.id,
                    space_number,
                    parking_type,
                    available_from,
                    available_until,
                ),
            ).lastrowid

        return self.get_slot(int(slot_id))

    def list_open_slots(
        self,
        requested_from: Optional[str] = None,
        requested_until: Optional[str] = None,
        parking_type: Optional[str] = None,
        building_number: Optional[int] = None,
        exclude_owner_username: Optional[str] = None,
        exclude_owner_user_id: Optional[int] = None,
    ) -> list[ParkingSlot]:
        params: list[object] = []
        where = ["ps.status = 'OPEN'"]

        if parking_type is not None:
            self._validate_parking_type(parking_type)
            where.append("ps.parking_type = ?")
            params.append(parking_type)

        if building_number is not None:
            self._validate_building_number(building_number)
            where.append("ps.building_number = ?")
            params.append(building_number)

        if exclude_owner_user_id is not None:
            where.append("ps.owner_user_id != ?")
            params.append(exclude_owner_user_id)
        elif exclude_owner_username:
            owner = self.get_user_by_username(exclude_owner_username)
            where.append("ps.owner_user_id != ?")
            params.append(owner.id)

        if requested_from is not None and requested_until is not None:
            from_dt = self._parse_iso_datetime(requested_from)
            until_dt = self._parse_iso_datetime(requested_until)
            if from_dt >= until_dt:
                raise SlotValidationError("requested_from must be before requested_until")
            where.append("ps.available_from <= ?")
            where.append("ps.available_until >= ?")
            params.extend([requested_from, requested_until])
        elif requested_from is not None or requested_until is not None:
            raise SlotValidationError(
                "requested_from and requested_until must be provided together"
            )

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    ps.id,
                    ps.building_number,
                    owner.username AS owner_username,
                    owner.phone_number AS owner_phone_number,
                    ps.parking_space_number,
                    ps.parking_type,
                    ps.available_from,
                    ps.available_until,
                    ps.status,
                    reserver.username AS reserved_by_username,
                    reserver.phone_number AS reserved_by_phone_number,
                    ps.claim_phone_number,
                    ps.reservation_from,
                    ps.reservation_until
                FROM parking_slots ps
                JOIN users owner ON owner.id = ps.owner_user_id
                LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
                WHERE {' AND '.join(where)}
                ORDER BY ps.available_from ASC, ps.id ASC
                """,
                params,
            ).fetchall()

        return [self._slot_from_row(row) for row in rows]

    def auto_reserve_slot(
        self,
        requester_username: str,
        requested_from: str,
        requested_until: str,
        parking_type: Optional[str] = None,
        building_number: Optional[int] = None,
        claim_phone_number: Optional[str] = None,
        requester_user: Optional[UserAccount] = None,
    ) -> ParkingSlot:
        requester = requester_user or self.get_user_by_username(requester_username)
        if requester.role == "admin" and building_number is None:
            raise SlotValidationError("admin must provide building_number to claim a slot")
        target_building = (
            building_number
            if building_number is not None
            else requester.building_number
        )
        self._validate_building_number(target_building)

        from_dt = self._parse_iso_datetime(requested_from)
        until_dt = self._parse_iso_datetime(requested_until)
        if from_dt >= until_dt:
            raise SlotValidationError("requested_from must be before requested_until")

        if parking_type is not None:
            self._validate_parking_type(parking_type)

        params: list[object] = [requester.id, target_building, requested_from, requested_until]
        where = [
            "ps.status = 'OPEN'",
            "ps.owner_user_id != ?",
            "ps.building_number = ?",
            "ps.available_from <= ?",
            "ps.available_until >= ?",
        ]
        if parking_type is not None:
            where.append("ps.parking_type = ?")
            params.append(parking_type)

        with self._connect() as conn:
            slot_row = conn.execute(
                f"""
                SELECT
                    ps.id,
                    ps.building_number,
                    ps.owner_user_id,
                    ps.parking_space_number,
                    ps.parking_type,
                    ps.available_from,
                    ps.available_until
                FROM parking_slots ps
                WHERE {' AND '.join(where)}
                ORDER BY ps.available_from ASC, ps.id ASC
                LIMIT 1
                """,
                params,
            ).fetchone()

            if slot_row is None:
                raise SlotNotFoundError("no matching open parking slot found")

            self._reserve_slot(
                conn=conn,
                slot_row=slot_row,
                requester_id=requester.id,
                requested_from=requested_from,
                requested_until=requested_until,
                claim_phone_number=claim_phone_number or requester.phone_number,
            )

        return self.get_slot(int(slot_row["id"]))

    def reserve_specific_slot(
        self,
        requester_username: str,
        slot_id: int,
        requested_from: str,
        requested_until: str,
        claim_phone_number: Optional[str] = None,
        requester_user: Optional[UserAccount] = None,
    ) -> ParkingSlot:
        requester = requester_user or self.get_user_by_username(requester_username)
        from_dt = self._parse_iso_datetime(requested_from)
        until_dt = self._parse_iso_datetime(requested_until)
        if from_dt >= until_dt:
            raise SlotValidationError("requested_from must be before requested_until")

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    id,
                    building_number,
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until,
                    status
                FROM parking_slots
                WHERE id = ?
                """,
                (slot_id,),
            ).fetchone()
            if row is None:
                raise SlotNotFoundError(f"slot {slot_id} not found")
            if str(row["status"]) != "OPEN":
                raise SlotValidationError("slot is not open for reservation")
            if int(row["owner_user_id"]) == requester.id:
                raise SlotValidationError("cannot claim your own shared spot")
            slot_from = self._parse_iso_datetime(str(row["available_from"]))
            slot_until = self._parse_iso_datetime(str(row["available_until"]))
            if from_dt < slot_from or until_dt > slot_until:
                raise SlotValidationError("requested period must be within slot availability")

            self._reserve_slot(
                conn=conn,
                slot_row=row,
                requester_id=requester.id,
                requested_from=requested_from,
                requested_until=requested_until,
                claim_phone_number=claim_phone_number or requester.phone_number,
            )

        return self.get_slot(int(slot_id))

    def list_slots_shared_by_user(self, username: str) -> list[ParkingSlot]:
        user = self.get_user_by_username(username)
        return self.list_slots_shared_by_user_id(user.id)

    def list_slots_claimed_by_user(self, username: str) -> list[ParkingSlot]:
        user = self.get_user_by_username(username)
        return self.list_slots_claimed_by_user_id(user.id)

    def list_slots_claimed_on_user_spaces(self, username: str) -> list[ParkingSlot]:
        user = self.get_user_by_username(username)
        return self.list_slots_claimed_on_user_spaces_id(user.id)

    def list_slots_shared_by_user_id(self, user_id: int) -> list[ParkingSlot]:
        return self._list_slots("ps.owner_user_id = ?", [user_id])

    def list_slots_claimed_by_user_id(self, user_id: int) -> list[ParkingSlot]:
        return self._list_slots("ps.reserved_by_user_id = ?", [user_id])

    def list_slots_claimed_on_user_spaces_id(self, user_id: int) -> list[ParkingSlot]:
        return self._list_slots(
            "ps.owner_user_id = ? AND ps.status = 'RESERVED'",
            [user_id],
        )

    @staticmethod
    def _reserve_slot(
        conn,
        slot_row,
        requester_id: int,
        requested_from: str,
        requested_until: str,
        claim_phone_number: str = "",
    ) -> None:
        slot_id = int(slot_row["id"])
        slot_from = str(slot_row["available_from"])
        slot_until = str(slot_row["available_until"])
        slot_from_dt = ParkingService._parse_iso_datetime(slot_from)
        slot_until_dt = ParkingService._parse_iso_datetime(slot_until)
        requested_from_dt = ParkingService._parse_iso_datetime(requested_from)
        requested_until_dt = ParkingService._parse_iso_datetime(requested_until)
        if requested_from_dt < slot_from_dt or requested_until_dt > slot_until_dt:
            raise SlotValidationError("requested period must be within slot availability")
        now = datetime.utcnow().isoformat(timespec="seconds")

        # Lock in the claimed interval on the original row.
        updated = conn.execute(
            """
            UPDATE parking_slots
            SET status = 'RESERVED',
                reserved_by_user_id = ?,
                reserved_at = ?,
                claim_phone_number = ?,
                reservation_from = ?,
                reservation_until = ?,
                available_from = ?,
                available_until = ?
            WHERE id = ?
              AND status = 'OPEN'
              AND available_from = ?
              AND available_until = ?
            """,
            (
                requester_id,
                now,
                claim_phone_number.strip(),
                requested_from,
                requested_until,
                requested_from,
                requested_until,
                slot_id,
                slot_from,
                slot_until,
            ),
        )
        if updated.rowcount == 0:
            raise SlotValidationError("slot was reserved by another user, retry")

        # Create remaining OPEN fragments for any unclaimed time.
        if slot_from_dt < requested_from_dt:
            conn.execute(
                """
                INSERT INTO parking_slots (
                    building_number,
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, 'OPEN')
                """,
                (
                    int(slot_row["building_number"]),
                    int(slot_row["owner_user_id"]),
                    str(slot_row["parking_space_number"]),
                    str(slot_row["parking_type"]),
                    slot_from,
                    requested_from,
                ),
            )

        if requested_until_dt < slot_until_dt:
            conn.execute(
                """
                INSERT INTO parking_slots (
                    building_number,
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, 'OPEN')
                """,
                (
                    int(slot_row["building_number"]),
                    int(slot_row["owner_user_id"]),
                    str(slot_row["parking_space_number"]),
                    str(slot_row["parking_type"]),
                    requested_until,
                    slot_until,
                ),
            )

    def _list_slots(self, where_clause: str, params: list[object]) -> list[ParkingSlot]:
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    ps.id,
                    ps.building_number,
                    owner.username AS owner_username,
                    owner.phone_number AS owner_phone_number,
                    ps.parking_space_number,
                    ps.parking_type,
                    ps.available_from,
                    ps.available_until,
                    ps.status,
                    reserver.username AS reserved_by_username,
                    reserver.phone_number AS reserved_by_phone_number,
                    ps.claim_phone_number,
                    ps.reservation_from,
                    ps.reservation_until
                FROM parking_slots ps
                JOIN users owner ON owner.id = ps.owner_user_id
                LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
                WHERE {where_clause}
                ORDER BY ps.available_from DESC, ps.id DESC
                """,
                params,
            ).fetchall()
        return [self._slot_from_row(row) for row in rows]

    def get_slot(self, slot_id: int) -> ParkingSlot:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    ps.id,
                    ps.building_number,
                    owner.username AS owner_username,
                    owner.phone_number AS owner_phone_number,
                    ps.parking_space_number,
                    ps.parking_type,
                    ps.available_from,
                    ps.available_until,
                    ps.status,
                    reserver.username AS reserved_by_username,
                    reserver.phone_number AS reserved_by_phone_number,
                    ps.claim_phone_number,
                    ps.reservation_from,
                    ps.reservation_until
                FROM parking_slots ps
                JOIN users owner ON owner.id = ps.owner_user_id
                LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
                WHERE ps.id = ?
                """,
                (slot_id,),
            ).fetchone()
        if row is None:
            raise SlotNotFoundError(f"slot {slot_id} not found")
        return self._slot_from_row(row)

    def list_building_stats(self) -> list[dict[str, int]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    building_number,
                    SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_shared_slots,
                    SUM(CASE WHEN status = 'RESERVED' THEN 1 ELSE 0 END) AS reserved_shared_slots
                FROM parking_slots
                GROUP BY building_number
                """
            ).fetchall()

        by_building = {
            int(row["building_number"]): {
                "open_shared_slots": int(row["open_shared_slots"] or 0),
                "reserved_shared_slots": int(row["reserved_shared_slots"] or 0),
            }
            for row in rows
        }

        stats: list[dict[str, int]] = []
        for building_number in range(1, TOTAL_BUILDINGS + 1):
            shared = by_building.get(
                building_number,
                {"open_shared_slots": 0, "reserved_shared_slots": 0},
            )
            stats.append(
                {
                    "building_number": building_number,
                    "underground_spaces": UNDERGROUND_CAPACITY_PER_BUILDING,
                    "above_ground_spaces": ABOVE_GROUND_CAPACITY_PER_BUILDING,
                    "open_shared_slots": shared["open_shared_slots"],
                    "reserved_shared_slots": shared["reserved_shared_slots"],
                }
            )
        return stats

    @staticmethod
    def _validate_parking_type(parking_type: str) -> None:
        if parking_type not in PARKING_TYPES:
            allowed = ", ".join(sorted(PARKING_TYPES))
            raise SlotValidationError(f"parking_type must be one of: {allowed}")

    @staticmethod
    def _validate_building_number(building_number: int) -> None:
        if building_number < 1 or building_number > TOTAL_BUILDINGS:
            raise SlotValidationError(f"building_number must be between 1 and {TOTAL_BUILDINGS}")

    @staticmethod
    def _parse_iso_datetime(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except ValueError as exc:
            raise SlotValidationError(
                f"invalid datetime '{value}', use ISO format like 2026-02-14T18:30"
            ) from exc

    @staticmethod
    def _normalize_username(username: str) -> str:
        return username.strip().lower()

    @staticmethod
    def _infer_building_from_username(username: str) -> Optional[int]:
        match = re.match(r"^bloc([1-9]|10)(?:_|\b)", username)
        if not match:
            return None
        return int(match.group(1))

    @staticmethod
    def _user_from_row(row: sqlite3.Row) -> UserAccount:
        return UserAccount(
            id=int(row["id"]),
            username=str(row["username"]),
            role=str(row["role"]),
            building_number=int(row["building_number"]),
            apartment_number=int(row["apartment_number"]),
            phone_number=str(row["phone_number"] or ""),
        )

    @staticmethod
    def _slot_from_row(row: sqlite3.Row) -> ParkingSlot:
        return ParkingSlot(
            id=int(row["id"]),
            building_number=int(row["building_number"]),
            owner_username=str(row["owner_username"]),
            owner_phone_number=str(row["owner_phone_number"] or ""),
            parking_space_number=str(row["parking_space_number"]),
            parking_type=str(row["parking_type"]),
            available_from=str(row["available_from"]),
            available_until=str(row["available_until"]),
            status=str(row["status"]),
            reserved_by_username=(
                str(row["reserved_by_username"])
                if row["reserved_by_username"] is not None
                else None
            ),
            reserved_by_phone_number=str(row["reserved_by_phone_number"] or ""),
            reservation_contact_phone=str(row["claim_phone_number"] or ""),
            reservation_from=(
                str(row["reservation_from"]) if row["reservation_from"] is not None else None
            ),
            reservation_until=(
                str(row["reservation_until"])
                if row["reservation_until"] is not None
                else None
            ),
        )

    @staticmethod
    def _hash_password(password: str) -> str:
        if not password:
            raise SlotValidationError("password cannot be empty")
        iterations = 200_000
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        ).hex()
        return f"pbkdf2_sha256${iterations}${salt}${digest}"

    @staticmethod
    def _verify_password(password: str, encoded: str) -> bool:
        try:
            algorithm, iterations, salt, digest = encoded.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            computed = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                int(iterations),
            ).hex()
            return hmac.compare_digest(computed, digest)
        except Exception:
            return False
