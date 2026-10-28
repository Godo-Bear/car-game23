import { describe, expect, it } from 'vitest';
import type { RaceRecord } from '../shared/api';
import { CAREER_EVENTS, eventUnlocked, nextEvent, settleRace } from '../shared/career';
import { cleanWallet, newWallet, raceReward } from '../shared/economy';
import { TRACKS } from '../src/track/tracks';

const result = (i: number, position: number): RaceRecord => {
  const e = CAREER_EVENTS[i];
  return { track: e.track, position, fieldSize: e.rivals + 1, laps: e.laps, difficulty: e.difficulty, totalTime: 300, bestLap: 90, event: e.id };
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
});
