from __future__ import annotations

import os
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

app = Flask(__name__, template_folder="templates")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change-this-secret")

service = ParkingService()
service.seed_default_users(DEFAULT_RESIDENT_PASSWORD)
service.ensure_admin_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)

F = TypeVar("F", bound=Callable[..., object])


def _json_error(message: str, status: int):
    return jsonify({"error": message}), status


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise SlotValidationError(f"invalid integer value: {value}") from exc


def _current_user() -> UserAccount:
    user_id = session.get("user_id")
    if not user_id:
        raise AuthenticationError("authentication required")
    try:
        return service.get_user_by_id(int(user_id))
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


@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")


@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "db_backend": "postgres" if service._is_postgres else "sqlite",
        }
    )


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
            },
        }
    )


@app.route("/api/auth/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", ""))
    password = str(payload.get("password", ""))
    user = service.authenticate_user(username, password)
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
    users = service.list_users(building_number=building_number)
    return jsonify([asdict(user) for user in users]), 200


@app.route("/api/users", methods=["POST"])
@admin_required
def create_user():
    payload = request.get_json(silent=True) or {}
    user = service.create_user(
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
    inserted = service.seed_default_users(DEFAULT_RESIDENT_PASSWORD)
    service.ensure_admin_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    return jsonify({"inserted_or_updated": inserted}), 200


@app.route("/api/slots", methods=["POST"])
@login_required
def create_slot():
    payload = request.get_json(silent=True) or {}
    user = _current_user()
    slot = service.create_availability_slot(
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
    slot = service.create_availability_slot(
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

    slots = service.list_open_slots(
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
    slot = service.auto_reserve_slot(
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
    slot = service.reserve_specific_slot(
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
    return jsonify(service.list_building_stats()), 200


@app.route("/api/dashboard", methods=["GET"])
@login_required
def dashboard():
    user = _current_user()
    building_number = _parse_optional_int(request.args.get("building_number"))

    shared_spots = service.list_open_slots(
        building_number=building_number,
        exclude_owner_username=None,
    )
    my_shared = service.list_slots_shared_by_user_id(user.id)
    my_claimed = service.list_slots_claimed_by_user_id(user.id)
    claimed_on_my = service.list_slots_claimed_on_user_spaces_id(user.id)

    return jsonify(
        {
            "current_user": asdict(user),
            "building_stats": service.list_building_stats(),
            "shared_parking_spots": [asdict(slot) for slot in shared_spots],
            "my_shared_parking_spots": [asdict(slot) for slot in my_shared],
            "my_shared_claimed_by_neighbours": [asdict(slot) for slot in claimed_on_my],
            "my_claimed_parking_spots": [asdict(slot) for slot in my_claimed],
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
