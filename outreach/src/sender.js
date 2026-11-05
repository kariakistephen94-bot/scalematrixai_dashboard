// Paced sending across WhatsApp accounts. Each account independently: connected, inside the Lagos sending
// window, under today's (warm-up) cap, and past its randomised gap since the last send.
import { all, get, getSetting, logActivity, run, setSetting, tx } from './db.js';
import { buildMessage } from './messages.js';
import { DAY, dayNumber, lagosDay, lagosDayStart, windowState } from './time.js';

const STUCK_RESERVATION_MS = 3 * 60_000;
const key = (account, name) => `acct:${account}:${name}`;

export const isSendingPaused = (db) => getSetting(db, 'send_paused', '1') === '1';
export const isAccountPaused = (db, id) => getSetting(db, key(id, 'paused'), '0') === '1';

/** Warm-up: first active day sends WARMUP_START, each later day adds WARMUP_STEP, never above the cap. */
export function dailyCap(db, cfg, accountId, day) {
  const first = getSetting(db, key(accountId, 'first_send_day'), null);
  const daysActive = first ? Math.max(0, dayNumber(day) - dayNumber(first)) : 0;
  return Math.min(cfg.dailyCapPerAccount, cfg.warmupStart + cfg.warmupStep * daysActive);
}

export function sentToday(db, accountId, day, now = Date.now()) {
  const start = lagosDayStart(day);
  return get(db, `SELECT COUNT(*) AS n FROM messages WHERE account = ? AND created_at >= ? AND created_at < ? AND status != 'failed'`,
    accountId, start, start + DAY).n;
}

/**
 * Delay before this account's next send. The remaining window is divided by the remaining cap, then
 * randomised to 0.5x-1.5x and clamped, so sends are spread over the day at irregular intervals.
 */
export function nextGapMs(cfg, remainingCap, secondsLeft, rand = Math.random) {
  const even = remainingCap > 0 ? secondsLeft / remainingCap : cfg.gapMaxSeconds;
  const base = Math.min(cfg.gapMaxSeconds, Math.max(cfg.gapMinSeconds, even));
  const jittered = Math.min(cfg.gapMaxSeconds, Math.max(cfg.gapMinSeconds, base * (0.5 + rand())));
  return Math.round(jittered * 1000);
}

export class Sender {
  constructor(ctx) {
    this.ctx = ctx;
    this.busy = false;
  }

  /** A send that was reserved but never resolved (process died mid-send) may have gone out: mark uncertain, never retry. */
  recoverStuck() {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const stuck = all(db, `SELECT id, lead_id FROM messages WHERE status = 'reserved' AND created_at < ?`, now - STUCK_RESERVATION_MS);
    for (const m of stuck) {
      tx(db, () => {
        run(db, `UPDATE messages SET status = 'uncertain', error = 'Interrupted before the gateway answered' WHERE id = ?`, m.id);
        run(db, `UPDATE leads SET stage = 'contacted', first_contacted_at = COALESCE(first_contacted_at, ?), last_contacted_at = ? WHERE id = ? AND stage = 'contacting'`, now, now, m.lead_id);
      });
    }
    return stuck.length;
  }

  nextJob(accountId, now) {
    const { db } = this.ctx;
    const followUp = get(db, `SELECT * FROM leads WHERE stage = 'contacted' AND assigned_account = ?
      AND next_followup_at IS NOT NULL AND next_followup_at <= ? ORDER BY next_followup_at LIMIT 1`, accountId, now);
    if (followUp) return { lead: followUp, step: followUp.followups_sent + 1 };
    const fresh = get(db, `SELECT * FROM leads WHERE stage = 'new' AND phone_type = 'mobile' AND phone IS NOT NULL
      ORDER BY discovery_day, review_count DESC, id LIMIT 1`);
    return fresh ? { lead: fresh, step: 0 } : null;
  }

  /** One scheduling pass over all accounts. Safe to call often. */
  async tick() {
    if (this.busy) return [];
    this.busy = true;
    const results = [];
    try {
      this.recoverStuck();
      for (const account of this.ctx.cfg.accounts) results.push({ account: account.id, result: await this.tickAccount(account) });
    } finally {
      this.busy = false;
    }
    return results;
  }

  async tickAccount(account) {
    const { db, cfg } = this.ctx;
    const now = this.ctx.now();
    if (isSendingPaused(db)) return 'paused';
    if (isAccountPaused(db, account.id)) return 'account_paused';
    const win = windowState(now, cfg);
    if (!win.open) return 'outside_window';
    if (now < Number(getSetting(db, key(account.id, 'next_send_at'), 0))) return 'waiting';

    const gateway = this.ctx.gateways[account.id];
    const gwStatus = await gateway.status();
    this.ctx.accountStatus[account.id] = { ...gwStatus, at: now };
    if (!gwStatus.connected) return 'disconnected';

    const day = lagosDay(now);
    const cap = dailyCap(db, cfg, account.id, day);
    const used = sentToday(db, account.id, day);
    if (used >= cap) return 'cap_reached';

    const job = this.nextJob(account.id, now);
    if (!job) return 'idle';
    return this.sendOne(account, gateway, job, { cap, used, win, day });
  }

