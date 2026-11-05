"""Import reviewed public-source research. Never infer a name, role, or email.
A single email and a single person count once, even across multiple sources.
Run with --dry-run to validate without changing the database.
"""
import argparse,asyncio,json,sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from pydantic import ValidationError
from app.config import get_settings
from app.storage import Store
from app.services.founder_emails import FounderEmail,contacts,person_key
from app.services.social_leads import now,website_host

async def main(args):
    candidates=[];rejected=[]
    for filename in args.files:
        for value in json.loads(Path(filename).read_text()):
            if str(value.get('review_status','')).startswith('exclude'):
                rejected.append({'company':value.get('company'),'founder_name':value.get('founder_name'),'issues':[value['review_status']]});continue
            try:candidates.append(FounderEmail.model_validate(value))
            except ValidationError as exc:rejected.append({'company':value.get('company'),'founder_name':value.get('founder_name'),'issues':[e['msg'] for e in exc.errors()]})
    # Prefer first-party, current contact pages over older third-party sources.
    def rank(item):
        own=website_host(item.email_source_url)==website_host(item.website)
        dated=item.email_source_year or next((int(y) for y in __import__('re').findall(r'(?<!\d)(20\d{2})(?!\d)',urlparse(item.email_source_url).path) if 2000<=int(y)<=2026),None)
        return (bool(dated and dated<2018),not own,dated is not None,item.company.casefold(),item.founder_name.casefold())
    candidates.sort(key=rank)
    chosen=[];emails=set();people=set()
    for item in candidates:
        key=person_key(item.founder_name)
        if item.email in emails or key in people:continue
        emails.add(item.email);people.add(key);chosen.append(item)
        if len(chosen)==args.target:break
    print(json.dumps({'validated_candidates':len(candidates),'selected':len(chosen),'target':args.target,'companies':len({website_host(r.website) for r in chosen}),'rejected':rejected}),flush=True)
    if args.output:Path(args.output).write_text(json.dumps([r.model_dump() for r in chosen],indent=2))
    if args.dry_run:return
    store=Store(get_settings())
    # Never remove a contact; pre-existing contacts outside a revised selection remain reviewable.
    writes=[{'id':'founder_email:'+item.contact_id,'value':dict(item.model_dump(),id=item.contact_id,status='source_backed',checked_at=now())} for item in chosen]
    for i in range(0,len(writes),30):await store.insert('sm_settings',writes[i:i+30],conflict='id')
    result=await contacts(store)
    count=len(result)
    progress={'target':args.target,'status':'completed' if count>=args.target else 'running','saved':count,'companies':len({website_host(r['website']) for r in result}),'updated_at':now(),'method':'Public professional emails and explicit founder/co-founder role sources; no inferred addresses.'}
    await store.insert('sm_settings',{'id':'founder_email_research:default','value':progress},conflict='id')
    print(json.dumps({'stored':count,'research':progress}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('files',nargs='+');p.add_argument('--target',type=int,default=100);p.add_argument('--dry-run',action='store_true');p.add_argument('--output');asyncio.run(main(p.parse_args()))
