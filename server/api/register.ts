import { type CredentialsRequest, PASSWORD_MAX, PASSWORD_MIN, USERNAME_PATTERN } from '../../shared/api';
import { type ApiHandler, checkWrite, createSession, fail, hashPassword, json, loadProfile, now, randomSalt, readJson, type UserRow } from '../auth';

/** POST /api/register  { username, password } -> profile + session cookie */
export const register: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const body = await readJson<CredentialsRequest>(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!USERNAME_PATTERN.test(username)) return fail(400, 'Username must be 3-20 letters, numbers or underscores.');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return fail(400, `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`);
  }

  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const t = now();
  const inserted = await db
    .prepare(
      'INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING id, username, created_at, settings',
    )
    .bind(username, hash, salt, t)
    .first<UserRow>();
  if (!inserted) return fail(409, 'That username is taken.');
  await db.prepare('INSERT INTO stats (user_id, updated_at) VALUES (?, ?)').bind(inserted.id, t).run();

  const cookie = await createSession(db, inserted.id);
  return json(await loadProfile(db, inserted), 201, { 'set-cookie': cookie });
};
