from pathlib import Path

import pytest

from parking_module import (
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_RESIDENT_PASSWORD,
    AuthenticationError,
    ParkingService,
    SlotNotFoundError,
)


@pytest.fixture()
def service(tmp_path: Path) -> ParkingService:
    db_path = tmp_path / "parking_test.db"
    svc = ParkingService(str(db_path))
    svc.seed_default_users(DEFAULT_RESIDENT_PASSWORD)
    svc.ensure_admin_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    return svc


def test_default_users_and_admin_exist(service: ParkingService) -> None:
    users = service.list_users()
    assert len(users) >= 161

    resident = service.authenticate_user("Bloc1_Apt1", DEFAULT_RESIDENT_PASSWORD)
    assert resident.role == "resident"

    admin = service.authenticate_user("Admin", DEFAULT_ADMIN_PASSWORD)
    assert admin.role == "admin"


def test_authentication_fails_with_wrong_password(service: ParkingService) -> None:
    with pytest.raises(AuthenticationError):
        service.authenticate_user("Bloc1_Apt1", "wrong")


def test_share_spot_accepts_free_text_number(service: ParkingService) -> None:
    slot = service.create_availability_slot(
        owner_username="Bloc1_Apt1",
        parking_space_number="UG-SPECIAL-44",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T12:00",
    )
    assert slot.parking_space_number == "UG-SPECIAL-44"


def test_auto_reserve_and_claim_lists(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc2_Apt1",
        parking_space_number="SPOT-201",
        parking_type="above_ground",
        available_from="2026-02-21T08:00",
        available_until="2026-02-21T18:00",
    )

    reserved = service.auto_reserve_slot(
        requester_username="Bloc2_Apt3",
        requested_from="2026-02-21T10:00",
        requested_until="2026-02-21T12:00",
        parking_type="above_ground",
    )
    assert reserved.status == "RESERVED"
    assert reserved.reserved_by_username == "Bloc2_Apt3"

    claimed_by_me = service.list_slots_claimed_by_user("Bloc2_Apt3")
    assert len(claimed_by_me) == 1

    claimed_on_owner = service.list_slots_claimed_on_user_spaces("Bloc2_Apt1")
    assert len(claimed_on_owner) == 1


def test_cannot_double_reserve_same_slot(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc3_Apt6",
        parking_space_number="SPOT-306",
        parking_type="underground",
        available_from="2026-02-22T08:00",
        available_until="2026-02-22T18:00",
    )

    service.auto_reserve_slot(
        requester_username="Bloc3_Apt7",
        requested_from="2026-02-22T09:00",
        requested_until="2026-02-22T10:00",
        parking_type="underground",
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="Bloc3_Apt8",
            requested_from="2026-02-22T09:00",
            requested_until="2026-02-22T10:00",
            parking_type="underground",
        )
