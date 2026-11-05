import asyncio
from types import SimpleNamespace
from app.services.social_leads import profile_url, niche_supported, company_key, website_host, SocialDiscovery, SocialCandidate
from app.services.agent import AgentPreferences


def test_profile_links_exclude_search_posts_and_personal_linkedin_accounts():
    assert profile_url('https://uk.linkedin.com/company/Acme-Ltd/posts/?x=1')==('linkedin','https://www.linkedin.com/company/acme-ltd/')
    assert profile_url('https://twitter.com/Acme/status/123')==('twitter','https://x.com/acme')
    assert profile_url('https://www.tiktok.com/@acme/video/123')[1]=='https://www.tiktok.com/@acme'
    assert profile_url('https://www.instagram.com/acme/reels/')[1]=='https://www.instagram.com/acme/'
    for url in ('https://linkedin.com/in/person','https://instagram.com/p/123','https://x.com/search?q=acme','https://tiktok.com/tag/solar','javascript:alert(1)','https://instagram.com.evil.test/acme','https://user:pass@instagram.com/acme'):
        assert profile_url(url) is None


def test_explicit_niche_evidence_required():
    assert niche_supported('Solar businesses','The business installs solar panels in Lagos.')
    assert not niche_supported('Solar businesses','London facilities management and workplace services.')
    assert niche_supported('Commercial cleaning','Provides commercial cleaning and janitorial services.')
    assert not niche_supported('Commercial cleaning','Residential home cleaning only.')
    assert niche_supported('Facility management','Integrated facilities management and building maintenance.')


def test_company_identity_handles_suffixes_and_uk_domains():
    assert company_key('Acme Ltd','Nigeria')==company_key('ACME LIMITED','Nigeria')
    assert website_host('https://www.acme.co.uk/contact')=='acme.co.uk'
    assert website_host('javascript:evil()')==''


class Store:
    def __init__(self):self.saved=[]
    async def insert(self,table,row,**kwargs):self.saved.append(row);return [row]


def candidate(**changes):
    fields=dict(company='Acme Solar Ltd',country='Nigeria',location='Lagos',website='https://acmesolar.ng',profile_url='https://www.linkedin.com/company/acme-solar/',evidence_url='https://www.linkedin.com/company/acme-solar/',evidence='Acme Solar installs solar panels for businesses in Lagos.',message_body='We help Acme Solar reach more buyers. Would you like to know how?')
    return SocialCandidate(**dict(fields,**changes))


def test_uncited_handles_and_wrong_niches_cannot_be_saved():
    async def run():
        store=Store();service=SocialDiscovery(store,None,None,None);prefs=AgentPreferences()
        assert not await service.accept(candidate(),'Solar businesses','linkedin',prefs,[],[])
        sources=[{'url':candidate().evidence_url}]
        assert not await service.accept(candidate(evidence='Facilities management and workplace services in Lagos.'),'Solar businesses','linkedin',prefs,sources,[])
        assert not store.saved
    asyncio.run(run())


def test_same_business_gets_profiles_without_duplicate_leads():
    async def run():
        store=Store();service=SocialDiscovery(store,None,None,None);prefs=AgentPreferences();rows=[]
        a=candidate();assert await service.accept(a,'Solar businesses','linkedin',prefs,[{'url':a.evidence_url}],rows)
        b=candidate(profile_url='https://instagram.com/acme_solar/',evidence_url='https://instagram.com/acme_solar/')
        assert await service.accept(b,'Solar businesses','instagram',prefs,[{'url':b.evidence_url}],rows)
        assert len(rows)==1 and len(rows[0]['profiles'])==2
        assert not await service.accept(b,'Solar businesses','instagram',prefs,[{'url':b.evidence_url}],rows)
        assert len(rows)==1
    asyncio.run(run())


def test_chinese_businesses_and_profiles_are_not_collapsed():
    assert company_key('北京阳光能源','China')!=company_key('上海绿色能源','China')
    assert profile_url('https://www.linkedin.com/company/北京阳光能源/') is not None


def test_nullable_web_search_sources_do_not_fail_a_batch():
    from app.services.ai import citations_from_response
    response=SimpleNamespace(model_dump=lambda:{'output':[{'type':'web_search_call','action':{'sources':None}},{'content':None}]})
    assert citations_from_response(response)==[]


def test_conflicting_insert_never_inflates_counts():
    async def run():
        store=Store()
        async def ignored(*args,**kwargs):return []
        store.insert=ignored
        service=SocialDiscovery(store,None,None,None);rows=[];a=candidate()
        assert not await service.accept(a,'Solar businesses','linkedin',AgentPreferences(),[{'url':a.evidence_url}],rows)
        assert not rows
    asyncio.run(run())


