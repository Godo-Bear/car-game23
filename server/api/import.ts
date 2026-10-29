import { cleanAdminStats } from '../../shared/admin';
import type { CareerStats } from '../../shared/api';
import { mergeWallets } from '../../shared/wallet';
import { type ApiHandler, checkWrite, currentUser, fail, json, loadProfile, now, readJson, walletOf } from '../auth';

/**
 * POST /api/import  { wallet, stats } -> profile
 * Logging in or creating an account on a device that was played as a guest: what the guest
 * earned and bought there (money, drift points, cosmetics, upgrades, career results, race
 * counts) is added to the account (see mergeWallets). Like race results, this comes from the
 * browser, so it is sanity-checked rather than cheat-proof.
 */
export const importGuest: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Not signed in.');
  const body = await readJson<{ wallet?: unknown; stats?: Partial<CareerStats> }>(request);
  if (!body || typeof body !== 'object') return fail(400, 'Invalid request.');

  const wallet = mergeWallets(walletOf(user), body.wallet);
  const writes = [db.prepare('UPDATE users SET wallet = ? WHERE id = ?').bind(JSON.stringify(wallet), user.id)];
  const stats = cleanAdminStats(body.stats);
  const best = body.stats?.bestLap;
  const bestLap = typeof best === 'number' && best >= 50 && best <= 900 ? best : null;
  if (stats && stats.races > 0) {
    writes.push(
      db
        .prepare(
          `INSERT INTO stats (user_id, races, wins, podiums, best_lap, total_laps, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             races = races + excluded.races,
             wins = wins + excluded.wins,
             podiums = podiums + excluded.podiums,
             best_lap = CASE WHEN excluded.best_lap IS NULL THEN best_lap
                             WHEN best_lap IS NULL OR excluded.best_lap < best_lap THEN excluded.best_lap
                             ELSE best_lap END,
             total_laps = total_laps + excluded.total_laps,
             updated_at = excluded.updated_at`,
        )
        .bind(user.id, stats.races, stats.wins, stats.podiums, bestLap, stats.totalLaps, now()),
    );
  }
  await db.batch(writes);
  user.wallet = JSON.stringify(wallet);
  return json(await loadProfile(db, user));
};
