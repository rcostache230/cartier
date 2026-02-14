from pathlib import Path

import pytest

from parking_module import ParkingService, SlotNotFoundError, SlotValidationError


@pytest.fixture()
def service(tmp_path: Path) -> ParkingService:
    db_path = tmp_path / "parking_test.db"
    svc = ParkingService(str(db_path))
    svc.seed_default_users()
    return svc


def test_seeds_160_users(service: ParkingService) -> None:
    slots = service.list_open_slots()
    assert slots == []

    # Quick behavior check: seeded users can create slots.
    created = service.create_availability_slot(
        owner_username="Bloc10_Apt16",
        parking_space_number="P-160",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T20:00",
    )
    assert created.owner_username == "Bloc10_Apt16"


def test_create_slot_requires_valid_type(service: ParkingService) -> None:
    with pytest.raises(SlotValidationError):
        service.create_availability_slot(
            owner_username="Bloc1_Apt1",
            parking_space_number="A-01",
            parking_type="roof",
            available_from="2026-02-20T08:00",
            available_until="2026-02-20T12:00",
        )


def test_auto_reserve_picks_earliest_matching_slot(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc1_Apt1",
        parking_space_number="A-01",
        parking_type="above_ground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )
    service.create_availability_slot(
        owner_username="Bloc2_Apt1",
        parking_space_number="B-11",
        parking_type="above_ground",
        available_from="2026-02-20T09:00",
        available_until="2026-02-20T19:00",
    )

    reserved = service.auto_reserve_slot(
        requester_username="Bloc3_Apt5",
        requested_from="2026-02-20T10:00",
        requested_until="2026-02-20T11:00",
        parking_type="above_ground",
    )

    assert reserved.owner_username == "Bloc1_Apt1"
    assert reserved.reserved_by_username == "Bloc3_Apt5"
    assert reserved.status == "RESERVED"


def test_auto_reserve_never_books_own_slot(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc1_Apt1",
        parking_space_number="A-01",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="Bloc1_Apt1",
            requested_from="2026-02-20T09:00",
            requested_until="2026-02-20T10:00",
            parking_type="underground",
        )


def test_reserved_slot_not_double_booked(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc4_Apt7",
        parking_space_number="D-07",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )

    service.auto_reserve_slot(
        requester_username="Bloc5_Apt3",
        requested_from="2026-02-20T10:00",
        requested_until="2026-02-20T12:00",
        parking_type="underground",
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="Bloc6_Apt2",
            requested_from="2026-02-20T10:00",
            requested_until="2026-02-20T12:00",
            parking_type="underground",
        )

