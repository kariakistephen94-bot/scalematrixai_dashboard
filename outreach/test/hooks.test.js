import test from 'node:test';
import assert from 'node:assert/strict';
import { get, run } from '../src/db.js';
import { applyInbound, applyStatusEvent } from '../src/hooks.js';
import { isStopMessage } from '../src/messages.js';
import { jidToPhone, normalizeNgPhone } from '../src/phone.js';
import { insertLead, makeCtx, statusEvent } from './helpers.js';

function withMessage(status = 'accepted') {
  const t = makeCtx();
  const lead = insertLead(t.db, { phone: '2348030000001', stage: 'contacted', first_contacted_at: t.clock.t });
  run(t.db, `INSERT INTO messages(lead_id, account, step, body, status, gateway_message_id, created_at) VALUES(?, 'a', 0, 'hi', ?, 'WAMSG00000001', ?)`, lead.id, status, t.clock.t);
  return { ...t, lead };
}
const state = (db) => get(db, 'SELECT * FROM messages');

test('receipts move a message forward: sent, delivered, read', () => {
  const { ctx, db } = withMessage();
  assert.equal(applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'sent')).applied, 'sent');
  assert.equal(applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'delivered')).applied, 'delivered');
  assert.equal(applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'read')).applied, 'read');
  const m = state(db);
  assert.equal(m.status, 'read');
  assert.ok(m.sent_at && m.delivered_at && m.read_at);
});

test('duplicate and out-of-order receipts never move a message backwards', () => {
  const { ctx, db } = withMessage();
  applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'read'));
  const dup = applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'read'));
  assert.equal(dup.duplicate, true);
  assert.equal(applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'delivered')).ignored, true);
  assert.equal(state(db).status, 'read');
});

test('failed never overrides delivered, but delivered overrides failed', () => {
  const a = withMessage('delivered');
  assert.equal(applyStatusEvent(a.ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'failed')).ignored, true);
  assert.equal(state(a.db).status, 'delivered');

  const b = withMessage('accepted');
  assert.equal(applyStatusEvent(b.ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'failed')).applied, 'failed');
  assert.equal(state(b.db).status, 'failed');
  assert.equal(applyStatusEvent(b.ctx, 'a', statusEvent('2348100000001', 'WAMSG00000001', 'delivered')).applied, 'delivered');
  assert.equal(state(b.db).status, 'delivered');
});

test('forged or malformed receipts are rejected; unknown message ids are accepted and dropped', () => {
  const { ctx } = withMessage();
  const ev = statusEvent('2348100000001', 'WAMSG00000001', 'read');
  assert.equal(applyStatusEvent(ctx, 'a', { ...ev, status: 'delivered' }).error, 'event_id_mismatch');
  assert.equal(applyStatusEvent(ctx, 'a', { nonsense: true }).error, 'invalid_event');
  assert.equal(applyStatusEvent(ctx, 'a', statusEvent('2348100000001', 'SOMETHING-ELSE', 'sent')).unknown, true);
  // a receipt for account a's message arriving on account b's hook must not touch it
  assert.equal(applyStatusEvent(ctx, 'b', statusEvent('2348100000002', 'WAMSG00000001', 'read')).unknown, true);
});

test('a reply from a contacted business marks the lead replied and stops follow-ups', () => {
  const { ctx, db, lead } = withMessage();
  run(db, 'UPDATE leads SET next_followup_at = 123 WHERE id = ?', lead.id);
  const r = applyInbound(ctx, 'a', { id: 'IN1', from: '2348030000001@s.whatsapp.net', text: 'Yes, call me', timestamp: 1_800_000_000 });
  assert.equal(r.stored, true);
  const l = get(db, 'SELECT * FROM leads WHERE id = ?', lead.id);
  assert.equal(l.stage, 'replied');
  assert.ok(l.replied_at);
  assert.equal(l.next_followup_at, null);
  assert.equal(applyInbound(ctx, 'a', { id: 'IN1', from: '2348030000001@s.whatsapp.net', text: 'Yes, call me' }).duplicate, true);
});

test('STOP opts the lead out and is not counted as a reply', () => {
  const { ctx, db, lead } = withMessage();
  assert.equal(applyInbound(ctx, 'a', { id: 'IN2', from: '2348030000001@s.whatsapp.net', text: 'STOP' }).stop, true);
  const l = get(db, 'SELECT * FROM leads WHERE id = ?', lead.id);
  assert.equal(l.stage, 'opted_out');
  assert.equal(l.replied_at, null);
  assert.ok(l.opted_out_at);
});

test('messages from people who are not leads, groups and unresolved ids are discarded, not stored', () => {
  const { ctx, db } = withMessage();
  assert.equal(applyInbound(ctx, 'a', { id: 'X1', from: '2348099999999@s.whatsapp.net', text: 'hi mum' }).ignored, 'not_a_lead');
  assert.equal(applyInbound(ctx, 'a', { id: 'X2', from: '1203630@g.us', text: 'group' }).ignored, 'unresolved_or_group');
  assert.equal(applyInbound(ctx, 'a', { id: 'X3', from: '9988@lid', text: 'x' }).ignored, 'unresolved_or_group');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM replies').n, 0);
});

test('a lead we have not messaged yet cannot become "replied"', () => {
  const t = makeCtx();
  insertLead(t.db, { phone: '2348030000009', stage: 'new' });
  assert.equal(applyInbound(t.ctx, 'a', { id: 'Z', from: '2348030000009@s.whatsapp.net', text: 'hello' }).ignored, 'not_a_lead');
});

test('stop-phrase detection is whole-message and conservative about false positives', () => {
  for (const s of ['STOP', 'stop.', ' Stop ', 'unsubscribe', 'Opt out', 'remove me', 'No more messages', "don't message me", 'Do not contact me', 'please stop', 'Stop messaging me']) {
    assert.equal(isStopMessage(s), true, s);
  }
  for (const s of ['Please do not stop the offer', 'Bus stop is near our shop', 'what is the price?', 'ok', null]) {
    assert.equal(isStopMessage(s), false, String(s));
  }
});

test('Nigerian phone numbers are classified', () => {
  assert.deepEqual(normalizeNgPhone('+234 803 123 4567'), { phone: '2348031234567', type: 'mobile' });
  assert.deepEqual(normalizeNgPhone('0803 123 4567'), { phone: '2348031234567', type: 'mobile' });
  assert.deepEqual(normalizeNgPhone('+234 903 123 4567'), { phone: '2349031234567', type: 'mobile' });
  assert.deepEqual(normalizeNgPhone('+234 1 234 5678'), { phone: '23412345678', type: 'landline' });
  assert.equal(normalizeNgPhone('+44 20 7946 0958').type, 'foreign');
  assert.equal(normalizeNgPhone('').type, 'none');
  assert.equal(normalizeNgPhone(undefined).type, 'none');
  assert.equal(jidToPhone('2348031234567@s.whatsapp.net'), '2348031234567');
  assert.equal(jidToPhone('2348031234567:12@s.whatsapp.net'), '2348031234567');
  assert.equal(jidToPhone('123@lid'), null);
});
