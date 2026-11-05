// Creates or tops up .env with random secrets, and links the dashboard frontend to this service.
//   npm run init                                   first time: writes .env from .env.example
//   npm run init                                   later: fills anything missing (new accounts, new settings);
//                                                  existing values are never changed. --force rewrites everything.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, '.env');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const secret = (bytes) => crypto.randomBytes(bytes).toString('hex');

const generated = { DASHBOARD_TOKEN: secret(24) };
for (const id of 'ABCDEF') {
  generated[`ACCOUNT_${id}_API_KEY`] = secret(24);
  generated[`ACCOUNT_${id}_STATUS_SECRET`] = secret(32);
  generated[`ACCOUNT_${id}_INBOUND_SECRET`] = secret(32);
}

// The scraper token is the dashboard backend's own token, so the outreach service can call the scraper.
const backendEnv = path.join(root, '..', 'backend', '.env');
if (fs.existsSync(backendEnv)) {
  const line = fs.readFileSync(backendEnv, 'utf8').split('\n').find((l) => l.startsWith('DASHBOARD_API_TOKEN='));
  const value = line?.slice('DASHBOARD_API_TOKEN='.length).trim();
  if (value) generated.SCRAPER_TOKEN = value;
}

const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8').split('\n');
const existing = fs.existsSync(target) && !args.includes('--force') ? fs.readFileSync(target, 'utf8').split('\n') : null;
const parse = (line) => /^([A-Z0-9_]+)=(.*)$/.exec(line);

let out;
if (!existing) {
  out = example.map((line) => { const m = parse(line); return m && !m[2] && generated[m[1]] ? `${m[1]}=${generated[m[1]]}` : line; });
  console.log('Wrote .env (mode 600).');
} else {
  const have = new Map(existing.map(parse).filter(Boolean).map((m) => [m[1], m[2]]));
  out = existing.map((line) => {
    const m = parse(line);
    return m && !m[2] && generated[m[1]] ? `${m[1]}=${generated[m[1]]}` : line;
  });
  const added = [];
  for (const line of example) {
    const m = parse(line);
    if (m && !have.has(m[1])) { out.push(!m[2] && generated[m[1]] ? `${m[1]}=${generated[m[1]]}` : line); added.push(m[1]); }
  }
  const filled = [...have].filter(([k, v]) => !v && generated[k]).map(([k]) => k);
  console.log(`Updated .env: ${added.length} settings added, ${filled.length} empty ones filled. Existing values untouched.`);
}
fs.writeFileSync(target, out.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
fs.chmodSync(target, 0o600);

// Link the dashboard frontend: its server-side proxy needs this service's URL and token.
const finalEnv = Object.fromEntries(out.map(parse).filter(Boolean).map((m) => [m[1], m[2]]));
const frontendEnv = path.join(root, '..', 'frontend', '.env.local');
if (fs.existsSync(frontendEnv)) {
  const text = fs.readFileSync(frontendEnv, 'utf8');
  const lines = [];
  if (!/^OUTREACH_URL=/m.test(text)) lines.push(`OUTREACH_URL=http://127.0.0.1:${finalEnv.PORT || 3200}`);
  if (!/^OUTREACH_API_TOKEN=/m.test(text)) lines.push(`OUTREACH_API_TOKEN=${finalEnv.DASHBOARD_TOKEN}`);
  if (lines.length) {
    fs.appendFileSync(frontendEnv, `${text.endsWith('\n') ? '' : '\n'}# Outreach service (server-only, never NEXT_PUBLIC_)\n${lines.join('\n')}\n`);
    console.log(`Linked the dashboard: added ${lines.map((l) => l.split('=')[0]).join(', ')} to frontend/.env.local`);
  }
}
console.log(`Scraper token ${finalEnv.SCRAPER_TOKEN ? 'is set' : 'is NOT set (backend/.env has no DASHBOARD_API_TOKEN)'}.`);
