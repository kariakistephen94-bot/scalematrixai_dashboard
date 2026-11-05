import { parseDays, parseWindow } from './time.js';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function loadConfig(env = process.env) {
  // Up to six WhatsApp accounts, A-F. ACCOUNT_COUNT picks how many are active; each account i runs
  // its own gateway on port 3101+i unless ACCOUNT_X_URL says otherwise.
  const count = num(env.ACCOUNT_COUNT, 2);
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error('Invalid configuration: ACCOUNT_COUNT must be a whole number from 1 to 6');
  const accounts = [...'abcdef'].slice(0, count).map((id, i) => {
    const U = id.toUpperCase();
    return {
      id,
      label: env[`ACCOUNT_${U}_LABEL`] || `Account ${U}`,
      url: (env[`ACCOUNT_${U}_URL`] || `http://127.0.0.1:${3101 + i}`).trim().replace(/\/+$/, ''),
      apiKey: env[`ACCOUNT_${U}_API_KEY`] || '',
      statusSecret: env[`ACCOUNT_${U}_STATUS_SECRET`] || '',
      inboundSecret: env[`ACCOUNT_${U}_INBOUND_SECRET`] || '',
    };
  });

  const cfg = {
    port: num(env.PORT, 3200),
    host: env.HOST || '127.0.0.1',
    dashboardToken: env.DASHBOARD_TOKEN || '',
    dbFile: env.DB_FILE || './data/outreach.db',

    // Leads come from the dashboard's Google Maps scraper (FastAPI backend), not from Google directly.
    scraperUrl: (env.SCRAPER_URL || 'http://127.0.0.1:8001').trim().replace(/\/+$/, ''),
    scraperToken: env.SCRAPER_TOKEN || '',
    scraperMaxRunsPerDay: num(env.SCRAPER_MAX_RUNS_PER_DAY, 14),
    // The scraper's AI Agent can research every new lead with OpenAI. Discovery stays paused while that is on, unless allowed here.
    allowAiResearch: String(env.SCRAPER_ALLOW_AI_RESEARCH || '').toLowerCase() === 'true',
    dailyLeadTarget: num(env.DAILY_LEAD_TARGET, 150),
    abujaShare: num(env.ABUJA_SHARE, 0.5),
    minReviewCount: num(env.MIN_REVIEW_COUNT, 20),
    minRating: num(env.MIN_RATING, 0),
    scanStartHour: num(env.SCAN_START_HOUR, 5),

    accounts,
    sendWindow: parseWindow(env.SEND_WINDOW || '09:00-17:30'),
    sendDays: parseDays(env.SEND_DAYS || '1-6'),
    dailyCapPerAccount: num(env.DAILY_CAP_PER_ACCOUNT, 75),
    warmupStart: num(env.WARMUP_START, 25),
    warmupStep: num(env.WARMUP_STEP, 10),
    gapMinSeconds: num(env.GAP_MIN_SECONDS, 60),
    gapMaxSeconds: num(env.GAP_MAX_SECONDS, 900),
    followupDays: (env.FOLLOWUP_DAYS ?? '3,7').split(',').map((s) => s.trim()).filter(Boolean).map(Number),

    senderName: (env.SENDER_NAME || '').trim(),
    companyName: (env.COMPANY_NAME || '').trim(),
  };

  const bad = (m) => { throw new Error(`Invalid configuration: ${m}`); };
  if (!(cfg.dailyLeadTarget >= 1 && cfg.dailyLeadTarget <= 1000)) bad('DAILY_LEAD_TARGET must be 1-1000');
  if (!(cfg.abujaShare >= 0 && cfg.abujaShare <= 1)) bad('ABUJA_SHARE must be between 0 and 1');
  if (!(cfg.minReviewCount >= 1)) bad('MIN_REVIEW_COUNT must be at least 1');
  if (!(cfg.minRating >= 0 && cfg.minRating <= 5)) bad('MIN_RATING must be 0-5');
  if (!(cfg.scraperMaxRunsPerDay >= 1 && cfg.scraperMaxRunsPerDay <= 100)) bad('SCRAPER_MAX_RUNS_PER_DAY must be 1-100');
  if (!(cfg.dailyCapPerAccount >= 1 && cfg.warmupStart >= 1 && cfg.warmupStep >= 0)) bad('daily caps must be positive');
  if (!(cfg.gapMinSeconds >= 1 && cfg.gapMaxSeconds >= cfg.gapMinSeconds)) bad('GAP_MIN_SECONDS/GAP_MAX_SECONDS');
  if (cfg.followupDays.some((d) => !(d >= 1)) || cfg.followupDays.some((d, i, a) => i && d <= a[i - 1])) bad('FOLLOWUP_DAYS must increase, e.g. 3,7');
  return cfg;
}
