import type { Difficulty, RaceRecord, TimeOfDay, TrackId, Wallet } from './api';
import { raceReward } from './economy';

/**
 * The career: a fixed run of events across every circuit, pinned on the city map. Each one sets
 * the circuit, time, laps and rivals; you pick the difficulty (harder pays more). A podium on any
 * difficulty unlocks the next event, and the first podium pays a bonus on top of the prize money.
 * Finishing inside an event's time limits earns up to three stars, each paying a star bonus once.
 * Shared by the game and the Worker.
 */
export interface CareerEvent {
  id: string;
  name: string;
  track: TrackId;
  timeOfDay: TimeOfDay;
  laps: number;
  /** AI rivals (the field is rivals + you). */
  rivals: number;
  /** Suggested difficulty (any can be chosen). */
  difficulty: Difficulty;
  /** Paid once, for the first podium. */
  bonus: number;
  /**
   * Pin on the map picture (the free drive map: the city in the middle, the countryside round it
   * and the mountains beyond), as fractions of its width and height.
   */
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
  ev('tokyo-debut', 'Tokyo Night Debut', 'tokyo', 'night', 2, 3, 'easy', 5000, [0.463, 0.578]),
  ev('sakura-spring', 'Sakura Spring Run', 'sakura', 'day', 2, 3, 'easy', 6000, [0.309, 0.683]),
  ev('hakone-climb', 'Hakone Hillclimb', 'hakone', 'day', 2, 5, 'easy', 7000, [0.162, 0.448]),
  ev('osaka-neon', 'Osaka Neon Sprint', 'osaka', 'night', 2, 5, 'easy', 8000, [0.397, 0.5]),
  ev('arashiyama-dash', 'Bamboo Grove Dash', 'arashiyama', 'day', 2, 5, 'normal', 9000, [0.691, 0.343]),
  ev('izu-cruise', 'Izu Coast Cruise', 'izu', 'sunset', 3, 5, 'normal', 10000, [0.441, 0.905]),
  ev('yokohama-lights', 'Harbour Lights', 'yokohama', 'night', 3, 5, 'normal', 11000, [0.61, 0.565]),
  ev('haruna-battle', 'Haruna Touge Battle', 'haruna', 'night', 3, 5, 'normal', 12000, [0.838, 0.421]),
  ev('irohazaka-autumn', 'Autumn Hairpins', 'irohazaka', 'day', 3, 7, 'normal', 13000, [0.176, 0.134]),
  ev('niseko-snow', 'Niseko Snow Run', 'niseko', 'day', 3, 7, 'normal', 14000, [0.118, 0.892]),
  ev('tokyo-expressway', 'Expressway GP', 'tokyo', 'sunset', 3, 7, 'normal', 15000, [0.549, 0.542]),
  ev('sakura-classic', 'Sakura Valley Classic', 'sakura', 'sunset', 3, 7, 'hard', 16000, [0.324, 0.291]),
  ev('osaka-castle', 'Osaka Castle Cup', 'osaka', 'day', 3, 7, 'hard', 17000, [0.412, 0.356]),
  ev('hakone-night', 'Hakone Night Pass', 'hakone', 'night', 3, 7, 'hard', 18000, [0.103, 0.709]),
  ev('izu-showdown', 'Sunset Showdown', 'izu', 'sunset', 3, 7, 'hard', 19000, [0.632, 0.866]),
  ev('niseko-midnight', 'Niseko Midnight', 'niseko', 'night', 3, 7, 'hard', 20000, [0.868, 0.892]),
  ev('irohazaka-legends', 'Irohazaka Legends', 'irohazaka', 'sunset', 5, 7, 'hard', 22000, [0.824, 0.134]),
  ev('yokohama-masters', 'Bay Masters', 'yokohama', 'sunset', 5, 7, 'hard', 24000, [0.596, 0.709]),
  ev('haruna-king', 'Downhill King', 'haruna', 'night', 5, 7, 'hard', 26000, [0.897, 0.657]),
  ev('tokyo-final', 'Tokyo Grand Final', 'tokyo', 'night', 5, 7, 'hard', 40000, [0.5, 0.461]),
];

export const CAREER_EVENT_IDS = CAREER_EVENTS.map((e) => e.id);

export function careerEvent(id: string | undefined): CareerEvent | undefined {
  return CAREER_EVENTS.find((e) => e.id === id);
}

/** Best finishing position on an event, or undefined if not raced yet. */
export function bestResult(wallet: Wallet, id: string): number | undefined {
  return wallet.events[id];
}

/** Career events needed (any finishing position) to unlock free drive. */
export const FREE_DRIVE_EVENTS = 3;

