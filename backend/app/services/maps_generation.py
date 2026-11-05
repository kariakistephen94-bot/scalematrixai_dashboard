from .google_maps import MapsError


async def save_maps_leads(store, maps, workspace, run):
    existing = await store.list('sm_maps_leads', limit=10000)
    candidates, metadata = await maps.discover(workspace, [row['place_id'] for row in existing], run['run_date'])
    if not candidates:
        return f"No new Maps listings with phone numbers found after {metadata['requests']} searches; existing listings were preserved."
    rows = [dict(candidate, run_id=run['id']) for candidate in candidates]
    saved = await store.insert('sm_maps_leads', rows, conflict='place_id', ignore=True)
    count = len(saved) if saved is not None else len(rows)
    warning = f" Some searches could not finish: {metadata['warning']}" if metadata.get('warning') else ''
    return f"{count} new Google Maps listings with phone numbers saved across {metadata['requests']} searches. Open Prospects to load live business details." + warning
