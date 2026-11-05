"""Research solar founders while the solar company discovery run is active."""
import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.ai import AIService
from app.services.social_leads import SocialDiscovery
from app.services.social_founders import research_founders

async def main():
    settings=get_settings();ai=AIService(settings)
    service=SocialDiscovery(Store(settings),ai,None,None)
    failures={}; gate=asyncio.Semaphore(3)
    async def one(row):
        async with gate:
            try:
                async with asyncio.timeout(300):result=await research_founders(service,row)
                print(json.dumps({'company':row['company'],'founders':len(result['founders']),'status':result['status']}),flush=True)
            except Exception as exc:
                failures[row['id']]=failures.get(row['id'],0)+1
                print(json.dumps({'company':row['company'],'error':type(exc).__name__}),flush=True)
    try:
        while True:
            rows,checked,runs=await asyncio.gather(service.records('social_lead'),service.records('social_founders'),service.records('social_run'))
            checked_ids={r['company_id'] for r in checked}
            pending=[r for r in rows if r['niche']=='Solar businesses' and r['id'] not in checked_ids and failures.get(r['id'],0)<2]
            if pending:
                print(json.dumps({'pending_solar_companies':len(pending)}),flush=True)
                await asyncio.gather(*(one(r) for r in pending))
                continue
            if not any(r['status'] in ('queued','running','stopping') for r in runs):break
            await asyncio.sleep(15)
    finally:await ai.client.close()
asyncio.run(main())
