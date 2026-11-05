"""Verify exact Instagram links on public solar-company websites without an AI API.
Candidates are unverified inputs. Identity, solar services and country must be
supported by fetched first-party pages before any contact is saved.
"""
import argparse,asyncio,json,re,sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import get_settings
from app.storage import Store
from app.services.social_leads import SocialDiscovery,SocialCandidate,profile_url,profile_brand_matches,plausible_identity,niche_supported,website_host
from app.services.agent import AgentPreferences
from app.services.solar_validation import solar_offering, non_solar_business_reason

US=re.compile(r'\b(United States|U\.S\.A?\.?|USA|California|Texas|Florida|Massachusetts|New Jersey|New York|Colorado|Arizona|Utah|Washington|Oregon|Minnesota|Wisconsin|Illinois|Missouri|Virginia|Maryland|Pennsylvania|North Carolina|South Carolina|Kentucky|Ohio|Michigan|Tennessee|Georgia|New Mexico|Vermont|New Hampshire|Rhode Island|Connecticut|Idaho|Nevada|Arkansas|Alabama|Louisiana|Montana|Wyoming|Maine|Oklahoma|Nebraska|Kansas)\b',re.I)
UK=re.compile(r'\b(United Kingdom|UK|U\.K\.|England|Scotland|Wales|Northern Ireland|Bristol|London|Manchester|Birmingham|Yorkshire|Hampshire|Kent|Essex|Surrey|Somerset|Devon|Cornwall|Oxfordshire|Suffolk|Norfolk|Berkshire|Cambridge|Aberdeen)\b',re.I)

def country_supported(country,text):
    if country=='United States':return bool(US.search(text) or re.search(r'\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(?:-\d{4})?\b',text))
    if country=='United Kingdom':return bool(UK.search(text) or re.search(r'\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b',text))
    if country=='Nigeria':return bool(re.search(r'\b(Abuja|Lagos|Port Harcourt)\b',text,re.I))
    return bool(re.search(r'\b(China|Beijing|Shanghai|Shenzhen|Guangzhou|Xiamen|Jiangsu|Ningbo|Hefei)\b|中国|北京|上海',text,re.I))

