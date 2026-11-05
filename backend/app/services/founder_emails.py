"""Public professional founder contacts, separate from inferred owner research."""
import re
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid5, NAMESPACE_URL
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from .social_leads import now, website_host
from .social_storage import SocialStore

GENERIC = {'info','hello','contact','sales','support','office','admin','team','inquiries','enquiries','press','marketing','service','customerservice','jobs','careers','webmaster','general'}
FOUNDER = re.compile(r'\b(?:co[-\s]?founders?|founders?|co[-\s]?founded|founded)\b', re.I)

def person_key(name):
    return re.sub(r'[^\w]+', '', name.casefold())

class FounderEmail(BaseModel):
    company: str = Field(min_length=2, max_length=180)
    founder_name: str = Field(min_length=3, max_length=160)
    founder_role: Literal['Founder','Co-founder']
    email: str = Field(max_length=254)
    website: str
    country: Literal['United States'] = 'United States'
    state: str = Field(min_length=2, max_length=60)
    niche: Literal['Solar businesses'] = 'Solar businesses'
    role_source_url: str
    role_quote: str = Field(min_length=8, max_length=500)
    email_source_url: str
    email_quote: str = Field(min_length=8, max_length=500)
    email_source_year: int | None = Field(default=None, ge=1990, le=2100)
    notes: str | None = Field(default=None, max_length=1200)

    @field_validator('founder_role', mode='before')
    @classmethod
    def founder_only(cls, value):
        if re.search(r'\b(?:not|unconfirmed|former)\b',str(value),re.I): raise ValueError('An established founder role is required.')
        if re.search(r'\bco[-\s]?founder\b', str(value), re.I): return 'Co-founder'
        if re.search(r'\bfounder\b', str(value), re.I): return 'Founder'
        raise ValueError('CEO, owner or employee alone does not establish a founder.')

    @field_validator('email')
    @classmethod
    def published_person_address(cls, value):
        value=value.strip().casefold()
        if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}",value):
            raise ValueError('A complete published email address is required.')
        if value.split('@')[0].split('+')[0] in GENERIC:
            raise ValueError('Generic company inboxes do not qualify as founder emails.')
        return value

    @field_validator('website','role_source_url','email_source_url')
    @classmethod
    def web_source(cls, value):
        parsed=urlparse(value)
        if parsed.scheme not in ('https','http') or not parsed.hostname or '.' not in parsed.hostname or parsed.username or parsed.password:
            raise ValueError('A public business or evidence URL is required.')
        return value

    @model_validator(mode='after')
    def explicit_evidence(self):
        if re.search(r'\b(?:not|never)\s+(?:(?:a|the)\s+)?(?:co[-\s]?)?founder\b',self.role_quote,re.I):
            raise ValueError('The source does not establish a founder role.')
        if not FOUNDER.search(self.role_quote):
            raise ValueError('Role evidence must explicitly establish founder or co-founder status.')
        name_parts=[p.casefold() for p in re.findall(r'\w+',self.founder_name) if len(p)>1]
        if not name_parts or not any(re.search(r'\b'+re.escape(p)+r'\b',self.role_quote,re.I) for p in name_parts):
            raise ValueError('Founder evidence must identify the named person.')
        if self.email not in self.email_quote.casefold():
            raise ValueError('Email evidence must include the published address, not an address pattern.')
        if not website_host(self.website): raise ValueError('Company website is required.')
        return self

    @property
    def contact_id(self):
        return str(uuid5(NAMESPACE_URL,'founder-email:'+website_host(self.website)+':'+person_key(self.founder_name)))

async def contacts(store):
    store=SocialStore(store);rows={};offset=0
    while True:
        page=await store.list('sm_settings',filters={'id':'like.founder_email:*'},limit=500,offset=offset,order='id.asc')
        for r in page:rows[r['id']]=r['value']
        if len(page)<500:break
        offset+=len(page)
    valid=[];emails=set();people=set()
    for value in rows.values():
        if value.get('status')!='source_backed':continue
        try:item=FounderEmail.model_validate(value)
        except ValidationError:continue
        name=person_key(item.founder_name)
        if item.email in emails or name in people:continue
        emails.add(item.email);people.add(name)
        valid.append(dict(item.model_dump(),id=item.contact_id,checked_at=value.get('checked_at')))
    return sorted(valid,key=lambda r:(r['company'].casefold(),r['founder_name'].casefold()))

async def list_contacts(store,query='',state='',offset=0,limit=25):
    rows=await contacts(store)
    research_rows=await SocialStore(store).list('sm_settings',filters={'id':'eq.founder_email_research:default'},limit=1)
    research=research_rows[0]['value'] if research_rows else {'status':'not_started','target':100}
    q=query.casefold().strip()
    filtered=[r for r in rows if (not state or r['state']==state) and (not q or q in ' '.join([r['company'],r['founder_name'],r['email'],r['state']]).casefold())]
    return {'contacts':filtered[offset:offset+limit],'matched':len(filtered),'total':len(rows),'companies':len({website_host(r['website']) for r in rows}),'states':sorted({r['state'] for r in rows}),'goal':100,'research':research}
