import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

import app.main as main
from app.services.crm_businesses import resolve_crm_businesses
from app.services.google_maps import GoogleMapsService


def test_maps_quota_fallback_only_attaches_exact_place_id_and_reuses_search():
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            if request.method == 'GET':
                return httpx.Response(429, json={})
            return httpx.Response(200, json={'places': [
                {'id': 'other-business', 'displayName': {'text': 'Wrong company'}, 'nationalPhoneNumber': '111'},
                {'id': 'saved-id', 'displayName': {'text': 'Real company'}, 'nationalPhoneNumber': '08012345678', 'websiteUri': 'https://example.com'},
            ]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = GoogleMapsService(SimpleNamespace(google_maps_api_key='test'), client)
            row = {'id': str(uuid4()), 'place_id': 'saved-id', 'niche': 'Facility management', 'country': 'Nigeria', 'search_city': 'Lagos'}
            result = (await service.hydrate([row]))[0]
            assert result['details']['displayName']['text'] == 'Real company'
            assert result['details']['nationalPhoneNumber'] == '08012345678'
            assert result['details_error'] is None
            again = await service.hydrate([row])
            assert again[0]['details']['id'] == 'saved-id'
            assert [r.method for r in calls] == ['GET', 'POST', 'POST']
    asyncio.run(run())


def test_maps_search_fallback_reports_missing_match_instead_of_guessing():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'places': [{'id': 'wrong-id', 'displayName': {'text': 'Do not attach'}}]}))) as client:
            service = GoogleMapsService(SimpleNamespace(google_maps_api_key='test'), client)
            records = [{'id': str(uuid4()), 'place_id': 'saved-id', 'niche': 'Commercial cleaning', 'country': 'United States', 'search_city': 'Austin, TX'}]
            result = (await service._search_saved_records(records))[0]
            assert result['details'] is None
            assert 'could not be matched' in result['details_error']
    asyncio.run(run())


def test_crm_resolves_google_and_web_sources_without_changing_saved_fields():
    maps_id, web_id = str(uuid4()), str(uuid4())
    maps_contact, web_contact = str(uuid4()), str(uuid4())
    raw = {'company': 'Original user label', 'source_type': 'google_maps', 'source_id': maps_id, 'notes': 'Keep notes', 'stage': 'proposal', 'phone': '', 'email': ''}
    class DB:
        async def list(self, table, **options):
            return {
                'sm_settings': [{'id': 'crm:' + maps_contact, 'value': raw}, {'id': 'crm:' + web_contact, 'value': {'source_type': 'web_research', 'source_id': web_id}}],
                'sm_maps_leads': [{'id': maps_id, 'place_id': 'place-id', 'niche': 'Facility management', 'country': 'Nigeria', 'search_city': 'Lagos'}],
                'sm_prospects': [{'id': web_id, 'name': 'Web company', 'website': 'https://web.example.com', 'location': 'London'}],
            }[table]
        async def insert(self, *args, **kwargs):
            raise AssertionError('Live source details must not overwrite CRM records')
    class Maps:
        async def hydrate(self, rows):
            return [dict(row, details={'displayName': {'text': 'Actual company'}, 'internationalPhoneNumber': '+23412345678'}, details_error=None) for row in rows]
    result = asyncio.run(resolve_crm_businesses(DB(), Maps(), [maps_contact, web_contact]))
    assert result[maps_contact]['name'] == 'Actual company'
    assert result[maps_contact]['phone'] == '+23412345678'
    assert result[maps_contact]['status'] == 'phone_only'
    assert result[maps_contact]['website'] is None
    assert result[web_contact]['name'] == 'Web company'
    assert result[web_contact]['website'] == 'https://web.example.com'
    assert raw['notes'] == 'Keep notes' and raw['stage'] == 'proposal' and raw['company'] == 'Original user label'
    assert raw['phone'] == '' and raw['email'] == ''


def test_crm_business_lookup_is_authenticated_and_bounded(monkeypatch):
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'business-test')
    class DB:
        async def list(self, *args, **kwargs):
            return []
    main.app.dependency_overrides[main.get_store] = lambda: DB()
    try:
        client = TestClient(main.app)
        headers = {'X-Dashboard-Token': 'business-test'}
        body = {'contact_ids': [str(uuid4())]}
        assert client.post('/crm/businesses', json=body).status_code == 401
        assert client.post('/crm/businesses', json=body, headers=headers).json() == {'businesses': {}}
        assert client.post('/crm/businesses', json={'contact_ids': []}, headers=headers).status_code == 422
        assert client.post('/crm/businesses', json={'contact_ids': [str(uuid4()) for _ in range(21)]}, headers=headers).status_code == 422
        assert client.post('/crm/businesses', json={'contact_ids': ['bad-id']}, headers=headers).status_code == 422
    finally:
        main.app.dependency_overrides.clear()
