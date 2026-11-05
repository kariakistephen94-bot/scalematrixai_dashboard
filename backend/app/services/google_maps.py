"""Google Maps discovery via Places API (New), with no browser scraping dependency."""
import asyncio
import time
from datetime import date
from urllib.parse import quote, urlparse

import httpx


class MapsError(Exception):
    """A provider failure safe to display without credentials or raw Google payloads."""


from ..targeting import MARKETS as AREA_MARKETS, selected_areas

MARKETS = {country: {'region': market['region'], 'cities': [item['city'] for rows in market['tiers'].values() for item in rows]} for country, market in AREA_MARKETS.items()}
NICHE_QUERIES = {
    "Commercial cleaning": "commercial cleaning companies",
    "Solar businesses": "solar installation companies",
    "Facility management": "facility management companies",
}


def contact_presence(details):
    details = details or {}
    phone = details.get('internationalPhoneNumber') or details.get('nationalPhoneNumber') or ''
    has_phone = isinstance(phone, str) and any(c.isdigit() for c in phone)
    website = details.get('websiteUri') or ''
    try:
        parsed = urlparse(website)
        has_website = parsed.scheme in ('http', 'https') and bool(parsed.hostname)
    except ValueError:
        has_website = False
    return has_phone, has_website


def search_plan(workspace, run_date):
    """Rotate niche/country combinations and city coverage deterministically each day."""
    niches = [v.strip() for v in workspace.target_industry.split(";") if v.strip()]
    markets = [v.strip() for v in workspace.target_location.split(";") if v.strip()]
    unsupported = set(markets) - set(MARKETS)
    if unsupported:
        raise MapsError("Choose United States, United Kingdom, Nigeria, or China for discovery.")
    if not niches or not markets:
        raise MapsError("Select at least one niche and market before discovery.")
    day = date.fromisoformat(run_date).toordinal()
    pairs = [(niche, markets[(index + turn) % len(markets)]) for turn in range(len(markets)) for index, niche in enumerate(niches)]
    shift = day % len(pairs)
    pairs = pairs[shift:] + pairs[:shift]
    plan = []
    for round_index in range(9):
        for niche, country in pairs:
            market = MARKETS[country]
            cities = [item['city'] for item in selected_areas(country, workspace.target_tiers, workspace.target_areas)]
            if not cities:
                continue
            city = cities[(day + round_index) % len(cities)]
            plan.append({"niche": niche, "country": country, "city": city, "region": market["region"], "query": f"{NICHE_QUERIES.get(niche, niche)} in {city}, {country}"})
    return plan


