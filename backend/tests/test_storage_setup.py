import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.storage import Store, StorageError


@pytest.mark.parametrize('code', ['PGRST205', 'PGRST202', '42P01'])
def test_missing_database_setup_has_an_actionable_safe_message(monkeypatch, code):
    original_client = httpx.AsyncClient
    def handler(request):
        return httpx.Response(404, json={'code': code, 'message': 'private provider detail sb_secret_test'})
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    settings = SimpleNamespace(storage_ready=True, supabase_url='https://example.supabase.co', supabase_secret_key='sb_secret_test')
    with pytest.raises(StorageError) as error:
        asyncio.run(Store(settings).list('sm_settings'))
    assert 'supabase/setup.sql' in str(error.value)
    assert 'sb_secret_test' not in str(error.value)
    assert 'private provider' not in str(error.value)
