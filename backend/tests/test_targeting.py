import json
from pathlib import Path
from app.targeting import MARKETS, selected_areas, region_matches
from app.models import WorkspaceSettings
from app.services.google_maps import search_plan
from app.services.agent import recipient_timezone


def test_nigeria_is_restricted_to_exact_requested_cities():
    for day in ('2026-10-27','2026-10-28','2026-11-01'):
        plan=search_plan(WorkspaceSettings(target_location='Nigeria'),day)
        assert {p['city'] for p in plan}=={'Abuja','Lagos','Port Harcourt'}
    assert not region_matches({'country':'Nigeria','search_city':'Ibadan'})
    assert not region_matches({'country':'Nigeria','search_city':'Kano'})
    assert region_matches({'country':'Nigeria','search_city':'Port Harcourt'})


def test_each_other_market_has_three_distinct_areas_in_each_tier():
    for country in ('United States','United Kingdom','China'):
        groups=MARKETS[country]['tiers']
        assert set(groups)=={'higher','middle','lower'}
        assert all(len(rows)==3 for rows in groups.values())
        assert len({row['area'] for rows in groups.values() for row in rows})==9
    frontend=Path(__file__).parents[2]/'frontend/lib/market-presets.json'
    assert json.loads(frontend.read_text())==MARKETS


def test_search_respects_tier_and_explicit_state():
    workspace=WorkspaceSettings(target_location='United States',target_tiers=['lower'],target_areas=['United States|Arkansas'])
    plan=search_plan(workspace,'2026-10-28')
    assert all(item['city']=='Little Rock, Arkansas' for item in plan)
    assert region_matches({'country':'United States','search_city':'Little Rock, Arkansas'},['lower'],workspace.target_areas)
    assert not region_matches({'country':'United States','search_city':'Seattle, Washington'},['lower'],workspace.target_areas)


def test_china_and_us_greeting_timezones():
    assert recipient_timezone({},'China','UTC')=='Asia/Shanghai'
    assert recipient_timezone({'search_city':'Seattle, Washington'},'United States','UTC')=='America/Los_Angeles'
    assert recipient_timezone({'search_city':'Boston, Massachusetts'},'United States','UTC')=='America/New_York'
    assert recipient_timezone({'search_city':'Little Rock, Arkansas'},'United States','UTC')=='America/Chicago'


def test_subregional_cities_are_recognized_without_expanding_nigeria():
    assert region_matches({'country':'United Kingdom','location':'Exeter, Devon'},['middle'],['United Kingdom|South West'])
    assert region_matches({'country':'United States','location':'Worcester, Massachusetts'},['higher'],['United States|Massachusetts'])
    assert not region_matches({'country':'Nigeria','location':'Ibadan'},['higher','middle','lower'],['Nigeria|Lagos','Nigeria|Abuja','Nigeria|Port Harcourt'])
