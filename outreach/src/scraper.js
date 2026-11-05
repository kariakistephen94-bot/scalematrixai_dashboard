// Client for the ScaleMatrix dashboard's own Google Maps scraper (the FastAPI backend). This service does
// not talk to Google: it asks that scraper to run searches ("Quick Search") and imports what it saved.
import crypto from 'node:crypto';
import { get, run } from './db.js';
import { normalizeNgPhone } from './phone.js';
import { shortenBusinessName } from './messages.js';
import { lagosDay } from './time.js';

export const NICHE = 'Solar businesses';
export const COUNTRY = 'Nigeria';
export const CITIES = ['Abuja', 'Lagos'];
const PER_RUN = 15; // the scraper saves at most 15 new listings per run

export class ScraperError extends Error {
  constructor(code, delaySeconds = 300, detail = '') {
    super(code);
    this.code = code;
    this.delaySeconds = delaySeconds;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ScraperClient {
  constructor(cfg, fetchImpl = fetch, sleepImpl = sleep) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
  }

  async call(method, path, { body, query, timeoutMs = 60_000 } = {}) {
    if (!this.cfg.scraperToken) throw new ScraperError('scraper_not_configured', 3600);
    const url = new URL(this.cfg.scraperUrl + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    let response;
    try {
      response = await this.fetch(url.href, {
        method,
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-dashboard-token': this.cfg.scraperToken },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ScraperError('scraper_unreachable', 60); // it may simply still be starting
    }
    let json = null;
    try { json = await response.json(); } catch { /* empty or non-JSON body */ }
    if (response.status === 401) throw new ScraperError('scraper_unauthorized', 3600);
    if (!response.ok) throw new ScraperError('scraper_error', 300, typeof json?.detail === 'string' ? json.detail.slice(0, 200) : `HTTP ${response.status}`);
    return json;
  }

  /** True when the dashboard's AI Agent would research every new lead with OpenAI after a search. */
  async autoResearchOn() {
    const state = await this.call('GET', '/agent');
    return state?.preferences?.auto_run !== false;
  }

  /** Start a Quick Search for one city. Settings are passed for this run only; the saved ones are untouched. */
  async quickSearch(city) {
    const result = await this.call('POST', '/search/quick', {
      body: {
        request_id: crypto.randomUUID(),
        workspace: {
          prospect_source: 'google_maps', target_industry: NICHE, target_location: COUNTRY, timezone: 'Africa/Lagos',
          daily_prospect_count: PER_RUN, min_reviews: this.cfg.minReviewCount, target_areas: [`${COUNTRY}|${city}`], schedule_enabled: false,
        },
      },
    });
    if (!result?.run?.id) throw new ScraperError('scraper_error', 300, 'Quick Search did not return a run');
    return result.run.id;
  }

  /** Wait for a run to stop running. Returns the run row (status completed or failed), or null on timeout. */
  async waitForRun(runId, { timeoutMs = 11 * 60_000, intervalMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.call('GET', '/dashboard');
      const found = (state?.runs || []).find((r) => r.id === runId);
      if (found && found.status !== 'running') return found;
      if (Date.now() >= deadline) return null;
      await this.sleep(intervalMs);
    }
  }

  listNew(offset) {
    return this.call('GET', '/maps/leads', { query: { niche: NICHE, country: COUNTRY, stage: 'new', limit: 10, offset }, timeoutMs: 90_000 });
  }

  setStage(sourceId, stage) {
    return this.call('PATCH', `/maps/leads/${encodeURIComponent(sourceId)}`, { body: { stage } });
  }
}

/** Turn one scraper lead (with live Google details) into an outreach lead, or say why not. */
export function prepareLead(row, cfg) {
  const d = row.details;
  if (!d) return { reject: 'no_details', keep: true }; // lookup failed: leave it for a later import
  const city = CITIES.find((c) => String(row.search_city || '').includes(c));
  if (!city) return { reject: 'other_city', keep: true };
  if (d.businessStatus && d.businessStatus !== 'OPERATIONAL') return { reject: 'not_operational' };
  const reviews = d.userRatingCount;
  if (!Number.isInteger(reviews) || reviews < cfg.minReviewCount) return { reject: 'too_few_reviews' };
  if (cfg.minRating > 0 && !(typeof d.rating === 'number' && d.rating >= cfg.minRating)) return { reject: 'low_rating' };
  const phone = normalizeNgPhone(d.internationalPhoneNumber || d.nationalPhoneNumber);
  if (!phone.phone) return { reject: 'no_phone' };
  const name = String(d.displayName?.text || '').trim();
  if (!row.place_id || !name) return { reject: 'incomplete' };
  const website = String(d.websiteUri || '');
  return {
    lead: {
      place_id: row.place_id, source_id: row.id, name: name.slice(0, 300), short_name: shortenBusinessName(name).name,
      address: String(d.formattedAddress || '').slice(0, 600), city, area: city, category: 'solar company',
      phone: phone.phone, phone_type: phone.type, website: /^https?:\/\//.test(website) ? website.slice(0, 2000) : '',
      rating: typeof d.rating === 'number' ? d.rating : null, review_count: reviews, lat: null, lng: null,
    },
  };
}

/**
 * Import every lead the scraper has saved but outreach has not seen yet (stage "new" there).
 * Handled leads are moved out of "new" in the scraper (shortlisted, or archived when unusable) so they
 * are not looked up again. Mobile leads beyond today's target are banked for tomorrow.
 */
export async function importLeads(ctx, { maxPages = 60 } = {}) {
  const { db, cfg } = ctx;
  const out = { added: 0, banked: 0, known: 0, callOnly: 0, rejected: 0, pages: 0 };
  const day = lagosDay(ctx.now());
  let todays = get(db, `SELECT COUNT(*) AS n FROM leads WHERE discovery_day = ? AND phone_type = 'mobile' AND stage NOT IN ('banked', 'archived')`, day).n;
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const data = await ctx.scraper.listNew(offset);
    out.pages++;
    let moved = 0;
    const move = async (id, stage) => { try { await ctx.scraper.setStage(id, stage); moved++; } catch { /* stays "new"; retried next import */ } };
    for (const row of data?.leads || []) {
      const { lead, reject, keep } = prepareLead(row, cfg);
      if (keep) continue;
      if (reject) { out.rejected++; await move(row.id, 'archived'); continue; }
      const existing = get(db, 'SELECT id FROM leads WHERE place_id = ? OR phone = ?', lead.place_id, lead.phone);
      if (existing) {
        run(db, 'UPDATE leads SET rating = ?, review_count = ?, source_id = COALESCE(source_id, ?) WHERE id = ?', lead.rating, lead.review_count, lead.source_id, existing.id);
        out.known++;
      } else {
        let stage = 'no_mobile';
        if (lead.phone_type === 'mobile') {
          if (todays < cfg.dailyLeadTarget) { stage = 'new'; todays++; out.added++; } else { stage = 'banked'; out.banked++; }
        } else out.callOnly++;
        run(db, `INSERT INTO leads(place_id, source_id, name, short_name, address, city, area, category, phone, phone_type, website,
            rating, review_count, lat, lng, stage, discovery_day, discovered_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          lead.place_id, lead.source_id, lead.name, lead.short_name, lead.address, lead.city, lead.area, lead.category, lead.phone,
          lead.phone_type, lead.website, lead.rating, lead.review_count, lead.lat, lead.lng, stage, day, ctx.now());
      }
      await move(row.id, 'shortlisted');
    }
    if (!data?.has_more) break;
    // Leads moved out of "new" shift the remaining ones up, so the next page starts earlier by that much.
    offset = Math.max(0, data.next_offset - moved);
  }
  return out;
}

const ALL_CITIES = ['Abuja', 'Lagos', 'Port Harcourt'];
const NICHE_CATEGORY = { 'Solar businesses': 'solar company', 'Commercial cleaning': 'commercial cleaning company', 'Facility management': 'facility management company' };

/**
 * One-off bulk import of every Nigerian lead the scraper has saved (all niches; Abuja, Lagos, Port Harcourt),
 * with no review minimum. Mobile solar leads become "Ready"; mobile leads of other niches are stored as
 * "other_niche" so the solar pitch is never auto-sent to them; landlines are "Call only".
 */
export async function importAllNigeria(ctx, { maxPages = 100 } = {}) {
  const { db } = ctx;
  const out = { added: 0, solarReady: 0, otherNiche: 0, callOnly: 0, known: 0, skipped: 0, pages: 0 };
  const day = lagosDay(ctx.now());
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const data = await ctx.scraper.call('GET', '/maps/leads', { query: { country: COUNTRY, stage: 'new', limit: 10, offset }, timeoutMs: 90_000 });
    out.pages++;
    let moved = 0;
    for (const row of data?.leads || []) {
      const d = row.details;
      const city = ALL_CITIES.find((c) => String(row.search_city || '').includes(c));
      const phone = d ? normalizeNgPhone(d.internationalPhoneNumber || d.nationalPhoneNumber) : null;
      const name = String(d?.displayName?.text || '').trim();
      if (!d || !city || !phone?.phone || !name || !row.place_id) { out.skipped++; continue; }
      const existing = get(db, 'SELECT id FROM leads WHERE place_id = ? OR phone = ?', row.place_id, phone.phone);
      if (!existing) {
        const solar = row.niche === NICHE;
        const stage = phone.type !== 'mobile' ? 'no_mobile' : solar ? 'new' : 'other_niche';
        const website = String(d.websiteUri || '');
        run(db, `INSERT INTO leads(place_id, source_id, name, short_name, address, city, area, category, phone, phone_type, website,
            rating, review_count, lat, lng, stage, discovery_day, discovered_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.place_id, row.id, name.slice(0, 300), shortenBusinessName(name).name, String(d.formattedAddress || '').slice(0, 600), city, city,
          NICHE_CATEGORY[row.niche] || String(row.niche || '').toLowerCase(), phone.phone, phone.type, /^https?:\/\//.test(website) ? website.slice(0, 2000) : '',
          typeof d.rating === 'number' ? d.rating : null, Number.isInteger(d.userRatingCount) ? d.userRatingCount : null, null, null, stage, day, ctx.now());
        out.added++;
        if (stage === 'new') out.solarReady++; else if (stage === 'other_niche') out.otherNiche++; else out.callOnly++;
      } else out.known++;
      try { await ctx.scraper.setStage(row.id, 'shortlisted'); moved++; } catch { /* retried on a later import */ }
    }
    if (!data?.has_more) break;
    offset = Math.max(0, data.next_offset - moved);
  }
  return out;
}

/**
 * Save places that were read straight from Google Maps (Places API text search) as outreach leads.
 * Each place: { place_id, name, address, city, phone, website, rating, reviews, niche }.
 * Mobile solar numbers become "Ready"; landlines "Call only". Existing place IDs / phone numbers are skipped.
 */
export function importPlaces(ctx, places) {
  const { db } = ctx;
  const out = { added: 0, ready: 0, callOnly: 0, known: 0, rejected: 0 };
  const day = lagosDay(ctx.now());
  for (const p of places) {
    const phone = normalizeNgPhone(p.phone);
    const name = String(p.name || '').trim();
    if (!p.place_id || !name || !p.city || !phone.phone) { out.rejected++; continue; }
    if (get(db, 'SELECT id FROM leads WHERE place_id = ? OR phone = ?', p.place_id, phone.phone)) { out.known++; continue; }
    const stage = phone.type === 'mobile' ? 'new' : 'no_mobile';
    const website = String(p.website || '');
    run(db, `INSERT INTO leads(place_id, source_id, name, short_name, address, city, area, category, phone, phone_type, website,
        rating, review_count, lat, lng, stage, discovery_day, discovered_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.place_id, null, name.slice(0, 300), shortenBusinessName(name).name, String(p.address || '').slice(0, 600), p.city, p.city,
      'solar company', phone.phone, phone.type, /^https?:\/\//.test(website) ? website.slice(0, 2000) : '',
      typeof p.rating === 'number' ? p.rating : null, Number.isInteger(p.reviews) ? p.reviews : null, null, null, stage, day, ctx.now());
    out.added++;
    if (stage === 'new') out.ready++; else out.callOnly++;
  }
  return out;
}
