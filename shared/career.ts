import type { Difficulty, RaceRecord, TimeOfDay, TrackId, Wallet } from './api';
import { raceReward } from './economy';

/**
 * The career: a fixed run of events across every circuit, pinned on the city map. Each one sets
 * the circuit, time, laps, rivals and difficulty; a podium unlocks the next, and the first podium
 * on an event pays a bonus on top of the prize money. Shared by the game and the Worker.
 */
export interface CareerEvent {
  id: string;
  name: string;
  track: TrackId;
  timeOfDay: TimeOfDay;
  laps: number;
  /** AI rivals (the field is rivals + you). */
  rivals: number;
  difficulty: Difficulty;
  /** Paid once, for the first podium. */
  bonus: number;
  /** Pin on the career map picture, as fractions of its width and height. */
  pin: [number, number];
}

const ev = (
  id: string,
  name: string,
  track: TrackId,
  timeOfDay: TimeOfDay,
  laps: number,
  rivals: number,
  difficulty: Difficulty,
  bonus: number,
  pin: [number, number],
): CareerEvent => ({ id, name, track, timeOfDay, laps, rivals, difficulty, bonus, pin });

export const CAREER_EVENTS: CareerEvent[] = [
  ev('tokyo-debut', 'Tokyo Night Debut', 'tokyo', 'night', 2, 3, 'easy', 5000, [0.558, 0.694]),
  ev('sakura-spring', 'Sakura Spring Run', 'sakura', 'day', 2, 3, 'easy', 6000, [0.1, 0.765]),
  ev('hakone-climb', 'Hakone Hillclimb', 'hakone', 'day', 2, 5, 'easy', 7000, [0.287, 0.37]),
  ev('osaka-neon', 'Osaka Neon Sprint', 'osaka', 'night', 2, 5, 'easy', 8000, [0.382, 0.652]),
  ev('arashiyama-dash', 'Bamboo Grove Dash', 'arashiyama', 'day', 2, 5, 'normal', 9000, [0.882, 0.736]),
  ev('izu-cruise', 'Izu Coast Cruise', 'izu', 'sunset', 3, 5, 'normal', 10000, [0.151, 0.618]),
  ev('yokohama-lights', 'Harbour Lights', 'yokohama', 'night', 3, 5, 'normal', 11000, [0.627, 0.589]),
  ev('haruna-battle', 'Haruna Touge Battle', 'haruna', 'night', 3, 5, 'normal', 12000, [0.541, 0.346]),
  ev('irohazaka-autumn', 'Autumn Hairpins', 'irohazaka', 'day', 3, 7, 'normal', 13000, [0.729, 0.369]),
  ev('niseko-snow', 'Niseko Snow Run', 'niseko', 'day', 3, 7, 'normal', 14000, [0.418, 0.292]),
  ev('tokyo-expressway', 'Expressway GP', 'tokyo', 'sunset', 3, 7, 'normal', 15000, [0.462, 0.565]),
  ev('sakura-classic', 'Sakura Valley Classic', 'sakura', 'sunset', 3, 7, 'hard', 16000, [0.258, 0.503]),
  ev('osaka-castle', 'Osaka Castle Cup', 'osaka', 'day', 3, 7, 'hard', 17000, [0.391, 0.532]),
  ev('hakone-night', 'Hakone Night Pass', 'hakone', 'night', 3, 7, 'hard', 18000, [0.116, 0.403]),
  ev('izu-showdown', 'Sunset Showdown', 'izu', 'sunset', 3, 7, 'hard', 19000, [0.816, 0.556]),
  ev('niseko-midnight', 'Niseko Midnight', 'niseko', 'night', 3, 7, 'hard', 20000, [0.611, 0.276]),
  ev('irohazaka-legends', 'Irohazaka Legends', 'irohazaka', 'sunset', 5, 7, 'hard', 22000, [0.912, 0.428]),
  ev('yokohama-masters', 'Bay Masters', 'yokohama', 'sunset', 5, 7, 'hard', 24000, [0.694, 0.706]),
  ev('haruna-king', 'Downhill King', 'haruna', 'night', 5, 7, 'hard', 26000, [0.453, 0.424]),
  ev('tokyo-final', 'Tokyo Grand Final', 'tokyo', 'night', 5, 7, 'hard', 40000, [0.585, 0.547]),
];

export const CAREER_EVENT_IDS = CAREER_EVENTS.map((e) => e.id);

export function careerEvent(id: string | undefined): CareerEvent | undefined {
  return CAREER_EVENTS.find((e) => e.id === id);
}

/** Best finishing position on an event, or undefined if not raced yet. */
export function bestResult(wallet: Wallet, id: string): number | undefined {
  return wallet.events[id];
}

/** The first event is open; each later one opens with a podium on the one before. */
export function eventUnlocked(wallet: Wallet, id: string): boolean {
  const i = CAREER_EVENT_IDS.indexOf(id);
  if (i < 0) return false;
  if (i === 0) return true;
  const prev = wallet.events[CAREER_EVENT_IDS[i - 1]];
  return prev !== undefined && prev <= 3;
}

/** The next event to race: the first unlocked one without a podium yet (else the last). */
export function nextEvent(wallet: Wallet): CareerEvent {
  return CAREER_EVENTS.find((e) => eventUnlocked(wallet, e.id) && !((wallet.events[e.id] ?? 99) <= 3)) ?? CAREER_EVENTS[CAREER_EVENTS.length - 1];
}

/** Does a race result match the event it claims to be? */
export function matchesEvent(e: CareerEvent, r: Pick<RaceRecord, 'track' | 'laps' | 'difficulty' | 'fieldSize'>): boolean {
  return r.track === e.track && r.laps === e.laps && r.difficulty === e.difficulty && r.fieldSize === e.rivals + 1;
}

/**
 * Pay for a finished race and record it on the career: prize money, plus the event's bonus for a
 * first podium. Returns an error message for an event that is locked or doesn't match.
 */
export function settleRace(wallet: Wallet, r: RaceRecord): { wallet: Wallet; earned: number; bonus: number } | string {
  let earned = raceReward(r);
  let bonus = 0;
  let events = wallet.events;
  if (r.event !== undefined) {
    const e = careerEvent(r.event);
    if (!e) return 'Unknown event.';
    if (!eventUnlocked(wallet, e.id)) return 'That event is still locked.';
    if (!matchesEvent(e, r)) return 'That result does not match the event.';
    const before = wallet.events[e.id];
    if (r.position <= 3 && !(before !== undefined && before <= 3)) bonus = e.bonus;
    earned += bonus;
    events = { ...events, [e.id]: Math.min(before ?? 99, r.position) };
  }
  return { wallet: { ...wallet, credits: wallet.credits + earned, events }, earned, bonus };
}
