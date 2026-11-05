from app.services.social_founders import FounderCandidate, sourced_founders

def person(**changes):
    return FounderCandidate(**dict(dict(name='Ada Example',role='Founder',profile_url='https://linkedin.com/in/ada-example',source_url='https://example.com/about',evidence='The company About page identifies Ada Example as its founder.'),**changes))

def test_founders_require_a_retrieved_affiliation_source():
    assert sourced_founders([person()],[])==[]

def test_personal_profile_is_never_guessed_from_a_name():
    result=sourced_founders([person()],[{'url':'https://example.com/about'}])
    assert result[0]['name']=='Ada Example' and result[0]['profile_url'] is None

def test_sourced_founder_profiles_are_preserved_and_people_deduplicated():
    a=person();result=sourced_founders([a,a],[{'url':a.source_url},{'url':a.profile_url}])
    assert len(result)==1 and result[0]['profile_url']==a.profile_url

def test_non_web_source_is_rejected():
    a=person(source_url='javascript:alert(1)')
    assert sourced_founders([a],[{'url':a.source_url}])==[]


def test_founding_narrative_alone_does_not_establish_a_founder():
    a=person(evidence='The CEO appears in the founding narrative and is associated with the origin story.')
    assert sourced_founders([a],[{'url':a.source_url}])==[]
