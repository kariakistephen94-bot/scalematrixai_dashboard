import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get, setSetting } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { Sender } from '../src/sender.js';
import { fakeGateways, insertLead, makeCfg, makeCtx } from './helpers.js';

test('two accounts are active by default; ACCOUNT_COUNT enables up to six', () => {
  assert.deepEqual(makeCfg().accounts.map((a) => a.id), ['a', 'b']);
  const six = makeCfg({ ACCOUNT_COUNT: '6' }).accounts;
  assert.deepEqual(six.map((a) => a.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(new Set(six.map((a) => a.apiKey)).size, 6);
  assert.equal(new Set(six.map((a) => a.statusSecret)).size, 6);
});

test('ACCOUNT_COUNT outside 1-6 is rejected', () => {
  for (const bad of ['0', '7', '2.5', 'many']) assert.throws(() => makeCfg({ ACCOUNT_COUNT: bad }), /ACCOUNT_COUNT/, bad);
});

test('each account gets its own gateway port by default (3101-3106)', () => {
  const cfg = loadConfig({ DASHBOARD_TOKEN: 'd'.repeat(24), ACCOUNT_COUNT: '6' });
  assert.deepEqual(cfg.accounts.map((a) => a.url), [3101, 3102, 3103, 3104, 3105, 3106].map((p) => `http://127.0.0.1:${p}`));
});

test('six accounts all send, each to a different lead, and nobody is messaged twice', async () => {
  const gw = fakeGateways();
  const t = makeCtx({ fetch: gw.handler, env: { ACCOUNT_COUNT: '6', WARMUP_START: '75' } });
  setSetting(t.db, 'send_paused', '0');
  for (let i = 0; i < 6; i++) insertLead(t.db, { phone: `23480300000${10 + i}` });
  const results = await new Sender(t.ctx).tick();
  assert.deepEqual(results.map((r) => r.result), Array(6).fill('accepted'));
  for (const id of 'abcdef') assert.equal(gw.state[id].sent.length, 1, `account ${id} sent one`);
  const perLead = get(t.db, 'SELECT MAX(c) AS most FROM (SELECT COUNT(*) AS c FROM messages GROUP BY lead_id)');
  assert.equal(perLead.most, 1);
});

test('one disconnected account among six does not stop the others', async () => {
  const gw = fakeGateways();
  gw.state.c.connected = false;
  const t = makeCtx({ fetch: gw.handler, env: { ACCOUNT_COUNT: '6', WARMUP_START: '75' } });
  setSetting(t.db, 'send_paused', '0');
  for (let i = 0; i < 6; i++) insertLead(t.db, { phone: `23480300000${10 + i}` });
  const results = Object.fromEntries((await new Sender(t.ctx).tick()).map((r) => [r.account, r.result]));
  assert.equal(results.c, 'disconnected');
  assert.deepEqual(['a', 'b', 'd', 'e', 'f'].map((id) => results[id]), Array(5).fill('accepted'));
});

test('webhooks work for accounts c-f with their own secrets, and not for inactive accounts', async () => {
  const gw = fakeGateways();
  const t = makeCtx({ fetch: gw.handler, env: { ACCOUNT_COUNT: '5' } });
  const server = createServer(t.ctx);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, headers) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id: 'x', from: '1@lid' }) });
  try {
    assert.equal((await post('/hooks/inbound/e', { 'x-helios-key': 'k'.repeat(32) })).status, 200); // e's inbound secret
    assert.equal((await post('/hooks/inbound/e', { 'x-helios-key': 'j'.repeat(32) })).status, 401); // c's secret
    assert.equal((await post('/hooks/inbound/f', { 'x-helios-key': 'K'.repeat(32) })).status, 404); // f not active with count 5
    assert.equal((await post('/hooks/inbound/g', {})).status, 404);
    const overview = await fetch(`${base}/api/overview`, { headers: { authorization: `Bearer ${t.cfg.dashboardToken}` } }).then((r) => r.json());
    assert.deepEqual(overview.accounts.map((a) => a.id), ['a', 'b', 'c', 'd', 'e']);
  } finally { server.close(); }
});
