"""Ownership and mutation regressions against a real local database."""
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.models import ActionItem, Matter, MatterMember, ResourceMetadata, Team, User
from app.services.birdie_workboard_service import execute_workboard_tool

@pytest.fixture
def board():
    engine = create_engine('sqlite://')
    for model in (Team, User, Matter, MatterMember, ActionItem, ResourceMetadata):
        model.__table__.create(engine)
    with Session(engine) as db:
        user = User(id='me', email='me@example.test', google_id='me', firm_role='associate')
        db.add_all([user, User(id='other', email='other@example.test', full_name='Jane', google_id='other'), Team(id='team', name='Firm')])
        db.flush()
        db.add_all([Matter(id='matter', team_id='team', title='Matter', case_number='M1'), Matter(id='private', team_id='team', title='Private', case_number='M2')])
        db.flush()
        db.add_all([MatterMember(matter_id='matter', user_id='me', role='associate'), MatterMember(matter_id='matter', user_id='other', role='associate')])
        db.add_all([
            ActionItem(id='own', title='Draft', assigner_id='other', assignee_id='me', matter_id='matter'),
            ActionItem(id='general', title='General', assigner_id='other', assignee_id='me'),
            ActionItem(id='others', title='Someone else', assigner_id='me', assignee_id='other', matter_id='matter'),
            ActionItem(id='hidden', title='Hidden', assigner_id='me', assignee_id='me', matter_id='private'),
        ])
        db.commit()
        yield db, user
    engine.dispose()

def call(board, name, args, matter='matter'):
    db, user = board
    return execute_workboard_tool(name, args, db=db, user=user, matter_id=matter)

def test_list_defaults_to_current_matter_and_current_assignee(board):
    assert [i['id'] for i in call(board, 'list_workboard_tickets', {})['tickets']] == ['own']
    assert [i['id'] for i in call(board, 'list_workboard_tickets', {}, matter=None)['tickets']] == ['general']
    assert {i['id'] for i in call(board, 'list_workboard_tickets', {'scope': 'all'})['tickets']} == {'own', 'general'}

@pytest.mark.parametrize('admin', [False, True])
@pytest.mark.parametrize('name,args', [
    ('get_workboard_ticket', {'ticket_id': 'others'}),
    ('update_workboard_ticket', {'ticket_id': 'others', 'changes': {'title': 'No'}}),
    ('delete_workboard_ticket', {'ticket_id': 'others'}),
])
def test_assigner_and_admin_cannot_manage_someone_elses_ticket(board, admin, name, args):
    board[1].is_admin = admin
    assert 'error' in call(board, name, args)
    assert board[0].get(ActionItem, 'others').title == 'Someone else'

def test_create_is_self_assigned_and_associate_can_edit_and_move(board):
    db, _ = board
    result = call(board, 'create_workboard_ticket', {'title': 'Research', 'description': 'Check cases'})
    ticket = db.get(ActionItem, result['ticket']['id'])
    assert (ticket.assignee_id, ticket.assigner_id, ticket.matter_id) == ('me', 'me', 'matter')
    result = call(board, 'update_workboard_ticket', {'ticket_id': ticket.id, 'changes': {'title': 'New title', 'description': 'New description', 'status': 'with_client'}})
    assert result['ticket']['title'] == 'New title'
    assert (ticket.description, ticket.status) == ('New description', 'with_client')
    ticket_id = ticket.id
    assert call(board, 'delete_workboard_ticket', {'ticket_id': ticket_id})['changed'] is True
    assert db.get(ActionItem, ticket_id) is None
    assert db.scalar(select(ResourceMetadata).where(ResourceMetadata.resource_id == ticket_id)) is None

def test_reassignment_revokes_ownership_immediately(board):
    assert call(board, 'update_workboard_ticket', {'ticket_id': 'own', 'changes': {'assignee_id': 'other'}})['ticket']['assignee_id'] == 'other'
    assert 'error' in call(board, 'update_workboard_ticket', {'ticket_id': 'own', 'changes': {'title': 'No'}})
    assert 'error' in call(board, 'delete_workboard_ticket', {'ticket_id': 'own'})

@pytest.mark.parametrize('changes', [
    {'status': 'nonsense'}, {'title': None}, {'status': None}, {'assignee_id': None},
    {'assignee_id': 'missing'}, {'assigner_id': 'me'}, {'matter_id': 'private'},
])
def test_invalid_changes_are_atomic(board, changes):
    assert 'error' in call(board, 'update_workboard_ticket', {'ticket_id': 'own', 'changes': changes})
    item = board[0].get(ActionItem, 'own')
    assert (item.title, item.status, item.assignee_id, item.matter_id) == ('Draft', 'pending', 'me', 'matter')

def test_matter_access_and_creation_assignment_are_checked(board):
    assert 'error' in call(board, 'get_workboard_ticket', {'ticket_id': 'hidden'})
    assert 'error' in call(board, 'create_workboard_ticket', {'title': 'No', 'matter_id': 'private'})
    assert 'error' in call(board, 'create_workboard_ticket', {'title': 'No', 'assignee_id': 'other'})
    assert 'error' in call(board, 'create_workboard_ticket', {'title': 'No'}, matter='missing')

@pytest.mark.parametrize('name,args', [
    ('update_workboard_ticket', {'ticket_id': 'own', 'changes': {'status': 'done'}}),
    ('update_workboard_ticket', {'ticket_id': 'own', 'changes': {'assignee_id': 'other'}}),
    ('delete_workboard_ticket', {'ticket_id': 'own'}),
])
def test_review_linked_tickets_cannot_bypass_review_workflow(board, name, args):
    board[0].get(ActionItem, 'own').active_handoff_id = 'review'
    board[0].commit()
    assert 'error' in call(board, name, args)
    assert board[0].get(ActionItem, 'own') is not None

def test_progress_counts_done_overdue_and_all_rows_not_just_list_limit(board):
    db, _ = board
    db.get(ActionItem, 'own').due_date = datetime.now(timezone.utc) - timedelta(days=1)
    db.add_all([ActionItem(title=f'Done {i}', assigner_id='other', assignee_id='me', matter_id='matter', status='done') for i in range(55)])
    db.commit()
    result = call(board, 'get_workboard_progress', {})
    assert (result['total'], result['by_status']['done'], result['outstanding'], result['overdue']) == (56, 55, 1, 1)
    listed = call(board, 'list_workboard_tickets', {})
    assert listed['total'] == 56
    assert listed['truncated'] is True

def test_assignee_lookup_and_matter_membership(board):
    assert call(board, 'find_workboard_assignees', {'query': 'Jane'})['users'][0]['id'] == 'other'
    db, _ = board
    db.add(User(id='outsider', email='outsider@example.test', google_id='outsider'))
    db.commit()
    assert 'error' in call(board, 'update_workboard_ticket', {'ticket_id': 'own', 'changes': {'assignee_id': 'outsider'}})

def test_iso_due_dates_are_accepted_and_nullable_fields_can_be_cleared(board):
    result = call(board, 'create_workboard_ticket', {'title': 'Dated', 'due_date': '2026-12-01T12:00:00Z'})
    assert 'error' not in result
    assert result['ticket']['due_date'].startswith('2026-12-01T12:00:00')
    result = call(board, 'update_workboard_ticket', {'ticket_id': result['ticket']['id'], 'changes': {'due_date': None, 'description': None}})
    assert result['ticket']['due_date'] is None
    assert result['ticket']['description'] is None
