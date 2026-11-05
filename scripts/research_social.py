"""Resume source-backed business social research using the existing server keys."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.ai import AIService
from app.services.google_maps import GoogleMapsService
from app.services.agent import LeadAgent
from app.services.social_leads import SocialDiscovery, SocialSearch

async def main(target, mode, batches, geography, solar_only):
    settings=get_settings(); store=Store(settings); ai=AIService(settings)
    tasks=[]
    def launch(coro):
        task=asyncio.create_task(coro); tasks.append(task); return task
    agent=LeadAgent(store,ai,GoogleMapsService(settings),launch)
    social=SocialDiscovery(store,ai,agent,launch)
    try:
        result=await social.start(SocialSearch(**({'niches':['Solar businesses']} if solar_only else {}),target_per_niche=target,target_mode=mode,max_batches_per_niche=batches,geography=geography))
        print(json.dumps({'run_id':result['run']['id'],'already_running':result['already_running']}),flush=True)
        if tasks: await asyncio.gather(*tasks)
        rows=await social.records('social_lead')
        print(json.dumps({'counts':{n:sum(r['niche']==n for r in rows) for n in ['Commercial cleaning','Solar businesses','Facility management']}}),flush=True)
    finally: await ai.client.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--target',type=int,default=100);parser.add_argument('--mode',choices=['across_platforms','per_platform'],default='per_platform');parser.add_argument('--batches',type=int,default=120);parser.add_argument('--geography',choices=['presets','countrywide'],default='presets');parser.add_argument('--solar-only',action='store_true');args=parser.parse_args()
    asyncio.run(main(args.target,args.mode,args.batches,args.geography,args.solar_only))
