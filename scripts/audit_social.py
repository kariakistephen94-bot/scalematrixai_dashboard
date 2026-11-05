"""Audit saved classifications and enrich profiles from first-party websites."""
import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.ai import AIService
from app.services.agent import LeadAgent
from app.services.social_leads import SocialDiscovery,niche_supported,profile_url,now,NICHES
from app.targeting import MARKETS,selected_areas,region_matches

async def main():
 settings=get_settings();store=Store(settings);ai=AIService(settings)
 social=SocialDiscovery(store,ai,LeadAgent(store,ai,None,None),None)
 rows=await social.records('social_lead',include_review=True)
 revised=0;quarantined=0
 for row in rows:
  evidence=' '.join(e['summary'] for e in row.get('evidence',[]) if e['method']=='indexed_public_profile')
  supported=[n for n in NICHES if niche_supported(n,evidence)]
  areas=[f"{country}|{area['area']}" for country in MARKETS for area in selected_areas(country)]
  if not supported or not region_matches(row,areas=areas) or not all(profile_url(url) for url in row['profiles'].values()):
   row['status']='needs_review';quarantined+=1
  elif row['niche'] not in supported:
   row['classification_review']={'previous_niche':row['niche'],'method':'explicit_service_evidence','checked_at':now()}
   row['niche']=supported[0];row['status']='source_backed';revised+=1
  await store.insert('sm_settings',{'id':f"social_lead:{row['id']}",'value':row},conflict='id')
 print(json.dumps({'reclassified':revised,'excluded_pending_review':quarantined}),flush=True)
 gate=asyncio.Semaphore(6)
 async def enrich(row):
  if row['status']!='source_backed':return
  async with gate:
   added=await social.enrich_profiles(row)
   if added:print(json.dumps({'company':row['company'],'profiles_added':added}),flush=True)
 await asyncio.gather(*(enrich(row) for row in rows))
 rows=await social.records('social_lead')
 print(json.dumps({'matrix':{n:{p:sum(r['niche']==n and p in r['profiles'] for r in rows) for p in ['linkedin','instagram','twitter','tiktok']} for n in NICHES}}),flush=True)
 await ai.client.close()
asyncio.run(main())
