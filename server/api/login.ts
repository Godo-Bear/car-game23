import type { CredentialsRequest } from '../../shared/api';
import {
  checkWrite,
  clearFailedLogins,
  createSession,
  fail,
  hashPassword,
  isLockedOut,
  json,
  loadProfile,
  readJson,
  recordFailedLogin,
  timingSafeEqual,
  type ApiHandler,
  type UserRow,
} from '../auth';

// Unknown usernames still run a full hash (with this dummy salt) so they take as long to reject as wrong passwords.
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA==';

/** POST /api/login  { username, password } -> profile + session cookie */
export const login: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const body = await readJson<CredentialsRequest>(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 20 || password.length > 128) return fail(400, 'Enter your username and password.');

  if (await isLockedOut(db, username)) return fail(429, 'Too many failed attempts. Try again in 15 minutes.');

  const row = await db
    .prepare('SELECT id, username, created_at, settings, password_hash, salt FROM users WHERE username = ?')
    .bind(username)
    .first<UserRow & { password_hash: string; salt: string }>();
  const hash = await hashPassword(password, row?.salt ?? DUMMY_SALT);
  if (!row || !timingSafeEqual(hash, row.password_hash)) {
    await recordFailedLogin(db, username);
    return fail(401, 'Wrong username or password.');
  }
  await clearFailedLogins(db, username);
  const cookie = await createSession(db, row.id);
  return json(await loadProfile(db, row), 200, { 'set-cookie': cookie });
};
