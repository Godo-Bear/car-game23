-- Career money, owned cars and upgrades (JSON, see shared/economy.ts). '{}' means a fresh start.
ALTER TABLE users ADD COLUMN wallet TEXT NOT NULL DEFAULT '{}';
