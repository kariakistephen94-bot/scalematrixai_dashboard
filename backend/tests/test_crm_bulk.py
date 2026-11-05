from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.main as main


@pytest.mark.parametrize('source,table', [('google_maps', 'sm_maps_leads'), ('web_research', 'sm_prospects')])
def test_bulk_import_includes_other_pages_and_preserves_existing_contacts(monkeypatch, source, table):
    ids = [str(uuid4()) for _ in range(502)]
    leads = [dict(id=key, name=f'Business {i}', niche='Commercial cleaning', search_city='Houston', stage='new', notes='Research note') for i,key in enumerate(ids)]
    leads[-1]['stage'] = 'archived'
    existing = {'company': 'My custom company label', 'stage': 'won', 'notes': 'Keep this', 'value': 3000}
    class Store:
        def __init__(self):
            self.contacts = {f'crm:{ids[0]}': existing.copy()}
            self.offsets = []
        async def list(self, name, **options):
            assert name == table
            assert options['filters'] == {'stage': 'neq.archived'}
            assert options['order'] == 'id.asc'
            self.offsets.append(options['offset'])
            active = [lead for lead in leads if lead['stage'] != 'archived']
            return active[options['offset']:options['offset'] + options['limit']]
        async def insert(self, name, rows, **options):
            assert name == 'sm_settings' and options == {'conflict': 'id', 'ignore': True}
            inserted = []
            for row in rows:
                if row['id'] not in self.contacts:
                    self.contacts[row['id']] = row['value']
                    inserted.append(row)
            return inserted
    db = Store()
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'bulk-test')
    main.app.dependency_overrides[main.get_store] = lambda: db
    try:
        client = TestClient(main.app)
        assert client.post('/crm/import', json={'source_type': source}).status_code == 401
        headers = {'X-Dashboard-Token': 'bulk-test'}
        response = client.post('/crm/import', json={'source_type': source}, headers=headers)
        assert response.status_code == 200
        assert response.json() == {'added': 500, 'skipped': 1, 'total': 501}
        assert db.offsets == [0, 500]
        assert db.contacts[f'crm:{ids[0]}'] == existing
        assert f'crm:{ids[-1]}' not in db.contacts
        contact = db.contacts[f'crm:{ids[1]}']
        assert contact['source_type'] == source and contact['source_id'] == ids[1]
        if source == 'google_maps':
            assert contact['company'].startswith('Commercial cleaning · Houston')
            assert 'Business' not in contact['company']
        else:
            assert contact['company'] == 'Business 1'
        again = client.post('/crm/import', json={'source_type': source}, headers=headers)
        assert again.json() == {'added': 0, 'skipped': 501, 'total': 501}
        assert client.post('/crm/import', json={'source_type': 'unknown'}, headers=headers).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_bulk_import_empty_source(monkeypatch):
    class EmptyStore:
        async def list(self, *args, **kwargs):
            return []
        async def insert(self, *args, **kwargs):
            raise AssertionError('Empty imports must not write anything')
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'bulk-test')
    main.app.dependency_overrides[main.get_store] = lambda: EmptyStore()
    try:
        result = TestClient(main.app).post('/crm/import', json={'source_type': 'google_maps'}, headers={'X-Dashboard-Token': 'bulk-test'})
        assert result.json() == {'added': 0, 'skipped': 0, 'total': 0}
    finally:
        main.app.dependency_overrides.clear()
