import unittest
from types import SimpleNamespace
from app.services.agent import LeadAgent, AgentRequest, OwnerFinding

class Store:
    def __init__(self): self.saved=[]; self.patched=[]
    async def list(self, table, **kwargs):
        key=kwargs.get('filters', {}).get('id','')
        if key=='eq.crm:lead': return [{'value': {'company':'Example Ltd','source_type':'manual','contact_name':'Keep me'}}]
        return []
    async def insert(self, table, rows, **kwargs): self.saved.append(rows); return [rows]
    async def patch(self, table, key, changes): self.patched.append(changes)
    async def claim_run(self, *args): return {'id':'run'}

class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_source_cannot_back_owner(self):
        store=Store()
        async def research(prompt): return 'untrusted text', [{'url':'https://example.com/about','title':'About'}]
        async def parse(**kwargs): return SimpleNamespace(output_parsed=OwnerFinding(owner_name='Invented',status='needs_review',evidence='claim',source_urls=['https://fake.com']))
        ai=SimpleNamespace(research=research, settings=SimpleNamespace(openai_model='test'), client=SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        result=await LeadAgent(store,ai,None,None).owner('lead', 'Example Ltd', {}, {'contact_id':'lead','message_body':'We help Example Ltd find customers.','recipient_timezone':'Africa/Lagos'})
        self.assertEqual(result['status'],'not_found')
        self.assertEqual(result['owner_name'],'')
        self.assertEqual(store.saved[0]['id'],'agent_lead:lead')
        self.assertFalse(store.patched)

    async def test_no_unresearched_leads_does_not_queue(self):
        result=await LeadAgent(Store(),None,None,None).start(AgentRequest())
        self.assertIsNone(result['run'])

    async def test_auto_disabled_does_not_import(self):
        store=Store()
        agent=LeadAgent(store,None,None,None)
        async def preferences(): return SimpleNamespace(auto_run=False)
        agent.preferences=preferences
        await agent.after_search(None,None)
        self.assertEqual(store.saved,[])

    async def test_failures_persist_and_finish_run(self):
        store=Store(); agent=LeadAgent(store,None,None,None)
        async def fail(contact_id): raise RuntimeError('secret error')
        agent.research=fail
        await agent.execute({'id':'run'},['lead'])
        self.assertEqual(store.patched[-1]['status'],'failed')
        failure=next(x['value'] for x in store.saved if x['id']=='agent_lead:lead')
        self.assertNotIn('secret',failure['evidence'])

    async def test_auto_imports_only_new_search_leads_and_queues(self):
        store=Store()
        async def listing(table, **kwargs):
            if table=='sm_maps_leads':
                self.assertEqual(kwargs['filters'],{'run_id':'eq.12345678-1234-1234-1234-123456789abc'})
                return [{'id':'12345678-1234-1234-1234-123456789abc','niche':'Commercial cleaning','search_city':'London'}]
            return []
        store.list=listing
        agent=LeadAgent(store,SimpleNamespace(settings=SimpleNamespace(openai_api_key='configured')),None,None)
        queued=[]
        async def start(body): queued.append(body)
        agent.start=start
        await agent.after_search(SimpleNamespace(prospect_source='google_maps'),{'id':'12345678-1234-1234-1234-123456789abc'})
        self.assertEqual(len(queued),1)
        self.assertEqual(queued[0].contact_ids,['12345678-1234-1234-1234-123456789abc'])
        self.assertEqual(store.saved[0]['value']['source_type'],'google_maps')
