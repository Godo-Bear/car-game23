import { describe, expect, it } from 'vitest';
import type { RaceRecord } from '../shared/api';
import { CAREER_EVENTS, DRIFT_CAP_PER_SECOND, eventUnlocked, nextEvent, PAR_LAP, STAR_BONUS, settleRace, starsFor, starTimes } from '../shared/career';
import { newWallet, raceReward } from '../shared/economy';
import { settleResult } from '../shared/quests';
import { cleanWallet } from '../shared/wallet';
import { TRACKS } from '../src/track/tracks';

const result = (i: number, position: number): RaceRecord => {
  const e = CAREER_EVENTS[i];
  return { track: e.track, position, fieldSize: e.rivals + 1, laps: e.laps, difficulty: e.difficulty, totalTime: 900, bestLap: 90, event: e.id };
};

describe('career', () => {
  it('has events on every circuit, with unique ids and pins on the map', () => {
    const ids = new Set(CAREER_EVENTS.map((e) => e.id));
    expect(ids.size).toBe(CAREER_EVENTS.length);
    for (const id of Object.keys(TRACKS)) expect(CAREER_EVENTS.some((e) => e.track === id)).toBe(true);
    for (const e of CAREER_EVENTS) {
      expect(e.pin[0]).toBeGreaterThan(0);
      expect(e.pin[0]).toBeLessThan(1);
      expect(e.pin[1]).toBeGreaterThan(0);
      expect(e.pin[1]).toBeLessThan(1);
    }
  });

  it('opens one event at a time: a podium unlocks the next', () => {
    let w = newWallet();
    expect(nextEvent(w).id).toBe(CAREER_EVENTS[0].id);
    expect(eventUnlocked(w, CAREER_EVENTS[1].id)).toBe(false);
    // 5th place: paid, but the next event stays locked.
    let s = settleRace(w, result(0, 5));
    if (typeof s === 'string') throw new Error(s);
    w = s.wallet;
    expect(eventUnlocked(w, CAREER_EVENTS[1].id)).toBe(false);
    s = settleRace(w, result(0, 2));
    if (typeof s === 'string') throw new Error(s);
    w = s.wallet;
    expect(eventUnlocked(w, CAREER_EVENTS[1].id)).toBe(true);
    expect(nextEvent(w).id).toBe(CAREER_EVENTS[1].id);
    expect(w.events[CAREER_EVENTS[0].id]).toBe(2);
  });

  it('pays the bonus once, for the first podium', () => {
    const w0 = newWallet();
    const first = settleRace(w0, result(0, 1));
    if (typeof first === 'string') throw new Error(first);
    expect(first.bonus).toBe(CAREER_EVENTS[0].bonus);
    expect(first.wallet.credits).toBe(w0.credits + raceReward(result(0, 1)) + CAREER_EVENTS[0].bonus);
    const again = settleRace(first.wallet, result(0, 1));
    if (typeof again === 'string') throw new Error(again);
    expect(again.bonus).toBe(0);
  });

  it('refuses locked events and results that do not match the event', () => {
    expect(settleRace(newWallet(), result(3, 1))).toBe('That event is still locked.');
    expect(settleRace(newWallet(), { ...result(0, 1), laps: 9 })).toBe('That result does not match the event.');
    expect(settleRace(newWallet(), { ...result(0, 1), event: 'nope' })).toBe('Unknown event.');
  });

  it('keeps only known events in stored wallets', () => {
    const w = cleanWallet({ credits: 10, owned: [], events: { [CAREER_EVENTS[0].id]: 2, bogus: 1, [CAREER_EVENTS[1].id]: 40 } });
    expect(w.events).toEqual({ [CAREER_EVENTS[0].id]: 2 });
  });

  it('counts a race on any difficulty, easy included', () => {
    const e = CAREER_EVENTS[0];
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const s = settleRace(newWallet(), { ...result(0, 1), difficulty });
      if (typeof s === 'string') throw new Error(s);
      expect(s.wallet.events[e.id]).toBe(1);
      expect(s.bonus).toBe(e.bonus);
    }
    // ...but harder pays more prize money.
    const easy = settleRace(newWallet(), { ...result(0, 1), difficulty: 'easy' });
    const hard = settleRace(newWallet(), { ...result(0, 1), difficulty: 'hard' });
    if (typeof easy === 'string' || typeof hard === 'string') throw new Error('refused');
    expect(hard.earned).toBeGreaterThan(easy.earned);
  });

  it('has star time limits from par laps, harder for each star', () => {
    for (const e of CAREER_EVENTS) {
      const [one, two, three] = starTimes(e);
      expect(one).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(three);
      expect(three).toBeGreaterThanOrEqual(PAR_LAP[e.track] * e.laps);
      expect(starsFor(e, three)).toBe(3);
      expect(starsFor(e, two)).toBe(2);
      expect(starsFor(e, one + 1)).toBe(0);
      expect(starsFor(e, null)).toBe(0);
      // Impossibly fast times earn nothing.
      expect(starsFor(e, three * 0.4)).toBe(0);
    }
  });

  it('pays each star once and keeps the best', () => {
    const e = CAREER_EVENTS[0];
    const [one, , three] = starTimes(e);
    const a = settleRace(newWallet(), { ...result(0, 5), totalTime: one });
    if (typeof a === 'string') throw new Error(a);
    expect(a.stars).toBe(1);
    expect(a.newStars).toBe(1);
    expect(a.earned).toBe(raceReward(result(0, 5)) + STAR_BONUS);
    const b = settleRace(a.wallet, { ...result(0, 5), totalTime: three });
    if (typeof b === 'string') throw new Error(b);
    expect(b.newStars).toBe(2);
    expect(b.wallet.stars[e.id]).toBe(3);
    const c = settleRace(b.wallet, { ...result(0, 5), totalTime: one });
    if (typeof c === 'string') throw new Error(c);
    expect(c.newStars).toBe(0);
    expect(c.wallet.stars[e.id]).toBe(3);
  });

  it('banks drift points, capped by the race time', () => {
    const w = newWallet();
    const s = settleRace(w, { ...result(0, 4), driftPoints: 4321.7 });
    if (typeof s === 'string') throw new Error(s);
    expect(s.dp).toBe(4321);
    expect(s.wallet.dp).toBe(4321);
    expect(s.wallet.dpTotal).toBe(4321);
    const silly = settleRace(w, { ...result(0, 4), totalTime: 200, driftPoints: 1e9 });
    if (typeof silly === 'string') throw new Error(silly);
    expect(silly.dp).toBe(200 * DRIFT_CAP_PER_SECOND);
    const bad = settleRace(w, { ...result(0, 4), driftPoints: -5 });
    if (typeof bad === 'string') throw new Error(bad);
    expect(bad.dp).toBe(0);
    // They count toward the day's drift quest too.
    const day = settleResult(w, { ...result(0, 4), driftPoints: 3000 }, '2026-10-28');
    if (typeof day === 'string') throw new Error(day);
    expect(day.wallet.daily.drift).toBe(3000);
  });

  it('keeps only known events and sensible stars, DP and items in stored wallets', () => {
    const id = CAREER_EVENTS[0].id;
    const w = cleanWallet({ stars: { [id]: 2, bogus: 3, [CAREER_EVENTS[1].id]: 7 }, dp: 500, dpTotal: 100, items: ['glow-blue', 'nope'] });
    expect(w.stars).toEqual({ [id]: 2 });
    expect(w.dp).toBe(500);
    expect(w.dpTotal).toBe(500);
    expect(w.items).toEqual(['glow-blue']);
    expect(cleanWallet({ dp: -4 }).dp).toBe(0);
  });
});
