import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/server.js';
import { openDb, run } from '../src/db.js';

// Monday 2 Nov 2026, 10:00 in Lagos (UTC+1)
export const MONDAY_10AM = Date.parse('2026-11-02T09:00:00Z');

// Accounts A-F always have credentials; ACCOUNT_COUNT (default 2) decides how many are active.
const accountEnv = Object.fromEntries([...'abcdef'].flatMap((id, i) => {
  const U = id.toUpperCase();
  const fill = (ch) => ch.repeat(32);
  return [
    [`ACCOUNT_${U}_URL`, `http://gw-${id}.test`], [`ACCOUNT_${U}_API_KEY`, ['a', 'b', 'c', 'd', 'e', 'f'][i].repeat(24)],
    [`ACCOUNT_${U}_STATUS_SECRET`, fill(['s', 'S', 't', 'T', 'u', 'U'][i])], [`ACCOUNT_${U}_INBOUND_SECRET`, fill(['i', 'I', 'j', 'J', 'k', 'K'][i])],
  ];
}));

export function makeCfg(over = {}) {
  return loadConfig({
    DASHBOARD_TOKEN: 'd'.repeat(24), SCRAPER_URL: 'http://scraper.test', SCRAPER_TOKEN: 'scraper-token',
    DAILY_LEAD_TARGET: '10', ...accountEnv, ...over,
  });
}

/** A controllable clock plus a context wired to fake network handlers. */
export function makeCtx({ env = {}, fetch: fetchImpl, start = MONDAY_10AM } = {}) {
  const clock = { t: start };
  const cfg = makeCfg(env);
  const ctx = createContext(cfg, { db: openDb(':memory:'), fetch: fetchImpl || (async () => { throw new Error('no network in this test'); }), now: () => clock.t, random: () => 0.5, sleep: async () => {}, runWait: { timeoutMs: 1000, intervalMs: 0 } });
  return { ctx, cfg, db: ctx.db, clock };
}

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let seq = 0;

/**
 * Fake of the dashboard's Google Maps scraper API (FastAPI). Quick Search "finds" up to 15 new solar leads for the
 * requested city and saves them as stage "new"; /maps/leads lists them with live details like the real endpoint.
 */
export function fakeScraper({ autoRun = false, supply = { Abuja: Infinity, Lagos: Infinity }, reviews = () => 50 } = {}) {
  const state = { leads: [], runs: [], calls: [], autoRun, supply: { ...supply }, reviews };
  const handler = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'scraper.test') throw new Error(`unexpected host ${u.host}`);
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, token: init.headers['x-dashboard-token'] });
    if (init.headers['x-dashboard-token'] !== 'scraper-token') return json(401, { detail: 'Dashboard authorization required.' });
    if (u.pathname === '/agent') return json(200, { preferences: { auto_run: state.autoRun }, results: [], runs: [] });
    if (u.pathname === '/search/quick') {
      const city = body.workspace.target_areas[0].split('|')[1];
      const count = Math.min(15, state.supply[city]);
      state.supply[city] -= count;
      for (let i = 0; i < count; i++) addLead(state, city);
      const run = { id: `run-${state.runs.length + 1}`, kind: 'prospects', status: 'completed', summary: `${count} new Google Maps listings saved` };
      state.runs.push(run);
      return json(202, { already_exists: false, run });
    }
    if (u.pathname === '/dashboard') return json(200, { runs: state.runs });
    if (u.pathname === '/maps/leads' && init.method === 'GET') {
      const open = state.leads.filter((l) => l.stage === 'new');
      const offset = Number(u.searchParams.get('offset')), limit = Number(u.searchParams.get('limit'));
      const page = open.slice(offset, offset + limit);
      return json(200, { leads: page, has_more: offset + page.length < open.length, offset, next_offset: offset + page.length, scanned: page.length, details_errors: 0 });
    }
    const patch = /^\/maps\/leads\/(.+)$/.exec(u.pathname);
    if (patch && init.method === 'PATCH') {
      const lead = state.leads.find((l) => l.id === decodeURIComponent(patch[1]));
      if (!lead) return json(404, { detail: 'Maps lead not found.' });
      lead.stage = body.stage;
      return json(200, lead);
    }
    return json(404, { detail: 'Not found' });
  };
  return { handler, state };
}

