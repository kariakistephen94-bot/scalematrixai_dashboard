import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from .services.generation import execute_run
from .services.workspace import load_workspace

logger = logging.getLogger(__name__)


def due(now, workspace):
    return workspace.schedule_enabled and now.strftime('%H:%M') >= workspace.generation_time


async def scheduler_loop(store, ai, settings, launch, maps=None):
    """Catch up after the scheduled time; Supabase claims prevent duplicate daily runs."""
    while True:
        try:
            if settings.storage_ready and (settings.openai_api_key or settings.google_maps_api_key):
                workspace = await load_workspace(store, settings)
                now = datetime.now(ZoneInfo(workspace.timezone))
                day = now.date().isoformat()
                if due(now, workspace):
                    previous = await store.list('sm_runs', filters={'run_key': f'eq.{day}:daily'}, limit=1)
                    # Failed jobs require an explicit retry instead of spending credits every minute.
                    if not previous:
                        run = await store.claim_run(f'{day}:daily', 'daily', day)
                        if run:
                            launch(execute_run(store, ai, workspace, run, maps))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('Scheduler check failed (%s)', type(exc).__name__)
        await asyncio.sleep(60)
