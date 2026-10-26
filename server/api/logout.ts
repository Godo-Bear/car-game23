import { type ApiHandler, CLEAR_SESSION_COOKIE, checkWrite, destroySession, json } from '../auth';

/** POST /api/logout -> clears the session */
export const logout: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  await destroySession(env.DB!, request);
  return json({ ok: true }, 200, { 'set-cookie': CLEAR_SESSION_COOKIE });
};
