import { type AdminPlayer, type AdminRequest, cleanAdminStats, isAdminCode, normaliseAdminCode } from '../../shared/admin';
import { cleanWallet } from '../../shared/wallet';
import {
  type ApiHandler,
  checkWrite,
  clearFailedLogins,
  fail,
  isLockedOut,
  json,
  loadProfile,
  now,
  readJson,
  recordFailedLogin,
  timingSafeEqual,
  USER_COLUMNS,
  type UserRow,
  walletOf,
} from '../auth';

/**
 * POST /api/admin  { code, action: 'check' | 'list' | 'get' | 'set' | 'stats', username?, wallet?, stats? }
 * Look up any player and set their wallet (money, DP, cars, upgrades, items, career, quests) or
 * their career stats. Every request carries the admin
 * code; wrong codes are counted per network address and lock it out like failed sign-ins.
 */
export const admin: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const body = await readJson<AdminRequest>(request);
  if (!body || typeof body.code !== 'string') return fail(400, 'Invalid request.');

  const who = `admin@${request.headers.get('cf-connecting-ip') ?? 'unknown'}`;
  if (await isLockedOut(db, who)) return fail(429, 'Too many wrong codes. Try again in 15 minutes.');
  const ok = env.ADMIN_CODE ? timingSafeEqual(normaliseAdminCode(body.code), normaliseAdminCode(env.ADMIN_CODE)) : await isAdminCode(body.code);
  if (!ok) {
    await recordFailedLogin(db, who);
    return fail(403, 'Wrong admin code.');
  }
  await clearFailedLogins(db, who);

  const find = (username: unknown) =>
    typeof username === 'string' && username.length <= 20
      ? db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`).bind(username).first<UserRow>()
      : null;
  const player = (u: UserRow): AdminPlayer => ({ username: u.username, wallet: walletOf(u) });

  switch (body.action) {
    case 'check':
      return json({ ok: true });
    case 'list': {
      const rows = await db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username COLLATE NOCASE LIMIT 200`).all<UserRow>();
      return json({ players: rows.results.map(player) });
    }
    case 'get': {
      const user = await find(body.username);
      if (!user) return fail(404, 'No player with that name.');
      const { stats } = await loadProfile(db, user);
      return json({ ...player(user), stats: { races: stats.races, wins: stats.wins, podiums: stats.podiums, totalLaps: stats.totalLaps } });
    }
    case 'set': {
      const user = await find(body.username);
      if (!user) return fail(404, 'No player with that name.');
      const wallet = cleanWallet(body.wallet);
      await db.prepare('UPDATE users SET wallet = ? WHERE id = ?').bind(JSON.stringify(wallet), user.id).run();
      return json({ username: user.username, wallet });
    }
    case 'stats': {
      const user = await find(body.username);
      if (!user) return fail(404, 'No player with that name.');
      const stats = cleanAdminStats(body.stats);
      if (!stats) return fail(400, 'Stats must be whole numbers, with wins ≤ podiums ≤ races.');
      await db
        .prepare(
          `INSERT INTO stats (user_id, races, wins, podiums, best_lap, total_laps, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET races = excluded.races, wins = excluded.wins, podiums = excluded.podiums,
             total_laps = excluded.total_laps, updated_at = excluded.updated_at`,
        )
        .bind(user.id, stats.races, stats.wins, stats.podiums, stats.totalLaps, now())
        .run();
      return json({ username: user.username, stats });
    }
    default:
      return fail(400, 'Unknown action.');
  }
};
