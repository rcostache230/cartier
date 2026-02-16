from __future__ import annotations

import os
import threading
from dataclasses import asdict
from functools import wraps
from typing import Callable, TypeVar

from flask import Flask, jsonify, render_template, request, session

from parking_module import (
    AuthenticationError,
    AuthorizationError,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_RESIDENT_PASSWORD,
    PARKING_TYPES,
    ParkingModuleError,
    ParkingService,
    SlotNotFoundError,
    SlotValidationError,
    UserAccount,
    UserNotFoundError,
)
from voting_module import (
    PollNotFoundError,
    PollValidationError,
    VoteValidationError,
    VotingAuthorizationError,
    VotingModuleError,
    VotingService,
)

app = Flask(__name__, template_folder="templates")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change-this-secret")

_service_instance: ParkingService | None = None
_service_lock = threading.Lock()
_voting_service_instance: VotingService | None = None
_voting_service_lock = threading.Lock()

F = TypeVar("F", bound=Callable[..., object])


class ServiceUnavailableError(Exception):
    """Raised when the database/service cannot be initialized."""


def _json_error(message: str, status: int, details: dict | None = None):
    payload = {"error": message}
    if details:
        payload["details"] = details
    return jsonify(payload), status


def _payload_error(message: str, details: dict | None = None, status: int = 400):
    return _json_error(message, status, details)


def _service() -> ParkingService:
    global _service_instance
    if _service_instance is not None:
        return _service_instance
    with _service_lock:
        if _service_instance is not None:
            return _service_instance
        try:
            svc = ParkingService()
            svc.seed_default_users(DEFAULT_RESIDENT_PASSWORD)
            svc.ensure_admin_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
            _service_instance = svc
            return svc
        except Exception as exc:
            raise ServiceUnavailableError(
                f"service initialization failed: {type(exc).__name__}: {exc}"
            ) from exc


def _voting_service() -> VotingService:
    global _voting_service_instance
    if _voting_service_instance is not None:
        return _voting_service_instance
    with _voting_service_lock:
        if _voting_service_instance is not None:
            return _voting_service_instance
        try:
            parking = _service()
            svc = VotingService(parking.db_path)
            _voting_service_instance = svc
            return svc
        except Exception as exc:
            raise ServiceUnavailableError(
                f"voting service initialization failed: {type(exc).__name__}: {exc}"
            ) from exc


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise SlotValidationError(f"invalid integer value: {value}") from exc