class GoogleMapsService:
    def __init__(self, settings, client=None):
        self.settings = settings
        self.client = client
        self.details_retry_after = 0

    async def _request(self, method, path, *, field_mask, body=None, retries=2):
        if not self.settings.google_maps_api_key:
            raise MapsError("Add GOOGLE_MAPS_API_KEY to backend/.env and enable Places API (New) in Google Cloud.")
        headers = {"X-Goog-Api-Key": self.settings.google_maps_api_key, "X-Goog-FieldMask": field_mask}
        for attempt in range(retries + 1):
            try:
                if self.client is not None:
                    response = await self.client.request(method, f"https://places.googleapis.com/v1/{path}", headers=headers, json=body, timeout=8)
                else:
                    async with httpx.AsyncClient(timeout=8) as client:
                        response = await client.request(method, f"https://places.googleapis.com/v1/{path}", headers=headers, json=body)
            except httpx.HTTPError as exc:
                if attempt < retries:
                    await asyncio.sleep(0.3 * (2 ** attempt))
                    continue
                raise MapsError("Google Maps is temporarily unreachable. Please retry.") from exc
            if response.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                await asyncio.sleep(0.3 * (2 ** attempt))
                continue
            if response.status_code in (401, 403):
                raise MapsError("Google Maps access was denied. Check the API key, Places API (New) enablement, key restrictions, and billing in Google Cloud.")
            if response.status_code == 429:
                raise MapsError("Google Maps quota is temporarily exhausted. Check your Google Cloud quota and retry later.")
            if response.status_code == 404:
                return None
            if response.is_error:
                raise MapsError("Google Maps could not complete this search. Check the selected niche and market, then retry.")
            try:
                result = response.json()
                if not isinstance(result, dict):
                    raise ValueError("Expected JSON object")
                return result
            except ValueError as exc:
                raise MapsError("Google Maps returned an unreadable response. Please retry.") from exc

    async def discover(self, workspace, existing_ids, run_date):
        """Return persistable IDs and user-selected context, not cached Google business details."""
        plan = search_plan(workspace, run_date)
        seen = set(existing_ids)
        rows = []
        requests_used = 0
        # Breadth before depth: don't spend the entire quota on the first niche/country.
        breadth = len({(target['niche'], target['country']) for target in plan})
        per_query = max(1, (workspace.daily_prospect_count + breadth - 1) // breadth)
        queries_run = []
        min_reviews = getattr(workspace, 'min_reviews', 0)
        # Review counts are only requested when a minimum is set, so the default request is unchanged.
        field_mask = "places.id,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,nextPageToken"
        if min_reviews:
            field_mask = field_mask.replace("places.websiteUri", "places.websiteUri,places.userRatingCount")
        for target in plan:
            if len(rows) >= workspace.daily_prospect_count or requests_used >= self.settings.google_maps_max_requests:
                break
            token = None
            for _page in range(self.settings.google_maps_max_pages):
                if requests_used >= self.settings.google_maps_max_requests:
                    break
                body = {"textQuery": target["query"], "pageSize": 20, "languageCode": "en", "regionCode": target["region"]}
                if token:
                    body["pageToken"] = token
                requests_used += 1
                try:
                    payload = await self._request("POST", "places:searchText", field_mask=field_mask, body=body)
                except MapsError as exc:
                    if rows:
                        return rows, {"requests": requests_used, "queries": queries_run, "warning": str(exc)}
                    raise
                if payload is None:
                    break
                queries_run.append(target["query"])
                added = 0
                for place in payload.get("places", []):
                    place_id = place.get("id")
                    if not isinstance(place_id, str) or not place_id or len(place_id) > 255 or place_id in seen:
                        continue
                    seen.add(place_id)
                    if not contact_presence(place)[0]:
                        continue
                    count = place.get("userRatingCount")
                    if min_reviews and not (isinstance(count, int) and not isinstance(count, bool) and count >= min_reviews):
                        continue
                    rows.append({"place_id": place_id, "niche": target["niche"], "country": target["country"], "search_city": target["city"]})
                    added += 1
                    if len(rows) >= workspace.daily_prospect_count or added >= per_query:
                        break
                if added or len(rows) >= workspace.daily_prospect_count:
                    break
                token = payload.get("nextPageToken")
                if not token:
                    break
        return rows, {"requests": requests_used, "queries": queries_run}

    async def details(self, place_id):
        # Fetched for display only. Returned details are never written to Supabase.
        return await self._request("GET", f"places/{quote(place_id, safe='')}", field_mask="id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,businessStatus,rating,userRatingCount,attributions", retries=0)

    async def _search_saved_records(self, records):
        """Resolve only exact saved Place IDs using the available Text Search API."""
        groups = {}
        for record in records:
            key = (record.get('niche'), record.get('search_city'), record.get('country'))
            groups.setdefault(key, []).append(record)
        semaphore = asyncio.Semaphore(3)
        async def resolve(key, group):
            niche, city, country = key
            if not all(key):
                return [dict(row, details=None, details_error='Business targeting details are missing. View this listing on Google Maps.') for row in group]
            wanted = {row['place_id'] for row in group}
            found = {}
            token = None
            error = None
            async with semaphore:
                for _ in range(2):
                    body = {'textQuery': f"{NICHE_QUERIES.get(niche, niche)} in {city}, {country}", 'pageSize': 20, 'languageCode': 'en'}
                    if country in MARKETS:
                        body['regionCode'] = MARKETS[country]['region']
                    if token:
                        body['pageToken'] = token
                    try:
                        payload = await self._request('POST', 'places:searchText',
                            field_mask='places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus,places.rating,places.userRatingCount,places.attributions,nextPageToken',
                            body=body, retries=0)
                    except MapsError as exc:
                        error = str(exc)
                        break
                    for place in (payload or {}).get('places', []):
                        if place.get('id') in wanted:
                            found[place['id']] = place
                    if wanted.issubset(found):
                        break
                    token = (payload or {}).get('nextPageToken')
                    if not token:
                        break
            return [dict(row, details=found.get(row['place_id']),
                         details_error=None if row['place_id'] in found else error or 'This saved business could not be matched in current Google results. View its listing or retry.') for row in group]
        batches = await asyncio.gather(*(resolve(key, group) for key, group in groups.items()))
        resolved = {row['place_id']: row for batch in batches for row in batch}
        return [resolved[row['place_id']] for row in records]

    async def hydrate(self, records):
        if not records:
            return []
        if time.monotonic() < self.details_retry_after:
            return await self._search_saved_records(records)
        semaphore = asyncio.Semaphore(5)
        async def one(record):
            async with semaphore:
                try:
                    details = await self.details(record["place_id"])
                    return dict(record, details=details, details_error=None if details else "This listing is no longer available.")
                except MapsError as exc:
                    return dict(record, details=None, details_error=str(exc))
        result = await asyncio.gather(*(one(record) for record in records))
        quota_rows = [row for row in result if 'quota' in (row.get('details_error') or '').lower()]
        if quota_rows:
            self.details_retry_after = time.monotonic() + 60
            recovered = {row['place_id']: row for row in await self._search_saved_records(quota_rows)}
            result = [recovered.get(row['place_id'], row) for row in result]
        return result
