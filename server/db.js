'use strict';
/* SQLite persistence. One file, no migrations framework — the schema is
 * created on boot and is the single source of truth for the whole app. */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.THEATER_DATA_DIR || path.join(__dirname, '..', 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'theater.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* The schema has a version. This is a prototype with disposable, reseedable
 * data, so an older database is rebuilt from scratch rather than migrated. */
const SCHEMA_VERSION = 2;
if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (tables.length) {
    console.warn(`[db] schema changed (v${SCHEMA_VERSION}) — rebuilding the demo database`);
    db.pragma('foreign_keys = OFF');
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    db.pragma('foreign_keys = ON');
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  handle      TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  is_house    INTEGER NOT NULL DEFAULT 0,
  credits     INTEGER NOT NULL DEFAULT 0,     -- seats in your pocket (see payments.js)
  created_at  INTEGER NOT NULL
);

/* Seat credits bought with a card or over Lightning. */
CREATE TABLE IF NOT EXISTS purchases (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  rail        TEXT NOT NULL,               -- card|lightning|comp
  bundle      TEXT,
  credits     INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,           -- fiat value at purchase
  sats        INTEGER,                     -- for lightning
  status      TEXT NOT NULL,               -- pending|paid|expired|failed
  ref         TEXT,                        -- provider reference / invoice id
  payment_request TEXT,                    -- bolt11, when lightning
  created_at  INTEGER NOT NULL,
  paid_at     INTEGER
);

CREATE TABLE IF NOT EXISTS theaters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  state          TEXT NOT NULL,            -- FILLING|OPEN_CALL|DOORS_CLOSED|SHOWING|VOTING|RESULTS|ARCHIVED
  created_at     INTEGER NOT NULL,
  plan_json      TEXT NOT NULL,            -- the House Manager's live plan for this room
  tier           TEXT,
  doors_closed_at INTEGER,
  showtime_at    INTEGER,
  started_at     INTEGER,
  ended_at       INTEGER,
  voting_ends_at INTEGER,
  results_end_at INTEGER,
  archived_at    INTEGER,
  guaranteed     INTEGER NOT NULL DEFAULT 0,   -- 1 = locked to a guaranteed showtime
  mode           TEXT NOT NULL DEFAULT 'nightly', -- nightly|lobby: which House Manager mode formed it
  reel_json      TEXT,                          -- frozen running order, set at doors-close
  winner_film_id TEXT,
  last_progress_at INTEGER NOT NULL,            -- last ticket/film event; drives anti-stall
  decay_steps    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  theater_id  INTEGER REFERENCES theaters(id),   -- NULL = waiting in the pool for a room
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,               -- FILMMAKER|AUDIENCE
  source      TEXT NOT NULL DEFAULT 'purchase', -- purchase|comp_rejected|carryover|house
  seat_index  INTEGER,
  paid_cents  INTEGER NOT NULL DEFAULT 0,
  attended    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_room_user ON tickets(theater_id, user_id) WHERE theater_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_pool_user ON tickets(user_id) WHERE theater_id IS NULL;

/* What actually happened in each room — the numbers the cadence is tuned on. */
CREATE TABLE IF NOT EXISTS outcomes (
  theater_id     INTEGER PRIMARY KEY REFERENCES theaters(id),
  mode           TEXT NOT NULL,
  tier           TEXT,
  films          INTEGER NOT NULL,
  tickets        INTEGER NOT NULL,
  attended       INTEGER NOT NULL,
  votes          INTEGER NOT NULL,
  reactions      INTEGER NOT NULL,
  wait_ms        INTEGER NOT NULL,     -- oldest ticket -> first frame
  lobby_ms       INTEGER NOT NULL,     -- doors closed -> first frame
  reel_ms        INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,
  recorded_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS films (
  id           TEXT PRIMARY KEY,
  theater_id   INTEGER REFERENCES theaters(id),   -- NULL = in the reserve queue
  user_id      TEXT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  blurb        TEXT,
  filename     TEXT,                 -- NULL for procedurally-rendered slate films
  mime         TEXT,
  kind         TEXT NOT NULL DEFAULT 'upload',  -- upload|slate
  slate_json   TEXT,
  duration_ms  INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,        -- pending|approved|rejected|screened
  reject_reason TEXT,
  slot_index   INTEGER,
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);

CREATE TABLE IF NOT EXISTS reactions (
  id         TEXT PRIMARY KEY,
  theater_id INTEGER NOT NULL REFERENCES theaters(id),
  film_id    TEXT NOT NULL REFERENCES films(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,          -- rose|tomato
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  theater_id INTEGER NOT NULL REFERENCES theaters(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  film_id    TEXT NOT NULL REFERENCES films(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (theater_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat (
  id         TEXT PRIMARY KEY,
  theater_id INTEGER NOT NULL REFERENCES theaters(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  handle     TEXT NOT NULL,
  body       TEXT NOT NULL,
  phase      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

/* Raw demand history. This is what the House Manager measures. */
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,          -- ticket|submission|attend|vote|show
  theater_id INTEGER,
  user_id    TEXT,
  meta       TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_theater ON tickets(theater_id);
CREATE INDEX IF NOT EXISTS idx_films_theater ON films(theater_id, status);
CREATE INDEX IF NOT EXISTS idx_reactions_film ON reactions(film_id);
CREATE INDEX IF NOT EXISTS idx_chat_theater ON chat(theater_id, created_at);
`);

/* Theater numbers start at a nicer-looking number than 1. */
const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='theaters'").get();
if (!seq) {
  db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES('theaters', ?)")
    .run(Number(process.env.THEATER_START_NUMBER || 100));
}

module.exports = { db, DATA_DIR, VIDEO_DIR };
