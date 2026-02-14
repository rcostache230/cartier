from __future__ import annotations

from dataclasses import asdict

from flask import Flask, jsonify, request

from parking_module import (
    ParkingModuleError,
    ParkingService,
    SlotNotFoundError,
    SlotValidationError,
    UserNotFoundError,
)

app = Flask(__name__)
service = ParkingService()
service.seed_default_users()


def _json_error(message: str, status: int):
    return jsonify({"error": message}), status


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
@app.route("/api", methods=["GET"])
def root():
    return jsonify(
        {
            "service": "neighbourhood-parking-api",
            "version": "1.0.0",
            "endpoints": {
                "health": "GET /health",
                "create_slot": "POST /slots",
                "list_open_slots": "GET /slots/open",
                "auto_reserve": "POST /slots/auto-reserve",
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

    slots = service.list_open_slots(
        requested_from=requested_from,
        requested_until=requested_until,
        parking_type=parking_type,
    )
    return jsonify([asdict(slot) for slot in slots])


@app.route("/slots/auto-reserve", methods=["POST"])
@app.route("/api/slots/auto-reserve", methods=["POST"])
def auto_reserve_slot():
    payload = request.get_json(silent=True) or {}
    slot = service.auto_reserve_slot(
        requester_username=str(payload.get("requester_username", "")),
        requested_from=str(payload.get("requested_from", "")),
        requested_until=str(payload.get("requested_until", "")),
        parking_type=payload.get("parking_type"),
    )
    return jsonify(asdict(slot)), 200


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)

