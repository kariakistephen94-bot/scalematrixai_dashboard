import re

# ASCII hyphens, Unicode hyphens/dashes, minus signs and fullwidth variants.
DASHES = re.compile(r"[-\u00ad\u058a\u05be\u1400\u1806\u2010-\u2015\u2043\u2053\u207b\u208b\u2212\u2e17\u2e1a\u2e3a-\u2e3b\u2e40\u2e5d\u301c\u3030\u30a0\ufe31-\ufe32\ufe58\ufe63\uff0d]+")


def clean_outreach(value):
    if value is None:
        return None
    return re.sub(r"[^\S\n]+", " ", DASHES.sub(" ", value)).strip()


# Apply only to prose, never URLs, phone numbers, identifiers or dates.
PROSE_FIELDS = {'title', 'body', 'topic', 'rationale', 'visual_brief', 'industry',
                'opportunity', 'evidence', 'outreach_draft', 'message_body', 'role', 'summary'}


def clean_generated(value):
    if isinstance(value, list):
        return [clean_generated(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_outreach(item) if key in PROSE_FIELDS and isinstance(item, str)
                else clean_generated(item) for key, item in value.items()}
    return value
