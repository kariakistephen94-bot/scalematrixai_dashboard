from datetime import datetime, timezone
from types import SimpleNamespace
import asyncio
from app.services.agent import AgentPreferences, LeadAgent, MessageBody, render_message
from app.text_filters import clean_generated
from app.models import ContentDraft


def test_greeting_uses_recipient_time_and_changes_without_regeneration():
    result={'message_body':'We help Solar One qualify buyers.','recipient_timezone':'Africa/Lagos'}
    assert 'good morning' in render_message(result, datetime(2026,10,28,8,tzinfo=timezone.utc))
    assert 'good afternoon' in render_message(result, datetime(2026,10,28,13,tzinfo=timezone.utc))
    assert 'good evening' in render_message(result, datetime(2026,10,28,18,tzinfo=timezone.utc))
    result['recipient_timezone']='America/Los_Angeles'
    assert 'good morning' in render_message(result, datetime(2026,10,28,13,tzinfo=timezone.utc))


def test_all_generated_prose_is_clean_but_addresses_are_preserved():
    value={'title':'AI — outreach','body':'follow-up\nnext – step', 'website':'https://solar-one.com/about-us', 'phone':'+234-123', 'id':'abc-def','sources':[{'title':'About — company','url':'https://a-b.com'}]}
    clean=clean_generated(value)
    assert clean['title']=='AI outreach'
    assert clean['body']=='follow up\nnext step'
    assert clean['sources'][0]['title']=='About company'
    for key in ('website','phone','id'): assert clean[key]==value[key]
    assert clean['sources'][0]['url']==value['sources'][0]['url']


def test_focus_matches_services_locations_and_niches():
    prefs=AgentPreferences(focus_countries=['Nigeria'],focus_niches=['Solar businesses'],focus_locations='Lagos, Abuja')
    assert LeadAgent.matches({'country':'Nigeria','niche':'Solar businesses','search_city':'Lagos'},prefs)
    assert not LeadAgent.matches({'country':'Nigeria','niche':'Solar businesses','search_city':'Kano'},prefs)
    assert not LeadAgent.matches({'country':'United Kingdom','niche':'Solar businesses','search_city':'London'},prefs)
    assert not LeadAgent.matches({'country':'Nigeria','niche':'Commercial cleaning','search_city':'Lagos'},prefs)
    assert prefs.messaging_key()!=AgentPreferences(focus_services=['Outreach']).messaging_key()


def test_custom_message_prompt_contains_exact_business_and_selected_offer():
    captured={}
    async def parse(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(output_parsed=MessageBody(body='We help SunCo reach more customers — without extra hiring. Would you like to know how?'))
    agent=LeadAgent(None,SimpleNamespace(settings=SimpleNamespace(openai_model='test'),client=SimpleNamespace(responses=SimpleNamespace(parse=parse))),None,None)
    result=asyncio.run(agent.message('SunCo',{'website':'https://sunco.ng'},{'niche':'Solar businesses','country':'Nigeria'},AgentPreferences(focus_services=['Lead generation'])))
    assert 'SunCo' in captured['input']
    assert 'Nigeria' in captured['input']
    assert '"selected_services": ["Lead generation"]' in captured['input']
    assert '—' not in result