def _validate_poll_payload(payload: dict) -> tuple[dict, dict]:
    errors: dict[str, str] = {}

    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        errors["title"] = "required string (max 200 chars)"
    elif len(title.strip()) > 200:
        errors["title"] = "must be at most 200 characters"

    description = payload.get("description")
    if description is not None and not isinstance(description, str):
        errors["description"] = "must be a string"

    poll_type = payload.get("poll_type")
    if poll_type not in {"yes_no", "multiple_choice", "weighted"}:
        errors["poll_type"] = "must be yes_no, multiple_choice, or weighted"

    scope = payload.get("scope")
    if scope not in {"neighbourhood", "building"}:
        errors["scope"] = "must be neighbourhood or building"

    status = payload.get("status", "draft")
    if status not in {"draft", "active", "closed", "archived"}:
        errors["status"] = "must be draft, active, closed, or archived"

    allow_multiple_selections = payload.get("allow_multiple_selections", False)
    if not isinstance(allow_multiple_selections, bool):
        errors["allow_multiple_selections"] = "must be boolean"

    show_results_before_close = payload.get("show_results_before_close", False)
    if not isinstance(show_results_before_close, bool):
        errors["show_results_before_close"] = "must be boolean"

    requires_quorum = payload.get("requires_quorum", False)
    if not isinstance(requires_quorum, bool):
        errors["requires_quorum"] = "must be boolean"

    quorum_percentage = payload.get("quorum_percentage")
    if requires_quorum:
        if quorum_percentage is None:
            errors["quorum_percentage"] = "required when requires_quorum is true"
        else:
            try:
                quorum_percentage = int(quorum_percentage)
            except (TypeError, ValueError):
                errors["quorum_percentage"] = "must be integer 1-100"
            else:
                if quorum_percentage < 1 or quorum_percentage > 100:
                    errors["quorum_percentage"] = "must be between 1 and 100"
    else:
        quorum_percentage = None

    start_date = payload.get("start_date")
    if not isinstance(start_date, str) or not start_date.strip():
        errors["start_date"] = "required ISO datetime string"

    end_date = payload.get("end_date")
    if not isinstance(end_date, str) or not end_date.strip():
        errors["end_date"] = "required ISO datetime string"

    building_id = payload.get("building_id")
    if scope == "building":
        if building_id is None:
            errors["building_id"] = "required for building scope"
    if building_id is not None:
        try:
            building_id = int(building_id)
        except (TypeError, ValueError):
            errors["building_id"] = "must be integer 1-10"
        else:
            if building_id < 1 or building_id > 10:
                errors["building_id"] = "must be between 1 and 10"

    options = payload.get("options", [])
    if poll_type in {"multiple_choice", "weighted"}:
        if not isinstance(options, list):
            errors["options"] = "must be an array of option labels"
        else:
            invalid_items = [item for item in options if not isinstance(item, str) or not item.strip()]
            if invalid_items:
                errors["options"] = "each option must be a non-empty string"
            else:
                normalized = [item.strip() for item in options]
                if len(normalized) < 2 or len(normalized) > 10:
                    errors["options"] = "must include between 2 and 10 options"
                options = normalized

    if poll_type != "multiple_choice" and allow_multiple_selections:
        errors["allow_multiple_selections"] = "only allowed for multiple_choice polls"

    attachments = payload.get("attachments")
    if attachments is not None:
        if not isinstance(attachments, list):
            errors["attachments"] = "must be an array"
        else:
            for idx, attachment in enumerate(attachments, start=1):
                if not isinstance(attachment, dict):
                    errors[f"attachments[{idx}]"] = "must be an object"
                    continue
                for key in ("file_url", "file_name", "file_type"):
                    value = attachment.get(key)
                    if not isinstance(value, str) or not value.strip():
                        errors[f"attachments[{idx}].{key}"] = "required string"

    cleaned = {
        "title": str(title or ""),
        "description": description,
        "poll_type": str(poll_type or ""),
        "scope": str(scope or ""),
        "building_id": building_id,
        "status": str(status or "draft"),
        "allow_multiple_selections": bool(allow_multiple_selections),
        "show_results_before_close": bool(show_results_before_close),
        "requires_quorum": bool(requires_quorum),
        "quorum_percentage": quorum_percentage,
        "start_date": str(start_date or ""),
        "end_date": str(end_date or ""),
        "options": options,
        "attachments": attachments,
    }

    return cleaned, errors


def _validate_vote_payload(payload: dict) -> tuple[list[str], dict]:
    errors: dict[str, str] = {}
    present_keys = [key for key in ("ranking", "option_ids", "option_id") if key in payload]
    if not present_keys:
        errors["selections"] = "provide ranking, option_ids, or option_id"
        return [], errors
    if len(present_keys) > 1:
        errors["selections"] = "provide only one of ranking, option_ids, or option_id"
        return [], errors

    key = present_keys[0]
    selections = payload.get(key)

    if isinstance(selections, str):
        selections = [selections]
    if not isinstance(selections, list):
        errors[key] = "must be a list of option ids"
        return [], errors

    if any(not isinstance(item, str) or not item.strip() for item in selections):
        errors[key] = "option ids must be non-empty strings"
        return [], errors

    normalized = [item.strip() for item in selections]
    if not normalized:
        errors[key] = "must include at least one option id"
    if len(normalized) != len(set(normalized)):
        errors[key] = "duplicate option ids are not allowed"

    return normalized, errors


