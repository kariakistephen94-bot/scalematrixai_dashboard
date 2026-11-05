import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  place_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  address TEXT,
  city TEXT NOT NULL,
  area TEXT,
  category TEXT,
  phone TEXT,
  phone_type TEXT NOT NULL,
  website TEXT,
  rating REAL,
  review_count INTEGER,
  lat REAL,
  lng REAL,
  stage TEXT NOT NULL,
  discovery_day TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  assigned_account TEXT,
  followups_sent INTEGER NOT NULL DEFAULT 0,
  next_followup_at INTEGER,
  send_failures INTEGER NOT NULL DEFAULT 0,
  first_contacted_at INTEGER,
  last_contacted_at INTEGER,
  replied_at INTEGER,
  opted_out_at INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage, discovery_day);
CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_unique ON leads(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  account TEXT NOT NULL,
  step INTEGER NOT NULL,
  template TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  gateway_message_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  sent_at INTEGER,
  delivered_at INTEGER,
  read_at INTEGER,
  failed_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_account_time ON messages(account, created_at);
CREATE INDEX IF NOT EXISTS messages_lead ON messages(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_gateway_id ON messages(account, gateway_message_id) WHERE gateway_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  account TEXT NOT NULL,
  gateway_message_id TEXT,
  text TEXT,
  received_at INTEGER NOT NULL,
  is_stop INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS replies_gateway_id ON replies(account, gateway_message_id) WHERE gateway_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS status_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS searches (
  key TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  page INTEGER NOT NULL DEFAULT 0,
  next_page_token TEXT,
  token_at INTEGER,
  last_run_at INTEGER,
  rested_until INTEGER,
  total_found INTEGER NOT NULL DEFAULT 0,
  new_found INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lead_events (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  status TEXT NOT NULL,
  scheduled_at INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, id);

CREATE TABLE IF NOT EXISTS api_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  if (!db.prepare('PRAGMA table_info(leads)').all().some((c) => c.name === 'source_id')) db.exec('ALTER TABLE leads ADD COLUMN source_id TEXT');
  const leadColumns = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
  for (const [name, type] of [['pipeline_status', 'TEXT'], ['pipeline_at', 'INTEGER'], ['pipeline_note', 'TEXT'], ['pipeline_updated_at', 'INTEGER']]) {
    if (!leadColumns.includes(name)) db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS leads_pipeline ON leads(pipeline_status, pipeline_at)');
  if (file !== ':memory:') for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.chmodSync(f, 0o600); } catch { /* not created yet */ }
  return db;
}

export const get = (db, sql, ...params) => db.prepare(sql).get(...params);
export const all = (db, sql, ...params) => db.prepare(sql).all(...params);
export const run = (db, sql, ...params) => db.prepare(sql).run(...params);

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = get(db, 'SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  run(db, 'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

export function logActivity(db, kind, detail, at = Date.now()) {
  run(db, 'INSERT INTO activity(at, kind, detail) VALUES(?, ?, ?)', at, kind, detail);
  run(db, 'DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 2000');
}
