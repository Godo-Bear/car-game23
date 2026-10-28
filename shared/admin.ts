import type { CareerStats, Wallet } from './api';

/**
 * Admin access. Only a SHA-256 of the admin code is kept here (the repository is public); the
 * Worker can also be given its own code with `wrangler secret put ADMIN_CODE`, which then replaces
 * this one. Codes are compared ignoring case and extra spaces.
 */
export const ADMIN_CODE_SHA256 = 'caabe118bbd7cb8e1d5ae197684e3f2fc5b2037f56aa1a67847d4aef7501f47b';

export function normaliseAdminCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True if `code` is the built-in admin code. */
export async function isAdminCode(code: string): Promise<boolean> {
  return (await sha256Hex(normaliseAdminCode(code))) === ADMIN_CODE_SHA256;
}

/** POST /api/admin */
export type AdminRequest =
  | { code: string; action: 'check' }
  | { code: string; action: 'list' }
  | { code: string; action: 'get'; username: string }
  | { code: string; action: 'set'; username: string; wallet: Wallet }
  | { code: string; action: 'stats'; username: string; stats: AdminStats };

/** The career counters an admin can set. */
export type AdminStats = Pick<CareerStats, 'races' | 'wins' | 'podiums' | 'totalLaps'>;

export interface AdminPlayer {
  username: string;
  wallet: Wallet;
  /** Sent by 'get' (not by 'list'). */
  stats?: AdminStats;
}

/** Validate admin-set stats: whole numbers, wins <= podiums <= races. Null if unusable. */
export function cleanAdminStats(raw: unknown): AdminStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000 ? (v as number) : null);
  const races = n(r.races);
  const podiums = n(r.podiums);
  const wins = n(r.wins);
  const totalLaps = n(r.totalLaps);
  if (races === null || podiums === null || wins === null || totalLaps === null) return null;
  if (wins > podiums || podiums > races) return null;
  return { races, wins, podiums, totalLaps };
}