def _current_user() -> UserAccount:
    user_id = session.get("user_id")
    if not user_id:
        raise AuthenticationError("authentication required")
    try:
        return _service().get_user_by_id(int(user_id))
    except UserNotFoundError as exc:
        session.clear()
        raise AuthenticationError("authentication required") from exc


def login_required(fn: F) -> F:
    @wraps(fn)
    def wrapper(*args, **kwargs):
        _current_user()
        return fn(*args, **kwargs)

    return wrapper  # type: ignore[return-value]


def admin_required(fn: F) -> F:
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = _current_user()
        if user.role != "admin":
            raise AuthorizationError("admin access required")
        return fn(*args, **kwargs)

    return wrapper  # type: ignore[return-value]


@app.errorhandler(AuthenticationError)
def _handle_authentication(err: AuthenticationError):
    return _json_error(str(err), 401)


@app.errorhandler(AuthorizationError)
def _handle_authorization(err: AuthorizationError):
    return _json_error(str(err), 403)


@app.errorhandler(UserNotFoundError)
def _handle_user_not_found(err: UserNotFoundError):
    return _json_error(str(err), 404)


@app.errorhandler(SlotNotFoundError)
def _handle_slot_not_found(err: SlotNotFoundError):
    return _json_error(str(err), 404)


@app.errorhandler(SlotValidationError)
def _handle_slot_validation(err: SlotValidationError):
    return _json_error(str(err), 400)


@app.errorhandler(ParkingModuleError)
def _handle_parking_error(err: ParkingModuleError):
    return _json_error(str(err), 400)


@app.errorhandler(PollNotFoundError)
def _handle_poll_not_found(err: PollNotFoundError):
    return _json_error(str(err), 404)


@app.errorhandler(PollValidationError)
def _handle_poll_validation(err: PollValidationError):
    return _json_error(str(err), 400)


@app.errorhandler(VoteValidationError)
def _handle_vote_validation(err: VoteValidationError):
    return _json_error(str(err), 400)


@app.errorhandler(VotingAuthorizationError)
def _handle_voting_authorization(err: VotingAuthorizationError):
    return _json_error(str(err), 403)


@app.errorhandler(VotingModuleError)
def _handle_voting_module_error(err: VotingModuleError):
    return _json_error(str(err), 400)


@app.errorhandler(ServiceUnavailableError)
def _handle_service_unavailable(err: ServiceUnavailableError):
    return _json_error(str(err), 503)


@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")


@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    try:
        svc = _service()
    except ServiceUnavailableError as exc:
        return (
            jsonify(
                {
                    "status": "degraded",
                    "error": str(exc),
                }
            ),
            503,
        )
    return jsonify({"status": "ok", "db_backend": "postgres" if svc._is_postgres else "sqlite"})


@app.route("/api", methods=["GET"])
def api_root():
    return jsonify(
        {
            "service": "neighbourhood-parking-api",
            "version": "3.0.0",
            "defaults": {
                "admin_username": DEFAULT_ADMIN_USERNAME,
            },
            "parking_types": sorted(PARKING_TYPES),
            "endpoints": {
                "claim_specific_slot": "POST /api/slots/claim",
                "polls": "GET /api/polls",
                "poll_create": "POST /api/polls",
                "poll_vote": "POST /api/polls/<poll_id>/vote",
                "poll_results": "GET /api/polls/<poll_id>/results",
            },
        }
    )


@app.route("/api/auth/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", ""))
    password = str(payload.get("password", ""))
    user = _service().authenticate_user(username, password)
    session["user_id"] = user.id
    return jsonify({"user": asdict(user)}), 200


@app.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    try:
        user = _current_user()
    except AuthenticationError:
        return jsonify({"authenticated": False}), 200
    return jsonify({"authenticated": True, "user": asdict(user)}), 200


