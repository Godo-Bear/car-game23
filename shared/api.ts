/** Request/response shapes shared by the game client (src/) and the Cloudflare Pages Functions (functions/). */

export type Difficulty = 'easy' | 'normal' | 'hard';
export type TrackId = 'tokyo' | 'hakone' | 'sakura';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type CameraModeSetting = 'chase' | 'far' | 'hood';

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
