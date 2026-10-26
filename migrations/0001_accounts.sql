-- Player accounts for Tokyo Circuit Racer (Cloudflare D1 / SQLite).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  settings      TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);

-- Only a SHA-256 of each session token is stored, so a database leak can't be replayed as cookies.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS stats (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  races      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  podiums    INTEGER NOT NULL DEFAULT 0,
  best_lap   REAL,
  total_laps INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS race_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  field_size INTEGER NOT NULL,
  laps       INTEGER NOT NULL,
  difficulty TEXT    NOT NULL,
  total_time REAL,
  best_lap   REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_user ON race_results(user_id, created_at DESC);

-- Simple brute-force protection: failed sign-ins per username in a rolling window.
CREATE TABLE IF NOT EXISTS failed_logins (
  username TEXT    PRIMARY KEY COLLATE NOCASE,
  count    INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
