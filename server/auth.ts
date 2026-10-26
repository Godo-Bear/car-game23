/** Shared helpers for the account API handlers in server/api. */
import type { CareerStats, ProfileResponse, RaceRecord } from '../shared/api';

export interface Env {
  /** Cloudflare D1 database for accounts (binding configured in wrangler.jsonc). */
  DB?: D1Database;
  /** The built game (dist/), served by Workers Static Assets. */
  ASSETS: Fetcher;
}

export type ApiHandler = (request: Request, env: Env) => Promise<Response>;

export interface UserRow {
  id: number;
  username: string;
  created_at: number;
  settings: string;
}

// Cloudflare Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOCKOUT_ATTEMPTS = 10;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

const encoder = new TextEncoder();

export const now = (): number => Math.floor(Date.now() / 1000);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: message }, status, headers);
}

/**
 * Parse a small JSON body. Requiring `application/json` (which a cross-site form can't send
 * without a CORS preflight) plus the Origin check below protects the cookie session from CSRF.
 */
export async function readJson<T>(request: Request): Promise<T | null> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return null;
  const text = await request.text();
  if (text.length > 4096) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Guard used by every mutating endpoint. Returns an error response, or null when OK. */
export function checkWrite(request: Request, env: Env): Response | null {
  if (!env.DB) return fail(503, 'Accounts database is not configured (missing D1 binding "DB").');
  if (!sameOrigin(request)) return fail(403, 'Cross-origin request blocked.');
  return null;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password: string, saltB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltB64), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toBase64(bits);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sessionCookie(token: string, maxAge: number): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, t + SESSION_TTL_SECONDS),
  ]);
  return sessionCookie(token, SESSION_TTL_SECONDS);
}

export const CLEAR_SESSION_COOKIE = sessionCookie('', 0);

function sessionToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'session') return v.join('=') || null;
  }
  return null;
}

export async function destroySession(db: D1Database, request: Request): Promise<void> {
  const token = sessionToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export async function currentUser(db: D1Database, request: Request): Promise<UserRow | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.username, u.created_at, u.settings
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), now())
    .first<UserRow>();
}

/** True if the username is temporarily locked after too many failed sign-ins. */
export async function isLockedOut(db: D1Database, username: string): Promise<boolean> {
  const row = await db.prepare('SELECT count, first_at FROM failed_logins WHERE username = ?').bind(username).first<{ count: number; first_at: number }>();
  return !!row && row.count >= LOCKOUT_ATTEMPTS && now() - row.first_at < LOCKOUT_WINDOW_SECONDS;
}

export async function recordFailedLogin(db: D1Database, username: string): Promise<void> {
  const t = now();
  await db
    .prepare(
      `INSERT INTO failed_logins (username, count, first_at) VALUES (?, 1, ?)
       ON CONFLICT(username) DO UPDATE SET
         count    = CASE WHEN ? - first_at > ? THEN 1 ELSE count + 1 END,
         first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`,
    )
    .bind(username, t, t, LOCKOUT_WINDOW_SECONDS, t, LOCKOUT_WINDOW_SECONDS, t)
    .run();
}

export async function clearFailedLogins(db: D1Database, username: string): Promise<void> {
  await db.prepare('DELETE FROM failed_logins WHERE username = ?').bind(username).run();
}

export async function loadProfile(db: D1Database, user: UserRow): Promise<ProfileResponse> {
  const [statsRow, recent] = await Promise.all([
    db
      .prepare('SELECT races, wins, podiums, best_lap, total_laps FROM stats WHERE user_id = ?')
      .bind(user.id)
      .first<{ races: number; wins: number; podiums: number; best_lap: number | null; total_laps: number }>(),
    db
      .prepare(
        `SELECT position, field_size, laps, difficulty, total_time, best_lap, created_at
           FROM race_results WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5`,
      )
      .bind(user.id)
      .all<{ position: number; field_size: number; laps: number; difficulty: RaceRecord['difficulty']; total_time: number | null; best_lap: number | null; created_at: number }>(),
  ]);
  const stats: CareerStats = {
    races: statsRow?.races ?? 0,
    wins: statsRow?.wins ?? 0,
    podiums: statsRow?.podiums ?? 0,
    bestLap: statsRow?.best_lap ?? null,
    totalLaps: statsRow?.total_laps ?? 0,
  };
  let settings = {};
  try {
    settings = JSON.parse(user.settings);
  } catch {
    settings = {};
  }
  return {
    username: user.username,
    createdAt: user.created_at,
    stats,
    settings,
    recent: recent.results.map((r) => ({
      position: r.position,
      fieldSize: r.field_size,
      laps: r.laps,
      difficulty: r.difficulty,
      totalTime: r.total_time,
      bestLap: r.best_lap,
      createdAt: r.created_at,
    })),
  };
}
