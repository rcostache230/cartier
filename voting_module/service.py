from __future__ import annotations

import os
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - optional dependency for local sqlite-only runs
    psycopg = None
    dict_row = None

POLL_TYPES = {"yes_no", "multiple_choice", "weighted"}
POLL_SCOPES = {"neighbourhood", "building"}
POLL_STATUSES = {"draft", "active", "closed", "archived"}
MIN_OPTIONS = 2
MAX_OPTIONS = 10
TOTAL_BUILDINGS = 10


class VotingModuleError(Exception):
    """Base error for voting module operations."""


class PollNotFoundError(VotingModuleError):
    """Raised when a poll cannot be found."""


class PollValidationError(VotingModuleError):
    """Raised when poll data is invalid."""


class VoteValidationError(VotingModuleError):
    """Raised when a vote submission is invalid."""


class VotingAuthorizationError(VotingModuleError):
    """Raised when a user is not allowed to perform an action."""


@dataclass(frozen=True)
class Poll:
    id: str
    title: str
    description: str
    poll_type: str
    created_by: int
    scope: str
    building_id: Optional[int]
    status: str
    allow_multiple_selections: bool
    show_results_before_close: bool
    requires_quorum: bool
    quorum_percentage: Optional[int]
    start_date: str
    end_date: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class PollOption:
    id: str
    poll_id: str
    label: str
    position: int


@dataclass(frozen=True)
class Vote:
    id: str
    poll_id: str
    user_id: int
    option_id: str
    weight: int
    cast_at: str


@dataclass(frozen=True)
class PollAttachment:
    id: str
    poll_id: str
    file_url: str
    file_name: str
    file_type: str


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
        return _PGExecutionResult(cursor)

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


