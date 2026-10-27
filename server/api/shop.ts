import type { Purchase } from '../../shared/api';
import { purchase } from '../../shared/economy';
import { type ApiHandler, checkWrite, currentUser, fail, json, readJson, walletOf } from '../auth';

/**
 * POST /api/shop  { kind: 'car', car } | { kind: 'upgrade', car, part } -> { wallet }
 * Prices and funds are checked here, so money can only come from races.
 */
export const shop: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Not signed in.');
  const body = await readJson<Purchase>(request);
  if (!body || (body.kind !== 'car' && body.kind !== 'upgrade')) return fail(400, 'Invalid purchase.');

  const wallet = purchase(walletOf(user), body);
  if (typeof wallet === 'string') return fail(400, wallet);
  await db.prepare('UPDATE users SET wallet = ? WHERE id = ?').bind(JSON.stringify(wallet), user.id).run();
  return json({ wallet });
};
