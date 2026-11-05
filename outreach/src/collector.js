// Daily lead supply. The leads come from the dashboard's Google Maps scraper: this module asks it to run
// Quick Searches (alternating Abuja and Lagos) until the day's target of outreach-ready mobile leads is
// reached, imports what it saved, and stops when the scraper has nothing new or a limit is hit.
import { all, getSetting, logActivity, run, setSetting } from './db.js';
import { CITIES, importLeads, ScraperError } from './scraper.js';
import { lagosDay, lagosParts } from './time.js';

const IMPORT_EVERY_MS = 10 * 60_000;
const runsKey = (day) => `scraper_runs:${day}`;

/** Mobile (outreach-ready) leads found on a Lagos day, per city. Banked and archived leads are not counted. */
export function leadsFoundOn(db, day) {
  const rows = all(db, `SELECT city, COUNT(*) AS n FROM leads
    WHERE discovery_day = ? AND phone_type = 'mobile' AND stage NOT IN ('banked', 'archived') GROUP BY city`, day);
  const out = { total: 0, Abuja: 0, Lagos: 0 };
  for (const r of rows) { out[r.city] = r.n; out.total += r.n; }
  return out;
}

/** Surplus found after the day's target was hit is banked and counts toward the next day first. */
export function promoteBanked(db, cfg, day) {
  const room = cfg.dailyLeadTarget - leadsFoundOn(db, day).total;
  if (room <= 0) return 0;
  return run(db, `UPDATE leads SET stage = 'new', discovery_day = ? WHERE id IN
    (SELECT id FROM leads WHERE stage = 'banked' ORDER BY id LIMIT ?)`, day, room).changes;
}

export const runsToday = (db, day) => Number(getSetting(db, runsKey(day), 0));

/** The city furthest below its share of the day's target goes next; cities the scraper has run dry for are skipped. */
export function pickCity(cfg, found, exhausted) {
  const quota = { Abuja: Math.round(cfg.dailyLeadTarget * cfg.abujaShare) };
  quota.Lagos = cfg.dailyLeadTarget - quota.Abuja;
  const fill = (city) => (quota[city] > 0 ? found[city] / quota[city] : 1);
  return CITIES.filter((c) => !exhausted.has(c))
    .sort((a, b) => (fill(a) < 1 ? 0 : 1) - (fill(b) < 1 ? 0 : 1) || fill(a) - fill(b))[0] ?? null;
}

/**
 * Run discovery for the current Lagos day. Stops on: target reached, run limit, nothing new from the scraper,
 * the AI Agent's automatic OpenAI research being on (it would run for every search), or a scraper error.
 */
export async function runScan(ctx) {
  const { db, cfg } = ctx;
  if (ctx.scanning) return { outcome: 'already_running' };
  ctx.scanning = true;
  const day = lagosDay(ctx.now());
  const before = leadsFoundOn(db, day).total;
  let outcome = 'target_reached';
  let runs = 0;
  const exhausted = new Set();
  try {
    promoteBanked(db, cfg, day);
    await importLeads(ctx); // anything already waiting in the scraper costs nothing to import
    if (!cfg.allowAiResearch && await ctx.scraper.autoResearchOn()) {
      outcome = 'ai_research_on';
    } else {
      for (;;) {
        const found = leadsFoundOn(db, day);
        if (found.total >= cfg.dailyLeadTarget) { outcome = 'target_reached'; break; }
        if (runsToday(db, day) >= cfg.scraperMaxRunsPerDay) { outcome = 'run_limit_reached'; break; }
        const city = pickCity(cfg, found, exhausted);
        if (!city) { outcome = 'scraper_exhausted'; break; }
        setSetting(db, runsKey(day), runsToday(db, day) + 1);
        runs++;
        const runId = await ctx.scraper.quickSearch(city);
        const finished = await ctx.scraper.waitForRun(runId, ctx.runWait);
        const imported = await importLeads(ctx);
        const note = finished ? String(finished.summary || finished.status).slice(0, 140) : 'timed out waiting for the scraper';
        logActivity(db, 'scan', `Scraper run for ${city}: ${note}. Imported ${imported.added} new (${imported.banked} banked, ${imported.known} already known, ${imported.callOnly} call-only, ${imported.rejected} rejected)`, ctx.now());
        if (!finished || finished.status !== 'completed' || imported.added + imported.banked === 0) exhausted.add(city);
      }
    }
  } catch (error) {
    if (error instanceof ScraperError) {
      outcome = error.code;
      setSetting(db, 'collector_cooldown_until', String(ctx.now() + error.delaySeconds * 1000));
      logActivity(db, 'error', `Lead discovery stopped: ${error.code}${error.detail ? ` (${error.detail})` : ''}`, ctx.now());
    } else {
      outcome = 'internal_error';
      logActivity(db, 'error', `Lead discovery failed: ${error.message}`, ctx.now());
    }
  } finally {
    ctx.scanning = false;
  }
  if (outcome === 'ai_research_on') setSetting(db, 'collector_cooldown_until', String(ctx.now() + 10 * 60_000));
  const added = leadsFoundOn(db, day).total - before;
  setSetting(db, 'collector_last', JSON.stringify({ at: ctx.now(), day, outcome, added, runs }));
  logActivity(db, 'scan', `Discovery finished: ${outcome}, +${added} leads, ${runs} scraper runs`, ctx.now());
  return { outcome, added };
}

export const collectorEnabled = (db, cfg) => getSetting(db, 'collector_enabled', cfg.scraperToken ? '1' : '0') === '1';

/**
 * Called every minute. Imports new scraper leads every few minutes (so searches you run yourself, or the
 * dashboard's daily run, also flow in), and starts the day's scan once the start hour has passed.
 */
export function collectorTick(ctx) {
  const { db, cfg } = ctx;
  const now = ctx.now();
  const day = lagosDay(now);
  promoteBanked(db, cfg, day);
  if (ctx.scanning || !collectorEnabled(db, cfg) || !cfg.scraperToken) return null;
  if (now < Number(getSetting(db, 'collector_cooldown_until', 0))) return null;
  if (now - Number(getSetting(db, 'last_import_at', 0)) >= IMPORT_EVERY_MS) {
    setSetting(db, 'last_import_at', String(now));
    importLeads(ctx).catch((error) => {
      if (error instanceof ScraperError) setSetting(db, 'collector_cooldown_until', String(now + Math.min(error.delaySeconds, 600) * 1000));
    });
  }
  if (lagosParts(now).hour < cfg.scanStartHour) return null;
  if (leadsFoundOn(db, day).total >= cfg.dailyLeadTarget) return null;
  const last = JSON.parse(getSetting(db, 'collector_last', 'null') || 'null');
  // A scan that ended because the scraper had nothing new, or hit today's run limit, is not repeated until tomorrow.
  if (last && last.day === day && ['scraper_exhausted', 'run_limit_reached'].includes(last.outcome)) return null;
  return runScan(ctx);
}
