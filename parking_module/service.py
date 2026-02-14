from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

PARKING_TYPES = {"above_ground", "underground"}


class ParkingModuleError(Exception):
    """Base error for parking module operations."""


class UserNotFoundError(ParkingModuleError):
    """Raised when a user does not exist."""


class SlotValidationError(ParkingModuleError):
    """Raised for invalid slot inputs or state transitions."""


class SlotNotFoundError(ParkingModuleError):
    """Raised when a slot cannot be found for an operation."""


@dataclass(frozen=True)
class UserAccount:
    id: int
    username: str
    building_number: int
    apartment_number: int


@dataclass(frozen=True)
class BuildingParkingSpace:
    id: int
    building_number: int
    parking_space_number: str
    parking_type: str
    assigned_apartment_number: Optional[int]


@dataclass(frozen=True)
class ParkingSlot:
    id: int
    building_number: int
    owner_username: str
    parking_space_number: str
    parking_type: str
    available_from: str
    available_until: str
    status: str
    reserved_by_username: Optional[str]
    reservation_from: Optional[str]
    reservation_until: Optional[str]


class ParkingService:
    """SQLite-backed parking slot sharing and auto-reservation service."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._initialize_db()

    @staticmethod
    def _default_db_path() -> str:
        configured = os.getenv("PARKING_DB_PATH")
        if configured:
            return configured
        if os.getenv("VERCEL"):
            # Vercel serverless filesystem is read-only except /tmp.
            return "/tmp/parking_module.db"
        return "parking_module.db"

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize_db(self) -> None:
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
                    building_number INTEGER NOT NULL,
                    apartment_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS building_parking_spaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    building_number INTEGER NOT NULL,
                    parking_space_number TEXT NOT NULL,
                    parking_type TEXT NOT NULL,
                    assigned_apartment_number INTEGER,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(building_number, parking_space_number)
                );

                CREATE TABLE IF NOT EXISTS parking_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    building_number INTEGER NOT NULL,
                    parking_space_id INTEGER,
                    owner_user_id INTEGER NOT NULL,
                    parking_space_number TEXT NOT NULL,
                    parking_type TEXT NOT NULL,
                    available_from TEXT NOT NULL,
                    available_until TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'OPEN',
                    reserved_by_user_id INTEGER,
                    reserved_at TEXT,
                    reservation_from TEXT,
                    reservation_until TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY(owner_user_id) REFERENCES users(id),
                    FOREIGN KEY(reserved_by_user_id) REFERENCES users(id),
                    FOREIGN KEY(parking_space_id) REFERENCES building_parking_spaces(id)
                );
                """
            )
            self._ensure_parking_slots_migrations(conn)

    @staticmethod
    def _ensure_parking_slots_migrations(conn: sqlite3.Connection) -> None:
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(parking_slots)").fetchall()
        }
        if "building_number" not in cols:
            conn.execute(
                "ALTER TABLE parking_slots ADD COLUMN building_number INTEGER DEFAULT 1"
            )
        if "parking_space_id" not in cols:
            conn.execute(
                "ALTER TABLE parking_slots ADD COLUMN parking_space_id INTEGER"
            )

    def seed_default_users(self) -> int:
        """
        Seed users for 10 buildings x 16 apartments.
        Usernames are generated as Bloc{building}_Apt{apartment}.
        """
        inserted = 0
        with self._connect() as conn:
            for building in range(1, 11):
                for apartment in range(1, 17):
                    username = f"Bloc{building}_Apt{apartment}"
                    row = conn.execute(
                        "SELECT 1 FROM users WHERE username = ?",
                        (username,),
                    ).fetchone()
                    if row:
                        continue
                    conn.execute(
                        """
                        INSERT INTO users (username, building_number, apartment_number)
                        VALUES (?, ?, ?)
                        """,
                        (username, building, apartment),
                    )
                    inserted += 1
        return inserted

    def seed_building_parking_spaces(
        self,
        underground_per_building: int = 10,
        above_ground_per_building: int = 6,
    ) -> int:
        if underground_per_building <= 0 or above_ground_per_building <= 0:
            raise SlotValidationError("parking slot counts must be greater than zero")

        inserted = 0
        with self._connect() as conn:
            for building in range(1, 11):
                for index in range(1, underground_per_building + 1):
                    inserted += self._insert_parking_space_if_missing(
                        conn=conn,
                        building_number=building,
                        parking_space_number=f"U{index:02d}",
                        parking_type="underground",
                        assigned_apartment_number=index,
                    )

                for index in range(1, above_ground_per_building + 1):
                    inserted += self._insert_parking_space_if_missing(
                        conn=conn,
                        building_number=building,
                        parking_space_number=f"A{index:02d}",
                        parking_type="above_ground",
                        assigned_apartment_number=underground_per_building + index,
                    )
        return inserted

    @staticmethod
    def _insert_parking_space_if_missing(
        conn: sqlite3.Connection,
        building_number: int,
        parking_space_number: str,
        parking_type: str,
        assigned_apartment_number: Optional[int],
    ) -> int:
        exists = conn.execute(
            """
            SELECT 1
            FROM building_parking_spaces
            WHERE building_number = ?
              AND parking_space_number = ?
            """,
            (building_number, parking_space_number),
        ).fetchone()
        if exists:
            return 0

        conn.execute(
            """
            INSERT INTO building_parking_spaces (
                building_number,
                parking_space_number,
                parking_type,
                assigned_apartment_number
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                building_number,
                parking_space_number,
                parking_type,
                assigned_apartment_number,
            ),
        )
        return 1

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
                SELECT id, username, building_number, apartment_number
                FROM users
                {where}
                ORDER BY building_number ASC, apartment_number ASC
                """,
                params,
            ).fetchall()

        return [
            UserAccount(
                id=int(row["id"]),
                username=str(row["username"]),
                building_number=int(row["building_number"]),
                apartment_number=int(row["apartment_number"]),
            )
            for row in rows
        ]

    def create_user(
        self,
        username: str,
        building_number: int,
        apartment_number: int,
    ) -> UserAccount:
        username = username.strip()
        if not username:
            raise SlotValidationError("username cannot be empty")
        self._validate_building_number(building_number)
        if apartment_number < 1 or apartment_number > 16:
            raise SlotValidationError("apartment_number must be between 1 and 16")

        with self._connect() as conn:
            try:
                user_id = conn.execute(
                    """
                    INSERT INTO users (username, building_number, apartment_number)
                    VALUES (?, ?, ?)
                    """,
                    (username, building_number, apartment_number),
                ).lastrowid
            except sqlite3.IntegrityError as exc:
                raise SlotValidationError("username already exists") from exc

        return UserAccount(
            id=int(user_id),
            username=username,
            building_number=building_number,
            apartment_number=apartment_number,
        )

    def list_parking_spaces(
        self,
        building_number: Optional[int] = None,
        parking_type: Optional[str] = None,
    ) -> list[BuildingParkingSpace]:
        params: list[object] = []
        where: list[str] = []

        if building_number is not None:
            self._validate_building_number(building_number)
            where.append("building_number = ?")
            params.append(building_number)

        if parking_type is not None:
            self._validate_parking_type(parking_type)
            where.append("parking_type = ?")
            params.append(parking_type)

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    id,
                    building_number,
                    parking_space_number,
                    parking_type,
                    assigned_apartment_number
                FROM building_parking_spaces
                {where_sql}
                ORDER BY building_number ASC, parking_type ASC, parking_space_number ASC
                """,
                params,
            ).fetchall()

        return [self._space_from_row(row) for row in rows]

    def list_building_stats(self) -> list[dict[str, object]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    b.building_number,
                    SUM(CASE WHEN b.parking_type = 'underground' THEN 1 ELSE 0 END) AS underground_spaces,
                    SUM(CASE WHEN b.parking_type = 'above_ground' THEN 1 ELSE 0 END) AS above_ground_spaces,
                    SUM(CASE WHEN ps.status = 'OPEN' THEN 1 ELSE 0 END) AS open_shared_slots,
                    SUM(CASE WHEN ps.status = 'RESERVED' THEN 1 ELSE 0 END) AS reserved_shared_slots
                FROM building_parking_spaces b
                LEFT JOIN parking_slots ps
                    ON ps.parking_space_id = b.id
                   AND ps.status IN ('OPEN', 'RESERVED')
                GROUP BY b.building_number
                ORDER BY b.building_number ASC
                """
            ).fetchall()

        return [
            {
                "building_number": int(row["building_number"]),
                "underground_spaces": int(row["underground_spaces"] or 0),
                "above_ground_spaces": int(row["above_ground_spaces"] or 0),
                "open_shared_slots": int(row["open_shared_slots"] or 0),
                "reserved_shared_slots": int(row["reserved_shared_slots"] or 0),
            }
            for row in rows
        ]

    def create_availability_slot(
        self,
        owner_username: str,
        parking_space_number: str,
        parking_type: str,
        available_from: str,
        available_until: str,
    ) -> ParkingSlot:
        owner = self._user_by_username(owner_username)
        self._validate_parking_type(parking_type)
        from_dt = self._parse_iso_datetime(available_from)
        until_dt = self._parse_iso_datetime(available_until)
        if from_dt >= until_dt:
            raise SlotValidationError("available_from must be before available_until")

        parking_space_number = parking_space_number.strip().upper()
        if not parking_space_number:
            raise SlotValidationError("parking_space_number cannot be empty")

        with self._connect() as conn:
            space = conn.execute(
                """
                SELECT id, parking_type, assigned_apartment_number
                FROM building_parking_spaces
                WHERE building_number = ?
                  AND parking_space_number = ?
                """,
                (owner.building_number, parking_space_number),
            ).fetchone()
            if not space:
                raise SlotValidationError(
                    "parking space does not exist in owner's building"
                )
            if str(space["parking_type"]) != parking_type:
                raise SlotValidationError(
                    "parking_type does not match the selected parking space"
                )

            assigned_apartment = (
                int(space["assigned_apartment_number"])
                if space["assigned_apartment_number"] is not None
                else None
            )
            if assigned_apartment is not None and assigned_apartment != owner.apartment_number:
                raise SlotValidationError(
                    "selected parking space is assigned to a different apartment"
                )

            overlap = conn.execute(
                """
                SELECT id
                FROM parking_slots
                WHERE owner_user_id = ?
                  AND building_number = ?
                  AND parking_space_number = ?
                  AND status IN ('OPEN', 'RESERVED')
                  AND NOT (available_until <= ? OR available_from >= ?)
                LIMIT 1
                """,
                (
                    owner.id,
                    owner.building_number,
                    parking_space_number,
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
                    parking_space_id,
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    owner.building_number,
                    int(space["id"]),
                    owner.id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until,
                ),
            ).lastrowid

        return self.get_slot(slot_id)

    def list_open_slots(
        self,
        requested_from: Optional[str] = None,
        requested_until: Optional[str] = None,
        parking_type: Optional[str] = None,
        building_number: Optional[int] = None,
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

        query = f"""
            SELECT
                ps.id,
                ps.building_number,
                owner.username AS owner_username,
                ps.parking_space_number,
                ps.parking_type,
                ps.available_from,
                ps.available_until,
                ps.status,
                reserver.username AS reserved_by_username,
                ps.reservation_from,
                ps.reservation_until
            FROM parking_slots ps
            JOIN users owner ON owner.id = ps.owner_user_id
            LEFT JOIN users reserver ON reserver.id = ps.reserved_by_user_id
            WHERE {' AND '.join(where)}
            ORDER BY ps.available_from ASC, ps.id ASC
        """
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._slot_from_row(row) for row in rows]

    def auto_reserve_slot(
        self,
        requester_username: str,
        requested_from: str,
        requested_until: str,
        parking_type: Optional[str] = None,
        building_number: Optional[int] = None,
    ) -> ParkingSlot:
        requester = self._user_by_username(requester_username)
        target_building = building_number if building_number is not None else requester.building_number
        self._validate_building_number(target_building)

        from_dt = self._parse_iso_datetime(requested_from)
        until_dt = self._parse_iso_datetime(requested_until)
        if from_dt >= until_dt:
            raise SlotValidationError("requested_from must be before requested_until")
        if parking_type is not None:
            self._validate_parking_type(parking_type)

        with self._connect() as conn:
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

            slot_row = conn.execute(
                f"""
                SELECT ps.id
                FROM parking_slots ps
                WHERE {' AND '.join(where)}
                ORDER BY ps.available_from ASC, ps.id ASC
                LIMIT 1
                """,
                params,
            ).fetchone()

            if slot_row is None:
                raise SlotNotFoundError("no matching open parking slot found")

            now_iso = datetime.utcnow().isoformat(timespec="seconds")
            updated = conn.execute(
                """
                UPDATE parking_slots
                SET status = 'RESERVED',
                    reserved_by_user_id = ?,
                    reserved_at = ?,
                    reservation_from = ?,
                    reservation_until = ?
                WHERE id = ?
                  AND status = 'OPEN'
                """,
                (
                    requester.id,
                    now_iso,
                    requested_from,
                    requested_until,
                    int(slot_row["id"]),
                ),
            )

            if updated.rowcount == 0:
                raise SlotValidationError("slot was reserved by another user, retry")

        return self.get_slot(int(slot_row["id"]))

    def get_slot(self, slot_id: int) -> ParkingSlot:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    ps.id,
                    ps.building_number,
                    owner.username AS owner_username,
                    ps.parking_space_number,
                    ps.parking_type,
                    ps.available_from,
                    ps.available_until,
                    ps.status,
                    reserver.username AS reserved_by_username,
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

    def _user_by_username(self, username: str) -> UserAccount:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, username, building_number, apartment_number
                FROM users
                WHERE username = ?
                """,
                (username,),
            ).fetchone()
        if row is None:
            raise UserNotFoundError(f"user '{username}' not found")
        return UserAccount(
            id=int(row["id"]),
            username=str(row["username"]),
            building_number=int(row["building_number"]),
            apartment_number=int(row["apartment_number"]),
        )

    @staticmethod
    def _validate_parking_type(parking_type: str) -> None:
        if parking_type not in PARKING_TYPES:
            allowed = ", ".join(sorted(PARKING_TYPES))
            raise SlotValidationError(f"parking_type must be one of: {allowed}")

    @staticmethod
    def _validate_building_number(building_number: int) -> None:
        if building_number < 1 or building_number > 10:
            raise SlotValidationError("building_number must be between 1 and 10")

    @staticmethod
    def _parse_iso_datetime(value: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except ValueError as exc:
            raise SlotValidationError(
                f"invalid datetime '{value}', use ISO format like 2026-02-14T18:30"
            ) from exc

    @staticmethod
    def _slot_from_row(row: sqlite3.Row) -> ParkingSlot:
        return ParkingSlot(
            id=int(row["id"]),
            building_number=int(row["building_number"]),
            owner_username=str(row["owner_username"]),
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
    def _space_from_row(row: sqlite3.Row) -> BuildingParkingSpace:
        return BuildingParkingSpace(
            id=int(row["id"]),
            building_number=int(row["building_number"]),
            parking_space_number=str(row["parking_space_number"]),
            parking_type=str(row["parking_type"]),
            assigned_apartment_number=(
                int(row["assigned_apartment_number"])
                if row["assigned_apartment_number"] is not None
                else None
            ),
        )