@app.route("/api/users", methods=["GET"])
@admin_required
def list_users():
    building_number = _parse_optional_int(request.args.get("building_number"))
    users = _service().list_users(building_number=building_number)
    return jsonify([asdict(user) for user in users]), 200


@app.route("/api/users", methods=["POST"])
@admin_required
def create_user():
    payload = request.get_json(silent=True) or {}
    user = _service().create_user(
        username=str(payload.get("username", "")),
        password=str(payload.get("password", DEFAULT_RESIDENT_PASSWORD)),
        role=str(payload.get("role", "resident")),
        building_number=int(payload.get("building_number", 0)),
        apartment_number=int(payload.get("apartment_number", 0)),
        phone_number=str(payload.get("phone_number", "")),
    )
    return jsonify(asdict(user)), 201


@app.route("/api/users/reset-defaults", methods=["POST"])
@admin_required
def reset_defaults():
    svc = _service()
    inserted = svc.seed_default_users(DEFAULT_RESIDENT_PASSWORD, force=True)
    svc.ensure_admin_user(
        DEFAULT_ADMIN_USERNAME,
        DEFAULT_ADMIN_PASSWORD,
        reset_password=True,
    )
    return jsonify({"inserted_or_updated": inserted}), 200


@app.route("/api/slots", methods=["POST"])
@login_required
def create_slot():
    payload = request.get_json(silent=True) or {}
    user = _current_user()
    slot = _service().create_availability_slot(
        owner_username=user.username,
        parking_space_number=str(payload.get("parking_space_number", "")),
        parking_type=str(payload.get("parking_type", "")),
        available_from=str(payload.get("available_from", "")),
        available_until=str(payload.get("available_until", "")),
        owner_user=user,
    )
    return jsonify(asdict(slot)), 201


@app.route("/api/admin/slots", methods=["POST"])
@admin_required
def admin_create_slot():
    payload = request.get_json(silent=True) or {}
    slot = _service().create_availability_slot(
        owner_username=str(payload.get("owner_username", "")),
        parking_space_number=str(payload.get("parking_space_number", "")),
        parking_type=str(payload.get("parking_type", "")),
        available_from=str(payload.get("available_from", "")),
        available_until=str(payload.get("available_until", "")),
    )
    return jsonify(asdict(slot)), 201


@app.route("/api/slots/open", methods=["GET"])
@login_required
def list_open_slots():
    user = _current_user()
    requested_from = request.args.get("requested_from")
    requested_until = request.args.get("requested_until")
    parking_type = request.args.get("parking_type")
    building_number = _parse_optional_int(request.args.get("building_number"))
    exclude_self = request.args.get("exclude_self", "1") != "0"

    slots = _service().list_open_slots(
        requested_from=requested_from,
        requested_until=requested_until,
        parking_type=parking_type,
        building_number=building_number,
        exclude_owner_user_id=user.id if exclude_self else None,
    )
    return jsonify([asdict(slot) for slot in slots]), 200


@app.route("/api/slots/auto-reserve", methods=["POST"])
@login_required
def auto_reserve_slot():
    payload = request.get_json(silent=True) or {}
    user = _current_user()
    building_number = payload.get("building_number")
    slot = _service().auto_reserve_slot(
        requester_username=user.username,
        requested_from=str(payload.get("requested_from", "")),
        requested_until=str(payload.get("requested_until", "")),
        parking_type=payload.get("parking_type"),
        building_number=int(building_number) if building_number is not None else None,
        claim_phone_number=str(payload.get("claim_phone_number", "")),
        requester_user=user,
    )
    return jsonify(asdict(slot)), 200


@app.route("/api/slots/claim", methods=["POST"])
@login_required
def claim_specific_slot():
    payload = request.get_json(silent=True) or {}
    user = _current_user()
    slot = _service().reserve_specific_slot(
        requester_username=user.username,
        slot_id=int(payload.get("slot_id", 0)),
        requested_from=str(payload.get("requested_from", "")),
        requested_until=str(payload.get("requested_until", "")),
        claim_phone_number=str(payload.get("claim_phone_number", "")),
        requester_user=user,
    )
    return jsonify(asdict(slot)), 200


