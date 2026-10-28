import { type ItemKind, shopItem } from './items';
import type { DailyProgress } from './quests';
/** Request/response shapes shared by the game client (src/) and the Cloudflare Pages Functions (functions/). */

export type Difficulty = 'easy' | 'normal' | 'hard';
export type TrackId = 'tokyo' | 'osaka' | 'yokohama' | 'hakone' | 'irohazaka' | 'haruna' | 'niseko' | 'sakura' | 'arashiyama' | 'izu';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type CameraModeSetting = 'chase' | 'far' | 'hood';
export type CarId = 'starter' | 'hatch' | 'gt' | 'drift' | 'rally' | 'super';
/** The first four are free; satin, candy and chrome are bought in the shop (shared/items.ts). */
export type PaintFinish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'satin' | 'candy' | 'chrome';
export type LiveryPattern = 'none' | 'stripes' | 'side' | 'twotone' | 'race';

/** The player's car and how it's painted (saved per car, so each car keeps its own look). */
export interface CarSetup {
  paint: string;
  finish: PaintFinish;
  pattern: LiveryPattern;
  accent: string;
  rims: string;
  number: number;
  /** Personalised number plate text (see cleanPlate). */
  plate: string;
  /** Shop items fitted (item ids from shared/items.ts; none when missing). */
  glow?: string;
  flame?: string;
  smoke?: string;
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
  /** Career event this race was (see shared/career.ts). */
  event?: string;
  /** Drift points scored (paid into the wallet's DP; capped by the race time). */
  driftPoints?: number;
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

/** Money, cars and upgrades (see shared/economy.ts). */
export interface Wallet {
  credits: number;
  /** Cars bought (the starter car is always owned). */
  owned: CarId[];
  /** Upgrade levels per owned car. */
  upgrades: Partial<Record<CarId, Upgrades>>;
  /** Career events raced: best finishing position per event id. */
  events: Record<string, number>;
  /** Mega quests whose reward has been claimed (see shared/quests.ts). */
  quests: string[];
  /** Today's racing toward the daily quests. */
  daily: DailyProgress;
  /** Best stars per career event (1..3, from its time limits). */
  stars: Record<string, number>;
  /** Drift points to spend, and all ever scored. */
  dp: number;
  dpTotal: number;
  /** Shop cosmetics bought (shared/items.ts). */
  items: string[];
}

export type UpgradePart = 'engine' | 'gearbox' | 'aero' | 'tyres' | 'suspension' | 'brakes' | 'diff' | 'nitro';
export type Upgrades = Record<UpgradePart, number>;

export interface ProfileResponse {
  username: string;
  createdAt: number;
  stats: CareerStats;
  settings: Partial<PlayerSettings>;
  recent: RaceRecord[];
  wallet: Wallet;
}

/** POST /api/shop: buy a car, or the next level of an upgrade for an owned car. */
export type Purchase =
  | { kind: 'car'; car: CarId }
  | { kind: 'upgrade'; car: CarId; part: UpgradePart }
  | { kind: 'quest'; quest: string }
  | { kind: 'daily'; quest: string }
  | { kind: 'item'; item: string };

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
export const TRACK_IDS: TrackId[] = ['tokyo', 'osaka', 'yokohama', 'hakone', 'irohazaka', 'haruna', 'niseko', 'sakura', 'arashiyama', 'izu'];
export const TIMES_OF_DAY: TimeOfDay[] = ['day', 'sunset', 'night'];
/** Cheapest to dearest (the shop's order). */
export const CAR_IDS: CarId[] = ['starter', 'hatch', 'gt', 'drift', 'rally', 'super'];
export const PAINT_FINISHES: PaintFinish[] = ['gloss', 'metallic', 'matte', 'pearl', 'satin', 'candy', 'chrome'];
export const LIVERY_PATTERNS: LiveryPattern[] = ['none', 'stripes', 'side', 'twotone', 'race'];

export const PLATE_LENGTH = 8;
export const DEFAULT_PLATE = 'TOKYO';

/**
 * Tidy plate text typed by a player: capitals, digits, single spaces and dashes, at most
 * PLATE_LENGTH characters. Null when nothing usable is left.
 */
export function cleanPlate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLATE_LENGTH)
    .trim();
  return text || null;
}

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
  // Saved before plates existed: keep the paint job, give it the default plate.
  const setup: CarSetup = { paint, finish, pattern, accent, rims, number, plate: cleanPlate(r.plate) ?? DEFAULT_PLATE };
  // Fitted items: only known ones of the right kind.
  const fitted = (v: unknown, kind: ItemKind) => (typeof v === 'string' && shopItem(v)?.kind === kind ? v : undefined);
  for (const kind of ['glow', 'flame', 'smoke'] as const) {
    const id = fitted(r[kind], kind);
    if (id) setup[kind] = id;
  }
  return setup;
}
