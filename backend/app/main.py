import asyncio
import secrets
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request

from .config import get_settings
from .models import CRMBusinessLookup, CRMBulkImport, QuickSearch, CRMContact, PostUpdate, ProspectUpdate, WorkspaceSettings, MapsLeadUpdate, ProjectBody
from .references import reference_posts
from .scheduler import scheduler_loop
from .services.agent import LeadAgent, AgentRequest, AgentPreferences, render_message
from .text_filters import clean_generated
from .services.social_leads import SocialDiscovery, SocialSearch, Platform, Niche, Country
from .services.founder_emails import list_contacts
from .services.ai import AIService
from .services.crm_businesses import resolve_crm_businesses
from .services.maps_listing import contact_page
from .services.google_maps import GoogleMapsService, MapsError
from .services.generation import execute_run
from .services.showcase import Showcase, ShowcaseError, video_info, VIDEO_TYPES, IMAGE_TYPES, MAX_UPLOAD
from .services.workspace import defaults, load_workspace
from .storage import Store, StorageError

settings = get_settings()
store = Store(settings)
ai = AIService(settings)
maps = GoogleMapsService(settings)
tasks = set()


def launch(coroutine):
    task = asyncio.create_task(coroutine)
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return task


showcase = Showcase(settings, store)
agent = LeadAgent(store, ai, maps, launch)
ai.agent = agent
social = SocialDiscovery(store, ai, agent, launch)


@asynccontextmanager
async def lifespan(app):
    scheduler = launch(scheduler_loop(store, ai, settings, launch, maps)) if settings.scheduler_enabled else None
    yield
    for task in list(tasks):
        task.cancel()
    await asyncio.gather(*list(tasks), return_exceptions=True)
    await ai.client.close()


app = FastAPI(title='ScaleMatrix AI Workspace API', lifespan=lifespan, docs_url=None, redoc_url=None)


async def authorize(x_dashboard_token: str = Header(default='')):
    if not settings.dashboard_api_token or not secrets.compare_digest(x_dashboard_token, settings.dashboard_api_token):
        raise HTTPException(status_code=401, detail='Dashboard authorization required.')


def get_store():
    return store


@app.exception_handler(StorageError)
async def storage_error(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={'detail': str(exc)})


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.get('/dashboard', dependencies=[Depends(authorize)])
async def dashboard(db=Depends(get_store)):
    workspace = defaults(settings)
    result = {'posts': [], 'prospects': [], 'runs': [], 'references': reference_posts(), 'storage_error': None, 'storage_connected': False}
    if settings.storage_ready:
        try:
            workspace = await load_workspace(db, settings)
            posts, prospects, runs = await asyncio.gather(db.list('sm_posts', limit=200), db.list('sm_prospects', limit=500), db.list('sm_runs', limit=40))
            result.update(posts=posts, prospects=prospects, runs=runs, storage_connected=True)
        except StorageError as exc:
            result['storage_error'] = str(exc)
    maps_count = 0
    maps_storage_error = None
    if settings.storage_ready:
        try:
            maps_rows = await db.list('sm_maps_leads', limit=1000)
            maps_count = len([row for row in maps_rows if row['stage'] != 'archived'])
        except StorageError as exc:
            maps_storage_error = 'Apply supabase/migrations/002_google_maps.sql to enable Maps leads.'
    result.update(maps_lead_count=maps_count, maps_configured=bool(settings.google_maps_api_key), maps_storage_error=maps_storage_error, settings=workspace.model_dump(), openai_configured=bool(settings.openai_api_key), model=settings.openai_model, scheduler_running=settings.scheduler_enabled, server_time=datetime.now(ZoneInfo(workspace.timezone)).isoformat())
    return clean_generated(result)


@app.put('/settings', dependencies=[Depends(authorize)])
async def save_settings(body: WorkspaceSettings, db=Depends(get_store)):
    await db.insert('sm_settings', {'id': 'default', 'value': body.model_dump()}, conflict='id')
    return body


