import type { CourseId, Difficulty, RaceRecord, TimeOfDay, Wallet } from './api';

/**
 * Grand Prix: cups of four races with items on. Every race scores points by finishing place,
 * and the cup goes to whoever has the most after the fourth. A top-three finish wins a trophy
 * (gold, silver or bronze) for that cup and class (difficulty), with a bonus paid the first time
 * - or the difference, when you better a trophy you already have.
 */
export interface Cup {
  id: string;
  name: string;
  /** A kanji for the cup's emblem. */
  emblem: string;
  /** Emblem colour. */
  color: string;
  blurb: string;
  races: { track: CourseId; timeOfDay: TimeOfDay }[];
  /** Laps per race. */
  laps: number;
  /** What unlocks it (null: open from the start). */
  unlock: null | 'trophy' | 'freedrive';
}

export const CUPS: Cup[] = [
  {
    id: 'sakura',
    name: 'Sakura Cup',
    emblem: '桜',
    color: '#ff8fc2',
    blurb: 'Blossom valleys, the bamboo grove, the Izu coast and Osaka by day',
    races: [
      { track: 'sakura', timeOfDay: 'day' },
      { track: 'arashiyama', timeOfDay: 'day' },
      { track: 'izu', timeOfDay: 'sunset' },
      { track: 'osaka', timeOfDay: 'day' },
    ],
    laps: 2,
    unlock: null,
  },
  {
    id: 'neon',
    name: 'Neon Cup',
    emblem: '夜',
    color: '#7f6bff',
    blurb: 'Night in the big cities: Tokyo, Osaka and the Yokohama waterfront',
    races: [
      { track: 'tokyo', timeOfDay: 'night' },
      { track: 'osaka', timeOfDay: 'night' },
      { track: 'yokohama', timeOfDay: 'night' },
      { track: 'tokyo', timeOfDay: 'sunset' },
    ],
    laps: 2,
    unlock: null,
  },
  {
    id: 'mountain',
    name: 'Mountain Cup',
    emblem: '山',
    color: '#4fd18b',
    blurb: 'The passes: Hakone, the Irohazaka hairpins, Haruna at night and snowy Niseko',
    races: [
      { track: 'hakone', timeOfDay: 'day' },
      { track: 'irohazaka', timeOfDay: 'day' },
      { track: 'haruna', timeOfDay: 'night' },
      { track: 'niseko', timeOfDay: 'day' },
    ],
    laps: 2,
    unlock: 'trophy',
  },
  {
    id: 'city',
    name: 'City Cup',
    emblem: '街',
    color: '#ffb02e',
    blurb: 'Street races through the free drive city - with shortcuts down the side streets',
    races: [
      { track: 'city-ring', timeOfDay: 'day' },
      { track: 'city-tower', timeOfDay: 'sunset' },
      { track: 'city-wheel', timeOfDay: 'night' },
      { track: 'city-castle', timeOfDay: 'day' },
    ],
    laps: 2,
    unlock: 'freedrive',
  },
];

/** Points for 1st..8th (and nothing further back). */
export const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
/** Rivals in a Grand Prix field. */
export const GP_RIVALS = 7;
/** Trophy bonus for 1st, 2nd and 3rd overall, at each class. */
const TROPHY_BONUS = [20_000, 12_000, 8_000];
const CLASS_PAY: Record<Difficulty, number> = { easy: 0.6, normal: 1, hard: 1.6 };

export function cup(id: string | undefined): Cup | undefined {
  return CUPS.find((c) => c.id === id);
}

export function pointsFor(position: number): number {
  return GP_POINTS[position - 1] ?? 0;
}

/** The wallet key for a cup's trophy at a class. */
export const trophyKey = (cupId: string, difficulty: Difficulty) => `${cupId}:${difficulty}`;

/** Best trophy (1 gold, 2 silver, 3 bronze) for a cup at a class, if any. */
export function trophyOf(wallet: Wallet, cupId: string, difficulty: Difficulty): number | undefined {
  return wallet.trophies[trophyKey(cupId, difficulty)];
}

export function trophyBonus(place: number, difficulty: Difficulty): number {
  return place >= 1 && place <= 3 ? Math.round((TROPHY_BONUS[place - 1] * CLASS_PAY[difficulty]) / 100) * 100 : 0;
}

/**
 * Is the cup open? `freeDrive`: free drive is unlocked (the City Cup races on its map). The
 * Mountain Cup opens once you've won any trophy.
 */
export function cupUnlocked(wallet: Wallet, c: Cup, freeDrive: boolean): boolean {
  if (c.unlock === 'trophy') return Object.keys(wallet.trophies).length > 0;
  if (c.unlock === 'freedrive') return freeDrive;
  return true;
}

/** Overall standings after some races: [driver index, points], best first (ties: the better last result). */
export function standings(results: number[][]): { driver: number; points: number }[] {
  const n = results[0]?.length ?? 0;
  const rows = Array.from({ length: n }, (_, driver) => ({
    driver,
    points: results.reduce((sum, race) => sum + pointsFor(race[driver]), 0),
    last: results.length ? results[results.length - 1][driver] : 0,
  }));
  rows.sort((a, b) => b.points - a.points || a.last - b.last);
  return rows.map(({ driver, points }) => ({ driver, points }));
}

/**
 * Check a Grand Prix race result against its cup (the right course, laps and round, the cup
 * open), and work out the trophy bonus when it's the final round and you're on the podium
 * overall. Returns the wallet's new trophies and the bonus, or why it's wrong.
 */
export function settleGrandPrix(wallet: Wallet, r: RaceRecord, freeDrive: boolean): { trophies: Wallet['trophies']; bonus: number; trophy?: number } | string {
  const gp = r.gp!;
  const c = cup(gp.cup);
  if (!c) return 'Unknown cup.';
  if (!cupUnlocked(wallet, c, freeDrive)) return 'That cup is still locked.';
  const race = c.races[gp.round];
  if (!race || race.track !== r.track || r.laps !== c.laps) return 'That result does not match the cup.';
  const last = gp.round === c.races.length - 1;
  if (!last || gp.place === undefined) return { trophies: wallet.trophies, bonus: 0 };
  if (!Number.isInteger(gp.place) || gp.place < 1 || gp.place > r.fieldSize) return 'Invalid cup result.';
  if (gp.place > 3) return { trophies: wallet.trophies, bonus: 0 };
  const key = trophyKey(c.id, r.difficulty);
  const had = wallet.trophies[key];
  if (had !== undefined && had <= gp.place) return { trophies: wallet.trophies, bonus: 0, trophy: gp.place };
  // A better trophy pays the difference from the one you had.
  const bonus = trophyBonus(gp.place, r.difficulty) - (had ? trophyBonus(had, r.difficulty) : 0);
  return { trophies: { ...wallet.trophies, [key]: gp.place }, bonus, trophy: gp.place };
}
