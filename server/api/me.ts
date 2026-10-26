import { type ApiHandler, currentUser, fail, json, loadProfile } from '../auth';

/** GET /api/me -> the signed-in player's profile, or 401 */
export const me: ApiHandler = async (request, env) => {
  if (!env.DB) return fail(503, 'Accounts database is not configured (missing D1 binding "DB").');
  const user = await currentUser(env.DB, request);
  if (!user) return fail(401, 'Not signed in.');
  return json(await loadProfile(env.DB, user));
};