@app.post('/generate/{kind}', status_code=202, dependencies=[Depends(authorize)])
async def generate(kind: Literal['daily', 'content', 'prospects'], db=Depends(get_store)):
    if kind == 'content' and not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to backend/.env and restart FastAPI.')
    if kind == 'daily' and not (settings.openai_api_key or settings.google_maps_api_key):
        raise HTTPException(503, 'Add OPENAI_API_KEY and/or GOOGLE_MAPS_API_KEY to backend/.env and restart FastAPI.')
    workspace = await load_workspace(db, settings)
    if kind == 'content' or (kind == 'prospects' and workspace.prospect_source == 'web_research'):
        if not settings.openai_api_key:
            raise HTTPException(503, 'Add OPENAI_API_KEY to backend/.env and restart FastAPI.')
    elif kind == 'prospects' and not settings.google_maps_api_key:
        raise HTTPException(503, 'Add GOOGLE_MAPS_API_KEY to backend/.env and enable Places API (New).')
    elif kind == 'daily' and not (settings.openai_api_key or settings.google_maps_api_key):
        raise HTTPException(503, 'Add OPENAI_API_KEY and/or GOOGLE_MAPS_API_KEY to backend/.env and restart FastAPI.')
    day = datetime.now(ZoneInfo(workspace.timezone)).date().isoformat()
    target_key = hashlib.sha256(f'{workspace.prospect_source}|{workspace.target_industry}|{workspace.target_location}|{workspace.daily_prospect_count}|{workspace.target_tiers}|{workspace.target_areas}'.encode()).hexdigest()[:12]
    run_key = f'{day}:{kind}' + (f':{target_key}' if kind == 'prospects' else '')
    run = await db.claim_run(run_key, kind, day)
    if not run:
        rows = await db.list('sm_runs', filters={'run_key': f'eq.{run_key}'}, limit=1)
        return {'already_exists': True, 'run': rows[0] if rows else None}
    launch(execute_run(db, ai, workspace, run, maps))
    return {'already_exists': False, 'run': run}


@app.patch('/posts/{item_id}', dependencies=[Depends(authorize)])
async def update_post(item_id: UUID, body: PostUpdate, db=Depends(get_store)):
    changes = body.model_dump(exclude_none=True)
    rows = await db.list('sm_posts', filters={'id': f'eq.{item_id}'}, limit=1)
    if not rows:
        raise HTTPException(404, 'Post not found.')
    if len(changes.get('body', rows[0]['body'])) > (280 if rows[0]['platform'] == 'twitter' else 3000):
        raise HTTPException(422, 'The post exceeds the platform character limit.')
    if not changes:
        return rows[0]
    updated = await db.patch('sm_posts', str(item_id), changes)
    return updated[0]


@app.patch('/prospects/{item_id}', dependencies=[Depends(authorize)])
async def update_prospect(item_id: UUID, body: ProspectUpdate, db=Depends(get_store)):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(422, 'No changes supplied.')
    rows = await db.patch('sm_prospects', str(item_id), changes)
    if not rows:
        raise HTTPException(404, 'Prospect not found.')
    return rows[0]


@app.exception_handler(MapsError)
async def maps_error(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get('/maps/leads', dependencies=[Depends(authorize)])
async def maps_leads(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=5, ge=1, le=10),
    niche: Literal['Commercial cleaning', 'Solar businesses', 'Facility management'] | None = None,
    country: Literal['United States', 'United Kingdom', 'Nigeria', 'China'] | None = None,
    stage: Literal['new', 'shortlisted', 'contacted', 'qualified', 'archived'] | None = None,
    website: Literal['all', 'with_website', 'no_website'] = 'all',
    db=Depends(get_store),
):
    filters = {'stage': f'eq.{stage}' if stage else 'neq.archived'}
    if niche:
        filters['niche'] = f'eq.{niche}'
    if country:
        filters['country'] = f'eq.{country}'
    if not settings.google_maps_api_key:
        raise HTTPException(503, 'Add GOOGLE_MAPS_API_KEY to load live business details.')
    return await contact_page(db, maps, filters=filters, offset=offset, limit=limit, website=website)



@app.patch('/maps/leads/{item_id}', dependencies=[Depends(authorize)])
async def update_maps_lead(item_id: UUID, body: MapsLeadUpdate, db=Depends(get_store)):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(422, 'No changes supplied.')
    rows = await db.patch('sm_maps_leads', str(item_id), changes)
    if not rows:
        raise HTTPException(404, 'Maps lead not found.')
    return rows[0]


@app.post('/search/quick', status_code=202, dependencies=[Depends(authorize)])
async def quick_search(body: QuickSearch, db=Depends(get_store)):
    workspace = body.workspace or await load_workspace(db, settings)
    if workspace.prospect_source == 'google_maps' and not settings.google_maps_api_key:
        raise HTTPException(503, 'Add GOOGLE_MAPS_API_KEY to start Maps discovery.')
    if workspace.prospect_source == 'web_research' and not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to start web research.')
    day = datetime.now(ZoneInfo(workspace.timezone)).date().isoformat()
    run_key = f'quick:{body.request_id}'
    run = await db.claim_run(run_key, 'prospects', day)
    if not run:
        rows = await db.list('sm_runs', filters={'run_key': f'eq.{run_key}'}, limit=1)
        return {'already_exists': True, 'run': rows[0] if rows else None}
    launch(execute_run(db, ai, workspace, run, maps))
    return {'already_exists': False, 'run': run}


