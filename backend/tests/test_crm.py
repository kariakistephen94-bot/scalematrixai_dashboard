from uuid import uuid4
from fastapi.testclient import TestClient
import pytest
import app.main as main
from app.models import WorkspaceSettings

class Store:
    def __init__(self):
        self.rows = {'default': {'id': 'default', 'value': WorkspaceSettings().model_dump()}}
        self.runs = {}
    async def list(self, table, filters=None, **kwargs):
        target = (filters or {}).get('id', '')
        if table == 'sm_runs':
            return list(self.runs.values())
        if target.startswith('eq.'):
            row = self.rows.get(target[3:])
            return [row] if row else []
        return [r for k,r in self.rows.items() if k.startswith('crm:')]
    async def insert(self, table, row, **kwargs):
        self.rows[row['id']] = row
        return [row]
    async def claim_run(self, key, kind, day):
        if key in self.runs:
            return None
        self.runs[key] = {'id': str(uuid4()), 'run_key': key, 'kind': kind, 'run_date': day}
        return self.runs[key]

@pytest.fixture
def client(monkeypatch):
    db = Store()
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'test-token')
    monkeypatch.setattr(main.settings, 'google_maps_api_key', 'test-key')
    monkeypatch.setattr(main, 'launch', lambda coroutine: coroutine.close())
    main.app.dependency_overrides[main.get_store] = lambda: db
    yield TestClient(main.app), db, {'X-Dashboard-Token': 'test-token'}
    main.app.dependency_overrides.clear()


def test_quick_search_is_repeatable_and_request_idempotent(client):
    api, db, headers = client
    assert api.post('/search/quick', json={'request_id': str(uuid4())}).status_code == 401
    request = {'request_id': str(uuid4()), 'workspace': WorkspaceSettings(daily_prospect_count=2).model_dump()}
    first = api.post('/search/quick', json=request, headers=headers)
    assert first.status_code == 202 and not first.json()['already_exists']
    second = api.post('/search/quick', json=request, headers=headers)
    assert second.json()['already_exists']
    request['request_id'] = str(uuid4())
    assert not api.post('/search/quick', json=request, headers=headers).json()['already_exists']
    assert len(db.runs) == 2
    assert db.rows['default']['value']['daily_prospect_count'] == 5


def test_crm_persists_updates_and_keeps_workspace_separate(client):
    api, db, headers = client
    assert api.get('/crm').status_code == 401
    body = {'company': 'Test business', 'value': 1200, 'currency': 'GBP', 'follow_up': '2026-11-02'}
    created = api.post('/crm', json=body, headers=headers)
    assert created.status_code == 201
    contact = created.json()
    contact.update(stage='proposal', notes='Follow up with decision maker.', follow_up=None)
    result = api.put('/crm/' + contact['id'], json=contact, headers=headers)
    assert result.status_code == 200
    assert result.json()['stage'] == 'proposal' and result.json()['follow_up'] is None
    listed = api.get('/crm', headers=headers).json()['contacts']
    assert len(listed) == 1 and listed[0]['notes'] == contact['notes']
    assert db.rows['default']['value'] == WorkspaceSettings().model_dump()
    assert api.put('/crm/' + str(uuid4()), json=body, headers=headers).status_code == 404


def test_crm_rejects_invalid_values_and_missing_sources(client):
    api, db, headers = client
    for changes in [{'value': -1}, {'email': 'bad-email'}, {'stage': 'unknown'}, {'follow_up': 'bad-date'}]:
        assert api.post('/crm', json={'company': 'Valid company', **changes}, headers=headers).status_code == 422
    assert api.post('/crm', json={'company': 'Linked', 'source_type': 'google_maps', 'source_id': str(uuid4())}, headers=headers).status_code == 404
    assert api.post('/crm', json={'company': 'Linked', 'source_type': 'google_maps'}, headers=headers).status_code == 422


def test_adding_same_source_preserves_existing_crm_notes(client):
    api, db, headers = client
    source = str(uuid4())
    db.rows[source] = {'id': source}
    body = {'company': 'User label', 'source_type': 'google_maps', 'source_id': source, 'notes': 'Keep my notes'}
    first = api.post('/crm', json=body, headers=headers)
    assert first.status_code == 201
    body['notes'] = 'replacement'
    again = api.post('/crm', json=body, headers=headers)
    assert again.json()['id'] == first.json()['id']
    assert again.json()['notes'] == 'Keep my notes'
