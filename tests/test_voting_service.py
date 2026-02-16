from pathlib import Path

import pytest

from parking_module import (
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_RESIDENT_PASSWORD,
    ParkingService,
)
from voting_module import VoteValidationError, VotingService


@pytest.fixture()
def services(tmp_path: Path):
    db_path = tmp_path / "voting_test.db"
    parking = ParkingService(str(db_path))
    parking.seed_default_users(DEFAULT_RESIDENT_PASSWORD)
    parking.ensure_admin_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    voting = VotingService(str(db_path))
    return parking, voting


def test_yes_no_poll_vote_and_results(services) -> None:
    parking, voting = services
    admin = parking.authenticate_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    poll = voting.create_poll(
        title="Approve new gates",
        description=None,
        poll_type="yes_no",
        created_by=admin.id,
        scope="neighbourhood",
        building_id=None,
        start_date="2025-01-01T00:00:00+00:00",
        end_date="2030-01-01T00:00:00+00:00",
    )
    options = voting.get_poll_options(poll.id)
    assert [opt.label for opt in options] == ["Yes", "No"]

    resident = parking.authenticate_user("bloc1_apt1", DEFAULT_RESIDENT_PASSWORD)
    voting.update_poll_status(poll.id, "active")
    votes = voting.cast_vote(
        poll_id=poll.id,
        user_id=resident.id,
        user_role=resident.role,
        user_building=resident.building_number,
        selections=[options[0].id],
    )
    assert len(votes) == 1

    results = voting.get_results(poll.id)
    assert results["total_votes"] == 1
    assert results["options"][0]["votes"] == 1


def test_multiple_choice_multi_selection(services) -> None:
    parking, voting = services
    admin = parking.authenticate_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    poll = voting.create_poll(
        title="Pick improvements",
        description=None,
        poll_type="multiple_choice",
        created_by=admin.id,
        scope="neighbourhood",
        building_id=None,
        allow_multiple_selections=True,
        start_date="2025-01-01T00:00:00+00:00",
        end_date="2030-01-01T00:00:00+00:00",
        option_labels=["Playground", "Lighting", "Garden"],
    )
    voting.update_poll_status(poll.id, "active")
    options = voting.get_poll_options(poll.id)
    resident = parking.authenticate_user("bloc2_apt1", DEFAULT_RESIDENT_PASSWORD)

    votes = voting.cast_vote(
        poll_id=poll.id,
        user_id=resident.id,
        user_role=resident.role,
        user_building=resident.building_number,
        selections=[options[0].id, options[2].id],
    )
    assert len(votes) == 2

    results = voting.get_results(poll.id)
    assert results["total_votes"] == 2


def test_weighted_requires_full_ranking(services) -> None:
    parking, voting = services
    admin = parking.authenticate_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    poll = voting.create_poll(
        title="Choose maintenance vendor",
        description=None,
        poll_type="weighted",
        created_by=admin.id,
        scope="neighbourhood",
        building_id=None,
        start_date="2025-01-01T00:00:00+00:00",
        end_date="2030-01-01T00:00:00+00:00",
        option_labels=["Vendor A", "Vendor B", "Vendor C"],
    )
    voting.update_poll_status(poll.id, "active")
    options = voting.get_poll_options(poll.id)
    resident = parking.authenticate_user("bloc3_apt1", DEFAULT_RESIDENT_PASSWORD)

    with pytest.raises(VoteValidationError):
        voting.cast_vote(
            poll_id=poll.id,
            user_id=resident.id,
            user_role=resident.role,
            user_building=resident.building_number,
            selections=[options[0].id, options[1].id],
        )


def test_quorum_not_met_marks_results(services) -> None:
    parking, voting = services
    admin = parking.authenticate_user(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD)
    poll = voting.create_poll(
        title="Building 1 roof repair",
        description=None,
        poll_type="yes_no",
        created_by=admin.id,
        scope="building",
        building_id=1,
        requires_quorum=True,
        quorum_percentage=51,
        start_date="2025-01-01T00:00:00+00:00",
        end_date="2030-01-01T00:00:00+00:00",
    )
    voting.update_poll_status(poll.id, "active")
    options = voting.get_poll_options(poll.id)
    resident = parking.authenticate_user("bloc1_apt1", DEFAULT_RESIDENT_PASSWORD)

    voting.cast_vote(
        poll_id=poll.id,
        user_id=resident.id,
        user_role=resident.role,
        user_building=resident.building_number,
        selections=[options[0].id],
    )
    voting.update_poll_status(poll.id, "closed")

    results = voting.get_results(poll.id)
    assert results["quorum_met"] is False
    assert results["result_status"] == "quorum_not_met"
