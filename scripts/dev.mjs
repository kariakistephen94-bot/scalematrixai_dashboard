import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, 'backend/.venv/bin/python');
if (!existsSync(python)) {
  console.error('Install backend dependencies first. See README.md.');
  process.exit(1);
}
if (!existsSync(path.join(root, 'backend/.env')) || !existsSync(path.join(root, 'frontend/.env.local'))) {
  console.error('Run python3 scripts/setup_env.py first.');
  process.exit(1);
}
const processes = [
  spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'], { cwd: path.join(root, 'backend'), stdio: 'inherit' }),
  spawn('npm', ['run', 'dev'], { cwd: path.join(root, 'frontend'), stdio: 'inherit' }),
];

// WhatsApp outreach (optional): the service and its gateways start only once outreach/.env exists
// (`npm run init` in outreach/). If either exits, the rest of the dashboard keeps running.
const outreach = path.join(root, 'outreach');
const optional = [];
if (existsSync(path.join(outreach, '.env'))) {
  for (const script of ['src/server.js', 'scripts/gateways.mjs']) {
    optional.push(spawn(process.execPath, [script], { cwd: outreach, stdio: 'inherit' }));
  }
} else {
  console.log('Outreach is not set up yet (run `npm run init` in outreach/). Starting without it.');
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...processes, ...optional]) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of processes) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 0); });
}
for (const child of optional) {
  child.on('error', (error) => console.error(`outreach: ${error.message}`));
  child.on('exit', (code) => { if (!stopping) console.error(`outreach process exited (${code}); the dashboard is still running.`); });
}
