import { describe, expect, it } from 'vitest';
import type { RaceRecord } from '../shared/api';
import { settleRace } from '../shared/career';
import { newWallet } from '../shared/economy';
import { CUPS, cup, cupUnlocked, GP_POINTS, pointsFor, standings, trophyBonus, trophyKey } from '../shared/grandprix';
import { cleanWallet, mergeWallets } from '../shared/wallet';
import { courseInfo, isCityCourse } from '../src/track/tracks';

const round = (cupId: string, r: number, position: number, place?: number): RaceRecord => {
  const c = cup(cupId)!;
  return {
    track: c.races[r].track,
    position,
    fieldSize: 8,
    laps: c.laps,
    difficulty: 'normal',
    totalTime: 200,
    bestLap: 90,
    gp: { cup: cupId, round: r, ...(place !== undefined ? { place } : {}) },
  };
};

describe('grand prix', () => {
  it('has four cups of four races on real courses', () => {
    expect(CUPS.length).toBe(4);
    for (const c of CUPS) {
      expect(c.races.length).toBe(4);
      for (const r of c.races) expect(courseInfo(r.track).name.length).toBeGreaterThan(2);
    }
    expect(cup('city')!.races.every((r) => isCityCourse(r.track))).toBe(true);
  });

  it('scores points by place and ranks the standings', () => {
    expect(pointsFor(1)).toBe(GP_POINTS[0]);
    expect(pointsFor(9)).toBe(0);
    // Three drivers over two races: driver 1 wins both; 0 and 2 tie, and 2 was ahead last time.
    const table = standings([
      [2, 1, 3],
      [3, 1, 2],
    ]);
    expect(table.map((r) => r.driver)).toEqual([1, 2, 0]);
    expect(table[0].points).toBe(30);
    // A tie goes to the better last result.
    expect(
      standings([
        [1, 2],
        [2, 1],
      ])[0].driver,
    ).toBe(1);
  });

  it('pays a trophy once, and the difference for a better one', () => {
    let w = newWallet();
    const first = settleRace(w, round('sakura', 3, 2, 3));
    if (typeof first === 'string') throw new Error(first);
    expect(first.trophy).toBe(3);
    expect(first.trophyBonus).toBe(trophyBonus(3, 'normal'));
    w = first.wallet;
    expect(w.trophies[trophyKey('sakura', 'normal')]).toBe(3);
    // Bronze again: nothing more.
    const again = settleRace(w, round('sakura', 3, 4, 3));
    if (typeof again === 'string') throw new Error(again);
    expect(again.trophyBonus).toBe(0);
    // Gold: the difference.
    const gold = settleRace(w, round('sakura', 3, 1, 1));
    if (typeof gold === 'string') throw new Error(gold);
    expect(gold.trophyBonus).toBe(trophyBonus(1, 'normal') - trophyBonus(3, 'normal'));
    expect(gold.wallet.trophies[trophyKey('sakura', 'normal')]).toBe(1);
    // Earlier rounds pay the race only.
    const mid = settleRace(w, round('sakura', 1, 1));
    if (typeof mid === 'string') throw new Error(mid);
    expect(mid.trophy).toBeUndefined();
    expect(mid.earned).toBeGreaterThan(0);
  });

  it('checks the result matches the cup, and that the cup is open', () => {
    const w = newWallet();
    expect(settleRace(w, { ...round('sakura', 0, 1), track: 'tokyo' })).toBe('That result does not match the cup.');
    expect(settleRace(w, { ...round('sakura', 0, 1), gp: { cup: 'nope', round: 0 } })).toBe('Unknown cup.');
    expect(settleRace(w, round('mountain', 0, 1))).toBe('That cup is still locked.');
    expect(settleRace(w, round('city', 0, 1))).toBe('That cup is still locked.');
    // Any trophy opens the Mountain Cup; free drive (three career events) opens the City Cup.
    const withTrophy = { ...w, trophies: { [trophyKey('neon', 'easy')]: 3 } };
    expect(cupUnlocked(withTrophy, cup('mountain')!, false)).toBe(true);
    const open = { ...w, events: { 'tokyo-debut': 1, 'sakura-spring': 2, 'hakone-climb': 3 } };
    expect(typeof settleRace(open, round('city', 0, 1))).toBe('object');
  });

  it('keeps trophies through saving and when a guest logs in', () => {
    const w = { ...newWallet(), trophies: { [trophyKey('neon', 'hard')]: 2, 'bogus:normal': 1, [trophyKey('sakura', 'easy')]: 7 } };
    const clean = cleanWallet(JSON.parse(JSON.stringify(w)));
    expect(clean.trophies).toEqual({ [trophyKey('neon', 'hard')]: 2 });
    const merged = mergeWallets({ ...newWallet(), trophies: { [trophyKey('neon', 'hard')]: 3 } }, clean);
    expect(merged.trophies[trophyKey('neon', 'hard')]).toBe(2);
  });
});