def test_first_party_handles_can_join_brand_words_without_being_rejected():
    from app.services.social_leads import profile_brand_matches
    assert profile_brand_matches('Brooklyn SolarWorks','https://brooklynsolarworks.com','https://tiktok.com/@brooklynsolarworks')
    assert profile_brand_matches('Midel Management Limited','https://midelgroup.com','https://instagram.com/midelgroup')
    assert not profile_brand_matches('Midel Management Limited','https://midelgroup.com','https://instagram.com/webdesigneragency')
    assert not profile_brand_matches('Beacon Electrical Renewables Ltd','https://beaconrenewables.co.uk','https://instagram.com/other_electrical_company')
    assert profile_brand_matches('Beacon Electrical Renewables Ltd','https://beaconrenewables.co.uk','https://instagram.com/beaconrenewables')


def test_company_websites_normalize_bare_domains_and_exclude_private_urls():
    from app.services.social_leads import canonical_website
    assert canonical_website('www.acmesolar.ng')=='https://www.acmesolar.ng'
    assert website_host('www.acme.co.uk')=='acme.co.uk'
    assert canonical_website('http://127.0.0.1/private') is None
    assert canonical_website('https://facebook.com/acme') is None
    assert candidate(website='www.acmesolar.ng').website=='https://www.acmesolar.ng'


def test_records_for_review_are_excluded_from_lead_counts():
    async def run():
        store=Store()
        async def listing(*args,**kwargs):
            return [{'id':'social_lead:good','value':{'status':'source_backed'}},{'id':'social_lead:review','value':{'status':'needs_review'}}]
        store.list=listing
        rows=await SocialDiscovery(store,None,None,None).records('social_lead')
        assert [r['id'] for r in rows]==['good']
    asyncio.run(run())


def test_official_tiktok_api_can_confirm_a_sourced_handle(monkeypatch):
    import app.services.social_leads as module
    async def verified(url):return {'url':url,'name':'Acme Solar','verification_url':'https://www.tiktok.com/oembed?url=profile'}
    monkeypatch.setattr(module,'tiktok_profile',verified)
    async def run():
        service=SocialDiscovery(Store(),None,None,None)
        lead=candidate(profile_url='https://tiktok.com/@acmesolar',evidence_url='https://directory.example/acme',website=None)
        proof=await service.verify_candidate(lead,'Solar businesses','tiktok',AgentPreferences(),[{'url':lead.evidence_url}])
        assert proof['method']=='platform_public_api'
        assert proof['canonical'][1]=='https://www.tiktok.com/@acmesolar'
    asyncio.run(run())


def test_different_tiktok_account_name_does_not_verify_company(monkeypatch):
    import app.services.social_leads as module
    async def other(url):return {'url':url,'name':'Unrelated creator','verification_url':'https://www.tiktok.com/oembed?url=profile'}
    monkeypatch.setattr(module,'tiktok_profile',other)
    async def run():
        service=SocialDiscovery(Store(),None,None,None)
        lead=candidate(profile_url='https://tiktok.com/@acmesolar',evidence_url='https://directory.example/acme',website=None)
        assert await service.verify_candidate(lead,'Solar businesses','tiktok',AgentPreferences(),[{'url':lead.evidence_url}]) is None
    asyncio.run(run())


def test_countrywide_mode_still_does_not_expand_nigeria():
    async def run():
        service=SocialDiscovery(Store(),None,None,None)
        lead=candidate(location='Ibadan, Nigeria')
        assert await service.verify_candidate(lead,'Solar businesses','linkedin',AgentPreferences(),[{'url':lead.evidence_url}],countrywide=True) is None
    asyncio.run(run())


def test_discovery_recovers_an_exact_profile_link_missing_from_search_index():
    async def run():
        lead=candidate(profile_url='https://instagram.com/acme_solar/',evidence_url='https://acmesolar.ng')
        async def research(prompt):
            return 'Acme Solar installs solar panels in Lagos. See its official site.', [{'url':'https://acmesolar.ng','title':'Acme Solar'}]
        async def parse(**kwargs):
            assert 'https://instagram.com/acme_solar/' in kwargs['input']
            return SimpleNamespace(output_parsed=SimpleNamespace(leads=[lead]))
        ai=SimpleNamespace(research=research,settings=SimpleNamespace(openai_model='test'),client=SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        service=SocialDiscovery(Store(),ai,None,None)
        async def page(url):
            return {'url':'https://acmesolar.ng','title':'Acme Solar','text':'Acme Solar installs solar panels in Lagos, Nigeria.','links':['https://instagram.com/acme_solar/']}
        service.page=page
        prefs=AgentPreferences()
        leads,sources=await service.discover('Solar businesses','instagram','Nigeria','Lagos',prefs,[],0)
        proof=await service.verify_candidate(leads[0],'Solar businesses','instagram',prefs,sources)
        assert proof['method']=='company_website_link'
    asyncio.run(run())
