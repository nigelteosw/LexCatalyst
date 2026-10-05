import pytest
from pydantic import ValidationError

from app.schemas import ActionItemUpdate


def test_client_counterparty_is_a_valid_action_update():
    update = ActionItemUpdate(status="with_client")
    assert update.model_dump(exclude_unset=True) == {"status": "with_client"}


@pytest.mark.parametrize("status", ["pending", "in_progress", "review", "done"])
def test_existing_action_statuses_remain_valid(status):
    assert ActionItemUpdate(status=status).status == status


def test_unknown_action_status_is_rejected():
    with pytest.raises(ValidationError):
        ActionItemUpdate(status="made_up")
