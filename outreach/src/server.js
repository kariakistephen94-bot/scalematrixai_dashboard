import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { get, getSetting, logActivity, openDb, run, setSetting } from './db.js';
import { collectorEnabled, collectorTick, runScan } from './collector.js';
import { GatewayClient } from './gateway.js';
import { applyInbound, applyStatusEvent, safeEqual } from './hooks.js';
import { importAllNigeria, importPlaces, ScraperClient } from './scraper.js';
import { listEvents, PipelineError, setPipelineStatus, STATUSES } from './pipeline.js';
import { Sender } from './sender.js';
import { leadsCsv, listActivity, listLeads, listMessages, listReplies, overview } from './stats.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createContext(cfg, { db, fetch: fetchImpl = fetch, now = Date.now, random = Math.random, sleep, runWait } = {}) {
  const ctx = { cfg, db: db || openDb(cfg.dbFile), fetch: fetchImpl, now, random, runWait, scanning: false, accountStatus: {}, gateways: {} };
  for (const account of cfg.accounts) ctx.gateways[account.id] = new GatewayClient(account, fetchImpl);
  ctx.scraper = new ScraperClient(cfg, fetchImpl, sleep);
  return ctx;
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const int = (v, d, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d));

export function createServer(ctx) {
  const { cfg, db } = ctx;
  if (cfg.dashboardToken.length < 16) throw new Error('DASHBOARD_TOKEN must be at least 16 characters (run `npm run init`)');
  const accountById = (id) => cfg.accounts.find((a) => a.id === id);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const q = url.searchParams;

    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/') return send(res, 200, 'Outreach service is running. Use the dashboard\'s Outreach tab.\n', 'text/plain; charset=utf-8');

    // --- Gateway webhooks: authenticated per account with that account's own secret ---
    const hook = /^\/hooks\/(status|inbound)\/([a-f])$/.exec(p);
    if (hook && req.method === 'POST') {
      const account = accountById(hook[2]);
      if (!account) return send(res, 404, { error: 'unknown_account' });
      const secret = hook[1] === 'status' ? account.statusSecret : account.inboundSecret;
      const header = hook[1] === 'status' ? req.headers['x-helios-gateway-key'] : req.headers['x-helios-key'];
      if (!secret) return send(res, 503, { error: 'webhook_not_configured' });
      if (!safeEqual(header, secret)) return send(res, 401, { error: 'unauthorized' });
      const body = await readJson(req, 16 * 1024);
      const result = hook[1] === 'status' ? applyStatusEvent(ctx, account.id, body) : applyInbound(ctx, account.id, body);
      return send(res, result.ok ? 200 : 422, result);
    }

    if (!p.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(bearer, cfg.dashboardToken)) return send(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET') {
      if (p === '/api/overview') return send(res, 200, overview(ctx, ['today', '7d', 'all'].includes(q.get('range')) ? q.get('range') : 'today'));
      if (p === '/api/leads') {
        const filters = { stage: q.get('stage'), city: q.get('city'), q: q.get('q'), pipeline: q.get('pipeline') };
        return send(res, 200, listLeads(ctx, filters, int(q.get('limit'), 50, 1, 200), int(q.get('offset'), 0, 0, 1e7)));
      }
      if (p === '/api/leads.csv') {
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="solar-leads.csv"', 'cache-control': 'no-store' });
        return res.end(leadsCsv(ctx, { stage: q.get('stage'), city: q.get('city'), q: q.get('q'), pipeline: q.get('pipeline') }));
      }
      if (p === '/api/replies') return send(res, 200, { items: listReplies(ctx, ['today', '7d', 'all'].includes(q.get('range')) ? q.get('range') : 'all') });
      if (p === '/api/messages') return send(res, 200, { items: listMessages(ctx, { status: q.get('status'), limit: int(q.get('limit'), 100, 1, 500), offset: int(q.get('offset'), 0, 0, 1e7) }) });
      if (p === '/api/activity') return send(res, 200, { items: listActivity(ctx, int(q.get('limit'), 100, 1, 500)) });
      const qr = /^\/api\/accounts\/([a-f])\/qr$/.exec(p);
      if (qr) {
        if (!ctx.gateways[qr[1]]) return send(res, 404, { error: 'unknown_account' });
        return send(res, 200, (await ctx.gateways[qr[1]].qr()) || { qr: null, dataUrl: null });
      }
    }

    if (req.method === 'POST' && p === '/api/control') {
      const { action, account } = await readJson(req);
      if (action === 'pause_all') setSetting(db, 'send_paused', '1');
      else if (action === 'resume_all') setSetting(db, 'send_paused', '0');
      else if ((action === 'pause_account' || action === 'resume_account') && accountById(account)) setSetting(db, `acct:${account}:paused`, action === 'pause_account' ? '1' : '0');
      else return send(res, 400, { error: 'invalid_action' });
      logActivity(db, 'control', `${action}${account ? ` ${account}` : ''}`, ctx.now());
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/import-places') {
      const { places } = await readJson(req, 512 * 1024);
      if (!Array.isArray(places) || places.length > 500) return send(res, 400, { error: 'invalid_places' });
      const result = importPlaces(ctx, places);
      logActivity(db, 'scan', `Google Maps import: +${result.added} (${result.ready} ready, ${result.callOnly} call-only), ${result.known} already known, ${result.rejected} rejected`, ctx.now());
      return send(res, 200, result);
    }

    if (req.method === 'POST' && p === '/api/import-all') {
      if (!cfg.scraperToken) return send(res, 409, { error: 'scraper_not_configured' });
      const result = await importAllNigeria(ctx);
      logActivity(db, 'scan', `Bulk import: +${result.added} (${result.solarReady} solar ready, ${result.otherNiche} other niches, ${result.callOnly} call-only), ${result.known} already known, ${result.skipped} skipped`, ctx.now());
      return send(res, 200, result);
    }

    if (req.method === 'POST' && p === '/api/collector') {
      const { action } = await readJson(req);
      if (action === 'enable' || action === 'disable') {
        setSetting(db, 'collector_enabled', action === 'enable' ? '1' : '0');
        if (action === 'enable') setSetting(db, 'collector_cooldown_until', '0');
        return send(res, 200, { ok: true });
      }
      if (action === 'run') {
        if (!cfg.scraperToken) return send(res, 409, { error: 'scraper_not_configured' });
        if (ctx.scanning) return send(res, 409, { error: 'already_running' });
        setSetting(db, 'collector_cooldown_until', '0');
        runScan(ctx).catch(() => {});
        return send(res, 202, { ok: true, started: true });
      }
      return send(res, 400, { error: 'invalid_action' });
    }

    const events = /^\/api\/leads\/(\d+)\/events$/.exec(p);
    if (events && req.method === 'GET') return send(res, 200, { items: listEvents(ctx, Number(events[1])) });

    const lead = /^\/api\/leads\/(\d+)$/.exec(p);
    if (lead && req.method === 'POST') {
      const id = Number(lead[1]);
      const { action, notes, status, at, note } = await readJson(req);
      const row = get(db, 'SELECT id FROM leads WHERE id = ?', id);
      if (!row) return send(res, 404, { error: 'not_found' });
      if (action === 'opt_out') run(db, `UPDATE leads SET stage = 'opted_out', opted_out_at = COALESCE(opted_out_at, ?), next_followup_at = NULL WHERE id = ?`, ctx.now(), id);
      else if (action === 'close') run(db, `UPDATE leads SET stage = 'closed', next_followup_at = NULL WHERE id = ?`, id);
      else if (action === 'set_status') {
        try { setPipelineStatus(ctx, id, { status, at, note }); } catch (error) {
          if (error instanceof PipelineError) return send(res, error.code === 'not_found' ? 404 : 400, { error: error.code });
          throw error;
        }
        logActivity(db, 'pipeline', `Lead ${id}: ${STATUSES[status]?.label || status}${at ? ` @ ${new Date(Number(at)).toISOString()}` : ''}`, ctx.now());
      }
      else if (action === 'note') run(db, 'UPDATE leads SET notes = ? WHERE id = ?', String(notes ?? '').slice(0, 2000), id);
      else return send(res, 400, { error: 'invalid_action' });
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not_found' });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error.status || 500;
      if (status >= 500) console.error('request failed:', error);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'internal_error' : error.message });
    });
  });
}

