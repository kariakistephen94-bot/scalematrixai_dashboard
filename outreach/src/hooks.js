// Webhook handlers for the gateways: delivery/read receipts and inbound replies.
import crypto from 'node:crypto';
import { get, logActivity, run, tx } from './db.js';
import { isStopMessage } from './messages.js';
import { jidToPhone } from './phone.js';

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const RANK = { reserved: 0, failed: 0, uncertain: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };
const STATUS_COLUMN = { sent: 'sent_at', delivered: 'delivered_at', read: 'read_at' };

/**
 * Apply one gateway receipt (event shape: whatsapp-gateway/docs/status-webhook.md).
 * Idempotent on event_id; never moves a message backwards; `failed` never overrides delivered/read;
 * a delivered/read receipt after a failure wins because a receipt is proof of delivery.
 */
export function applyStatusEvent(ctx, accountId, ev) {
  const { db } = ctx;
  if (!ev || typeof ev !== 'object' || ev.event !== 'message_status'
    || !/^gwevt_[a-f0-9]{32}$/.test(String(ev.event_id))
    || !['sent', 'delivered', 'read', 'failed'].includes(ev.status)
    || typeof ev.message_id !== 'string' || !ev.message_id) return { ok: false, error: 'invalid_event' };
  const expected = `gwevt_${crypto.createHash('sha256').update(`${ev.sender}:${ev.message_id}:${ev.status}`).digest('hex').slice(0, 32)}`;
  if (expected !== ev.event_id) return { ok: false, error: 'event_id_mismatch' };

  const at = Date.parse(ev.occurred_at);
  const when = Number.isFinite(at) ? Math.min(at, ctx.now()) : ctx.now();
  return tx(db, () => {
    if (run(db, 'INSERT OR IGNORE INTO status_events(event_id, received_at) VALUES(?, ?)', ev.event_id, ctx.now()).changes === 0) {
      return { ok: true, duplicate: true };
    }
    const msg = get(db, 'SELECT id, status FROM messages WHERE account = ? AND gateway_message_id = ?', accountId, ev.message_id);
    if (!msg) return { ok: true, unknown: true };
    if (ev.status === 'failed') {
      if (RANK[msg.status] >= RANK.delivered || msg.status === 'failed') return { ok: true, ignored: true };
      run(db, `UPDATE messages SET status = 'failed', failed_at = ?, error = 'WhatsApp rejected the message' WHERE id = ?`, when, msg.id);
      return { ok: true, applied: 'failed' };
    }
    if (RANK[ev.status] <= RANK[msg.status]) return { ok: true, ignored: true };
    const column = STATUS_COLUMN[ev.status];
    run(db, `UPDATE messages SET status = ?, ${column} = COALESCE(${column}, ?), error = NULL WHERE id = ?`, ev.status, when, msg.id);
    return { ok: true, applied: ev.status };
  });
}

/**
 * Handle one inbound WhatsApp message from a gateway. Only replies from businesses we have messaged are
 * kept; everything else (family chats, groups, unknown numbers) is discarded without being stored.
 */
export function applyInbound(ctx, accountId, m) {
  const { db } = ctx;
  if (!m || typeof m !== 'object') return { ok: false, error: 'invalid_message' };
  const phone = jidToPhone(m.from);
  if (!phone) return { ok: true, ignored: 'unresolved_or_group' };
  const lead = get(db, `SELECT id, stage FROM leads WHERE phone = ? AND first_contacted_at IS NOT NULL`, phone);
  if (!lead) return { ok: true, ignored: 'not_a_lead' };

  const text = typeof m.text === 'string' ? m.text.slice(0, 2000) : null;
  const stop = isStopMessage(text);
  const at = m.timestamp ? m.timestamp * 1000 : ctx.now();
  return tx(db, () => {
    const inserted = run(db, `INSERT OR IGNORE INTO replies(lead_id, account, gateway_message_id, text, received_at, is_stop) VALUES(?, ?, ?, ?, ?, ?)`,
      lead.id, accountId, m.id ? String(m.id) : null, text, at, stop ? 1 : 0);
    if (inserted.changes === 0) return { ok: true, duplicate: true };
    if (stop) {
      run(db, `UPDATE leads SET stage = 'opted_out', opted_out_at = COALESCE(opted_out_at, ?), next_followup_at = NULL WHERE id = ?`, at, lead.id);
      logActivity(db, 'reply', `Opt-out received from lead #${lead.id}`, ctx.now());
    } else if (lead.stage === 'contacted' || lead.stage === 'contacting') {
      run(db, `UPDATE leads SET stage = 'replied', replied_at = COALESCE(replied_at, ?), next_followup_at = NULL WHERE id = ?`, at, lead.id);
      logActivity(db, 'reply', `Reply received from lead #${lead.id}`, ctx.now());
    }
    return { ok: true, stored: true, stop };
  });
}
