-- Marginalia D1 schema. Apply with:  wrangler d1 execute marginalia --remote --file=schema.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  pw_hash      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher')),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Only the SHA-256 of the session token is stored, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passage_id     TEXT NOT NULL,
  attempt_id     TEXT NOT NULL,
  question_id    TEXT NOT NULL,
  qtype          TEXT NOT NULL,
  correct        INTEGER NOT NULL,           -- computed server-side, never trusted from the client
  given          TEXT,
  secs           INTEGER NOT NULL DEFAULT 0, -- time taken
  cause          TEXT CHECK (cause IN ('notfind','misread','time') OR cause IS NULL),
  evidence       TEXT CHECK (evidence IN ('hit','miss','skipped') OR evidence IS NULL),
  words_mattered INTEGER,
  ts             INTEGER NOT NULL,
  UNIQUE (user_id, attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_user_ts ON answers(user_id, ts);

-- Review deck, settings and attempt summaries (small JSON documents per student).
CREATE TABLE IF NOT EXISTS user_state (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deck       TEXT NOT NULL DEFAULT '[]',
  settings   TEXT NOT NULL DEFAULT '{}',
  attempts   TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