/** Background loops. Returns a stop function. */
export function startLoops(ctx) {
  const sender = new Sender(ctx);
  const refreshAccounts = async () => {
    await Promise.all(ctx.cfg.accounts.map(async (a) => { ctx.accountStatus[a.id] = { ...(await ctx.gateways[a.id].status()), at: ctx.now() }; }));
  };
  const guard = (fn) => () => { Promise.resolve().then(fn).catch((e) => console.error('loop error:', e.message)); };
  const timers = [
    setInterval(guard(refreshAccounts), 20_000),
    setInterval(guard(() => sender.tick()), 15_000),
    setInterval(guard(() => collectorTick(ctx)), 60_000),
  ];
  guard(refreshAccounts)();
  guard(() => collectorTick(ctx))();
  return () => timers.forEach(clearInterval);
}

async function main() {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env: rely on the environment */ }
  const cfg = loadConfig();
  const ctx = createContext(cfg);
  const server = createServer(ctx);
  const stop = startLoops(ctx);
  server.listen(cfg.port, cfg.host, () => {
    const base = `http://${cfg.host}:${cfg.port}`;
    console.log(`Outreach service on ${base} (use the dashboard's Outreach tab)`);
    console.log(`Accounts configured: ${cfg.accounts.map((a) => a.label).join(', ') || 'none'}`);
    console.log(`Sending is ${getSetting(ctx.db, 'send_paused', '1') === '1' ? 'PAUSED (resume it from the dashboard)' : 'running'}; discovery is ${collectorEnabled(ctx.db, cfg) ? 'on' : 'off'}.`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); server.close(() => process.exit(0)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