# Each CRM record has its own key, avoiding shared-document updates and preserving
# the existing workspace settings. RLS on sm_settings keeps these server-only.
@app.get('/crm', dependencies=[Depends(authorize)])
async def crm_contacts(db=Depends(get_store)):
    rows = await db.list('sm_settings', filters={'id': 'like.crm:*'}, limit=1000)
    return {'contacts': [dict(row['value'], id=row['id'][4:]) for row in rows]}


async def write_contact(body, item_id, db):
    value = body.model_dump(mode='json')
    if body.source_type != 'manual':
        if not body.source_id:
            raise HTTPException(422, 'Select a source lead.')
        table = 'sm_maps_leads' if body.source_type == 'google_maps' else 'sm_prospects'
        if not await db.list(table, filters={'id': f'eq.{body.source_id}'}, limit=1):
            raise HTTPException(404, 'Source lead not found.')
    value['updated_at'] = datetime.now(ZoneInfo('UTC')).isoformat()
    await db.insert('sm_settings', {'id': f'crm:{item_id}', 'value': value}, conflict='id')
    return dict(value, id=str(item_id))


@app.post('/crm', status_code=201, dependencies=[Depends(authorize)])
async def create_contact(body: CRMContact, db=Depends(get_store)):
    # A linked lead has a stable ID, so adding it twice never duplicates a deal.
    item_id = body.source_id if body.source_type != 'manual' else uuid4()
    if item_id:
        existing = await db.list('sm_settings', filters={'id': f'eq.crm:{item_id}'}, limit=1)
        if existing:
            return dict(existing[0]['value'], id=str(item_id))
    return await write_contact(body, item_id, db)


@app.put('/crm/{item_id}', dependencies=[Depends(authorize)])
async def update_contact(item_id: UUID, body: CRMContact, db=Depends(get_store)):
    rows = await db.list('sm_settings', filters={'id': f'eq.crm:{item_id}'}, limit=1)
    if not rows:
        raise HTTPException(404, 'CRM contact not found.')
    original = rows[0]['value']
    if body.source_type != original['source_type'] or str(body.source_id) != str(original.get('source_id')):
        raise HTTPException(422, 'A contact source cannot be changed.')
    return await write_contact(body, item_id, db)


@app.post('/crm/import', dependencies=[Depends(authorize)])
async def import_all_contacts(body: CRMBulkImport, db=Depends(get_store)):
    table = 'sm_maps_leads' if body.source_type == 'google_maps' else 'sm_prospects'
    added = 0
    total = 0
    offset = 0
    batch_size = 500
    while True:
        leads = await db.list(table, filters={'stage': 'neq.archived'}, limit=batch_size, offset=offset, order='id.asc')
        if not leads:
            break
        rows = []
        for lead in leads:
            # Maps records retain only IDs and user-owned workflow metadata.
            label = (f"{lead['niche']} · {lead['search_city']} · {lead['id'][:6]}"
                     if body.source_type == 'google_maps' else lead['name'])
            contact = CRMContact(company=label[:180], source_type=body.source_type,
                                 source_id=lead['id'], notes=lead.get('notes', ''))
            value = contact.model_dump(mode='json')
            value['updated_at'] = datetime.now(ZoneInfo('UTC')).isoformat()
            rows.append({'id': f"crm:{lead['id']}", 'value': value})
        inserted = await db.insert('sm_settings', rows, conflict='id', ignore=True)
        added += len(inserted or [])
        total += len(rows)
        offset += len(leads)
        if len(leads) < batch_size:
            break
    return {'added': added, 'skipped': total - added, 'total': total}


@app.post('/crm/businesses', dependencies=[Depends(authorize)])
async def crm_businesses(body: CRMBusinessLookup, db=Depends(get_store)):
    return {'businesses': await resolve_crm_businesses(db, maps, body.contact_ids)}


@app.get('/agent', dependencies=[Depends(authorize)])
async def agent_state():
    results = await store.list('sm_settings', filters={'id': 'like.agent_lead:*'}, limit=1000)
    runs = await store.list('sm_settings', filters={'id': 'like.agent_run:*'}, limit=20)
    return clean_generated({'preferences': (await agent.preferences()).model_dump(), 'results': [dict(r['value'], outreach_draft=render_message(r['value'])) for r in results], 'runs': [r['value'] for r in runs]})

