import asyncio
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from ..storage import StorageError
from .ai import GenerationError
from .google_maps import MapsError
from .maps_generation import save_maps_leads

logger = logging.getLogger(__name__)


async def save_content(store, ai, workspace, run):
    day = run['run_date']
    existing = await store.list('sm_posts', filters={'generation_date': f'eq.{day}'})
    if {p['platform'] for p in existing} >= {'linkedin', 'twitter'}:
        return 'Daily posts already exist; preserved your drafts.'
    history = await store.list('sm_posts', limit=30)
    drafts, sources = await ai.content(workspace, [p['topic'] for p in history], day)
    rows = [dict(d.model_dump(), generation_date=day, status='draft', sources=sources, run_id=run['id']) for d in (drafts.linkedin, drafts.twitter)]
    await store.insert('sm_posts', rows, conflict='generation_date,platform', ignore=True)
    return 'LinkedIn and X drafts saved for review.'


async def save_web_prospects(store, ai, workspace, run):
    existing = await store.list('sm_prospects', limit=1000)
    candidates, _ = await ai.prospects(workspace, [p['website'] for p in existing])
    rows = []
    for candidate in candidates:
        host = urlparse(candidate.website).hostname.removeprefix('www.')
        rows.append(dict(candidate.model_dump(), website_key=host, stage='new', run_id=run['id'], researched_at=datetime.now(timezone.utc).isoformat()))
    saved = await store.insert('sm_prospects', rows, conflict='website_key', ignore=True) if rows else []
    count = len(saved) if saved is not None else len(rows)
    return f'{count} source-backed business prospects found. Fit still needs human review.'


def public_failure(exc):
    if isinstance(exc, (StorageError, GenerationError, MapsError)):
        return str(exc)
    return 'Check API access, quotas, database migrations, and connection, then retry. Completed steps are preserved.'


async def execute_run(store, ai, workspace, run, maps=None):
    """Independent phases preserve content even when Maps fails, and vice versa."""
    summary = []
    errors = []
    phases = []
    if run['kind'] in ('daily', 'content'):
        phases.append(('Content', lambda: save_content(store, ai, workspace, run)))
    if run['kind'] in ('daily', 'prospects'):
        async def prospects():
            if workspace.prospect_source == 'google_maps':
                if maps is None:
                    raise MapsError('Google Maps discovery is not initialized. Restart FastAPI.')
                return await save_maps_leads(store, maps, workspace, run)
            return await save_web_prospects(store, ai, workspace, run)
        phases.append(('Prospects', prospects))
    try:
        async with asyncio.timeout(600):
            for label, action in phases:
                try:
                    summary.append(await action())
                    if label == 'Prospects' and getattr(ai, 'agent', None):
                        try:
                            await ai.agent.after_search(workspace, run)
                            summary.append('Automatic owner research queued for new leads when enabled.')
                        except Exception:
                            summary.append('Leads saved. Automatic owner research could not start; use Run Agent.')
                except Exception as exc:
                    logger.warning('%s phase failed (%s)', label, type(exc).__name__)
                    errors.append(f'{label}: {public_failure(exc)}')
    except TimeoutError:
        errors.append('The run reached its ten-minute limit. Completed steps are preserved.')
    try:
        await store.patch('sm_runs', run['id'], {'status': 'failed' if errors else 'completed', 'summary': ' '.join(summary + errors), 'finished_at': datetime.now(timezone.utc).isoformat()})
    except StorageError:
        logger.warning('Could not persist run state; its lease will expire.')
