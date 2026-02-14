from __future__ import annotations

from dataclasses import asdict

from flask import Flask, jsonify, render_template, request

from parking_module import (
    ParkingModuleError,
    ParkingService,
    SlotNotFoundError,
    SlotValidationError,
    UserNotFoundError,
)

app = Flask(__name__, template_folder="templates")
service = ParkingService()
service.seed_default_users()
service.seed_building_parking_spaces(underground_per_building=10, above_ground_per_building=6)


def _json_error(message: str, status: int):
    return jsonify({"error": message}), status


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise SlotValidationError(f"invalid integer value: {value}") from exc


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


@app.route("/api", methods=["GET"])
def api_root():
    return jsonify(
        {
            "service": "neighbourhood-parking-api",
            "version": "2.0.0",
            "endpoints": {
                "health": "GET /api/health",
                "users": "GET/POST /api/users",
                "parking_spaces": "GET /api/parking-spaces",
                "building_stats": "GET /api/buildings/stats",
                "create_slot": "POST /api/slots",
                "list_open_slots": "GET /api/slots/open",
                "auto_reserve": "POST /api/slots/auto-reserve",
            },
        }
    )


@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "db_path": service.db_path})


@app.route("/users/seed", methods=["POST"])
@app.route("/api/users/seed", methods=["POST"])
def seed_users():
    inserted = service.seed_default_users()
    return jsonify({"inserted": inserted}), 200


@app.route("/parking-spaces/seed", methods=["POST"])
@app.route("/api/parking-spaces/seed", methods=["POST"])
def seed_parking_spaces():
    inserted = service.seed_building_parking_spaces(
        underground_per_building=10,
        above_ground_per_building=6,
    )
    return jsonify({"inserted": inserted}), 200


@app.route("/users", methods=["GET"])
@app.route("/api/users", methods=["GET"])
def list_users():
    building_number = _parse_optional_int(request.args.get("building_number"))
    users = service.list_users(building_number=building_number)
    return jsonify([asdict(user) for user in users]), 200


@app.route("/users", methods=["POST"])
@app.route("/api/users", methods=["POST"])
def create_user():
    payload = request.get_json(silent=True) or {}
    user = service.create_user(
        username=str(payload.get("username", "")),
        building_number=int(payload.get("building_number", 0)),
        apartment_number=int(payload.get("apartment_number", 0)),
    )
    return jsonify(asdict(user)), 201


@app.route("/parking-spaces", methods=["GET"])
@app.route("/api/parking-spaces", methods=["GET"])
def list_parking_spaces():
    building_number = _parse_optional_int(request.args.get("building_number"))
    parking_type = request.args.get("parking_type")
    spaces = service.list_parking_spaces(
        building_number=building_number,
        parking_type=parking_type,
    )
    return jsonify([asdict(space) for space in spaces]), 200


@app.route("/buildings/stats", methods=["GET"])
@app.route("/api/buildings/stats", methods=["GET"])
def building_stats():
    return jsonify(service.list_building_stats()), 200


@app.route("/slots", methods=["POST"])
@app.route("/api/slots", methods=["POST"])
def create_slot():
    payload = request.get_json(silent=True) or {}
    slot = service.create_availability_slot(
        owner_username=str(payload.get("owner_username", "")),
        parking_space_number=str(payload.get("parking_space_number", "")),
        parking_type=str(payload.get("parking_type", "")),
        available_from=str(payload.get("available_from", "")),
        available_until=str(payload.get("available_until", "")),
    )
    return jsonify(asdict(slot)), 201


@app.route("/slots/open", methods=["GET"])
@app.route("/api/slots/open", methods=["GET"])
def list_open_slots():
    requested_from = request.args.get("requested_from")
    requested_until = request.args.get("requested_until")
    parking_type = request.args.get("parking_type")
    building_number = _parse_optional_int(request.args.get("building_number"))

    slots = service.list_open_slots(
        requested_from=requested_from,
        requested_until=requested_until,
        parking_type=parking_type,
        building_number=building_number,
    )
    return jsonify([asdict(slot) for slot in slots])


@app.route("/slots/auto-reserve", methods=["POST"])
@app.route("/api/slots/auto-reserve", methods=["POST"])
def auto_reserve_slot():
    payload = request.get_json(silent=True) or {}
    building_number = payload.get("building_number")
    slot = service.auto_reserve_slot(
        requester_username=str(payload.get("requester_username", "")),
        requested_from=str(payload.get("requested_from", "")),
        requested_until=str(payload.get("requested_until", "")),
        parking_type=payload.get("parking_type"),
        building_number=int(building_number) if building_number is not None else None,
    )
    return jsonify(asdict(slot)), 200


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
