import httpx


class StorageError(Exception):
    pass


class Store:
    """Only this server-side adapter receives the Supabase secret key."""

    def __init__(self, settings):
        self.settings = settings

    async def request(self, method, path, *, params=None, body=None, prefer=None):
        if not self.settings.storage_ready:
            raise StorageError('Connect Supabase and apply the migration to save your workspace.')
        headers = {'apikey': self.settings.supabase_secret_key, 'Content-Type': 'application/json'}
        # New sb_secret_ keys authenticate through apikey. Legacy JWT keys also use Bearer.
        if self.settings.supabase_secret_key.startswith('eyJ'):
            headers['Authorization'] = f'Bearer {self.settings.supabase_secret_key}'
        if prefer:
            headers['Prefer'] = prefer
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.request(method, f'{self.settings.supabase_url.rstrip("/")}/rest/v1/{path}', headers=headers, params=params, json=body)
            if response.is_error:
                try:
                    error_code = response.json().get('code')
                except (ValueError, AttributeError):
                    error_code = None
                if error_code in ('PGRST205', 'PGRST202', '42P01'):
                    raise StorageError('Database setup is incomplete. Run supabase/setup.sql in your Supabase SQL Editor, then refresh the dashboard.')
                raise StorageError('Supabase could not complete the request. Check the project URL, secret key, and SQL migration.')
            return response.json() if response.content else None
        except httpx.HTTPError as exc:
            raise StorageError('Supabase is unreachable. Check your connection and project URL.') from exc

    async def list(self, table, *, limit=100, filters=None, order='created_at.desc', offset=0):
        return await self.request('GET', table, params={'select': '*', 'order': order, 'limit': limit, 'offset': offset, **(filters or {})})

    async def insert(self, table, rows, conflict=None, ignore=False):
        return await self.request('POST', table, body=rows, params={'on_conflict': conflict} if conflict else None, prefer=f'return=representation,resolution={"ignore" if ignore else "merge"}-duplicates')

    async def patch(self, table, item_id, changes):
        return await self.request('PATCH', table, params={'id': f'eq.{item_id}'}, body=changes, prefer='return=representation')

    async def claim_run(self, run_key, kind, run_date):
        return await self.request('POST', 'rpc/sm_claim_run', body={'p_key': run_key, 'p_kind': kind, 'p_date': run_date})
