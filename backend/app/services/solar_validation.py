"""Require an advertised solar offering, rather than an incidental solar mention."""
import re
PATTERNS = [
    r'\bsolar\b[^.!?\n]{0,85}\b(?:install(?:ation|ations|er|ers)|maintenance|repair(?:s)?|cleaning|suppl(?:y|ier|iers)|manufactur(?:e|er|ers|ing)|solutions|services|engineering|EPC|development)\b',
    r'\b(?:install(?:s|ing)?|design(?:s|ing)?|provid(?:e|es|ing)|suppl(?:y|ies|ying)|sell(?:s|ing)?|manufactur(?:e|es|ing)|maintain(?:s|ing)?|repair(?:s|ing)?|shop|buy|browse)\b[^.!?\n]{0,100}\b(?:solar|photovoltaic)\b',
    r'\b(?:solar|photovoltaic)\s+(?:PV\s+)?(?:panel\s+)?(?:installers?|installation|maintenance|repairs?|cleaning|suppliers?|manufacturers?)\b',
]

def solar_offering(text):
    text=' '.join(text.split())
    for pattern in PATTERNS:
        for match in re.finditer(pattern,text,re.I):
            context=text[max(0,match.start()-35):match.end()]
            if re.search(r"\b(?:do not|does not|don't|doesn't|not currently|no longer)\b",context,re.I):
                continue
            return ' '.join(text[max(0,match.start()-30):match.end()+120].split()[:24])
    return None


def non_solar_business_reason(website, text):
    from urllib.parse import urlparse
    host=(urlparse(website).hostname or '').lower()
    if host.endswith(('.gov','.edu','.gov.uk','.ac.uk')):
        return 'Government or education website, rather than a solar operating company.'
    intro=' '.join(text.split())[:6500]
    sells_enabling_services=re.search(r'\b(?:solar\s+(?:lead generation|marketing|CRM|software)|(?:software|CRM|lead generation|marketing platform)\s+for\s+(?:the\s+)?solar|AI for solar lead generation)\b',intro,re.I)
    physical_offer=re.search(r'\bwe\s+(?:also\s+)?(?:design\s+and\s+)?(?:install|manufacture|supply|sell|clean|repair|maintain)\b[^.!?]{0,90}\bsolar\b',intro,re.I)
    if sells_enabling_services and not physical_offer:
        return 'Solar-related software, marketing or lead-generation provider; no direct physical solar offering confirmed.'
    return None