async def main(args):
    service=SocialDiscovery(Store(get_settings()),None,None,None);prefs=AgentPreferences();gate=asyncio.Semaphore(8);write=asyncio.Lock();done=asyncio.Event()
    rows=await service.records('social_lead');before=sum(r['niche']=='Solar businesses' and 'instagram' in r['profiles'] for r in rows)
    current=before;checked=0;added=[];candidates=[]
    allowed_countries=set(args.countries or ['United States','United Kingdom'])
    all_rows=await service.records('social_lead',include_review=True)
    known_domains={r.get('website_key') for r in all_rows if r.get('status')=='needs_review' or 'instagram' in r.get('profiles',{})}
    for row in ([] if args.new_only else rows):
        if row['niche']=='Solar businesses' and row['country'] in allowed_countries and 'instagram' not in row['profiles'] and row.get('website'):
            candidates.append((row['company'],row['country'],row['website'],row['location']))
    seed=args.seed_data if getattr(args, 'seed_data', None) is not None else json.loads(Path(args.seeds).read_text())
    candidates += [(company,country,url,country) for country,items in seed.items() if country in allowed_countries for company,url in items]
    seen=set();unique=[]
    for item in candidates:
        key=website_host(item[2])
        if key and key not in seen and key not in known_domains:seen.add(key);unique.append(item)
    print(json.dumps({'baseline':before,'target':args.target,'candidate_websites':len(unique)}),flush=True)
    async def one(item):
        nonlocal current,checked
        company,country,website,location=item
        if website.lower().startswith('http://'):website='https://'+website[7:]
        async with gate:
            if done.is_set():return
            try:
                home=await service.page(website)
                if not home:return
                # A foreign regional website is insufficient evidence of a US/UK base.
                if country in ('United States','United Kingdom') and (urlparse(home['url']).hostname or '').endswith(('.com.au','.co.nz','.co.za','.ca','.ie','.in')):return
                pages=[home]
                links=[u for u in home['links'] if website_host(u)==website_host(home['url']) and re.search(r'/(contact|about|company|our-team|who-we-are)(?:[/.?#-]|$)',urlparse(u).path,re.I)]
                def instagram(page):
                    return sorted(set(p[1] for u in page['links'] if (p:=profile_url(u)) and p[0]=='instagram' and 'podcast' not in p[1] and profile_brand_matches(company,website,p[1])), key=len)
                if not instagram(home) or not country_supported(country,home['text']):
                    pages += [p for p in await asyncio.gather(*(service.page(u) for u in list(dict.fromkeys(links))[:2])) if p]
                text=' '.join(p['text'] for p in pages)
                if non_solar_business_reason(home['url'],text):return
                offering=next(((p,solar_offering(p['text'])) for p in pages if solar_offering(p['text'])),None)
                if not offering:
                    solar_pages=list(dict.fromkeys(u for u in home['links'] if website_host(u)==website_host(home['url']) and re.search(r'solar|photovoltaic',urlparse(u).path,re.I) and not re.search(r'/blog|/news|/tag|/categor|/case-stud|/portfolio|\.pdf$',urlparse(u).path,re.I)))[:2]
                    pages += [p for p in await asyncio.gather(*(service.page(u) for u in solar_pages)) if p]
                    text=' '.join(p['text'] for p in pages)
                    offering=next(((p,solar_offering(p['text'])) for p in pages if solar_offering(p['text'])),None)
                if not offering:return
                # Independently corroborate candidate names on the first-party site.
                if getattr(args, 'from_maps', False):
                    core=re.sub(r'\b(limited|ltd|llc|inc|plc)\b','',company,flags=re.I)
                    normalized=lambda v: re.sub(r'[^\w]+','',v.casefold())
                    if normalized(core) not in normalized(home['title']+' '+text):return
                if not plausible_identity(company,home['title']+' '+text[:15000]) or not niche_supported('Solar businesses',text) or not country_supported(country,text):return
                if re.search(r'ceased trading|permanently closed|ceased operations?|no longer in business|no longer actively contracting|no longer in operation',text,re.I):return
                if country == 'Nigeria':
                    location = re.search(r'\b(Abuja|Lagos|Port Harcourt)\b', text, re.I).group(0) + ', Nigeria'
                match=next(((p,u) for p in pages for u in instagram(p)),None)
                if not match:return
                page,url=match
                evidence=f"The official {company} website advertises a solar offering in {country} and links directly to this Instagram account."
                body=f"I'm reaching out to the team at {company}. We help solar companies in {country} reach potential customers looking for solar installations. We also help qualify interested buyers and book site inspections directly into your calendar. Would you like to know how we could support {company}'s lead generation and outreach?"
                candidate=SocialCandidate(company=company,country=country,location=location,website=home['url'],profile_url=url,evidence_url=page['url'],evidence=evidence,message_body=body)
                sources=[{'url':page['url'],'title':page['title']}]
                proof=await service.verify_candidate(candidate,'Solar businesses','instagram',prefs,sources,countrywide=True)
                if not proof:return
                async with write:
                    if done.is_set():return
                    records=await service.records('social_lead')
                    current=sum(r['niche']=='Solar businesses' and 'instagram' in r['profiles'] for r in records)
                    if current>=args.target:done.set();return
                    if await service.accept(candidate,'Solar businesses','instagram',prefs,sources,records,proof=proof,checked=True):
                        current=sum(r['niche']=='Solar businesses' and 'instagram' in r['profiles'] for r in records)
                        row=next(r for r in records if r.get('profiles',{}).get('instagram')==url)
                        row['solar_offering']={'source_url':offering[0]['url'],'excerpt':offering[1]}
                        await service.store.insert('sm_settings',{'id':f"social_lead:{row['id']}",'value':row},conflict='id')
                        result={'company':company,'instagram':url,'country':country,'instagram_total':current}
                        added.append(result);print(json.dumps(result),flush=True)
                        if current>=args.target:done.set()
            except Exception as exc:print(json.dumps({'company':company,'error':type(exc).__name__}),flush=True)
            finally:
                checked+=1
                if checked%20==0:print(json.dumps({'websites_checked':checked,'instagram_total':current}),flush=True)
    await asyncio.gather(*(one(item) for item in unique))
    print(json.dumps({'finished':True,'baseline':before,'instagram_total':current,'added':len(added),'target_reached':current>=args.target}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--seeds',required=True);p.add_argument('--target',type=int,default=148);p.add_argument('--new-only',action='store_true');p.add_argument('--countries',nargs='+',choices=['United States','United Kingdom','Nigeria','China']);asyncio.run(main(p.parse_args()))