  async sendOne(account, gateway, { lead, step }, { cap, used, win, day }) {
    const { db, cfg } = this.ctx;
    const now = this.ctx.now();
    const { text, template } = buildMessage(lead, step, cfg, now);

    // Reserve before sending, in one transaction, so a lead can never be picked twice.
    const messageId = tx(db, () => {
      const fresh = get(db, 'SELECT stage FROM leads WHERE id = ?', lead.id);
      const expected = step === 0 ? 'new' : 'contacted';
      if (fresh.stage !== expected) return null;
      const id = run(db, `INSERT INTO messages(lead_id, account, step, template, body, status, created_at) VALUES(?, ?, ?, ?, ?, 'reserved', ?)`,
        lead.id, account.id, step, template, text, now).lastInsertRowid;
      run(db, `UPDATE leads SET stage = 'contacting', assigned_account = COALESCE(assigned_account, ?) WHERE id = ?`, account.id, lead.id);
      return Number(id);
    });
    if (messageId === null) return 'lead_changed';

    const outcome = await gateway.send(lead.phone, text);
    const after = this.ctx.now();
    tx(db, () => {
      if (outcome.outcome === 'accepted') {
        run(db, `UPDATE messages SET status = 'accepted', gateway_message_id = ?, accepted_at = ? WHERE id = ?`, outcome.id, after, messageId);
        this.#markContacted(lead, step, after);
        if (step === 0 && lead.source_id) this.ctx.scraper.setStage(lead.source_id, 'contacted').catch(() => {});
        if (!getSetting(db, key(account.id, 'first_send_day'), null)) setSetting(db, key(account.id, 'first_send_day'), day);
      } else if (outcome.outcome === 'uncertain') {
        run(db, `UPDATE messages SET status = 'uncertain', error = ? WHERE id = ?`, outcome.error, messageId);
        this.#markContacted(lead, step, after, { followUps: false });
      } else {
        run(db, `UPDATE messages SET status = 'failed', error = ?, failed_at = ? WHERE id = ?`, outcome.error, after, messageId);
        // Back to where it was; a lead that fails twice is parked instead of retried forever.
        const failures = lead.send_failures + 1;
        const resume = step === 0 ? (failures >= 2 ? 'send_failed' : 'new') : 'contacted';
        run(db, `UPDATE leads SET stage = ?, send_failures = ? WHERE id = ?`, resume, failures, lead.id);
        if (step === 0 && failures < 2) run(db, 'UPDATE leads SET assigned_account = NULL WHERE id = ?', lead.id);
      }
    });

    const remaining = Math.max(0, cap - (used + (outcome.outcome === 'failed' ? 0 : 1)));
    let gap = nextGapMs(cfg, remaining, win.secondsLeft, this.ctx.random);
    // A longer breather every 8-14 sends, as a person would take.
    const sinceBreak = Number(getSetting(db, key(account.id, 'since_break'), 0)) + 1;
    const breakEvery = Number(getSetting(db, key(account.id, 'break_every'), 0)) || 8 + Math.floor(this.ctx.random() * 7);
    if (sinceBreak >= breakEvery) {
      gap += Math.round((10 + this.ctx.random() * 15) * 60_000);
      setSetting(db, key(account.id, 'since_break'), 0);
      setSetting(db, key(account.id, 'break_every'), 8 + Math.floor(this.ctx.random() * 7));
    } else {
      setSetting(db, key(account.id, 'since_break'), sinceBreak);
      setSetting(db, key(account.id, 'break_every'), breakEvery);
    }
    setSetting(db, key(account.id, 'next_send_at'), after + gap);
    logActivity(db, 'send', `${account.label} -> ${lead.name} (${step === 0 ? 'first message' : `follow-up ${step}`}): ${outcome.outcome}${outcome.error ? ` (${outcome.error})` : ''}`, after);
    return outcome.outcome;
  }

  #markContacted(lead, step, at, { followUps = true } = {}) {
    const { db, cfg } = this.ctx;
    const first = lead.first_contacted_at ?? at;
    const dueDays = followUps ? cfg.followupDays[step] : undefined; // followupDays[0] is the offset for follow-up 1
    run(db, `UPDATE leads SET stage = 'contacted', first_contacted_at = ?, last_contacted_at = ?, followups_sent = ?, next_followup_at = ? WHERE id = ?`,
      first, at, step, dueDays === undefined ? null : first + dueDays * DAY, lead.id);
  }
}
