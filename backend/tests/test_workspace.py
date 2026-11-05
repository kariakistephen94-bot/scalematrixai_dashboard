import asyncio
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app, get_store, settings
from app.models import ContentDraft, DailyContent, ProspectCandidate, WorkspaceSettings
from app.scheduler import due
from app.services.ai import AIService, citations_from_response
from app.services.generation import execute_run


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, 'dashboard_api_token', 'test-token')
    monkeypatch.setattr(settings, 'supabase_url', '')
    monkeypatch.setattr(settings, 'supabase_secret_key', '')
    monkeypatch.setattr(settings, 'google_maps_api_key', '')
    return TestClient(app)


def test_api_rejects_unauthorized_dashboard(client):
    assert client.get('/health').status_code == 200
    assert client.get('/dashboard').status_code == 401
    response = client.get('/dashboard', headers={'X-Dashboard-Token': 'test-token'})
    assert response.status_code == 200
    data = response.json()
    assert data['storage_connected'] is False
    assert data['posts'] == [] and data['prospects'] == []
    assert data['references']
    assert 'openai_api_key' not in data
    assert 'dashboard_api_token' not in data


def test_settings_validation():
    for changes in [{'generation_time': '25:90'}, {'timezone': 'not/a/zone'}, {'daily_prospect_count': 0}]:
        with pytest.raises(ValidationError):
            WorkspaceSettings(**changes)


def test_schedule_time_boundary_and_pause():
    workspace = WorkspaceSettings()
    assert not due(datetime(2026, 10, 27, 7, 59), workspace)
    assert due(datetime(2026, 10, 27, 8, 0), workspace)
    assert due(datetime(2026, 10, 27, 12, 0), workspace)
    workspace.schedule_enabled = False
    assert not due(datetime(2026, 10, 27, 12, 0), workspace)


def candidate(**changes):
    fields = dict(name='Example business', website='https://example.com', industry='Solar businesses', location='Lagos, Nigeria', opportunity='Hypothesis: explore whether intake automation would help.', evidence='Public website describes solar installation services.', source_url='https://example.com/services', contact_url=None, outreach_draft='Hello, would reviewing your inquiry follow-up workflow be useful?')
    return ProspectCandidate(**(fields | changes))


def test_candidate_rejects_private_links():
    with pytest.raises(ValidationError):
        candidate(website='http://127.0.0.1/admin')
    with pytest.raises(ValidationError):
        candidate(source_url='javascript:alert(1)')


def test_research_sources_come_from_provider_annotations():
    response = SimpleNamespace(model_dump=lambda: {'output': [{'type': 'message', 'content': [{'annotations': [{'type': 'url_citation', 'url': 'https://example.com', 'title': 'Example'}]}]}]})
    assert citations_from_response(response) == [{'url': 'https://example.com', 'title': 'Example'}]


class FakeStore:
    def __init__(self, posts=None):
        self.posts = posts or []
        self.saved = []
        self.patched = []

    async def list(self, table, **kwargs):
        return self.posts if table == 'sm_posts' else []

    async def insert(self, table, rows, **kwargs):
        self.saved.append((table, rows, kwargs))

    async def patch(self, table, item_id, body):
        self.patched.append(body)


def test_run_preserves_existing_posts_and_deduplicates_prospect_write():
    store = FakeStore([{'platform': 'linkedin'}, {'platform': 'twitter'}])
    class FakeAI:
        async def content(self, *args):
            raise AssertionError('Existing daily posts must not be regenerated.')
        async def prospects(self, *args):
            return [candidate()], []
    run = {'id': str(uuid4()), 'run_date': '2026-10-27', 'kind': 'daily'}
    asyncio.run(execute_run(store, FakeAI(), WorkspaceSettings(prospect_source="web_research"), run))
    assert store.saved[0][0] == 'sm_prospects'
    assert store.saved[0][2] == {'conflict': 'website_key', 'ignore': True}
    assert store.patched[-1]['status'] == 'completed'


def test_partial_run_failure_is_persisted_without_erasing_saved_posts():
    store = FakeStore()
    draft = dict(title='A useful engineering idea', body='A concrete conceptual example with an honest limitation.', topic='Validation', rationale='Explain a useful decision with a concrete example.', visual_brief='A simple decision tree.')
    class FakeAI:
        async def content(self, *args):
            return DailyContent(linkedin=ContentDraft(platform='linkedin', **draft), twitter=ContentDraft(platform='twitter', **draft)), []
        async def prospects(self, *args):
            raise RuntimeError('private provider error')
    asyncio.run(execute_run(store, FakeAI(), WorkspaceSettings(prospect_source="web_research"), {'id': str(uuid4()), 'run_date': '2026-10-27', 'kind': 'daily'}))
    assert store.saved[0][0] == 'sm_posts'
    assert store.patched[-1]['status'] == 'failed'
    assert 'private provider error' not in store.patched[-1]['summary']


def test_api_checks_twitter_character_limit(client):
    class FakeDB:
        async def list(self, *args, **kwargs):
            return [{'platform': 'twitter', 'body': 'A short draft.'}]
    app.dependency_overrides[get_store] = lambda: FakeDB()
    try:
        response = client.patch(f'/posts/{uuid4()}', headers={'X-Dashboard-Token': 'test-token'}, json={'body': 'a' * 281})
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_prospect_extraction_filters_unsupported_sources_and_duplicate_domains(monkeypatch):
    from app.models import ProspectResults
    service = object.__new__(AIService)
    service.settings = SimpleNamespace(openai_model='test-model')
    supported = candidate(contact_url='https://example.com/guessed-contact')
    unsupported = candidate(name='Unsupported candidate', website='https://unsupported.example', source_url='https://invented.example/source')
    duplicate = candidate(name='Duplicate business', website='https://www.example.com')
    async def research(prompt):
        return 'Research evidence', [{'url': 'https://example.com/services', 'title': 'Company services'}]
    async def parse(**kwargs):
        return SimpleNamespace(output_parsed=ProspectResults(prospects=[supported, unsupported, duplicate]))
    service.research = research
    service.client = SimpleNamespace(responses=SimpleNamespace(parse=parse))
    candidates, sources = asyncio.run(service.prospects(WorkspaceSettings(), []))
    assert len(candidates) == 1
    assert candidates[0].name == supported.name
    assert candidates[0].contact_url is None


def test_generation_missing_openai_key_is_actionable(client, monkeypatch):
    monkeypatch.setattr(settings, 'openai_api_key', '')
    response = client.post('/generate/daily', headers={'X-Dashboard-Token': 'test-token'})
    assert response.status_code == 503
    assert 'OPENAI_API_KEY' in response.json()['detail']
