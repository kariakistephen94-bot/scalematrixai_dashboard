import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
import app.main as main
from app.services.founder_emails import FounderEmail, contacts, list_contacts


def candidate(**changes):
    return dict(company='Example Solar',founder_name='Ada Example',founder_role='Founder & CEO',email='ada@example-solar.com',website='https://example-solar.com',country='United States',state='Texas',role_source_url='https://example-solar.com/about',role_quote='Ada Example founded Example Solar.',email_source_url='https://example-solar.com/team',email_quote='Ada Example: ada@example-solar.com',**changes)


@pytest.mark.parametrize('change',[
 {'founder_role':'Owner'}, {'founder_role':'CEO'}, {'founder_role':'Not a founder'},
 {'role_quote':'Ada Example is the current CEO and owner.'},
 {'role_quote':'Ada Example is not a founder.'},
 {'country':'United Kingdom'}, {'email':'info@example-solar.com','email_quote':'info@example-solar.com'},
 {'email':'info+owner@example-solar.com','email_quote':'info+owner@example-solar.com'},
 {'email_quote':'Addresses follow a first.last email pattern.'},
 {'role_source_url':'javascript:alert(1)'},
])
def test_unqualified_or_inferred_contacts_are_rejected(change):
    value=candidate();value.update(change)
    with pytest.raises(ValidationError):FounderEmail(**value)


def test_cofounder_and_published_professional_freemail_are_supported():
    value=candidate();value.update(founder_role='Co-founder & President',email='ada.solar@gmail.com',email_quote='Ada Example: ada.solar@gmail.com')
    assert FounderEmail(**value).founder_role=='Co-founder'


class MemoryStore:
    def __init__(self, values):self.values=values
    async def list(self, table, **options):
        assert table=='sm_settings'
        if options['filters']['id']=='eq.founder_email_research:default':return [{'id':'founder_email_research:default','value':{'status':'running','target':100}}]
        rows=[{'id':f'founder_email:{i}','value':v} for i,v in enumerate(self.values)]
        start=options.get('offset',0);return rows[start:start+options.get('limit',100)]


def test_endpoint_auth_filters_and_unique_founder_counts(monkeypatch):
    ada=dict(candidate(),status='source_backed')
    other=candidate();other.update(founder_name='Grace Example',founder_role='Co-founder',email='grace@example-solar.com',role_quote='Grace Example is a co-founder.',email_quote='Grace Example: grace@example-solar.com',status='source_backed')
    owner=candidate();owner.update(founder_name='Non Founder',founder_role='Owner',status='source_backed')
    duplicate=dict(ada,email='alternate@example-solar.com',email_quote='Ada Example: alternate@example-solar.com')
    db=MemoryStore([ada,other,owner,duplicate,dict(ada,status='needs_review')])
    monkeypatch.setattr(main.settings,'dashboard_api_token','email-test')
    main.app.dependency_overrides[main.get_store]=lambda:db
    try:
        client=TestClient(main.app)
        assert client.get('/emails').status_code==401
        result=client.get('/emails?q=grace&state=Texas',headers={'X-Dashboard-Token':'email-test'}).json()
        assert result['total']==2 and result['matched']==1 and result['companies']==1
        assert result['contacts'][0]['founder_name']=='Grace Example'
        assert result['contacts'][0]['founder_role']=='Co-founder'
        assert result['research']['status']=='running'
        assert client.get('/emails?state=California',headers={'X-Dashboard-Token':'email-test'}).json()['matched']==0
        assert len(client.get('/emails?offset=1&limit=1',headers={'X-Dashboard-Token':'email-test'}).json()['contacts'])==1
    finally:main.app.dependency_overrides.clear()
