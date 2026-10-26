import schemaSql from '../migrations/0001_accounts.sql';

/**
 * Creates the account tables on first use, so a fresh D1 database works without running
 * `wrangler d1 migrations apply` by hand. Every statement is `IF NOT EXISTS`, so this is a
 * no-op once the schema exists; it runs once per Worker isolate.
 */
const statements = schemaSql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= db
    .batch(statements.map((s) => db.prepare(s)))
    .then(() => undefined)
    .catch((err: unknown) => {
      ready = null;
      throw err;
    });
  return ready;
}
