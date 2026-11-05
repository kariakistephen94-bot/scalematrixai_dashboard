// Starts one whatsapp-gateway instance per configured account, each with its own paired session
// and its webhooks pointed at this app. Does not touch the gateway project's own .env or auth_state.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* validated below */ }
const cfg = loadConfig();

const gatewayDir = path.resolve(root, process.env.GATEWAY_DIR || '../../whatsapp-gateway');
const entry = path.join(gatewayDir, 'src', 'server.js');
if (!fs.existsSync(entry)) { console.error(`whatsapp-gateway not found at ${gatewayDir}. Set GATEWAY_DIR in .env.`); process.exit(1); }
if (!cfg.accounts.length) { console.error('No accounts configured in .env'); process.exit(1); }

const appBase = `http://127.0.0.1:${cfg.port}`;
const children = [];

for (const account of cfg.accounts) {
  if (!account.apiKey || !account.statusSecret || !account.inboundSecret) {
    console.error(`${account.label}: missing secrets in .env (run \`npm run init\`)`); process.exit(1);
  }
  const url = new URL(account.url);
  const authDir = path.join(root, 'data', `auth-${account.id}`);
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    API_KEY: account.apiKey, HOST: '127.0.0.1', PORT: url.port || '80',
    AUTH_DIR: authDir, STATUS_DATA_DIR: path.join(root, 'data', `gateway-${account.id}`),
    WEBHOOK_URL: `${appBase}/hooks/inbound/${account.id}`, WEBHOOK_SECRET: account.inboundSecret,
    STATUS_WEBHOOK_URL: `${appBase}/hooks/status/${account.id}`, STATUS_WEBHOOK_SECRET: account.statusSecret,
    MIN_SEND_INTERVAL_MS: '3000', LOG_LEVEL: 'warn',
  };
  const child = spawn(process.execPath, [entry], { cwd: gatewayDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${account.label}]`;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
  child.on('exit', (code) => console.log(`${tag} gateway exited (${code})`));
  children.push(child);
  console.log(`${tag} gateway on ${account.url}. Pair it from the dashboard's Accounts panel.`);
}

const stop = () => { children.forEach((c) => c.kill('SIGTERM')); setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
