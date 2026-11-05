"""Create private local configuration without overwriting existing credentials."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
backend = root / 'backend/.env'
frontend = root / 'frontend/.env.local'
existing = {}
if backend.exists():
    for line in backend.read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            existing[key] = value
key = existing.get('DASHBOARD_API_TOKEN') or secrets.token_urlsafe(36)
if not backend.exists():
    backend.write_text((root / 'backend/.env.example').read_text().replace('DASHBOARD_API_TOKEN=', f'DASHBOARD_API_TOKEN={key}'))
    backend.chmod(0o600)
if not frontend.exists():
    frontend.write_text(f'BACKEND_URL=http://127.0.0.1:8001\nDASHBOARD_API_TOKEN={key}\n')
    frontend.chmod(0o600)
print('Local environment files are ready. Add OpenAI and Supabase credentials to backend/.env.')
