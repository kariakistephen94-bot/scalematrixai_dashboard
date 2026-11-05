import test from 'node:test';
import assert from 'node:assert/strict';
import { all, get, getSetting, run, setSetting } from '../src/db.js';
import { dailyCap, nextGapMs, Sender } from '../src/sender.js';
import { fakeGateways, insertLead, makeCtx, MONDAY_10AM } from './helpers.js';

function setup(env = {}, leads = 3) {
  const gw = fakeGateways();
  const t = makeCtx({ fetch: gw.handler, env: { WARMUP_START: '75', ...env } });
  t.sender = new Sender(t.ctx);
  t.gw = gw;
  t.leads = Array.from({ length: leads }, () => insertLead(t.db));
  setSetting(t.db, 'send_paused', '0');
  return t;
}
const results = (r) => Object.fromEntries(r.map((x) => [x.account, x.result]));

test('sending starts paused until resumed', async () => {
  const t = setup();
  setSetting(t.db, 'send_paused', '1');
  assert.deepEqual(results(await t.sender.tick()), { a: 'paused', b: 'paused' });
  assert.equal(get(t.db, 'SELECT COUNT(*) AS n FROM messages').n, 0);
});

test('each account sends one message, then waits a randomised gap', async () => {
  const t = setup();
  const r = results(await t.sender.tick());
  assert.deepEqual(r, { a: 'accepted', b: 'accepted' });
  assert.equal(get(t.db, `SELECT COUNT(*) AS n FROM leads WHERE stage = 'contacted'`).n, 2);
  assert.deepEqual(results(await t.sender.tick()), { a: 'waiting', b: 'waiting' });
  const next = Number(getSetting(t.db, 'acct:a:next_send_at'));
  assert.ok(next - t.clock.t >= 60_000 && next - t.clock.t <= 900_000 + 25 * 60_000, 'gap within bounds (plus an occasional breather)');
});

test('gaps vary with the jitter and always stay within the configured bounds', () => {
  const cfg = t0().cfg;
  const lows = nextGapMs(cfg, 70, 30000, () => 0);
  const highs = nextGapMs(cfg, 70, 30000, () => 0.999);
  assert.ok(lows < highs);
  for (const r of [0, 0.3, 0.7, 0.999]) {
    const ms = nextGapMs(cfg, 70, 30000, () => r);
    assert.ok(ms >= cfg.gapMinSeconds * 1000 && ms <= cfg.gapMaxSeconds * 1000);
  }
  assert.equal(nextGapMs(cfg, 0, 100, () => 0.5), cfg.gapMaxSeconds * 1000); // no cap left: clamps to the max gap
});
function t0() { return makeCtx(); }

test('never contacts the same lead twice and uses both accounts', async () => {
  const t = setup({}, 6);
  for (let i = 0; i < 12; i++) {
    await t.sender.tick();
    t.clock.t += 40 * 60_000;
    if (t.clock.t > MONDAY_10AM + 7 * 3600_000) break;
  }
  const counts = all(t.db, 'SELECT lead_id, COUNT(*) AS n FROM messages WHERE step = 0 GROUP BY lead_id');
  assert.equal(counts.length, 6);
  assert.ok(counts.every((c) => c.n === 1));
  assert.ok(t.gw.state.a.sent.length > 0 && t.gw.state.b.sent.length > 0);
});

test('does not send outside the Lagos window or on Sundays', async () => {
  const t = setup();
  t.clock.t = Date.parse('2026-11-02T20:00:00Z'); // 21:00 Lagos
  assert.deepEqual(results(await t.sender.tick()), { a: 'outside_window', b: 'outside_window' });
  t.clock.t = Date.parse('2026-11-01T10:00:00Z'); // Sunday
  assert.deepEqual(results(await t.sender.tick()), { a: 'outside_window', b: 'outside_window' });
});

test('respects the warm-up cap per account', async () => {
  const t = setup({ WARMUP_START: '2', WARMUP_STEP: '10', DAILY_CAP_PER_ACCOUNT: '75' }, 10);
  setSetting(t.db, 'acct:b:paused', '1');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(results(await t.sender.tick()).a);
    t.clock.t += 25 * 60_000;
  }
  assert.deepEqual(seen.filter((s) => s === 'accepted').length, 2);
  assert.ok(seen.includes('cap_reached'));
});

test('warm-up grows daily up to the configured cap', () => {
  const t = makeCtx({ env: { WARMUP_START: '25', WARMUP_STEP: '10', DAILY_CAP_PER_ACCOUNT: '75' } });
  assert.equal(dailyCap(t.db, t.cfg, 'a', '2026-11-02'), 25);
  setSetting(t.db, 'acct:a:first_send_day', '2026-11-02');
  assert.equal(dailyCap(t.db, t.cfg, 'a', '2026-11-02'), 25);
  assert.equal(dailyCap(t.db, t.cfg, 'a', '2026-11-03'), 35);
  assert.equal(dailyCap(t.db, t.cfg, 'a', '2026-11-20'), 75);
});

