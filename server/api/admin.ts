import { type AdminPlayer, type AdminRequest, isAdminCode, normaliseAdminCode } from '../../shared/admin';
import { cleanWallet } from '../../shared/economy';
import {
  type ApiHandler,
  checkWrite,
  clearFailedLogins,
  fail,
  isLockedOut,
  json,
  readJson,
  recordFailedLogin,
  timingSafeEqual,
  USER_COLUMNS,
  type UserRow,
  walletOf,
} from '../auth';

/**
 * POST /api/admin  { code, action: 'check' | 'list' | 'get' | 'set', username?, wallet? }
 * Look up any player and set their money, cars and upgrades. Every request carries the admin
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
      return user ? json(player(user)) : fail(404, 'No player with that name.');
    }
    case 'set': {
      const user = await find(body.username);
      if (!user) return fail(404, 'No player with that name.');
      const wallet = cleanWallet(body.wallet);
      await db.prepare('UPDATE users SET wallet = ? WHERE id = ?').bind(JSON.stringify(wallet), user.id).run();
      return json({ username: user.username, wallet });
    }
    default:
      return fail(400, 'Unknown action.');
  }
};
