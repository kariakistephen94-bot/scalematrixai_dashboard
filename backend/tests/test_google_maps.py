import asyncio
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.models import WorkspaceSettings
from app.services.ai import GenerationError
from app.services.generation import execute_run
from app.services.google_maps import GoogleMapsService, MapsError, search_plan
from app.services.maps_generation import save_maps_leads


def configuration(**changes):
    return SimpleNamespace(google_maps_api_key='test-google-key', google_maps_max_requests=4, google_maps_max_pages=2, **changes)


def test_city_and_niche_rotation_covers_selected_markets():
    workspace = WorkspaceSettings()
    today = search_plan(workspace, '2026-10-27')
    tomorrow = search_plan(workspace, '2026-10-28')
    assert {item['country'] for item in today[:12]} == {'United States', 'United Kingdom', 'Nigeria', 'China'}
    assert {item['niche'] for item in today[:12]} == {'Commercial cleaning', 'Solar businesses', 'Facility management'}
    assert today != tomorrow
    assert all(item['city'] in item['query'] and item['country'] in item['query'] for item in today)
    with pytest.raises(MapsError):
        search_plan(WorkspaceSettings(target_location='Unsupported market'), '2026-10-27')


def test_search_deduplicates_and_respects_request_budget_and_field_mask():
    async def run():
        requests = []
        def handler(request):
            requests.append(request)
            assert request.url == 'https://places.googleapis.com/v1/places:searchText'
            assert request.headers['X-Goog-Api-Key'] == 'test-google-key'
            assert request.headers['X-Goog-FieldMask'] == 'places.id,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,nextPageToken'
            return httpx.Response(200, json={'places': [{'id': 'already-saved', 'nationalPhoneNumber': '1234567890'}, {'id': 'same-new-id', 'nationalPhoneNumber': '1234567890'}, {'id': f'fresh-{len(requests)}', 'nationalPhoneNumber': '1234567890'}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            rows, metadata = await GoogleMapsService(configuration(), client).discover(WorkspaceSettings(daily_prospect_count=10), ['already-saved'], '2026-10-27')
        assert len(requests) <= 4
        assert metadata['requests'] == len(requests)
        assert len({r['place_id'] for r in rows}) == len(rows)
        assert 'already-saved' not in {r['place_id'] for r in rows}
        assert all(set(r) == {'place_id', 'niche', 'country', 'search_city'} for r in rows)
    asyncio.run(run())


def test_search_uses_next_page_when_first_page_contains_only_seen_ids():
    async def run():
        requests = []
        def handler(request):
            import json
            body = json.loads(request.content)
            requests.append(body)
            if body.get('pageToken') == 'next-page':
                return httpx.Response(200, json={'places': [{'id': 'new-id', 'nationalPhoneNumber': '1234567890'}]})
            return httpx.Response(200, json={'places': [{'id': 'old-id', 'nationalPhoneNumber': '1234567890'}], 'nextPageToken': 'next-page'})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            rows, metadata = await GoogleMapsService(configuration(), client).discover(WorkspaceSettings(daily_prospect_count=1), ['old-id'], '2026-10-27')
        assert len(rows) == 1 and rows[0]['place_id'] == 'new-id'
        assert requests[1]['pageToken'] == 'next-page'
        assert requests[0]['textQuery'] == requests[1]['textQuery']
    asyncio.run(run())


def test_google_errors_do_not_expose_keys_or_provider_payloads():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(403, json={'error': {'message': 'private raw payload test-google-key'}}))) as client:
            with pytest.raises(MapsError) as caught:
                await GoogleMapsService(configuration(), client).details('some-id')
            assert 'test-google-key' not in str(caught.value)
            assert 'private raw payload' not in str(caught.value)
            assert 'Places API (New)' in str(caught.value)
        settings = configuration()
        settings.google_maps_api_key = ''
        with pytest.raises(MapsError, match='GOOGLE_MAPS_API_KEY'):
            await GoogleMapsService(settings).details('some-id')
    asyncio.run(run())


def test_transient_google_errors_retry_with_a_bound(monkeypatch):
    async def no_sleep(*args):
        pass
    monkeypatch.setattr(asyncio, 'sleep', no_sleep)
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(429 if len(calls) < 3 else 200, json={} if len(calls) < 3 else {'places': [{'id': 'one', 'nationalPhoneNumber': '1234567890'}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            rows, _ = await GoogleMapsService(configuration(), client).discover(WorkspaceSettings(daily_prospect_count=1), [], '2026-10-27')
        assert len(calls) == 3 and rows[0]['place_id'] == 'one'
    asyncio.run(run())


class FakeStore:
    def __init__(self):
        self.saved = []
        self.patched = []
        self.calls = []
    async def list(self, table, **kwargs):
        self.calls.append((table, kwargs))
        return []
    async def insert(self, table, rows, **kwargs):
        self.saved.append((table, rows, kwargs))
        return rows
    async def patch(self, table, item_id, changes):
        self.patched.append(changes)
        return [{'id': item_id, **changes}]
    async def claim_run(self, key, kind, day):
        return {'id': str(uuid4()), 'run_key': key, 'kind': kind, 'run_date': day}


class FakeMaps:
    async def discover(self, workspace, existing_ids, day):
        return [{'place_id': 'one', 'niche': 'Solar businesses', 'country': 'Nigeria', 'search_city': 'Lagos'}], {'requests': 1}
    async def hydrate(self, records):
        return [dict(r, details={'displayName': {'text': 'Live company'}, 'internationalPhoneNumber': '+2341234567890'}, details_error=None) for r in records]


def test_maps_storage_keeps_only_ids_and_workflow_metadata():
    store = FakeStore()
    asyncio.run(save_maps_leads(store, FakeMaps(), WorkspaceSettings(), {'id': str(uuid4()), 'run_date': '2026-10-27'}))
    table, rows, options = store.saved[0]
    assert table == 'sm_maps_leads'
    assert options == {'conflict': 'place_id', 'ignore': True}
    assert set(rows[0]) == {'place_id', 'niche', 'country', 'search_city', 'run_id'}


def test_maps_runs_even_when_content_generation_fails():
    class NoAI:
        async def content(self, *args):
            raise GenerationError('Add OPENAI_API_KEY to enable content.')
    store = FakeStore()
    asyncio.run(execute_run(store, NoAI(), WorkspaceSettings(), {'id': str(uuid4()), 'kind': 'daily', 'run_date': '2026-10-27'}, FakeMaps()))
    assert store.saved[0][0] == 'sm_maps_leads'
    assert store.patched[-1]['status'] == 'failed'
    assert '1 new Google Maps' in store.patched[-1]['summary']
    assert 'OPENAI_API_KEY' in store.patched[-1]['summary']


def test_maps_api_auth_filters_and_query_limits(monkeypatch):
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'maps-test-token')
    monkeypatch.setattr(main.settings, 'google_maps_api_key', 'test-key')
    monkeypatch.setattr(main, 'maps', FakeMaps())
    store = FakeStore()
    main.app.dependency_overrides[main.get_store] = lambda: store
    try:
        client = TestClient(main.app)
        assert client.get('/maps/leads').status_code == 401
        headers = {'X-Dashboard-Token': 'maps-test-token'}
        assert client.get('/maps/leads?limit=100', headers=headers).status_code == 422
        assert client.get('/maps/leads?offset=-1', headers=headers).status_code == 422
        assert client.get('/maps/leads?country=Unknown', headers=headers).status_code == 422
        response = client.get('/maps/leads?country=Nigeria&niche=Solar%20businesses&stage=shortlisted', headers=headers)
        assert response.status_code == 200
        assert store.calls[-1][1]['filters'] == {'country': 'eq.Nigeria', 'niche': 'eq.Solar businesses', 'stage': 'eq.shortlisted'}
        # The prospect endpoint queues Maps discovery even without an OpenAI key.
        monkeypatch.setattr(main.settings, 'openai_api_key', '')
        monkeypatch.setattr(main, 'launch', lambda coro: coro.close())
        assert client.post('/generate/prospects', headers=headers).status_code == 202
    finally:
        main.app.dependency_overrides.clear()


def test_maps_notes_are_separate_from_google_details(monkeypatch):
    monkeypatch.setattr(main.settings, 'dashboard_api_token', 'maps-test-token')
    store = FakeStore()
    main.app.dependency_overrides[main.get_store] = lambda: store
    try:
        client = TestClient(main.app)
        response = client.patch(f'/maps/leads/{uuid4()}', headers={'X-Dashboard-Token': 'maps-test-token'}, json={'stage': 'shortlisted', 'notes': 'Ask about their booking workflow.'})
        assert response.status_code == 200
        assert store.patched[-1] == {'stage': 'shortlisted', 'notes': 'Ask about their booking workflow.'}
        assert client.patch(f'/maps/leads/{uuid4()}', headers={'X-Dashboard-Token': 'maps-test-token'}, json={'stage': 'invalid'}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()


def test_partial_results_survive_a_later_provider_failure(monkeypatch):
    async def no_sleep(*args):
        pass
    monkeypatch.setattr(asyncio, 'sleep', no_sleep)
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(200, json={'places': [{'id': 'preserved-id', 'nationalPhoneNumber': '1234567890'}]})
            return httpx.Response(429, json={'error': {'message': 'quota exhausted'}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            rows, metadata = await GoogleMapsService(configuration(), client).discover(WorkspaceSettings(daily_prospect_count=5), [], '2026-10-27')
        assert rows[0]['place_id'] == 'preserved-id'
        assert 'quota' in metadata['warning']
    asyncio.run(run())


def test_scheduler_can_start_daily_maps_without_openai(monkeypatch):
    from app.config import Settings
    from app.scheduler import scheduler_loop
    settings = Settings(supabase_url='https://example.supabase.co', supabase_secret_key='test', google_maps_api_key='test', openai_api_key='', generation_time='00:00')
    store = FakeStore()
    launched = []
    def launch(coroutine):
        launched.append(True)
        coroutine.close()
    async def stop_after_one_tick(*args):
        raise asyncio.CancelledError
    monkeypatch.setattr(asyncio, 'sleep', stop_after_one_tick)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(scheduler_loop(store, object(), settings, launch, FakeMaps()))
    assert len(launched) == 1


def test_min_reviews_keeps_only_listings_with_enough_google_reviews():
    async def run():
        masks = []
        def handler(request):
            masks.append(request.headers['X-Goog-FieldMask'])
            return httpx.Response(200, json={'places': [
                {'id': 'twenty', 'nationalPhoneNumber': '1234567890', 'userRatingCount': 20},
                {'id': 'nineteen', 'nationalPhoneNumber': '1234567890', 'userRatingCount': 19},
                {'id': 'unknown', 'nationalPhoneNumber': '1234567890'},
                {'id': 'many', 'nationalPhoneNumber': '1234567890', 'userRatingCount': 400},
            ]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            rows, _ = await GoogleMapsService(configuration(), client).discover(WorkspaceSettings(daily_prospect_count=15, min_reviews=20), [], '2026-10-27')
        assert {row['place_id'] for row in rows} == {'twenty', 'many'}
        assert all('places.userRatingCount' in mask for mask in masks)
    asyncio.run(run())


def test_min_reviews_is_off_by_default_and_leaves_requests_unchanged():
    assert WorkspaceSettings().min_reviews == 0
    with pytest.raises(ValueError):
        WorkspaceSettings(min_reviews=-1)
