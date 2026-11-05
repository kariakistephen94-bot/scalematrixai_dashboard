// Read models for the dashboard.
import { all, get, getSetting } from './db.js';
import { collectorEnabled, leadsFoundOn, runsToday } from './collector.js';
import { dailyCap, isAccountPaused, isSendingPaused, sentToday } from './sender.js';
import { pipelineSummary } from './pipeline.js';
import { DAY, lagosDay, lagosDayStart, windowState } from './time.js';

export function rangeStart(range, now) {
  if (range === 'today') return lagosDayStart(lagosDay(now));
  if (range === '7d') return now - 7 * DAY;
  return 0;
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function overview(ctx, range = 'today') {
  const { db, cfg } = ctx;
  const now = ctx.now();
  const since = rangeStart(range, now);
  const day = lagosDay(now);

  const byStatus = Object.fromEntries(all(db, 'SELECT status, COUNT(*) AS n FROM messages WHERE created_at >= ? GROUP BY status', since).map((r) => [r.status, r.n]));
  const n = (s) => byStatus[s] || 0;
  const sent = n('accepted') + n('sent') + n('delivered') + n('read');
  const failed = n('failed');
  const contacted = get(db, 'SELECT COUNT(*) AS n FROM leads WHERE first_contacted_at >= ?', since).n;
  const repliedLeads = get(db, 'SELECT COUNT(*) AS n FROM leads WHERE first_contacted_at >= ? AND replied_at IS NOT NULL', since).n;
  const optedOut = get(db, 'SELECT COUNT(*) AS n FROM leads WHERE opted_out_at >= ?', since).n;

  const stages = Object.fromEntries(all(db, 'SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage').map((r) => [r.stage, r.n]));
  const found = leadsFoundOn(db, day);
  const abujaQuota = Math.round(cfg.dailyLeadTarget * cfg.abujaShare);

  const accounts = cfg.accounts.map((a) => {
    const st = ctx.accountStatus[a.id] || {};
    const cap = dailyCap(db, cfg, a.id, day);
    return {
      id: a.id, label: a.label,
      reachable: st.reachable ?? null, connected: st.connected === true, state: st.state || 'unknown',
      needsQr: st.needsQr === true, number: st.me?.id ? String(st.me.id).split(/[:@]/)[0] : null,
      paused: isAccountPaused(db, a.id),
      sentToday: sentToday(db, a.id, day), cap,
      nextSendAt: Number(getSetting(db, `acct:${a.id}:next_send_at`, 0)) || null,
    };
  });

  const last = JSON.parse(getSetting(db, 'collector_last', 'null') || 'null');
  const win = windowState(now, cfg);

  return {
    range, generatedAt: now,
    tiles: {
      sent, failed, sentPlusFailed: sent + failed, uncertain: n('uncertain'),
      delivered: n('delivered') + n('read'), read: n('read'),
      repliedLeads, contacted, replyConversion: contacted ? Math.round((repliedLeads / contacted) * 1000) / 10 : 0,
      optedOut,
    },
    leadsToday: { ...found, target: cfg.dailyLeadTarget, abujaQuota, lagosQuota: cfg.dailyLeadTarget - abujaQuota },
    pipeline: {
      ready: stages.new || 0, banked: stages.banked || 0, contacted: stages.contacted || 0, replied: stages.replied || 0,
      optedOut: stages.opted_out || 0, callOnly: stages.no_mobile || 0, sendFailed: stages.send_failed || 0,
      followupsDue: get(db, `SELECT COUNT(*) AS n FROM leads WHERE stage = 'contacted' AND next_followup_at IS NOT NULL AND next_followup_at <= ?`, now).n,
      total: Object.values(stages).reduce((a, b) => a + b, 0),
    },
    calls: pipelineSummary(ctx),
    byCity: all(db, `SELECT city, COUNT(*) AS leads, SUM(first_contacted_at IS NOT NULL) AS contacted, SUM(replied_at IS NOT NULL) AS replied
      FROM leads WHERE phone_type = 'mobile' GROUP BY city ORDER BY city`),
    accounts,
    sending: {
      paused: isSendingPaused(db), windowOpen: win.open,
      window: `${hhmm(cfg.sendWindow.start)}-${hhmm(cfg.sendWindow.end)}`, days: [...cfg.sendDays].sort(),
      followupDays: cfg.followupDays,
    },
    collector: {
      enabled: collectorEnabled(db, cfg), configured: Boolean(cfg.scraperToken), scanning: Boolean(ctx.scanning), last,
      runsToday: runsToday(db, day), runLimit: cfg.scraperMaxRunsPerDay,
      cooldownUntil: Number(getSetting(db, 'collector_cooldown_until', 0)) || null,
      minReviews: cfg.minReviewCount, minRating: cfg.minRating, allowAiResearch: cfg.allowAiResearch,
    },
  };
}

function leadFilter({ stage, city, q, pipeline } = {}) {
  const where = [];
  const params = [];
  // Archived leads (an earlier, non-solar batch, or ones the scraper rejected) only show when asked for.
  if (stage && stage !== 'all') { where.push('l.stage = ?'); params.push(stage); } else where.push("l.stage != 'archived'");
  if (city && city !== 'all') { where.push('l.city = ?'); params.push(city); }
  if (pipeline === 'any') where.push('l.pipeline_status IS NOT NULL');
  else if (pipeline === 'none') where.push('l.pipeline_status IS NULL');
  else if (pipeline && pipeline !== 'all') { where.push('l.pipeline_status = ?'); params.push(pipeline); }
  if (q) {
    where.push('(l.name LIKE ? OR l.area LIKE ? OR l.phone LIKE ? OR l.category LIKE ?)');
    const like = `%${String(q).replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listLeads(ctx, filters = {}, limit = 50, offset = 0) {
  const { sql, params } = leadFilter(filters);
  const total = get(ctx.db, `SELECT COUNT(*) AS n FROM leads l ${sql}`, ...params).n;
  const items = all(ctx.db, `SELECT l.id, l.name, l.city, l.area, l.category, l.phone, l.phone_type, l.website, l.rating, l.review_count,
      l.stage, l.discovery_day, l.assigned_account, l.followups_sent, l.first_contacted_at, l.last_contacted_at, l.replied_at, l.notes,
      l.pipeline_status, l.pipeline_at, l.pipeline_note, l.pipeline_updated_at,
      (SELECT status FROM messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS last_message_status
    FROM leads l ${sql} ORDER BY l.discovered_at DESC, l.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { total, items };
}

export function listReplies(ctx, range = 'all', limit = 100) {
  const since = rangeStart(range, ctx.now());
  return all(ctx.db, `SELECT r.id, r.received_at, r.text, r.is_stop, r.account, l.id AS lead_id, l.name, l.city, l.area, l.phone, l.stage
    FROM replies r JOIN leads l ON l.id = r.lead_id WHERE r.received_at >= ? ORDER BY r.received_at DESC LIMIT ?`, since, limit);
}

export function listMessages(ctx, { status, limit = 100, offset = 0 } = {}) {
  const where = status && status !== 'all' ? 'WHERE m.status = ?' : '';
  const params = where ? [status] : [];
  return all(ctx.db, `SELECT m.id, m.created_at, m.account, m.step, m.template, m.status, m.error, m.body, l.id AS lead_id, l.name, l.phone
    FROM messages m JOIN leads l ON l.id = m.lead_id ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

export const listActivity = (ctx, limit = 100) => all(ctx.db, 'SELECT at, kind, detail FROM activity ORDER BY id DESC LIMIT ?', limit);

// Spreadsheet formulas in business names would run when the CSV is opened, so they are neutralised.
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function leadsCsv(ctx, filters = {}) {
  const { items } = listLeads(ctx, filters, 100000, 0);
  const head = ['id', 'name', 'city', 'area', 'category', 'phone', 'phone_type', 'website', 'rating', 'reviews', 'stage', 'discovered', 'last_message_status', 'notes', 'pipeline_status', 'pipeline_meeting_or_callback_time', 'pipeline_note'];
  const rows = items.map((l) => [l.id, l.name, l.city, l.area, l.category, l.phone ? `+${l.phone}` : '', l.phone_type, l.website, l.rating, l.review_count, l.stage, l.discovery_day, l.last_message_status, l.notes, l.pipeline_status, l.pipeline_at ? new Date(l.pipeline_at).toISOString() : '', l.pipeline_note]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
