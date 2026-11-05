import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.models import WorkspaceSettings
from app.services.google_maps import GoogleMapsService
from app.services.maps_listing import contact_page


def test_discovery_requires_phone_and_accepts_phone_without_website():
    async def run():
        def handler(request):
            fields = request.headers['X-Goog-FieldMask']
            assert 'places.internationalPhoneNumber' in fields and 'places.websiteUri' in fields
            return httpx.Response(200, json={'places': [
                {'id': 'website-only', 'websiteUri': 'https://example.com'},
                {'id': 'blank-phone', 'nationalPhoneNumber': '   '},
                {'id': 'phone-only', 'nationalPhoneNumber': '08012345678'},
                {'id': 'both', 'internationalPhoneNumber': '+1234567890', 'websiteUri': 'https://example.com'},
            ]})
        settings = SimpleNamespace(google_maps_api_key='test', google_maps_max_requests=4, google_maps_max_pages=2)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            leads, _ = await GoogleMapsService(settings, client).discover(WorkspaceSettings(daily_prospect_count=2), [], '2026-10-27')
        assert {lead['place_id'] for lead in leads} == {'phone-only', 'both'}
        assert all(set(lead) == {'place_id', 'niche', 'country', 'search_city'} for lead in leads)
    asyncio.run(run())


@pytest.mark.parametrize('website,expected', [('all', ['both', 'phone-only']), ('with_website', ['both']), ('no_website', ['phone-only'])])
def test_contact_filter_distinguishes_missing_website_from_failed_details(website, expected):
    class DB:
        async def list(self, *args, **kwargs):
            rows = [{'id': value, 'place_id': value} for value in ['failed', 'website-only', 'both', 'phone-only']]
            return rows[kwargs['offset']:kwargs['offset'] + kwargs['limit']]
    class Maps:
        async def hydrate(self, records):
            details = {
                'failed': None,
                'website-only': {'websiteUri': 'https://example.com'},
                'both': {'nationalPhoneNumber': '1234567', 'websiteUri': 'https://example.com'},
                'phone-only': {'internationalPhoneNumber': '+2341234567'},
            }
            return [dict(row, details=details[row['id']], details_error='Temporary failure' if row['id'] == 'failed' else None) for row in records]
    result = asyncio.run(contact_page(DB(), Maps(), filters={}, offset=0, limit=5, website=website))
    assert [row['id'] for row in result['leads']] == expected
    assert result['details_errors'] == 1
    assert result['has_more'] is False
    assert result['next_offset'] == 4
    for row in result['leads']:
        assert row['contact_status'] == ('phone_only' if row['id'] == 'phone-only' else 'phone_and_website')


def test_filter_reaches_later_pages_without_skipping_matches_and_obeys_budget():
    class DB:
        async def list(self, *args, **kwargs):
            return [{'id': str(i), 'place_id': str(i)} for i in range(kwargs['offset'], min(40, kwargs['offset'] + kwargs['limit']))]
    class Maps:
        async def hydrate(self, records):
            return [dict(row, details={'nationalPhoneNumber': '123456', **({'websiteUri': 'https://example.com'} if int(row['id']) < 7 else {})}, details_error=None) for row in records]
    first = asyncio.run(contact_page(DB(), Maps(), filters={}, offset=0, limit=2, website='no_website'))
    assert [r['id'] for r in first['leads']] == ['7', '8']
    assert first['next_offset'] == 9 and first['has_more']
    second = asyncio.run(contact_page(DB(), Maps(), filters={}, offset=first['next_offset'], limit=2, website='no_website'))
    assert [r['id'] for r in second['leads']] == ['9', '10']
    empty = asyncio.run(contact_page(DB(), Maps(), filters={}, offset=8, limit=5, website='with_website'))
    assert not empty['leads'] and empty['has_more']
    assert empty['scanned'] == 20 and empty['next_offset'] == 28


def test_provider_wide_error_stops_lookups_and_keeps_retry_cursor():
    class DB:
        async def list(self, *args, **kwargs):
            return [{'id': str(i), 'place_id': str(i)} for i in range(6)]
    class Maps:
        calls = 0
        async def hydrate(self, records):
            self.calls += 1
            return [dict(row, details=None, details_error='Google Maps quota is temporarily exhausted.') for row in records]
    maps = Maps()
    result = asyncio.run(contact_page(DB(), maps, filters={}, offset=0, limit=5, website='no_website'))
    assert maps.calls == 1 and not result['leads']
    assert result['next_offset'] == 0 and not result['has_more']
    assert result['details_errors'] == 5 and 'quota' in result['lookup_warning']