@app.put('/agent/settings', dependencies=[Depends(authorize)])
async def agent_settings(body: AgentPreferences):
    await store.insert('sm_settings', {'id': 'agent_preferences', 'value': body.model_dump()}, conflict='id')
    return body

@app.post('/agent/run', status_code=202, dependencies=[Depends(authorize)])
async def run_agent(body: AgentRequest):
    if not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to enable owner research.')
    for item_id in body.contact_ids:
        try:
            UUID(item_id)
        except ValueError:
            raise HTTPException(422, 'Invalid CRM contact ID.')
    return await agent.start(body)

@app.post('/crm/{item_id}/research-owner', status_code=202, dependencies=[Depends(authorize)])
async def research_owner(item_id: UUID):
    if not await store.list('sm_settings', filters={'id': f'eq.crm:{item_id}'}, limit=1):
        raise HTTPException(404, 'CRM contact not found.')
    return await run_agent(AgentRequest(contact_ids=[str(item_id)]))


@app.post('/agent/messages', status_code=202, dependencies=[Depends(authorize)])
async def generate_all_messages(body: AgentRequest):
    if not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to enable custom messages.')
    return await agent.all_messages(body.request_id)


@app.get('/crm/{item_id}/message', dependencies=[Depends(authorize)])
async def lead_message(item_id: UUID):
    rows = await store.list('sm_settings', filters={'id': f'eq.agent_lead:{item_id}'}, limit=1)
    return {'message': clean_generated(dict(rows[0]['value'], outreach_draft=render_message(rows[0]['value']))) if rows else None}

@app.post('/crm/{item_id}/message', status_code=202, dependencies=[Depends(authorize)])
async def generate_lead_message(item_id: UUID):
    if not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to enable custom messages.')
    if not await store.list('sm_settings', filters={'id': f'eq.crm:{item_id}'}, limit=1):
        raise HTTPException(404, 'CRM contact not found.')
    return await agent.start(AgentRequest(contact_ids=[str(item_id)]), messages_only=True)


@app.get('/emails', dependencies=[Depends(authorize)])
async def founder_email_contacts(q: str = Query(default='', max_length=180), state: str = Query(default='', max_length=60),
                                 offset: int = Query(default=0, ge=0), limit: int = Query(default=25, ge=1, le=1000), db=Depends(get_store)):
    return await list_contacts(db, q, state, offset, limit)


@app.get('/social', dependencies=[Depends(authorize)])
async def social_state():
    leads, runs = await asyncio.gather(social.records('social_lead'), social.records('social_run'))
    counts = {niche: sum(row['niche'] == niche for row in leads) for niche in ['Commercial cleaning', 'Solar businesses', 'Facility management']}
    platforms = {platform: sum(platform in row.get('profiles', {}) for row in leads) for platform in ['twitter', 'instagram', 'tiktok', 'linkedin']}
    runs.sort(key=lambda r: r['started_at'], reverse=True)
    matrix = {niche: {platform: sum(r['niche'] == niche and platform in r.get('profiles', {}) for r in leads) for platform in ['twitter','instagram','tiktok','linkedin']} for niche in counts}
    return {'total': len(leads), 'counts': counts, 'platform_counts': platforms, 'niche_platform_counts': matrix, 'runs': runs[:15]}

@app.get('/social/leads', dependencies=[Depends(authorize)])
async def social_leads(platform: Platform | None = None, niche: Niche | None = None, country: Country | None = None,
                       q: str = Query(default='', max_length=180), offset: int = Query(default=0, ge=0), limit: int = Query(default=25, ge=1, le=100)):
    leads, founder_rows = await asyncio.gather(social.records('social_lead'), social.records('social_founders'))
    founders = {r['company_id']: r for r in founder_rows}
    leads = [dict(r, founder_research=founders.get(r['id']), contact_name=next((p['name'] for p in founders.get(r['id'], {}).get('founders', [])), r['company']), contact_type='person' if founders.get(r['id'], {}).get('founders') else 'company') for r in leads]
    leads = [r for r in leads if (not platform or platform in r.get('profiles', {})) and (not niche or niche == r['niche']) and (not country or country == r['country']) and (not q or q.lower() in (r['company'] + ' ' + r['location']).lower())]
    leads.sort(key=lambda r: r['company'].casefold())
    return clean_generated({'total': len(leads), 'leads': [dict(r, outreach_draft=render_message(r)) for r in leads[offset:offset+limit]]})

