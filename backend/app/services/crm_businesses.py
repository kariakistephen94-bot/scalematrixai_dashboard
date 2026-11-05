"""Live source details for CRM; never overwrites saved user-owned CRM fields."""
import asyncio
from .google_maps import contact_presence


def id_filter(ids):
    return 'in.(' + ','.join(str(value) for value in ids) + ')'


async def resolve_crm_businesses(db, maps, contact_ids):
    rows = await db.list('sm_settings', filters={'id': id_filter(f'crm:{value}' for value in contact_ids)}, limit=len(contact_ids))
    contacts = [dict(row['value'], id=row['id'][4:]) for row in rows]
    map_ids = {c['source_id'] for c in contacts if c['source_type'] == 'google_maps' and c.get('source_id')}
    web_ids = {c['source_id'] for c in contacts if c['source_type'] == 'web_research' and c.get('source_id')}
    async def sources(table, ids):
        return await db.list(table, filters={'id': id_filter(ids)}, limit=len(ids)) if ids else []
    maps_rows, web_rows = await asyncio.gather(sources('sm_maps_leads', map_ids), sources('sm_prospects', web_ids))
    hydrated = {row['id']: row for row in await maps.hydrate(maps_rows)} if maps_rows else {}
    web = {row['id']: row for row in web_rows}
    result = {}
    for contact in contacts:
        source_id = contact.get('source_id')
        if contact['source_type'] == 'google_maps':
            lead = hydrated.get(source_id)
            details = (lead or {}).get('details') or {}
            has_phone, has_website = contact_presence(details)
            result[contact['id']] = {
                'name': (details.get('displayName') or {}).get('text'),
                'phone': details.get('internationalPhoneNumber') or details.get('nationalPhoneNumber'),
                'website': details.get('websiteUri') if has_website else None,
                'address': details.get('formattedAddress'),
                'place_id': (lead or {}).get('place_id'),
                'maps_url': details.get('googleMapsUri'),
                'attributions': details.get('attributions') or [],
                'status': ('phone_and_website' if has_website else 'phone_only' if has_phone else 'no_phone') if details else 'unavailable',
                'error': (lead or {}).get('details_error') if lead else 'The original Maps lead is no longer available.',
            }
        elif contact['source_type'] == 'web_research':
            lead = web.get(source_id)
            result[contact['id']] = {'name': (lead or {}).get('name'), 'website': (lead or {}).get('website'),
                'address': (lead or {}).get('location'), 'status': 'web_research',
                'error': None if lead else 'The original prospect is no longer available.'}
    return result
