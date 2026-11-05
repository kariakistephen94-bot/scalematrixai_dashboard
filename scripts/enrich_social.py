"""Refresh exact social links on the official websites of saved business leads."""
import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.ai import AIService
from app.services.agent import LeadAgent
from app.services.social_leads import SocialDiscovery,canonical_website,website_host,now
async def main():
 settings=get_settings();store=Store(settings);ai=AIService(settings)
 service=SocialDiscovery(store,ai,LeadAgent(store,ai,None,None),None)
 rows=await service.records('social_lead');changes=[]
 for row in rows:
  website=canonical_website(row.get('website'))
  if website!=row.get('website') or website_host(website)!=row.get('website_key'):
   row.update(website=website,website_key=website_host(website));changes.append({'id':f"social_lead:{row['id']}",'value':row})
 if changes:await store.insert('sm_settings',changes,conflict='id')
 print(json.dumps({'businesses':len(rows),'websites_normalized':len(changes)}),flush=True)
 gate=asyncio.Semaphore(6)
 async def enrich(row):
  if not row.get('website') or len(row['profiles'])==4:return
  async with gate:
   added=await service.enrich_profiles(row)
   row['website_checked_at']=now()
   if not added:await service.store.insert('sm_settings',{'id':f"social_lead:{row['id']}",'value':row},conflict='id')
   if added:print(json.dumps({'company':row['company'],'profiles_added':added}),flush=True)
 await asyncio.gather(*(enrich(row) for row in rows))
 rows=await service.records('social_lead')
 print(json.dumps({'matrix':{n:{p:sum(r['niche']==n and p in r['profiles'] for r in rows) for p in ['linkedin','instagram','twitter','tiktok']} for n in ['Commercial cleaning','Solar businesses','Facility management']}}),flush=True)
 await ai.client.close()
asyncio.run(main())
