"""Retry only idempotent social reads and keyed upserts on transient storage errors."""
import asyncio
from ..storage import StorageError

class SocialStore:
    def __init__(self,store):self.store=store
    async def _retry(self,method,*args,**kwargs):
        for attempt in range(3):
            try:return await getattr(self.store,method)(*args,**kwargs)
            except StorageError:
                if attempt==2:raise
                await asyncio.sleep(attempt+1)
    async def list(self,*args,**kwargs):return await self._retry('list',*args,**kwargs)
    async def insert(self,*args,**kwargs):return await self._retry('insert',*args,**kwargs)
