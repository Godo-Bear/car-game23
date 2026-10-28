import type { Purchase } from '../../shared/api';
import { purchase } from '../../shared/economy';
import { claimDaily, claimQuest, todayKey } from '../../shared/quests';
import { type ApiHandler, checkWrite, currentUser, fail, json, loadProfile, readJson, walletOf } from '../auth';

/**
 * POST /api/shop  { kind: 'car', car } | { kind: 'upgrade', car, part } | { kind: 'quest' | 'daily', quest } | { kind: 'item', item } -> { wallet }
 * Prices and funds are checked here, so money can only come from races.
 */
export const shop: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Not signed in.');
  const body = await readJson<Purchase>(request);
  if (!body || !['car', 'upgrade', 'quest', 'daily', 'item'].includes(body.kind)) return fail(400, 'Invalid purchase.');

  // Quest rewards are checked against this account's own career stats and today's races.
  const wallet =
    body.kind === 'quest'
      ? claimQuest(walletOf(user), (await loadProfile(db, user)).stats, String(body.quest))
      : body.kind === 'daily'
        ? claimDaily(walletOf(user), String(body.quest), todayKey())
        : purchase(walletOf(user), body);
  if (typeof wallet === 'string') return fail(400, wallet);
  await db.prepare('UPDATE users SET wallet = ? WHERE id = ?').bind(JSON.stringify(wallet), user.id).run();
  return json({ wallet });
};
