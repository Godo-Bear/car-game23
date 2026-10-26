import schemaSql from '../migrations/0001_accounts.sql';
import raceTrackSql from '../migrations/0002_race_track.sql';

/**
 * Creates the account tables on first use, so a fresh D1 database works without running
 * `wrangler d1 migrations apply` by hand. Every statement is `IF NOT EXISTS` (or a column
 * addition that's skipped once present), so this is a no-op once the schema is current; it runs
 * once per Worker isolate.
 */
const split = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

const statements = split(schemaSql);
/** Later column additions; each is skipped if a previous run already applied it. */
const upgrades = split(raceTrackSql);

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= (async () => {
    await db.batch(statements.map((s) => db.prepare(s)));
    for (const sql of upgrades) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        if (!String(err).includes('duplicate column')) throw err;
      }
    }
  })().catch((err: unknown) => {
    ready = null;
    throw err;
  });
  return ready;
}
