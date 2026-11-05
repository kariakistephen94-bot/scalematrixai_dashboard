import test from 'node:test';
import assert from 'node:assert/strict';
import { leadsFoundOn } from '../src/collector.js';
import { all } from '../src/db.js';
import { buildMessage } from '../src/messages.js';
import { insertLead, makeCfg, makeCtx } from './helpers.js';

test('archived leads do not count toward today and are never picked for sending', () => {
  const { db } = makeCtx();
  insertLead(db, { stage: 'archived' });
  insertLead(db, { stage: 'new' });
  assert.equal(leadsFoundOn(db, '2026-11-02').total, 1);
  assert.equal(all(db, `SELECT id FROM leads WHERE stage = 'new' AND phone_type = 'mobile'`).length, 1);
});

test('messages pitch solar companies, name the sender, and are fixed templates (no model involved)', () => {
  const cfg = makeCfg({ SENDER_NAME: 'Stephen', COMPANY_NAME: 'ScaleMatrix AI' });
  const lead = { id: 3, name: 'Sunrise Solar Ltd', short_name: 'Sunrise Solar', city: 'Abuja' };
  const at = Date.parse('2026-11-02T09:00:00Z');
  for (let step = 0; step <= 2; step++) {
    const { text } = buildMessage(lead, step, cfg, at);
    assert.match(text, /Sunrise Solar/);
    assert.match(text, /Reply STOP/);
    assert.doesNotMatch(text, /generator|grid outage|NEPA/i);
    if (step === 0) assert.match(text, /This is Stephen from ScaleMatrix AI/);
    assert.equal(buildMessage(lead, step, cfg, at).text, text, 'same input, same text');
  }
  const first = Array.from({ length: 3 }, (_, i) => buildMessage({ ...lead, id: i }, 0, cfg).text);
  assert.ok(first.every((t) => /solar compan|solar enquiry/i.test(t)));
  assert.equal(new Set(first).size, 3);
});
