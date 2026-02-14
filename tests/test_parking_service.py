from pathlib import Path

import pytest

from parking_module import ParkingService, SlotNotFoundError, SlotValidationError


@pytest.fixture()
def service(tmp_path: Path) -> ParkingService:
    db_path = tmp_path / "parking_test.db"
    svc = ParkingService(str(db_path))
    svc.seed_default_users()
    svc.seed_building_parking_spaces(underground_per_building=10, above_ground_per_building=6)
    return svc


def test_seeds_expected_capacity(service: ParkingService) -> None:
    users = service.list_users()
    spaces = service.list_parking_spaces()
    assert len(users) == 160
    assert len(spaces) == 160

    stats = service.list_building_stats()
    assert len(stats) == 10
    assert stats[0]["underground_spaces"] == 10
    assert stats[0]["above_ground_spaces"] == 6


def test_create_slot_must_match_assigned_apartment(service: ParkingService) -> None:
    # Bloc1_Apt1 owns U01 in Bloc 1.
    slot = service.create_availability_slot(
        owner_username="Bloc1_Apt1",
        parking_space_number="U01",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T12:00",
    )
    assert slot.owner_username == "Bloc1_Apt1"
    assert slot.building_number == 1

    with pytest.raises(SlotValidationError):
        service.create_availability_slot(
            owner_username="Bloc1_Apt1",
            parking_space_number="U02",
            parking_type="underground",
            available_from="2026-02-20T13:00",
            available_until="2026-02-20T15:00",
        )


def test_create_slot_rejects_wrong_parking_type(service: ParkingService) -> None:
    with pytest.raises(SlotValidationError):
        service.create_availability_slot(
            owner_username="Bloc1_Apt11",  # Apt11 owns A01 (above_ground)
            parking_space_number="A01",
            parking_type="underground",
            available_from="2026-02-20T08:00",
            available_until="2026-02-20T12:00",
        )


def test_auto_reserve_defaults_to_requester_building(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc2_Apt1",
        parking_space_number="U01",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="Bloc3_Apt4",
            requested_from="2026-02-20T09:00",
            requested_until="2026-02-20T10:00",
            parking_type="underground",
        )


def test_auto_reserve_with_building_filter(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc1_Apt1",
        parking_space_number="U01",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )
    service.create_availability_slot(
        owner_username="Bloc1_Apt11",
        parking_space_number="A01",
        parking_type="above_ground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )

    reserved = service.auto_reserve_slot(
        requester_username="Bloc2_Apt5",
        requested_from="2026-02-20T10:00",
        requested_until="2026-02-20T11:00",
        parking_type="above_ground",
        building_number=1,
    )
    assert reserved.owner_username == "Bloc1_Apt11"
    assert reserved.status == "RESERVED"


def test_reserved_slot_not_double_booked(service: ParkingService) -> None:
    service.create_availability_slot(
        owner_username="Bloc4_Apt7",
        parking_space_number="U07",
        parking_type="underground",
        available_from="2026-02-20T08:00",
        available_until="2026-02-20T18:00",
    )

    service.auto_reserve_slot(
        requester_username="Bloc4_Apt8",
        requested_from="2026-02-20T10:00",
        requested_until="2026-02-20T12:00",
        parking_type="underground",
        building_number=4,
    )

    with pytest.raises(SlotNotFoundError):
        service.auto_reserve_slot(
            requester_username="Bloc4_Apt9",
            requested_from="2026-02-20T10:00",
            requested_until="2026-02-20T12:00",
            parking_type="underground",
            building_number=4,
        )
