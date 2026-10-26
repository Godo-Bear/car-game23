import { DIFFICULTIES, type RaceRecord, TRACK_IDS } from '../../shared/api';
import { type ApiHandler, checkWrite, currentUser, fail, json, loadProfile, now, readJson } from '../auth';

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isTime = (v: unknown, lo: number, hi: number): v is number | null => v === null || (typeof v === 'number' && v >= lo && v <= hi);

/**
 * POST /api/races  { track, position, fieldSize, laps, difficulty, totalTime, bestLap }
 * Records a finished race and updates career stats. (Results come from the browser, so this is
 * sanity-checked rather than cheat-proof - fine for a personal career record.)
 */
export const races: ApiHandler = async (request, env) => {
  const blocked = checkWrite(request, env);
  if (blocked) return blocked;
  const db = env.DB!;
  const user = await currentUser(db, request);
  if (!user) return fail(401, 'Not signed in.');

  const r = await readJson<RaceRecord>(request);
  // Clients from before multiple circuits existed didn't send one.
  if (r && r.track === undefined) r.track = 'tokyo';
  if (
    !r ||
    !TRACK_IDS.includes(r.track) ||
    !isInt(r.fieldSize, 2, 12) ||
    !isInt(r.position, 1, r.fieldSize) ||
    !isInt(r.laps, 1, 10) ||
    !DIFFICULTIES.includes(r.difficulty) ||
    !isTime(r.bestLap, 50, 900) ||
    !isTime(r.totalTime, 50, 9000)
  ) {
    return fail(400, 'Invalid race result.');
  }

  const t = now();
  const podium = r.position <= 3 ? 1 : 0;
  const win = r.position === 1 ? 1 : 0;
  await db.batch([
    db
      .prepare(
        'INSERT INTO race_results (user_id, track, position, field_size, laps, difficulty, total_time, best_lap, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(user.id, r.track, r.position, r.fieldSize, r.laps, r.difficulty, r.totalTime, r.bestLap, t),
    db
      .prepare(
        `INSERT INTO stats (user_id, races, wins, podiums, best_lap, total_laps, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           races = races + 1,
           wins = wins + excluded.wins,
           podiums = podiums + excluded.podiums,
           best_lap = CASE WHEN excluded.best_lap IS NULL THEN best_lap
                           WHEN best_lap IS NULL OR excluded.best_lap < best_lap THEN excluded.best_lap
                           ELSE best_lap END,
           total_laps = total_laps + excluded.total_laps,
           updated_at = excluded.updated_at`,
      )
      .bind(user.id, win, podium, r.bestLap, r.laps, t),
  ]);
  return json(await loadProfile(db, user), 201);
};
