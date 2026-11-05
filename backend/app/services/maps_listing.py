"""Filter live Google contact details without caching them in the database."""
from .google_maps import contact_presence


async def contact_page(db, maps, *, filters, offset, limit, website):
    leads = []
    cursor = offset
    scanned = 0
    errors = 0
    has_more = False
    lookup_warning = None
    # Keep each interactive request bounded; Next continues from the exact cursor.
    budget = 20
    while scanned < budget and len(leads) < limit:
        size = min(5, budget - scanned)
        records = await db.list('sm_maps_leads', limit=size + 1, offset=cursor, filters=filters,
                                order='created_at.desc,id.desc')
        batch = records[:size]
        if not batch:
            has_more = False
            break
        hydrated = await maps.hydrate(batch)
        if hydrated and all(lead.get('details_error') for lead in hydrated):
            # Stop on provider-wide failures instead of spending the remaining
            # request budget on lookups that are likely to fail the same way.
            errors += len(hydrated)
            scanned += len(hydrated)
            lookup_warning = hydrated[0]['details_error']
            has_more = False
            break
        for index, lead in enumerate(hydrated):
            cursor += 1
            scanned += 1
            has_more = index + 1 < len(batch) or len(records) > size
            if lead.get('details_error') or not lead.get('details'):
                errors += 1
                continue
            has_phone, has_website = contact_presence(lead['details'])
            if not has_phone:
                continue
            if website == 'with_website' and not has_website:
                continue
            if website == 'no_website' and has_website:
                continue
            leads.append(dict(lead, contact_status='phone_and_website' if has_website else 'phone_only'))
            if len(leads) == limit:
                break
        if not has_more:
            break
    return {'leads': leads, 'has_more': has_more, 'offset': offset,
            'next_offset': cursor, 'scanned': scanned, 'details_errors': errors, 'lookup_warning': lookup_warning}