let leadSeq = 0;
export function addLead(state, city, details = {}) {
  leadSeq++;
  const lead = {
    id: `src-${leadSeq}`, place_id: `place-${leadSeq}`, niche: 'Solar businesses', country: 'Nigeria', search_city: city, stage: 'new',
    details: {
      displayName: { text: `Solar Co ${leadSeq} Ltd` }, formattedAddress: `${leadSeq} Test Road, ${city}`,
      internationalPhoneNumber: `+234 803 ${String(1000000 + leadSeq).slice(-7)}`, businessStatus: 'OPERATIONAL',
      rating: 4.5, userRatingCount: state.reviews(leadSeq), ...details,
    },
  };
  state.leads.push(lead);
  return lead;
}

/** Fake gateways for accounts a-f. Behaviour can be changed per account through `state`. */
export function fakeGateways() {
  const state = Object.fromEntries([...'abcdef'].map((id) => [id, { connected: true, sendMode: 'ok', sent: [] }]));
  let n = 0;
  const handler = async (url, init) => {
    const u = new URL(url);
    const id = /gw-([a-f])\.test/.exec(u.host)[1];
    const gw = state[id];
    if (u.pathname === '/status') return json(200, { state: gw.connected ? 'open' : 'qr', connected: gw.connected, needsQr: !gw.connected, me: gw.connected ? { id: `23480000000${'abcdef'.indexOf(id) + 1}:5@s.whatsapp.net` } : null });
    if (u.pathname === '/qr.json') return json(200, { qr: 'raw', dataUrl: 'data:image/png;base64,AAAA' });
    if (u.pathname === '/send') {
      const body = JSON.parse(init.body);
      if (gw.sendMode === 'throw') throw new Error('socket hang up');
      if (gw.sendMode === 'error') return json(500, { error: 'boom' });
      const msgId = `MSG${id.toUpperCase()}${++n}${'X'.repeat(8)}`;
      gw.sent.push({ ...body, id: msgId });
      return json(200, { ok: true, id: msgId, to: `${body.to}@s.whatsapp.net` });
    }
    return json(404, { error: 'not found' });
  };
  return { handler, state };
}

export function insertLead(db, over = {}) {
  seq++;
  const lead = {
    place_id: `ins-${seq}`, name: `Lead ${seq}`, short_name: `Lead ${seq}`, address: 'x', city: 'Lagos', area: 'Ikeja', category: 'hotel',
    phone: `23480${String(30000000 + seq)}`, phone_type: 'mobile', website: '', rating: 4.5, review_count: 50, lat: 6.6, lng: 3.3,
    stage: 'new', discovery_day: '2026-11-02', discovered_at: MONDAY_10AM, ...over,
  };
  const id = run(db, `INSERT INTO leads(place_id, name, short_name, address, city, area, category, phone, phone_type, website, rating, review_count, lat, lng, stage, discovery_day, discovered_at, first_contacted_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lead.place_id, lead.name, lead.short_name, lead.address, lead.city, lead.area, lead.category, lead.phone, lead.phone_type, lead.website,
    lead.rating, lead.review_count, lead.lat, lead.lng, lead.stage, lead.discovery_day, lead.discovered_at, lead.first_contacted_at ?? null).lastInsertRowid;
  return { id: Number(id), ...lead };
}

export function statusEvent(sender, messageId, status, at = '2026-11-02T09:05:00.000Z') {
  const event_id = `gwevt_${crypto.createHash('sha256').update(`${sender}:${messageId}:${status}`).digest('hex').slice(0, 32)}`;
  return { event_id, event: 'message_status', provider: 'linked_gateway', message_id: messageId, sender, recipient: '2348030000001', status, occurred_at: at, timestamp_source: 'provider' };
}
