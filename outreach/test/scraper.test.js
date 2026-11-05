import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorTick, leadsFoundOn, promoteBanked, runScan, runsToday } from '../src/collector.js';
import { all, get, getSetting } from '../src/db.js';
import { importLeads, prepareLead } from '../src/scraper.js';
import { Sender } from '../src/sender.js';
import { setSetting } from '../src/db.js';
import { addLead, fakeGateways, fakeScraper, json, makeCfg, makeCtx } from './helpers.js';

const DAY = '2026-11-02';

test('searches are asked of the dashboard scraper, for one city at a time, with the review minimum', async () => {
  const sc = fakeScraper();
  const { ctx } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '15' } });
  await runScan(ctx);
  const search = sc.state.calls.find((c) => c.path === '/search/quick');
  assert.equal(search.token, 'scraper-token');
  assert.equal(search.body.workspace.target_industry, 'Solar businesses');
  assert.equal(search.body.workspace.target_location, 'Nigeria');
  assert.equal(search.body.workspace.min_reviews, 20);
  assert.equal(search.body.workspace.daily_prospect_count, 15);
  assert.match(search.body.workspace.target_areas[0], /^Nigeria\|(Abuja|Lagos)$/);
  assert.ok(sc.state.calls.every((c) => c.path !== undefined), 'only the scraper is called (the fake rejects any other host)');
});

test('import keeps solar leads with 20+ reviews and a mobile number, archives the rest, ignores other cities', async () => {
  const sc = fakeScraper();
  const { ctx, db } = makeCtx({ fetch: sc.handler });
  const good = addLead(sc.state, 'Abuja', { userRatingCount: 20 });
  const few = addLead(sc.state, 'Abuja', { userRatingCount: 19 });
  const landline = addLead(sc.state, 'Lagos', { internationalPhoneNumber: '+234 1 2345678' });
  const nophone = addLead(sc.state, 'Lagos', { internationalPhoneNumber: undefined, nationalPhoneNumber: undefined });
  const closed = addLead(sc.state, 'Lagos', { businessStatus: 'CLOSED_PERMANENTLY' });
  const elsewhere = addLead(sc.state, 'Port Harcourt');
  const failed = { ...addLead(sc.state, 'Lagos'), details: null };
  sc.state.leads[sc.state.leads.length - 1] = failed;

  const out = await importLeads(ctx);
  assert.equal(out.added, 1);
  assert.equal(get(db, 'SELECT stage FROM leads WHERE place_id = ?', good.place_id).stage, 'new');
  assert.equal(get(db, 'SELECT stage FROM leads WHERE place_id = ?', landline.place_id).stage, 'no_mobile');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM leads').n, 2, 'only the good lead and the call-only one are stored');
  const stage = (l) => sc.state.leads.find((x) => x.id === l.id).stage;
  assert.deepEqual([good, landline].map(stage), ['shortlisted', 'shortlisted']);
  assert.deepEqual([few, nophone, closed].map(stage), ['archived', 'archived', 'archived']);
  assert.equal(stage(elsewhere), 'new', 'other cities are left alone');
  assert.equal(sc.state.leads.at(-1).stage, 'new', 'a failed live lookup is retried later, not archived');
});

test('prepareLead enforces the configured thresholds', () => {
  const cfg = makeCfg({ MIN_RATING: '4', MIN_REVIEW_COUNT: '25' });
  const row = (d) => ({ id: 'a', place_id: 'p', search_city: 'Lagos', details: { displayName: { text: 'Sun Ltd' }, internationalPhoneNumber: '+234 803 123 4567', businessStatus: 'OPERATIONAL', rating: 4.2, userRatingCount: 30, ...d } });
  assert.equal(prepareLead(row({}), cfg).lead.short_name, 'Sun');
  assert.equal(prepareLead(row({ userRatingCount: 24 }), cfg).reject, 'too_few_reviews');
  assert.equal(prepareLead(row({ rating: 3.9 }), cfg).reject, 'low_rating');
  assert.equal(prepareLead(row({ userRatingCount: undefined }), cfg).reject, 'too_few_reviews');
});

test('a 150-lead day is built from repeated scraper runs, split evenly between Abuja and Lagos', async () => {
  const sc = fakeScraper();
  const { ctx, db } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '150' } });
  const result = await runScan(ctx);
  const found = leadsFoundOn(db, DAY);
  assert.equal(result.outcome, 'target_reached');
  assert.deepEqual([found.total, found.Abuja, found.Lagos], [150, 75, 75]);
  assert.equal(runsToday(db, DAY), 10);
  assert.equal(sc.state.leads.filter((l) => l.stage === 'new').length, 0, 'everything imported was moved out of "new" in the scraper');
});