@app.route("/api/buildings/stats", methods=["GET"])
@login_required
def building_stats():
    return jsonify(_service().list_building_stats()), 200


@app.route("/api/dashboard", methods=["GET"])
@login_required
def dashboard():
    user = _current_user()
    building_number = _parse_optional_int(request.args.get("building_number"))
    svc = _service()

    shared_spots = svc.list_open_slots(
        building_number=building_number,
        exclude_owner_username=None,
    )
    my_shared = svc.list_slots_shared_by_user_id(user.id)
    my_claimed = svc.list_slots_claimed_by_user_id(user.id)
    claimed_on_my = svc.list_slots_claimed_on_user_spaces_id(user.id)

    return jsonify(
        {
            "current_user": asdict(user),
            "building_stats": svc.list_building_stats(),
            "shared_parking_spots": [asdict(slot) for slot in shared_spots],
            "my_shared_parking_spots": [asdict(slot) for slot in my_shared],
            "my_shared_claimed_by_neighbours": [asdict(slot) for slot in claimed_on_my],
            "my_claimed_parking_spots": [asdict(slot) for slot in my_claimed],
        }
    )


def _ensure_poll_visible(poll, user: UserAccount) -> None:
    if user.role == "admin":
        return
    if poll.scope == "building" and poll.building_id != user.building_number:
        raise VotingAuthorizationError("poll restricted to another building")


@app.route("/api/polls", methods=["GET"])
@login_required
def list_polls():
    user = _current_user()
    scope = request.args.get("scope")
    status = request.args.get("status")
    building_id_raw = request.args.get("building_id")

    errors: dict[str, str] = {}
    if scope is not None and scope not in {"neighbourhood", "building"}:
        errors["scope"] = "must be neighbourhood or building"
    if status is not None and status not in {"draft", "active", "closed", "archived"}:
        errors["status"] = "must be draft, active, closed, or archived"

    building_id = None
    if building_id_raw is not None and building_id_raw != "":
        try:
            building_id = int(building_id_raw)
        except ValueError:
            errors["building_id"] = "must be integer 1-10"
        else:
            if building_id < 1 or building_id > 10:
                errors["building_id"] = "must be between 1 and 10"

    if errors:
        return _payload_error("invalid query parameters", errors)

    polls = _voting_service().list_polls(
        scope=scope,
        status=status,
        building_id=building_id,
        viewer_role=user.role,
        viewer_building=user.building_number if user.role != "admin" else None,
    )

    payload = []
    for poll in polls:
        votes = _voting_service().list_votes_for_user(poll.id, user.id)
        payload.append(
            {
                **asdict(poll),
                "has_voted": bool(votes),
            }
        )
    return jsonify(payload), 200


@app.route("/api/polls", methods=["POST"])
@admin_required
def create_poll():
    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return _payload_error("invalid payload", {"payload": "object required"})
    user = _current_user()
    cleaned, errors = _validate_poll_payload(payload)
    if errors:
        return _payload_error("invalid poll payload", errors)

    if cleaned["poll_type"] == "yes_no":
        cleaned["options"] = []

    poll = _voting_service().create_poll(
        title=cleaned["title"],
        description=cleaned["description"],
        poll_type=cleaned["poll_type"],
        created_by=user.id,
        scope=cleaned["scope"],
        building_id=cleaned["building_id"],
        status=cleaned["status"],
        allow_multiple_selections=cleaned["allow_multiple_selections"],
        show_results_before_close=cleaned["show_results_before_close"],
        requires_quorum=cleaned["requires_quorum"],
        quorum_percentage=cleaned["quorum_percentage"],
        start_date=cleaned["start_date"],
        end_date=cleaned["end_date"],
        option_labels=cleaned["options"],
        attachments=cleaned["attachments"],
    )
    options = _voting_service().get_poll_options(poll.id)
    attachments = _voting_service().get_poll_attachments(poll.id)
    return (
        jsonify(
            {
                "poll": asdict(poll),
                "options": [asdict(option) for option in options],
                "attachments": [asdict(item) for item in attachments],
            }
        ),
        201,
    )