@app.post('/social/search', status_code=202, dependencies=[Depends(authorize)])
async def social_search(body: SocialSearch):
    if not settings.openai_api_key:
        raise HTTPException(503, 'Add OPENAI_API_KEY to research business profiles.')
    try:
        return await social.start(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

@app.post('/social/runs/{item_id}/stop', dependencies=[Depends(authorize)])
async def stop_social_run(item_id: UUID):
    rows = await store.list('sm_settings', filters={'id': f'eq.social_run:{item_id}'}, limit=1)
    if not rows:
        raise HTTPException(404, 'Research run not found.')
    value = rows[0]['value']
    if value['status'] in ('running', 'queued'):
        await store.insert('sm_settings', {'id': f'social_stop:{item_id}', 'value': {'requested_at': datetime.now(ZoneInfo('UTC')).isoformat()}}, conflict='id')
        value['status'] = 'stopping'
        await social.save_run(value)
    return {'run': value}


# ---- Project showcase (shown on the marketing website under "See what we've built") ----
def _project_out(row):
    return dict(row['value'], id=row['id'][8:])


async def _clean_project(body, db):
    value = body.model_dump()
    value['tags'] = [t.strip()[:30] for t in value['tags'] if t.strip()]
    for field in ('link', 'thumbnail_url'):
        if value[field] and not value[field].startswith('https://'):
            raise HTTPException(422, f'{field.replace("_", " ").capitalize()} must start with https://')
    try:
        video_info(value['video_url'])
    except ShowcaseError as exc:
        raise HTTPException(422, str(exc))
    return value


async def _publish_feed():
    try:
        return await showcase.publish()
    except ShowcaseError as exc:
        raise HTTPException(502, str(exc))


@app.get('/projects', dependencies=[Depends(authorize)])
async def list_projects(db=Depends(get_store)):
    rows = await db.list('sm_settings', filters={'id': 'like.project:*'}, limit=500)
    items = sorted((_project_out(r) for r in rows), key=lambda p: (p.get('order', 0), p.get('created_at', '')))
    return {'projects': items, 'feed_url': showcase.public_url('projects.json')}


@app.post('/projects', status_code=201, dependencies=[Depends(authorize)])
async def create_project(body: ProjectBody, db=Depends(get_store)):
    value = await _clean_project(body, db)
    value['created_at'] = datetime.now(ZoneInfo('UTC')).isoformat()
    item_id = uuid4()
    await db.insert('sm_settings', {'id': f'project:{item_id}', 'value': value}, conflict='id')
    await _publish_feed()
    return dict(value, id=str(item_id))


@app.put('/projects/{item_id}', dependencies=[Depends(authorize)])
async def update_project(item_id: UUID, body: ProjectBody, db=Depends(get_store)):
    rows = await db.list('sm_settings', filters={'id': f'eq.project:{item_id}'}, limit=1)
    if not rows:
        raise HTTPException(404, 'Project not found.')
    value = await _clean_project(body, db)
    value['created_at'] = rows[0]['value'].get('created_at', '')
    await db.insert('sm_settings', {'id': f'project:{item_id}', 'value': value}, conflict='id')
    await _publish_feed()
    return dict(value, id=str(item_id))


@app.delete('/projects/{item_id}', dependencies=[Depends(authorize)])
async def delete_project(item_id: UUID, db=Depends(get_store)):
    await db.request('DELETE', 'sm_settings', params={'id': f'eq.project:{item_id}'})
    await _publish_feed()
    return {'deleted': True}


@app.post('/projects/upload', dependencies=[Depends(authorize)])
async def upload_project_file(request: Request, kind: Literal['video', 'image'] = Query(...)):
    """Raw-body upload (no multipart): the browser sends the file bytes with its Content-Type."""
    content_type = (request.headers.get('content-type') or '').split(';')[0].strip().lower()
    allowed = VIDEO_TYPES if kind == 'video' else IMAGE_TYPES
    if content_type not in allowed:
        raise HTTPException(415, 'Use MP4, WebM or MOV for videos, and JPG, PNG or WebP for images.')
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD:
            raise HTTPException(413, 'That file is over 50 MB. Upload it to YouTube (unlisted is fine) and paste the link instead.')
        chunks.append(chunk)
    if not size:
        raise HTTPException(422, 'Empty file.')
    path = f'{kind}s/{uuid4().hex}.{allowed[content_type]}'
    try:
        return {'url': await showcase.upload(path, b''.join(chunks), content_type)}
    except ShowcaseError as exc:
        raise HTTPException(502, str(exc))