test('leads beyond the target are banked and released tomorrow without another scraper run', async () => {
  const sc = fakeScraper();
  const { ctx, db } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '10' } });
  await runScan(ctx); // one run saves 15 leads
  assert.equal(leadsFoundOn(db, DAY).total, 10);
  assert.equal(get(db, `SELECT COUNT(*) AS n FROM leads WHERE stage = 'banked'`).n, 5);
  assert.equal(promoteBanked(db, ctx.cfg, '2026-11-03'), 5);
  assert.equal(leadsFoundOn(db, '2026-11-03').total, 5);
});

test('stops at the daily run limit', async () => {
  const sc = fakeScraper();
  const { ctx } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '150', SCRAPER_MAX_RUNS_PER_DAY: '3' } });
  const result = await runScan(ctx);
  assert.equal(result.outcome, 'run_limit_reached');
  assert.equal(sc.state.calls.filter((c) => c.path === '/search/quick').length, 3);
});

test('when the scraper has nothing new it stops instead of searching forever', async () => {
  const sc = fakeScraper({ supply: { Abuja: 20, Lagos: 10 } });
  const { ctx, db } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '150' } });
  const result = await runScan(ctx);
  assert.equal(result.outcome, 'scraper_exhausted');
  assert.equal(leadsFoundOn(db, DAY).total, 30);
  assert.ok(sc.state.calls.filter((c) => c.path === '/search/quick').length <= 6);
  assert.equal(collectorTick(ctx), null, 'not retried again today');
});

test('discovery pauses while the AI Agent would research every lead with OpenAI, unless allowed', async () => {
  const sc = fakeScraper({ autoRun: true });
  const { ctx, db } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '15' } });
  const result = await runScan(ctx);
  assert.equal(result.outcome, 'ai_research_on');
  assert.equal(sc.state.calls.filter((c) => c.path === '/search/quick').length, 0);
  assert.ok(Number(getSetting(db, 'collector_cooldown_until')) > ctx.now());

  const allowed = fakeScraper({ autoRun: true });
  const t2 = makeCtx({ fetch: allowed.handler, env: { DAILY_LEAD_TARGET: '15', SCRAPER_ALLOW_AI_RESEARCH: 'true' } });
  assert.equal((await runScan(t2.ctx)).outcome, 'target_reached');
});

test('an unreachable or rejecting scraper stops the scan with a cooldown', async () => {
  const down = makeCtx({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await runScan(down.ctx)).outcome, 'scraper_unreachable');
  assert.ok(Number(getSetting(down.db, 'collector_cooldown_until')) >= down.clock.t + 60_000);
  assert.equal(collectorTick(down.ctx), null);

  const denied = makeCtx({ fetch: async () => json(401, { detail: 'nope' }) });
  assert.equal((await runScan(denied.ctx)).outcome, 'scraper_unauthorized');
});

test('without a scraper token nothing is attempted', async () => {
  const { ctx } = makeCtx({ env: { SCRAPER_TOKEN: '' } });
  assert.equal(collectorTick(ctx), null);
  assert.equal((await runScan(ctx)).outcome, 'scraper_not_configured');
});

test('leads from searches you run yourself in the dashboard are picked up by the periodic import', async () => {
  const sc = fakeScraper();
  const { ctx, db } = makeCtx({ fetch: sc.handler, env: { DAILY_LEAD_TARGET: '150' } });
  setSetting(db, 'collector_last', JSON.stringify({ day: DAY, outcome: 'scraper_exhausted' }));
  for (let i = 0; i < 4; i++) addLead(sc.state, i % 2 ? 'Abuja' : 'Lagos');
  collectorTick(ctx);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(leadsFoundOn(db, DAY).total, 4);
});

test('the first message marks the lead "contacted" in the scraper pipeline', async () => {
  const sc = fakeScraper();
  const gw = fakeGateways();
  const both = async (url, init) => (new URL(url).host === 'scraper.test' ? sc.handler(url, init) : gw.handler(url, init));
  const { ctx, db } = makeCtx({ fetch: both, env: { WARMUP_START: '75' } });
  const lead = addLead(sc.state, 'Abuja');
  await importLeads(ctx);
  setSetting(db, 'send_paused', '0');
  await new Sender(ctx).tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sc.state.leads.find((l) => l.id === lead.id).stage, 'contacted');
  assert.equal(all(db, 'SELECT source_id FROM leads')[0].source_id, lead.id);
});
