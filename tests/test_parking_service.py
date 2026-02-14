from pathlib import Path

import pytest

from parking_module import (
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_RESIDENT_PASSWORD,
    AuthenticationError,
    ParkingService,
    SlotNotFoundError,
    SlotValidationError,
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

    resident = service.authenticate_user("bloc1_apt1", DEFAULT_RESIDENT_PASSWORD)
    assert resident.role == "resident"
    assert resident.phone_number == ""

    admin = service.authenticate_user("admin", DEFAULT_ADMIN_PASSWORD)
    assert admin.role == "admin"


def test_authentication_fails_with_wrong_password(service: ParkingService) -> None:
    with pytest.raises(AuthenticationError):
        service.authenticate_user("bloc1_apt1", "wrong")


def test_share_spot_accepts_free_text_number(service: ParkingService) -> None:
    slot = service.create_availability_slot(
        owner_username="bloc1_apt1",
        parking_space_number="UG-SPECIAL-44",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T12:00",
    )
    assert slot.parking_space_number == "UG-SPECIAL-44"
    assert slot.owner_phone_number == ""


def test_auto_reserve_and_claim_lists(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="bloc2_apt1",
        parking_space_number="SPOT-201",
        parking_type="above_ground",
        available_from="2026-02-21T08:00",
        available_until="2026-02-21T18:00",
    )

    reserved = service.auto_reserve_slot(
        requester_username="bloc2_apt3",
        requested_from="2026-02-21T10:00",
        requested_until="2026-02-21T12:00",
        parking_type="above_ground",
    )
    assert reserved.status == "RESERVED"
    assert reserved.reserved_by_username == "bloc2_apt3"

    claimed_by_me = service.list_slots_claimed_by_user("bloc2_apt3")
    assert len(claimed_by_me) == 1

    claimed_on_owner = service.list_slots_claimed_on_user_spaces("bloc2_apt1")
    assert len(claimed_on_owner) == 1


def test_cannot_double_reserve_same_slot(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="bloc3_apt6",
        parking_space_number="SPOT-306",
        parking_type="underground",
        available_from="2026-02-22T08:00",
        available_until="2026-02-22T18:00",
    )

    service.auto_reserve_slot(
        requester_username="bloc3_apt7",
        requested_from="2026-02-22T09:00",
        requested_until="2026-02-22T10:00",
        parking_type="underground",
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="bloc3_apt8",
            requested_from="2026-02-22T09:00",
            requested_until="2026-02-22T10:00",
            parking_type="underground",
        )


def test_create_user_with_phone_and_claim_selected_slot(service: ParkingService) -> None:
    created = service.create_user(
        username="bloc5_apt20",
        password="secret",
        building_number=5,
        apartment_number=5,
        role="resident",
        phone_number="0712-000-111",
    )
    assert created.username == "bloc5_apt20"
    assert created.phone_number == "0712-000-111"

    shared = service.create_availability_slot(
        owner_username="bloc5_apt1",
        parking_space_number="SPOT-501",
        parking_type="underground",
        available_from="2026-02-23T08:00",
        available_until="2026-02-23T18:00",
    )
    claimed = service.reserve_specific_slot(
        requester_username="bloc5_apt2",
        slot_id=shared.id,
        requested_from="2026-02-23T09:00",
        requested_until="2026-02-23T11:00",
        claim_phone_number="0700-777-888",
    )
    assert claimed.reserved_by_username == "bloc5_apt2"
    assert claimed.reservation_contact_phone == "0700-777-888"


def test_claim_selected_slot_respects_window(service: ParkingService) -> None:
    shared = service.create_availability_slot(
        owner_username="bloc6_apt1",
        parking_space_number="SPOT-601",
        parking_type="above_ground",
        available_from="2026-02-24T10:00",
        available_until="2026-02-24T12:00",
    )

    with pytest.raises(SlotValidationError):
        service.reserve_specific_slot(
            requester_username="bloc6_apt2",
            slot_id=shared.id,
            requested_from="2026-02-24T09:00",
            requested_until="2026-02-24T11:00",
        )


def test_partial_claim_leaves_remaining_open_duration(service: ParkingService) -> None:
    shared = service.create_availability_slot(
        owner_username="bloc7_apt1",
        parking_space_number="SPOT-701",
        parking_type="underground",
        available_from="2026-02-25T08:00",
        available_until="2026-02-25T18:00",
    )

    claimed = service.reserve_specific_slot(
        requester_username="bloc7_apt2",
        slot_id=shared.id,
        requested_from="2026-02-25T10:00",
        requested_until="2026-02-25T12:00",
    )
    assert claimed.status == "RESERVED"

    open_slots = service.list_open_slots(building_number=7, parking_type="underground")
    intervals = {(s.available_from, s.available_until) for s in open_slots if s.parking_space_number == "SPOT-701"}
    assert ("2026-02-25T08:00", "2026-02-25T10:00") in intervals
    assert ("2026-02-25T12:00", "2026-02-25T18:00") in intervals


def test_building_inferred_from_username_prefix(service: ParkingService) -> None:
    created = service.create_user(
        username="Bloc3_guest_user",
        password="pw",
        building_number=8,
        apartment_number=2,
        role="resident",
    )
    assert created.username == "bloc3_guest_user"
    assert created.building_number == 3
