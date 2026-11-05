import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get, run, all } from '../src/db.js';
import { listEvents, pipelineSummary, PipelineError, setPipelineStatus } from '../src/pipeline.js';

function setup(stage = 'new') {
  const db = openDb(':memory:');
  run(db, `INSERT INTO leads(place_id, name, city, phone, phone_type, stage, discovery_day, discovered_at) VALUES('p1', 'Acme Solar', 'Lagos', '2348031234567', 'mobile', ?, '2026-11-05', 1)`, stage);
  const ctx = { db, now: () => Date.UTC(2026, 10, 5, 12) };
  return { ctx, id: get(db, 'SELECT id FROM leads').id };
}

test('cold called keeps WhatsApp automation running', () => {
  const { ctx, id } = setup();
  setPipelineStatus(ctx, id, { status: 'called', note: 'spoke to receptionist' });
  const lead = get(ctx.db, 'SELECT stage, pipeline_status, pipeline_note FROM leads WHERE id = ?', id);
  assert.equal(lead.stage, 'new');
  assert.equal(lead.pipeline_status, 'called');
  assert.equal(lead.pipeline_note, 'spoke to receptionist');
});

test('meeting booked and call back require a time', () => {
  const { ctx, id } = setup();
  for (const status of ['meeting_booked', 'callback']) {
    assert.throws(() => setPipelineStatus(ctx, id, { status }), (e) => e instanceof PipelineError && e.code === 'time_required');
    assert.throws(() => setPipelineStatus(ctx, id, { status, at: 'soon' }), PipelineError);
  }
  assert.throws(() => setPipelineStatus(ctx, id, { status: 'nonsense' }), (e) => e.code === 'invalid_status');
  assert.throws(() => setPipelineStatus(ctx, 9999, { status: 'called' }), (e) => e.code === 'not_found');
});

test('a booked meeting stops automatic messages and is kept in history and the summary', () => {
  const { ctx, id } = setup('contacted');
  const at = Date.UTC(2026, 10, 6, 13);
  setPipelineStatus(ctx, id, { status: 'called' });
  setPipelineStatus(ctx, id, { status: 'meeting_booked', at, note: 'Zoom' });
  const lead = get(ctx.db, 'SELECT stage, pipeline_status, pipeline_at, next_followup_at FROM leads WHERE id = ?', id);
  assert.equal(lead.stage, 'closed');
  assert.equal(lead.pipeline_at, at);
  assert.equal(lead.next_followup_at, null);
  assert.deepEqual(listEvents(ctx, id).map((e) => e.status), ['meeting_booked', 'called']);
  const summary = pipelineSummary(ctx);
  assert.equal(summary.counts.meeting_booked, 1);
  assert.equal(summary.upcoming[0].overdue, false);
});

test('past call backs are flagged overdue; times are cleared for statuses without one', () => {
  const { ctx, id } = setup();
  setPipelineStatus(ctx, id, { status: 'callback', at: Date.UTC(2026, 10, 4, 9) });
  assert.equal(pipelineSummary(ctx).upcoming[0].overdue, true);
  setPipelineStatus(ctx, id, { status: 'not_interested', at: Date.UTC(2026, 10, 9) });
  assert.equal(get(ctx.db, 'SELECT pipeline_at FROM leads WHERE id = ?', id).pipeline_at, null);
  assert.equal(pipelineSummary(ctx).upcoming.length, 0);
});

test('do not contact opts the lead out, but never touches an in-flight send', () => {
  const a = setup();
  setPipelineStatus(a.ctx, a.id, { status: 'do_not_contact' });
  const lead = get(a.ctx.db, 'SELECT stage, opted_out_at FROM leads WHERE id = ?', a.id);
  assert.equal(lead.stage, 'opted_out');
  assert.ok(lead.opted_out_at);
  const b = setup('contacting');
  setPipelineStatus(b.ctx, b.id, { status: 'interested' });
  assert.equal(get(b.ctx.db, 'SELECT stage FROM leads WHERE id = ?', b.id).stage, 'contacting');
});
