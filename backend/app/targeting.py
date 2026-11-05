"""Curated area presets. Regional output is not a business-size classification."""
import json
import re
from pathlib import Path

MARKETS = json.loads((Path(__file__).parent / 'data/market-presets.json').read_text())
TIERS = ['higher', 'middle', 'lower']


def selected_areas(country, tiers=None, areas=None):
    groups = MARKETS[country]['tiers']
    selected = [item for tier, rows in groups.items() if tier == 'priority' or tier in (tiers or TIERS) for item in rows]
    explicit = [value.split('|', 1)[1] for value in (areas or []) if value.startswith(country + '|')]
    return [item for item in selected if not explicit or item['area'] in explicit]


def region_matches(lead, tiers=None, areas=None):
    country = lead.get('country') or lead.get('location', '')
    country = next((name for name in MARKETS if name.lower() in country.lower()), None)
    if not country:
        return not areas
    location = ' '.join(str(lead.get(k, '')) for k in ('search_city', 'location', 'address'))
    # Nigeria is always restricted to the three requested cities. For other countries,
    # unrestricted old leads remain available until an explicit area/tier is selected.
    if country != 'Nigeria' and not areas and set(tiers or TIERS) == set(TIERS):
        return True
    for item in selected_areas(country, tiers, areas):
        terms = [item['area'], item['city'].split(',')[0], *item.get('aliases', [])]
        if any((term in location if re.search(r'[\u4e00-\u9fff]', term) else re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', location, re.I)) for term in terms):
            return True
    return False


def target_description(workspace):
    countries = [v.strip() for v in workspace.target_location.split(';') if v.strip()]
    return {country: [item['city'] for item in selected_areas(country, workspace.target_tiers, workspace.target_areas)] for country in countries if country in MARKETS}