@app.route("/api/polls/<poll_id>", methods=["GET"])
@login_required
def poll_detail(poll_id: str):
    user = _current_user()
    poll = _voting_service().get_poll(poll_id)
    _ensure_poll_visible(poll, user)
    options = _voting_service().get_poll_options(poll.id)
    attachments = _voting_service().get_poll_attachments(poll.id)
    votes = _voting_service().list_votes_for_user(poll.id, user.id)
    return (
        jsonify(
            {
                "poll": asdict(poll),
                "options": [asdict(option) for option in options],
                "attachments": [asdict(item) for item in attachments],
                "has_voted": bool(votes),
                "my_votes": [asdict(vote) for vote in votes],
            }
        ),
        200,
    )


@app.route("/api/polls/<poll_id>/attachments", methods=["POST"])
@admin_required
def add_poll_attachments(poll_id: str):
    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return _payload_error("invalid payload", {"payload": "object required"})
    attachments = payload.get("attachments", [])
    errors: dict[str, str] = {}
    if not isinstance(attachments, list) or not attachments:
        errors["attachments"] = "must be a non-empty array"
    else:
        for idx, attachment in enumerate(attachments, start=1):
            if not isinstance(attachment, dict):
                errors[f"attachments[{idx}]"] = "must be an object"
                continue
            for key in ("file_url", "file_name", "file_type"):
                value = attachment.get(key)
                if not isinstance(value, str) or not value.strip():
                    errors[f"attachments[{idx}].{key}"] = "required string"
    if errors:
        return _payload_error("invalid attachments payload", errors)
    added = _voting_service().add_poll_attachments(poll_id, attachments)
    return jsonify([asdict(item) for item in added]), 201


@app.route("/api/polls/<poll_id>/activate", methods=["POST"])
@admin_required
def activate_poll(poll_id: str):
    poll = _voting_service().update_poll_status(poll_id, "active")
    return jsonify(asdict(poll)), 200


@app.route("/api/polls/<poll_id>/close", methods=["POST"])
@admin_required
def close_poll(poll_id: str):
    poll = _voting_service().update_poll_status(poll_id, "closed")
    return jsonify(asdict(poll)), 200


@app.route("/api/polls/<poll_id>/archive", methods=["POST"])
@admin_required
def archive_poll(poll_id: str):
    poll = _voting_service().update_poll_status(poll_id, "archived")
    return jsonify(asdict(poll)), 200


@app.route("/api/polls/<poll_id>/vote", methods=["POST"])
@login_required
def cast_vote(poll_id: str):
    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return _payload_error("invalid payload", {"payload": "object required"})
    user = _current_user()
    poll = _voting_service().get_poll(poll_id)
    _ensure_poll_visible(poll, user)

    selections, errors = _validate_vote_payload(payload)
    if errors:
        return _payload_error("invalid vote payload", errors)

    votes = _voting_service().cast_vote(
        poll_id=poll_id,
        user_id=user.id,
        user_role=user.role,
        user_building=user.building_number,
        selections=selections,
    )
    return jsonify([asdict(vote) for vote in votes]), 201


@app.route("/api/polls/<poll_id>/results", methods=["GET"])
@login_required
def poll_results(poll_id: str):
    user = _current_user()
    poll = _voting_service().get_poll(poll_id)
    _ensure_poll_visible(poll, user)
    if poll.status != "closed" and not poll.show_results_before_close and user.role != "admin":
        raise VotingAuthorizationError("results are hidden until poll closes")
    results = _voting_service().get_results(poll_id)
    results["poll"] = asdict(results["poll"])
    return jsonify(results), 200


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
