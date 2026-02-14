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
class ParkingSlot:
    id: int
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

                CREATE TABLE IF NOT EXISTS parking_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                    FOREIGN KEY(reserved_by_user_id) REFERENCES users(id)
                );
                """
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

    def create_availability_slot(
        self,
        owner_username: str,
        parking_space_number: str,
        parking_type: str,
        available_from: str,
        available_until: str,
    ) -> ParkingSlot:
        owner_user_id = self._user_id(owner_username)
        self._validate_parking_type(parking_type)
        from_dt = self._parse_iso_datetime(available_from)
        until_dt = self._parse_iso_datetime(available_until)
        if from_dt >= until_dt:
            raise SlotValidationError("available_from must be before available_until")

        if not parking_space_number.strip():
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
                    owner_user_id,
                    parking_space_number.strip(),
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
                    owner_user_id,
                    parking_space_number,
                    parking_type,
                    available_from,
                    available_until
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    owner_user_id,
                    parking_space_number.strip(),
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
    ) -> list[ParkingSlot]:
        params: list[object] = []
        where = ["ps.status = 'OPEN'"]

        if parking_type is not None:
            self._validate_parking_type(parking_type)
            where.append("ps.parking_type = ?")
            params.append(parking_type)

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
    ) -> ParkingSlot:
        requester_id = self._user_id(requester_username)
        from_dt = self._parse_iso_datetime(requested_from)
        until_dt = self._parse_iso_datetime(requested_until)
        if from_dt >= until_dt:
            raise SlotValidationError("requested_from must be before requested_until")
        if parking_type is not None:
            self._validate_parking_type(parking_type)

        with self._connect() as conn:
            params: list[object] = [requester_id, requested_from, requested_until]
            where = [
                "ps.status = 'OPEN'",
                "ps.owner_user_id != ?",
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
                    requester_id,
                    now_iso,
                    requested_from,
                    requested_until,
                    slot_row["id"],
                ),
            )

            if updated.rowcount == 0:
                raise SlotValidationError("slot was reserved by another user, retry")

        return self.get_slot(slot_row["id"])

    def get_slot(self, slot_id: int) -> ParkingSlot:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    ps.id,
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

    def _user_id(self, username: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM users WHERE username = ?",
                (username,),
            ).fetchone()
        if row is None:
            raise UserNotFoundError(f"user '{username}' not found")
        return int(row["id"])

    @staticmethod
    def _validate_parking_type(parking_type: str) -> None:
        if parking_type not in PARKING_TYPES:
            allowed = ", ".join(sorted(PARKING_TYPES))
            raise SlotValidationError(f"parking_type must be one of: {allowed}")

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
