// Manual sales pipeline for each lead (cold calls, meetings), separate from the automatic WhatsApp "stage".
// Every change is kept in lead_events so the history of calls and bookings is never lost.
import { all, get, run, tx } from './db.js';

/**
 * needsTime: a date/time is required (call back, meeting).
 * stopsAuto: once set, the WhatsApp automation stops messaging this lead (they are being handled by hand).
 */
export const STATUSES = {
  called: { label: 'Cold called', needsTime: false, stopsAuto: false },
  no_answer: { label: 'No answer', needsTime: false, stopsAuto: false },
  interested: { label: 'Interested', needsTime: false, stopsAuto: true },
  callback: { label: 'Call back', needsTime: true, stopsAuto: true },
  meeting_booked: { label: 'Meeting booked', needsTime: true, stopsAuto: true },
  proposal_sent: { label: 'Proposal sent', needsTime: false, stopsAuto: true },
  won: { label: 'Won', needsTime: false, stopsAuto: true },
  not_interested: { label: 'Not interested', needsTime: false, stopsAuto: true },
  lost: { label: 'Lost', needsTime: false, stopsAuto: true },
  wrong_number: { label: 'Wrong number', needsTime: false, stopsAuto: true },
  do_not_contact: { label: 'Do not contact', needsTime: false, stopsAuto: true },
};

export class PipelineError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const MIN_TIME = Date.UTC(2020, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

/** Set a lead's pipeline status. `at` is epoch milliseconds, required for call backs and meetings. */
export function setPipelineStatus(ctx, leadId, { status, at, note }) {
  const def = STATUSES[status];
  if (!def) throw new PipelineError('invalid_status');
  let when = null;
  if (def.needsTime) {
    when = Number(at);
    if (!Number.isFinite(when) || when < MIN_TIME || when > MAX_TIME) throw new PipelineError('time_required');
  }
  const text = String(note ?? '').trim().slice(0, 1000);
  const now = ctx.now();
  return tx(ctx.db, () => {
    const lead = get(ctx.db, 'SELECT id, stage FROM leads WHERE id = ?', leadId);
    if (!lead) throw new PipelineError('not_found');
    run(ctx.db, `UPDATE leads SET pipeline_status = ?, pipeline_at = ?, pipeline_note = ?, pipeline_updated_at = ? WHERE id = ?`,
      status, when, text || null, now, leadId);
    run(ctx.db, 'INSERT INTO lead_events(lead_id, status, scheduled_at, note, created_at) VALUES(?, ?, ?, ?, ?)', leadId, status, when, text || null, now);
    // Stop the WhatsApp automation for leads now being handled by hand. In-flight sends, replied and
    // opted-out leads are left exactly as they are.
    if (status === 'do_not_contact' && lead.stage !== 'opted_out') {
      run(ctx.db, `UPDATE leads SET stage = 'opted_out', opted_out_at = COALESCE(opted_out_at, ?), next_followup_at = NULL WHERE id = ? AND stage != 'contacting'`, now, leadId);
    } else if (def.stopsAuto && ['new', 'contacted', 'banked', 'other_niche'].includes(lead.stage)) {
      run(ctx.db, `UPDATE leads SET stage = 'closed', next_followup_at = NULL WHERE id = ?`, leadId);
    }
    return { ok: true };
  });
}

export const listEvents = (ctx, leadId) => all(ctx.db,
  'SELECT id, status, scheduled_at, note, created_at FROM lead_events WHERE lead_id = ? ORDER BY id DESC LIMIT 100', leadId);

/** Counts per status plus the call backs / meetings that are coming up (or overdue), soonest first. */
export function pipelineSummary(ctx) {
  const counts = Object.fromEntries(all(ctx.db, `SELECT pipeline_status AS s, COUNT(*) AS n FROM leads WHERE pipeline_status IS NOT NULL GROUP BY 1`).map((r) => [r.s, r.n]));
  const upcoming = all(ctx.db, `SELECT id, name, city, phone, pipeline_status AS status, pipeline_at AS at, pipeline_note AS note FROM leads
    WHERE pipeline_status IN ('callback', 'meeting_booked') AND pipeline_at IS NOT NULL ORDER BY pipeline_at ASC LIMIT 30`);
  const now = ctx.now();
  return { counts, upcoming: upcoming.map((u) => ({ ...u, overdue: u.at < now })) };
}