class VotingService:
    """Database-backed polling and voting service."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path or self._default_db_path()
        self._is_postgres = self.db_path.startswith(("postgres://", "postgresql://"))
        self._initialize_db()

    @staticmethod
    def _default_db_path() -> str:
        configured = (
            os.getenv("VOTING_DB_PATH")
            or os.getenv("PARKING_DB_PATH")
            or os.getenv("DATABASE_URL")
            or os.getenv("POSTGRES_URL_NON_POOLING")
            or os.getenv("POSTGRES_URL")
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
        ddl = """
        CREATE TABLE IF NOT EXISTS polls (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            poll_type TEXT NOT NULL,
            created_by BIGINT NOT NULL,
            scope TEXT NOT NULL,
            building_id INTEGER,
            status TEXT NOT NULL DEFAULT 'draft',
            allow_multiple_selections BOOLEAN NOT NULL DEFAULT FALSE,
            show_results_before_close BOOLEAN NOT NULL DEFAULT FALSE,
            requires_quorum BOOLEAN NOT NULL DEFAULT FALSE,
            quorum_percentage INTEGER,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (poll_type IN ('yes_no', 'multiple_choice', 'weighted')),
            CHECK (scope IN ('neighbourhood', 'building')),
            CHECK (status IN ('draft', 'active', 'closed', 'archived'))
        );

        CREATE TABLE IF NOT EXISTS poll_options (
            id TEXT PRIMARY KEY,
            poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            position INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS votes (
            id TEXT PRIMARY KEY,
            poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL,
            option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
            weight INTEGER NOT NULL DEFAULT 1,
            cast_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS votes_unique_option
            ON votes (poll_id, user_id, option_id);

        CREATE TABLE IF NOT EXISTS poll_attachments (
            id TEXT PRIMARY KEY,
            poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            file_url TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_type TEXT NOT NULL
        );
        """

        with self._connect() as conn:
            conn.executescript(ddl)

    @staticmethod
    def _normalize_title(title: str) -> str:
        return title.strip()

    @staticmethod
    def _normalize_description(description: Optional[str]) -> str:
        return (description or "").strip()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def _parse_datetime(value: str, field_name: str) -> datetime:
        if not value:
            raise PollValidationError(f"{field_name} is required")
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise PollValidationError(f"{field_name} must be ISO datetime") from exc
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    @staticmethod
    def _validate_building_number(building_id: int) -> None:
        if building_id < 1 or building_id > TOTAL_BUILDINGS:
            raise PollValidationError("building_id must be between 1 and 10")

    def _poll_from_row(self, row) -> Poll:
        return Poll(
            id=str(row["id"]),
            title=str(row["title"]),
            description=str(row["description"] or ""),
            poll_type=str(row["poll_type"]),
            created_by=int(row["created_by"]),
            scope=str(row["scope"]),
            building_id=int(row["building_id"]) if row["building_id"] is not None else None,
            status=str(row["status"]),
            allow_multiple_selections=bool(row["allow_multiple_selections"]),
            show_results_before_close=bool(row["show_results_before_close"]),
            requires_quorum=bool(row["requires_quorum"]),
            quorum_percentage=int(row["quorum_percentage"]) if row["quorum_percentage"] is not None else None,
            start_date=str(row["start_date"]),
            end_date=str(row["end_date"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _option_from_row(self, row) -> PollOption:
        return PollOption(
            id=str(row["id"]),
            poll_id=str(row["poll_id"]),
            label=str(row["label"]),
            position=int(row["position"]),
        )

    def _vote_from_row(self, row) -> Vote:
        return Vote(
            id=str(row["id"]),
            poll_id=str(row["poll_id"]),
            user_id=int(row["user_id"]),
            option_id=str(row["option_id"]),
            weight=int(row["weight"]),
            cast_at=str(row["cast_at"]),
        )

    def _attachment_from_row(self, row) -> PollAttachment:
        return PollAttachment(
            id=str(row["id"]),
            poll_id=str(row["poll_id"]),
            file_url=str(row["file_url"]),
            file_name=str(row["file_name"]),
            file_type=str(row["file_type"]),
        )

    def _validate_options(self, poll_type: str, option_labels: Iterable[str]) -> list[str]:
        if poll_type == "yes_no":
            return ["Yes", "No"]

        labels = [label.strip() for label in option_labels if label and str(label).strip()]
        if len(labels) < MIN_OPTIONS or len(labels) > MAX_OPTIONS:
            raise PollValidationError("options must include between 2 and 10 entries")
        if len({label.lower() for label in labels}) != len(labels):
            raise PollValidationError("options must be unique")
        if any(len(label) > 300 for label in labels):
            raise PollValidationError("option labels must be at most 300 characters")
        return labels

    def create_poll(
        self,
        *,
        title: str,
        description: Optional[str],
        poll_type: str,
        created_by: int,
        scope: str,
        building_id: Optional[int],
        status: str = "draft",
        allow_multiple_selections: bool = False,
        show_results_before_close: bool = False,
        requires_quorum: bool = False,
        quorum_percentage: Optional[int] = None,
        start_date: str,
        end_date: str,
        option_labels: Optional[Iterable[str]] = None,
        attachments: Optional[Iterable[dict[str, str]]] = None,
    ) -> Poll:
        title = self._normalize_title(title)
        if not title:
            raise PollValidationError("title is required")
        if len(title) > 200:
            raise PollValidationError("title must be at most 200 characters")

        description = self._normalize_description(description)
        if poll_type not in POLL_TYPES:
            raise PollValidationError("poll_type must be yes_no, multiple_choice, or weighted")
        if scope not in POLL_SCOPES:
            raise PollValidationError("scope must be neighbourhood or building")
        if status not in POLL_STATUSES:
            raise PollValidationError("status must be draft, active, closed, or archived")

        if scope == "building":
            if building_id is None:
                raise PollValidationError("building_id is required for building scope")
            self._validate_building_number(int(building_id))
        else:
            building_id = None

        if poll_type != "multiple_choice":
            allow_multiple_selections = False

        if requires_quorum:
            if quorum_percentage is None:
                raise PollValidationError("quorum_percentage is required when requires_quorum is true")
            if quorum_percentage < 1 or quorum_percentage > 100:
                raise PollValidationError("quorum_percentage must be between 1 and 100")
        else:
            quorum_percentage = None

        start_dt = self._parse_datetime(start_date, "start_date")
        end_dt = self._parse_datetime(end_date, "end_date")
        if end_dt <= start_dt:
            raise PollValidationError("end_date must be after start_date")

        labels = self._validate_options(poll_type, option_labels or [])

        poll_id = str(uuid.uuid4())
        now = self._now_iso()

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO polls (
                    id,
                    title,
                    description,
                    poll_type,
                    created_by,
                    scope,
                    building_id,
                    status,
                    allow_multiple_selections,
                    show_results_before_close,
                    requires_quorum,
                    quorum_percentage,
                    start_date,
                    end_date,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    poll_id,
                    title,
                    description,
                    poll_type,
                    created_by,
                    scope,
                    building_id,
                    status,
                    bool(allow_multiple_selections),
                    bool(show_results_before_close),
                    bool(requires_quorum),
                    quorum_percentage,
                    start_dt.isoformat(),
                    end_dt.isoformat(),
                    now,
                    now,
                ),
            )

            for position, label in enumerate(labels, start=1):
                option_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO poll_options (id, poll_id, label, position)
                    VALUES (?, ?, ?, ?)
                    """,
                    (option_id, poll_id, label, position),
                )

            if attachments:
                for attachment in attachments:
                    file_url = str(attachment.get("file_url", "")).strip()
                    file_name = str(attachment.get("file_name", "")).strip()
                    file_type = str(attachment.get("file_type", "")).strip()
                    if not file_url or not file_name or not file_type:
                        raise PollValidationError("attachments require file_url, file_name, file_type")
                    conn.execute(
                        """
                        INSERT INTO poll_attachments (id, poll_id, file_url, file_name, file_type)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (str(uuid.uuid4()), poll_id, file_url, file_name, file_type),
                    )

        return self.get_poll(poll_id)

    def list_polls(
        self,
        *,
        scope: Optional[str] = None,
        status: Optional[str] = None,
        building_id: Optional[int] = None,
        viewer_role: Optional[str] = None,
        viewer_building: Optional[int] = None,
    ) -> list[Poll]:
        clauses = []
        params: list[object] = []

        if scope:
            if scope not in POLL_SCOPES:
                raise PollValidationError("scope must be neighbourhood or building")
            clauses.append("scope = ?")
            params.append(scope)
        if status:
            if status not in POLL_STATUSES:
                raise PollValidationError("status must be draft, active, closed, or archived")
            clauses.append("status = ?")
            params.append(status)
        if building_id is not None:
            self._validate_building_number(building_id)
            clauses.append("building_id = ?")
            params.append(building_id)

        if viewer_role != "admin":
            if viewer_building is None:
                raise VotingAuthorizationError("building context required")
            clauses.append("(scope = 'neighbourhood' OR (scope = 'building' AND building_id = ?))")
            params.append(viewer_building)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM polls
                {where}
                ORDER BY created_at DESC
                """,
                params,
            ).fetchall()

        return [self._poll_from_row(row) for row in rows]

    def get_poll(self, poll_id: str) -> Poll:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if not row:
            raise PollNotFoundError("poll not found")
        return self._poll_from_row(row)

    def get_poll_options(self, poll_id: str) -> list[PollOption]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM poll_options
                WHERE poll_id = ?
                ORDER BY position ASC
                """,
                (poll_id,),
            ).fetchall()
        return [self._option_from_row(row) for row in rows]

    def get_poll_attachments(self, poll_id: str) -> list[PollAttachment]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM poll_attachments
                WHERE poll_id = ?
                ORDER BY file_name ASC
                """,
                (poll_id,),
            ).fetchall()
        return [self._attachment_from_row(row) for row in rows]

    def add_poll_attachments(
        self,
        poll_id: str,
        attachments: Iterable[dict[str, str]],
    ) -> list[PollAttachment]:
        if not attachments:
            raise PollValidationError("attachments cannot be empty")
        self.get_poll(poll_id)
        added: list[PollAttachment] = []
        with self._connect() as conn:
            for attachment in attachments:
                file_url = str(attachment.get("file_url", "")).strip()
                file_name = str(attachment.get("file_name", "")).strip()
                file_type = str(attachment.get("file_type", "")).strip()
                if not file_url or not file_name or not file_type:
                    raise PollValidationError("attachments require file_url, file_name, file_type")
                attachment_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO poll_attachments (id, poll_id, file_url, file_name, file_type)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (attachment_id, poll_id, file_url, file_name, file_type),
                )
                added.append(
                    PollAttachment(
                        id=attachment_id,
                        poll_id=poll_id,
                        file_url=file_url,
                        file_name=file_name,
                        file_type=file_type,
                    )
                )
        return added

    def update_poll_status(self, poll_id: str, status: str) -> Poll:
        if status not in POLL_STATUSES:
            raise PollValidationError("status must be draft, active, closed, or archived")
        now = self._now_iso()
        with self._connect() as conn:
            result = conn.execute(
                """
                UPDATE polls
                SET status = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, now, poll_id),
            )
            if result.rowcount == 0:
                raise PollNotFoundError("poll not found")
        return self.get_poll(poll_id)

    def _ensure_poll_open_for_voting(self, poll: Poll) -> None:
        if poll.status != "active":
            raise VoteValidationError("poll is not active")
        now = datetime.now(timezone.utc)
        start_dt = self._parse_datetime(poll.start_date, "start_date")
        end_dt = self._parse_datetime(poll.end_date, "end_date")
        if now < start_dt:
            raise VoteValidationError("poll has not started yet")
        if now > end_dt:
            raise VoteValidationError("poll has ended")

    @staticmethod
    def _ensure_resident(role: str) -> None:
        if role != "resident":
            raise VotingAuthorizationError("resident access required")

    def _ensure_scope_access(self, poll: Poll, user_building: int) -> None:
        if poll.scope == "building":
            if poll.building_id is None:
                raise VoteValidationError("poll missing building scope")
            if poll.building_id != user_building:
                raise VotingAuthorizationError("poll restricted to another building")

    def _poll_option_ids(self, poll_id: str) -> list[str]:
        options = self.get_poll_options(poll_id)
        if not options:
            raise PollValidationError("poll has no options")
        return [opt.id for opt in options]

    def _existing_votes(self, poll_id: str, user_id: int) -> list[Vote]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM votes
                WHERE poll_id = ? AND user_id = ?
                """,
                (poll_id, user_id),
            ).fetchall()
        return [self._vote_from_row(row) for row in rows]

    def cast_vote(
        self,
        *,
        poll_id: str,
        user_id: int,
        user_role: str,
        user_building: int,
        selections: Iterable[str],
    ) -> list[Vote]:
        poll = self.get_poll(poll_id)
        self._ensure_resident(user_role)
        self._ensure_scope_access(poll, user_building)
        self._ensure_poll_open_for_voting(poll)

        selections = [str(item) for item in selections if item]
        if not selections:
            raise VoteValidationError("vote selections cannot be empty")

        option_ids = self._poll_option_ids(poll_id)
        option_set = set(option_ids)

        if poll.poll_type == "weighted":
            if len(selections) != len(option_ids):
                raise VoteValidationError("weighted polls require ranking all options")
            if set(selections) != option_set:
                raise VoteValidationError("weighted rankings must include each option exactly once")
            if self._existing_votes(poll_id, user_id):
                raise VoteValidationError("vote already submitted for this poll")

            now = self._now_iso()
            votes: list[Vote] = []
            with self._connect() as conn:
                for rank, option_id in enumerate(selections, start=1):
                    vote_id = str(uuid.uuid4())
                    conn.execute(
                        """
                        INSERT INTO votes (id, poll_id, user_id, option_id, weight, cast_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (vote_id, poll_id, user_id, option_id, rank, now),
                    )
                    votes.append(
                        Vote(
                            id=vote_id,
                            poll_id=poll_id,
                            user_id=user_id,
                            option_id=option_id,
                            weight=rank,
                            cast_at=now,
                        )
                    )
            return votes

        if len(selections) != len(set(selections)):
            raise VoteValidationError("duplicate selections are not allowed")
        if any(option_id not in option_set for option_id in selections):
            raise VoteValidationError("invalid option selection")

        existing = self._existing_votes(poll_id, user_id)
        if poll.poll_type in {"yes_no", "multiple_choice"} and not poll.allow_multiple_selections:
            if existing:
                raise VoteValidationError("vote already submitted for this poll")
            if len(selections) != 1:
                raise VoteValidationError("exactly one option must be selected")
        else:
            existing_option_ids = {vote.option_id for vote in existing}
            if existing_option_ids.intersection(selections):
                raise VoteValidationError("already voted for one or more selected options")

        now = self._now_iso()
        votes: list[Vote] = []
        with self._connect() as conn:
            for option_id in selections:
                vote_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO votes (id, poll_id, user_id, option_id, weight, cast_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (vote_id, poll_id, user_id, option_id, 1, now),
                )
                votes.append(
                    Vote(
                        id=vote_id,
                        poll_id=poll_id,
                        user_id=user_id,
                        option_id=option_id,
                        weight=1,
                        cast_at=now,
                    )
                )
        return votes

    def get_results(self, poll_id: str) -> dict[str, object]:
        poll = self.get_poll(poll_id)
        options = self.get_poll_options(poll_id)
        option_map = {opt.id: opt for opt in options}
        if not options:
            raise PollValidationError("poll has no options")

        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT option_id, COUNT(*) AS total
                FROM votes
                WHERE poll_id = ?
                GROUP BY option_id
                """,
                (poll_id,),
            ).fetchall()
            distinct_row = conn.execute(
                """
                SELECT COUNT(DISTINCT user_id) AS total
                FROM votes
                WHERE poll_id = ?
                """,
                (poll_id,),
            ).fetchone()

        counts = {opt.id: 0 for opt in options}
        for row in rows:
            counts[str(row["option_id"])] = int(row["total"])

        unique_voters = int(distinct_row["total"]) if distinct_row else 0
        eligible_voters = self._eligible_voters(poll)
        turnout_pct = 0.0
        if eligible_voters:
            turnout_pct = (unique_voters / eligible_voters) * 100
        quorum_met = True
        if poll.requires_quorum:
            quorum_met = turnout_pct >= float(poll.quorum_percentage or 0)

        result_status = "valid"
        if poll.requires_quorum and poll.status == "closed" and not quorum_met:
            result_status = "quorum_not_met"

        if poll.poll_type == "weighted":
            with self._connect() as conn:
                vote_rows = conn.execute(
                    """
                    SELECT option_id, weight
                    FROM votes
                    WHERE poll_id = ?
                    """,
                    (poll_id,),
                ).fetchall()
            option_count = len(options)
            points = {opt.id: 0 for opt in options}
            for row in vote_rows:
                option_id = str(row["option_id"])
                weight = int(row["weight"])
                points[option_id] += max(option_count - weight + 1, 0)
            winners = self._winners_from_metric(points)
            options_payload = [
                {
                    "id": opt.id,
                    "label": opt.label,
                    "position": opt.position,
                    "points": points.get(opt.id, 0),
                }
                for opt in options
            ]
            options_payload.sort(key=lambda item: (-item["points"], item["position"]))
            total_points = sum(points.values())
            return {
                "poll": poll,
                "options": options_payload,
                "total_votes": sum(counts.values()),
                "unique_voters": unique_voters,
                "eligible_voters": eligible_voters,
                "turnout_percentage": round(turnout_pct, 2),
                "quorum_met": quorum_met,
                "result_status": result_status,
                "winners": winners,
                "total_points": total_points,
            }

        total_votes = sum(counts.values())
        options_payload = []
        for opt in options:
            count = counts.get(opt.id, 0)
            percentage = 0.0
            if total_votes:
                percentage = (count / total_votes) * 100
            options_payload.append(
                {
                    "id": opt.id,
                    "label": opt.label,
                    "position": opt.position,
                    "votes": count,
                    "percentage": round(percentage, 2),
                }
            )
        options_payload.sort(key=lambda item: (-item.get("votes", 0), item["position"]))
        winners = self._winners_from_metric({opt["id"]: opt["votes"] for opt in options_payload})

        return {
            "poll": poll,
            "options": options_payload,
            "total_votes": total_votes,
            "unique_voters": unique_voters,
            "eligible_voters": eligible_voters,
            "turnout_percentage": round(turnout_pct, 2),
            "quorum_met": quorum_met,
            "result_status": result_status,
            "winners": winners,
        }

    @staticmethod
    def _winners_from_metric(metric: dict[str, int]) -> list[str]:
        if not metric:
            return []
        max_value = max(metric.values())
        return [key for key, value in metric.items() if value == max_value]

    def _eligible_voters(self, poll: Poll) -> int:
        params: list[object] = ["resident"]
        where = "role = ?"
        if poll.scope == "building":
            if poll.building_id is None:
                raise PollValidationError("poll missing building scope")
            where += " AND building_number = ?"
            params.append(poll.building_id)

        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM users
                WHERE {where}
                """,
                params,
            ).fetchone()

        if not row:
            return 0
        return int(row["total"])

    def list_votes_for_user(self, poll_id: str, user_id: int) -> list[Vote]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM votes
                WHERE poll_id = ? AND user_id = ?
                ORDER BY cast_at ASC
                """,
                (poll_id, user_id),
            ).fetchall()
        return [self._vote_from_row(row) for row in rows]
