/** Request/response shapes shared by the game client (src/) and the Cloudflare Pages Functions (functions/). */

export type Difficulty = 'easy' | 'normal' | 'hard';
export type TrackId = 'tokyo' | 'hakone' | 'sakura';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type CameraModeSetting = 'chase' | 'far' | 'hood';
export type CarId = 'gt' | 'hatch' | 'rally' | 'drift' | 'super';
export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl';
export type LiveryPattern = 'none' | 'stripes' | 'side' | 'twotone' | 'race';

/** The player's car and how it's painted (saved per car, so each car keeps its own look). */
export interface CarSetup {
  paint: string;
  finish: PaintFinish;
  pattern: LiveryPattern;
  accent: string;
  rims: string;
  number: number;
}

export interface CareerStats {
  races: number;
  wins: number;
  podiums: number;
  /** Best lap on any circuit in seconds (kept for older clients). */
  bestLap: number | null;
  /** Best lap per circuit, in seconds. */
  bestLaps: Partial<Record<TrackId, number>>;
  totalLaps: number;
}

export interface RaceRecord {
  /** Circuit raced (older results without it were all on the Tokyo circuit). */
  track: TrackId;
  position: number;
  fieldSize: number;
  laps: number;
  difficulty: Difficulty;
  totalTime: number | null;
  bestLap: number | null;
  /** Unix seconds (set by the server; optional when submitting). */
  createdAt?: number;
}

export interface PlayerSettings {
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  /** Stability control on/off. */
  assists: boolean;
  camera: CameraModeSetting;
  track: TrackId;
  timeOfDay: TimeOfDay;
  car: CarId;
  /** Customisation per car. */
  garage: Partial<Record<CarId, CarSetup>>;
}

export interface ProfileResponse {
  username: string;
  createdAt: number;
  stats: CareerStats;
  settings: Partial<PlayerSettings>;
  recent: RaceRecord[];
}

export interface CredentialsRequest {
  username: string;
  password: string;
}

export interface ErrorResponse {
  error: string;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const CAMERA_MODES: CameraModeSetting[] = ['chase', 'far', 'hood'];
export const TRACK_IDS: TrackId[] = ['tokyo', 'hakone', 'sakura'];
export const TIMES_OF_DAY: TimeOfDay[] = ['day', 'sunset', 'night'];
export const CAR_IDS: CarId[] = ['gt', 'hatch', 'rally', 'drift', 'super'];
export const PAINT_FINISHES: PaintFinish[] = ['gloss', 'metallic', 'matte', 'pearl'];
export const LIVERY_PATTERNS: LiveryPattern[] = ['none', 'stripes', 'side', 'twotone', 'race'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Validate a car setup from an untrusted source (request body, local storage). */
export function cleanCarSetup(raw: unknown): CarSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const color = (v: unknown) => (typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : null);
  const paint = color(r.paint);
  const accent = color(r.accent);
  const rims = color(r.rims);
  const finish = PAINT_FINISHES.find((f) => f === r.finish);
  const pattern = LIVERY_PATTERNS.find((p) => p === r.pattern);
  const number = typeof r.number === 'number' && Number.isInteger(r.number) && r.number >= 1 && r.number <= 99 ? r.number : null;
  if (!paint || !accent || !rims || !finish || !pattern || number === null) return null;
  return { paint, finish, pattern, accent, rims, number };
}
