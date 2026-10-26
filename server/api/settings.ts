import { CAMERA_MODES, DIFFICULTIES, type PlayerSettings } from '../../shared/api';
import { checkWrite, currentUser, fail, json, readJson, type ApiHandler } from '../auth';

/** PUT /api/settings  Partial<PlayerSettings> -> saved settings (race setup remembered per account) */
export const settings: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Not signed in.');
  const body = await readJson<Partial<PlayerSettings>>(request);
  if (!body) return fail(400, 'Invalid settings.');

  const clean: Partial<PlayerSettings> = {};
  if (Number.isInteger(body.laps) && body.laps! >= 1 && body.laps! <= 10) clean.laps = body.laps;
  if (Number.isInteger(body.opponents) && body.opponents! >= 1 && body.opponents! <= 11) clean.opponents = body.opponents;
  if (body.difficulty && DIFFICULTIES.includes(body.difficulty)) clean.difficulty = body.difficulty;
  if (typeof body.assists === 'boolean') clean.assists = body.assists;
  if (body.camera && CAMERA_MODES.includes(body.camera)) clean.camera = body.camera;

  await db.prepare('UPDATE users SET settings = ? WHERE id = ?').bind(JSON.stringify(clean), user.id).run();
  return json({ settings: clean });
};
