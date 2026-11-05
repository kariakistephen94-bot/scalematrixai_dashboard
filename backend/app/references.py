import json
from pathlib import Path

from .config import ROOT

REFERENCE_DIR = ROOT / 'references'


def reference_posts():
    return json.loads((REFERENCE_DIR / 'posts.json').read_text())


def writing_context():
    # These files are supplied style context, not runtime instructions or credentials.
    guide = (REFERENCE_DIR / 'linkedin_style_guide.md').read_text()
    examples = reference_posts()
    return guide + '\n\nUser-authored examples (learn techniques, never copy):\n' + '\n\n'.join(p['body'] for p in examples[-4:])
