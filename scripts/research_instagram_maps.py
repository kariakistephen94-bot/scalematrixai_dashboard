"""Discover candidate sites through Places, verify independently on company sites.
Provider discovery payloads remain in memory. Only corroborated first-party
company information and source-backed Instagram links are saved to Supabase.
"""
import asyncio,argparse,json,sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.google_maps import GoogleMapsService,MapsError
from app.services.social_leads import SocialDiscovery,website_host,canonical_website
from research_instagram_public import main as verify

UK=['Leicester','Derby','Nottingham','Milton Keynes','Bedford','Peterborough','Cambridge','Norwich','Ipswich','Chelmsford','Colchester','Canterbury','Plymouth','Exeter','Taunton','Bath','Swindon','Reading','Oxford','Southampton','Portsmouth','Gloucester','Hereford','Worcester','Shrewsbury','Stoke-on-Trent','Wolverhampton','Coventry','Warwick','Northampton','Kettering','Sheffield','Doncaster','Hull','York','Harrogate','Sunderland','Durham','Carlisle','Lancaster','Preston','Blackpool','Bolton','Stockport','Huddersfield','Halifax','Chester','Warrington','Belfast','Glasgow','Edinburgh','Dundee','Aberdeen','Inverness','Stirling','Perth','Swansea','Cardiff','Newport','Wrexham']
US=['San Antonio Texas','Dallas Texas','Houston Texas','Corpus Christi Texas','Lubbock Texas','El Paso Texas','Oklahoma City Oklahoma','Tulsa Oklahoma','Wichita Kansas','Kansas City Missouri','Omaha Nebraska','Des Moines Iowa','Sioux Falls South Dakota','Fargo North Dakota','Madison Wisconsin','Milwaukee Wisconsin','Grand Rapids Michigan','Detroit Michigan','Cleveland Ohio','Columbus Ohio','Cincinnati Ohio','Louisville Kentucky','Lexington Kentucky','Nashville Tennessee','Chattanooga Tennessee','Huntsville Alabama','Birmingham Alabama','Atlanta Georgia','Savannah Georgia','Charleston South Carolina','Columbia South Carolina','Charlotte North Carolina','Raleigh North Carolina','Richmond Virginia','Roanoke Virginia','Baltimore Maryland','Pittsburgh Pennsylvania','Harrisburg Pennsylvania','Buffalo New York','Rochester New York','Albany New York','Hartford Connecticut','Portland Maine','Manchester New Hampshire','Burlington Vermont','Boston Massachusetts','Providence Rhode Island','Orlando Florida','Tampa Florida','Gainesville Florida','Jacksonville Florida','Sarasota Florida','Fort Myers Florida','Miami Florida','Redding California','Chico California','Modesto California','Stockton California','Bakersfield California','Fresno California','Sacramento California','San Jose California','Ventura California','San Luis Obispo California','Las Vegas Nevada','Reno Nevada','Phoenix Arizona','Tucson Arizona','Albuquerque New Mexico','Denver Colorado','Colorado Springs Colorado','Salt Lake City Utah','Boise Idaho','Spokane Washington','Tacoma Washington','Eugene Oregon','Salem Oregon']
async def main(target,offset):
    settings=get_settings();maps=GoogleMapsService(settings);service=SocialDiscovery(Store(settings),None,None,None)
    rows=await service.records('social_lead',include_review=True)
    seen={r.get('website_key') for r in rows if r.get('status')=='needs_review' or 'instagram' in r.get('profiles',{})}
    plan=[]
    for i in range(max(len(UK),len(US))):
        if i<len(UK):plan.append(('United Kingdom',UK[i],'GB'))
        if i<len(US):plan.append(('United States',US[i],'US'))
    plan=plan[offset:];requests=0
    while plan:
        candidates={};queries=0
        for country,city,region in plan[:settings.google_maps_max_requests]:
            try:
                payload=await maps._request('POST','places:searchText',field_mask='places.displayName,places.websiteUri',body={'textQuery':f'solar panel installation companies in {city}, {country}','pageSize':20,'languageCode':'en','regionCode':region},retries=0)
            except MapsError as exc:
                print(json.dumps({'discovery_error':str(exc),'requests':requests}),flush=True);return
            requests+=1;queries+=1
            for place in (payload or {}).get('places',[]):
                site=canonical_website(place.get('websiteUri'));name=(place.get('displayName') or {}).get('text');host=website_host(site)
                if not site or not name or not host or host in seen:continue
                seen.add(host);candidates.setdefault(country,[]).append([name,site])
            # Never persist the provider response or its business details.
            payload=None
        plan=plan[queries:]
        print(json.dumps({'discovery_requests':requests,'unverified_websites':sum(map(len,candidates.values())),'next_offset':offset+requests}),flush=True)
        if candidates:
            await verify(SimpleNamespace(seed_data=candidates,from_maps=True,seeds=None,target=target,new_only=True,countries=['United States','United Kingdom']))
        rows=await service.records('social_lead');count=sum(r['niche']=='Solar businesses' and 'instagram' in r['profiles'] for r in rows)
        if count>=target:
            print(json.dumps({'complete':True,'instagram_total':count,'discovery_requests':requests}),flush=True);return
    print(json.dumps({'complete':False,'reason':'Candidate search plan exhausted; saved matches preserved.','discovery_requests':requests}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--target',type=int,default=548);p.add_argument('--offset',type=int,default=0);a=p.parse_args();asyncio.run(main(a.target,a.offset))