/** How many different career events have been raced to the finish. */
export function eventsFinished(wallet: Wallet): number {
  return CAREER_EVENT_IDS.filter((id) => wallet.events[id] !== undefined).length;
}

/** Free drive opens once you've finished three career events. */
export function freeDriveUnlocked(wallet: Wallet): boolean {
  return eventsFinished(wallet) >= FREE_DRIVE_EVENTS;
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

/** Does a race result match the event it claims to be? (Any difficulty counts.) */
export function matchesEvent(e: CareerEvent, r: Pick<RaceRecord, 'track' | 'laps' | 'fieldSize'>): boolean {
  return r.track === e.track && r.laps === e.laps && r.fieldSize === e.rivals + 1;
}

// ---------------------------------------------------------------- stars

/**
 * Par lap per circuit in seconds: the AI's typical lap in a stock car on Normal (measured from
 * simulated races). Star time limits are a race's worth of par laps, stretched a little.
 */
export const PAR_LAP: Record<TrackId, number> = {
  tokyo: 109,
  osaka: 98,
  yokohama: 94,
  hakone: 105,
  irohazaka: 101,
  haruna: 108,
  niseko: 77,
  sakura: 77,
  arashiyama: 83,
  izu: 77,
};
/** Slack on par for one, two and three stars. */
const STAR_SLACK = [1.4, 1.18, 1.04];
/** Money for each star the first time it's earned. */
export const STAR_BONUS = 1500;
export const MAX_STARS = 3;

/** Finishing times (seconds) for one, two and three stars on an event. */
export function starTimes(e: CareerEvent): number[] {
  return STAR_SLACK.map((k) => Math.round(PAR_LAP[e.track] * e.laps * k));
}

/** Stars for a finishing time (0 for no time, or one too fast to be real). */
export function starsFor(e: CareerEvent, totalTime: number | null | undefined): number {
  if (typeof totalTime !== 'number' || totalTime < PAR_LAP[e.track] * e.laps * 0.6) return 0;
  return starTimes(e).filter((t) => totalTime <= t).length;
}

/** All stars earned on the career. */
export function totalStars(wallet: Wallet): number {
  return Object.values(wallet.stars).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------- drift points

/** Most drift points a race can score per second of racing (sanity cap on reported scores). */
export const DRIFT_CAP_PER_SECOND = 900;

/** The drift points a result is worth, capped by how long the race took. */
export function raceDriftPoints(r: Pick<RaceRecord, 'driftPoints' | 'totalTime' | 'laps'>): number {
  const dp = r.driftPoints;
  if (typeof dp !== 'number' || !Number.isFinite(dp) || dp <= 0) return 0;
  const seconds = typeof r.totalTime === 'number' ? r.totalTime : r.laps * 60;
  return Math.floor(Math.min(dp, seconds * DRIFT_CAP_PER_SECOND));
}

export interface Settled {
  wallet: Wallet;
  /** Money paid in total. */
  earned: number;
  /** First-podium bonus (part of earned). */
  bonus: number;
  /** Stars this run earned, and how many of them are new (each paid STAR_BONUS, part of earned). */
  stars: number;
  newStars: number;
  /** Drift points banked. */
  dp: number;
}

/**
 * Pay for a finished race and record it on the career: prize money, plus the event's bonus for a
 * first podium and a bonus per new star, and the race's drift points. Returns an error message
 * for an event that is locked or doesn't match.
 */
export function settleRace(wallet: Wallet, r: RaceRecord): Settled | string {
  let earned = raceReward(r);
  let bonus = 0;
  let stars = 0;
  let newStars = 0;
  let events = wallet.events;
  let starMap = wallet.stars;
  if (r.event !== undefined) {
    const e = careerEvent(r.event);
    if (!e) return 'Unknown event.';
    if (!eventUnlocked(wallet, e.id)) return 'That event is still locked.';
    if (!matchesEvent(e, r)) return 'That result does not match the event.';
    const before = wallet.events[e.id];
    if (r.position <= 3 && !(before !== undefined && before <= 3)) bonus = e.bonus;
    events = { ...events, [e.id]: Math.min(before ?? 99, r.position) };
    stars = starsFor(e, r.totalTime);
    const had = wallet.stars[e.id] ?? 0;
    newStars = Math.max(0, stars - had);
    if (newStars) starMap = { ...starMap, [e.id]: stars };
    earned += bonus + newStars * STAR_BONUS;
  }
  const dp = raceDriftPoints(r);
  return {
    wallet: { ...wallet, credits: wallet.credits + earned, events, stars: starMap, dp: wallet.dp + dp, dpTotal: wallet.dpTotal + dp },
    earned,
    bonus,
    stars,
    newStars,
    dp,
  };
}
