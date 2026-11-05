import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get, run, setSetting } from '../src/db.js';
import { createServer } from '../src/server.js';
import { Sender } from '../src/sender.js';
import { fakeGateways, insertLead, makeCtx, statusEvent } from './helpers.js';

async function boot(opts = {}) {
  const gw = fakeGateways();
  const t = makeCtx({ fetch: gw.handler, env: { WARMUP_START: '75', ...opts.env } });
  const server = createServer(t.ctx);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${t.cfg.dashboardToken}` };
  const api = async (path, init = {}) => {
    const res = await fetch(base + path, { ...init, headers: { ...auth, 'content-type': 'application/json', ...init.headers }, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { ...t, gw, base, api, close: () => server.close() };
}

test('API requires the dashboard token; the page and health are open', async () => {
  const t = await boot();
  try {
    assert.equal((await fetch(`${t.base}/api/overview`)).status, 401);
    assert.equal((await fetch(`${t.base}/api/overview`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${t.base}/health`)).status, 200);
    const page = await fetch(t.base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Outreach service is running/);
    assert.equal((await t.api('/api/overview')).status, 200);
  } finally { t.close(); }
});

test('webhooks need the account secret', async () => {
  const t = await boot();
  try {
    const post = (path, headers, body) => fetch(t.base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/hooks/status/a', {}, {})).status, 401);
    assert.equal((await post('/hooks/status/a', { 'x-helios-gateway-key': 'S'.repeat(32) }, {})).status, 401); // account b's secret
    assert.equal((await post('/hooks/inbound/a', { 'x-helios-key': 's'.repeat(32) }, {})).status, 401); // status secret on inbound
    assert.equal((await post('/hooks/inbound/a', { 'x-helios-key': 'i'.repeat(32) }, { id: 'q', from: '1@lid' })).status, 200);
    assert.equal((await post('/hooks/status/a', { 'x-helios-gateway-key': 's'.repeat(32) }, { junk: 1 })).status, 422);
  } finally { t.close(); }
});

test('dashboard tiles reflect sent, failed, uncertain, delivered, read, replies and conversion', async () => {
  const t = await boot();
  try {
    const leads = Array.from({ length: 4 }, (_, i) => insertLead(t.db, { phone: `234803000000${i + 1}` }));
    setSetting(t.db, 'send_paused', '0');
    setSetting(t.db, 'acct:b:paused', '1');
    const sender = new Sender(t.ctx);

    await sender.tick(); // lead 1: accepted
    t.clock.t += 30 * 60_000; t.gw.state.a.sendMode = 'error'; await sender.tick(); // lead 2: failed
    t.clock.t += 30 * 60_000; t.gw.state.a.sendMode = 'throw'; await sender.tick(); // lead 2 retried: uncertain
    t.clock.t += 30 * 60_000; t.gw.state.a.sendMode = 'ok'; await sender.tick(); // lead 3: accepted

    const accepted = t.gw.state.a.sent;
    assert.equal(accepted.length, 2);
    await t.api('/hooks/status/a', {}).catch(() => {});
    const { applyStatusEvent, applyInbound } = await import('../src/hooks.js');
    applyStatusEvent(t.ctx, 'a', statusEvent('2348100000001', accepted[0].id, 'delivered'));
    applyStatusEvent(t.ctx, 'a', statusEvent('2348100000001', accepted[0].id, 'read'));
    applyStatusEvent(t.ctx, 'a', statusEvent('2348100000001', accepted[1].id, 'delivered'));
    applyInbound(t.ctx, 'a', { id: 'R1', from: `${accepted[0].to}@s.whatsapp.net`, text: 'Interested' });

    const { body } = await t.api('/api/overview?range=all');
    assert.deepEqual(
      { sent: body.tiles.sent, failed: body.tiles.failed, both: body.tiles.sentPlusFailed, uncertain: body.tiles.uncertain, delivered: body.tiles.delivered, read: body.tiles.read, replied: body.tiles.repliedLeads },
      { sent: 2, failed: 1, both: 3, uncertain: 1, delivered: 2, read: 1, replied: 1 });
    assert.equal(body.tiles.contacted, 3); // lead 2 is counted via its uncertain message
    assert.equal(body.tiles.replyConversion, 33.3);

    const replies = (await t.api('/api/replies')).body.items;
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, 'Interested');
    assert.ok(leads.length === 4);
  } finally { t.close(); }
});

test('leads list filters and CSV export neutralise spreadsheet formulas', async () => {
  const t = await boot();
  try {
    insertLead(t.db, { name: '=HYPERLINK("http://evil")', city: 'Lagos' });
    insertLead(t.db, { name: 'Safe Hotel', city: 'Abuja', area: 'Maitama' });
    const abuja = (await t.api('/api/leads?city=Abuja')).body;
    assert.equal(abuja.total, 1);
    assert.equal(abuja.items[0].name, 'Safe Hotel');
    const search = (await t.api('/api/leads?q=maitama')).body;
    assert.equal(search.total, 1);
    const csv = (await t.api('/api/leads.csv')).body;
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /\+234803/);
  } finally { t.close(); }
});

test('archived leads are hidden from the default list but can be shown', async () => {
  const t = await boot();
  try {
    insertLead(t.db, { name: 'Old hotel', stage: 'archived' });
    insertLead(t.db, { name: 'Sunrise Solar', stage: 'new' });
    const all = (await t.api('/api/leads')).body;
    assert.deepEqual(all.items.map((l) => l.name), ['Sunrise Solar']);
    assert.equal(all.total, 1);
    const archived = (await t.api('/api/leads?stage=archived')).body;
    assert.deepEqual(archived.items.map((l) => l.name), ['Old hotel']);
  } finally { t.close(); }
});

test('controls: pause/resume sending and per-account, mark opt-out manually', async () => {
  const t = await boot();
  try {
    assert.equal((await t.api('/api/overview')).body.sending.paused, true);
    await t.api('/api/control', { method: 'POST', body: { action: 'resume_all' } });
    await t.api('/api/control', { method: 'POST', body: { action: 'pause_account', account: 'b' } });
    const o = (await t.api('/api/overview')).body;
    assert.equal(o.sending.paused, false);
    assert.equal(o.accounts.find((a) => a.id === 'b').paused, true);
    assert.equal((await t.api('/api/control', { method: 'POST', body: { action: 'nope' } })).status, 400);

    const lead = insertLead(t.db, { stage: 'contacted', first_contacted_at: 1 });
    assert.equal((await t.api(`/api/leads/${lead.id}`, { method: 'POST', body: { action: 'opt_out' } })).status, 200);
    assert.equal(get(t.db, 'SELECT stage FROM leads WHERE id = ?', lead.id).stage, 'opted_out');
  } finally { t.close(); }
});

test('accounts panel shows connection state and QR for pairing', async () => {
  const t = await boot();
  try {
    t.gw.state.b.connected = false;
    t.ctx.accountStatus.a = await t.ctx.gateways.a.status();
    t.ctx.accountStatus.b = await t.ctx.gateways.b.status();
    const o = (await t.api('/api/overview')).body;
    assert.equal(o.accounts.find((a) => a.id === 'a').connected, true);
    assert.equal(o.accounts.find((a) => a.id === 'b').needsQr, true);
    assert.match((await t.api('/api/accounts/b/qr')).body.dataUrl, /^data:image/);
    run(t.db, 'SELECT 1');
  } finally { t.close(); }
});
