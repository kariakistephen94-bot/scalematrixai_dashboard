"""Use the public Solar PV member finder, then corroborate on company websites.
Only public business name/website candidates are retained; contact fields and
provider record identifiers are discarded. Membership alone is not verification.
"""
import argparse,asyncio,json,sys
from pathlib import Path
from types import SimpleNamespace
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.social_leads import SocialDiscovery,website_host
from research_instagram_public import main as verify

async def main(target,start_page,max_pages):
    service=SocialDiscovery(Store(get_settings()),None,None,None);seen=set();page=start_page
    async with httpx.AsyncClient(timeout=40,follow_redirects=False) as client:
        tech_response=await client.get('https://www.recc.org.uk/wp-json/recc-finder/v1/technologies');tech_response.raise_for_status()
        solar_id=next(t['id'] for t in tech_response.json()['technologies'] if t['name']=='Solar PV')
        total_pages=None
        while page<start_page+max_pages and (total_pages is None or page<=total_pages):
            rows=await service.records('social_lead',include_review=True)
            seen.update(r.get('website_key') for r in rows if r.get('status')=='needs_review' or 'instagram' in r.get('profiles',{}))
            candidates=[];first_page=page
            for _ in range(3):
                if page>=start_page+max_pages or (total_pages is not None and page>total_pages):break
                response=await client.post('https://www.recc.org.uk/wp-json/recc-finder/v1/search',json={'postcode':'','name':'','town':'','technologies':[solar_id],'page':page},headers={'Accept':'application/json'})
                if response.status_code!=200:
                    print(json.dumps({'source_unavailable':response.status_code,'next_page':page}),flush=True);return
                data=response.json();per_page=int(data['itemsPerPage']);total_pages=(int(data['total'])+per_page-1)//per_page
                for item in data.get('companies',[]):
                    name=item.get('name');website=item.get('website');host=website_host(website)
                    if name and website and host and host not in seen:
                        seen.add(host);candidates.append([name,website])
                # Discard the public finder contact fields and membership identifiers.
                data=None;page+=1
                await asyncio.sleep(0.5)
            print(json.dumps({'public_solar_pv_pages':[first_page,page-1],'candidate_websites':len(candidates),'next_page':page}),flush=True)
            if candidates:
                await verify(SimpleNamespace(seed_data={'United Kingdom':candidates},seeds=None,target=target,new_only=True,countries=['United Kingdom']))
            rows=await service.records('social_lead');count=sum(r['niche']=='Solar businesses' and 'instagram' in r['profiles'] for r in rows)
            if count>=target:
                print(json.dumps({'complete':True,'instagram_total':count,'next_page':page}),flush=True);return
        print(json.dumps({'complete':False,'instagram_total':count,'next_page':page}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--target',type=int,default=548);p.add_argument('--start-page',type=int,default=1);p.add_argument('--max-pages',type=int,default=18);a=p.parse_args();asyncio.run(main(a.target,a.start_page,a.max_pages))