test('a disconnected account does not send; the other still does', async () => {
  const t = setup();
  t.gw.state.a.connected = false;
  assert.deepEqual(results(await t.sender.tick()), { a: 'disconnected', b: 'accepted' });
});

test('a gateway error is recorded as failed and the lead is retried once, then parked', async () => {
  const t = setup({}, 1);
  setSetting(t.db, 'acct:b:paused', '1');
  t.gw.state.a.sendMode = 'error';
  assert.equal(results(await t.sender.tick()).a, 'failed');
  let lead = get(t.db, 'SELECT * FROM leads WHERE id = ?', t.leads[0].id);
  assert.equal(lead.stage, 'new');
  assert.equal(lead.send_failures, 1);
  t.clock.t += 20 * 60_000;
  assert.equal(results(await t.sender.tick()).a, 'failed');
  lead = get(t.db, 'SELECT * FROM leads WHERE id = ?', t.leads[0].id);
  assert.equal(lead.stage, 'send_failed');
  assert.equal(get(t.db, `SELECT COUNT(*) AS n FROM messages WHERE status = 'failed'`).n, 2);
});

test('no answer from the gateway is "uncertain" and is never retried or followed up', async () => {
  const t = setup({}, 1);
  setSetting(t.db, 'acct:b:paused', '1');
  t.gw.state.a.sendMode = 'throw';
  assert.equal(results(await t.sender.tick()).a, 'uncertain');
  const lead = get(t.db, 'SELECT * FROM leads WHERE id = ?', t.leads[0].id);
  assert.equal(lead.stage, 'contacted');
  assert.equal(lead.next_followup_at, null);
  assert.equal(get(t.db, 'SELECT status FROM messages').status, 'uncertain');
});

test('follow-ups go out from the same account after the configured days, and stop once the lead replies', async () => {
  const t = setup({ FOLLOWUP_DAYS: '3,7' }, 2);
  setSetting(t.db, 'acct:b:paused', '1');
  await t.sender.tick();
  await t.sender.tick(); // waiting
  t.clock.t += 2 * 24 * 3600_000;
  assert.equal(get(t.db, `SELECT COUNT(*) AS n FROM messages WHERE step = 1`).n, 0);

  // second lead is picked as a fresh contact before day 3
  t.clock.t = MONDAY_10AM + 3 * 24 * 3600_000 + 60_000; // Thursday 10:01
  await t.sender.tick();
  const first = t.leads[0].id;
  const step1 = get(t.db, 'SELECT * FROM messages WHERE lead_id = ? AND step = 1', first);
  assert.ok(step1, 'follow-up 1 sent to the first lead');
  assert.equal(step1.account, 'a');
  assert.match(step1.body, /following up|checking in/i);

  // reply cancels the remaining follow-up
  run(t.db, `UPDATE leads SET stage = 'replied', replied_at = ?, next_followup_at = NULL WHERE id = ?`, t.clock.t, first);
  t.clock.t = MONDAY_10AM + 8 * 24 * 3600_000; // following Tuesday
  await t.sender.tick();
  assert.equal(get(t.db, 'SELECT COUNT(*) AS n FROM messages WHERE lead_id = ? AND step = 2', first).n, 0);
});

test('opted-out leads are never contacted', async () => {
  const t = setup({}, 1);
  run(t.db, `UPDATE leads SET stage = 'opted_out'`);
  assert.deepEqual(results(await t.sender.tick()), { a: 'idle', b: 'idle' });
});

test('a send interrupted mid-flight is recovered as uncertain, not resent', async () => {
  const t = setup({}, 1);
  const lead = t.leads[0];
  run(t.db, `UPDATE leads SET stage = 'contacting', assigned_account = 'a' WHERE id = ?`, lead.id);
  run(t.db, `INSERT INTO messages(lead_id, account, step, body, status, created_at) VALUES(?, 'a', 0, 'x', 'reserved', ?)`, lead.id, t.clock.t - 10 * 60_000);
  assert.equal(t.sender.recoverStuck(), 1);
  assert.equal(get(t.db, 'SELECT status FROM messages').status, 'uncertain');
  assert.equal(get(t.db, 'SELECT stage FROM leads WHERE id = ?', lead.id).stage, 'contacted');
});

test('message text varies by lead, greets by time of day and includes an opt-out line', async () => {
  const t = setup({}, 3);
  setSetting(t.db, 'acct:b:paused', '1');
  for (let i = 0; i < 3; i++) { await t.sender.tick(); t.clock.t += 30 * 60_000; }
  const bodies = all(t.db, 'SELECT body, template FROM messages ORDER BY id');
  assert.equal(new Set(bodies.map((b) => b.template)).size, 3);
  assert.ok(bodies.every((b) => /Hello, good morning\./.test(b.body) && /Reply STOP/.test(b.body)));
});
