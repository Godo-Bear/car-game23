import { describe, expect, it } from 'vitest';
import type { CareerStats, RaceRecord } from '../shared/api';
import { CAREER_EVENTS } from '../shared/career';
import { newWallet } from '../shared/economy';
import { claimDaily, claimQuest, DAILY_COUNT, DAILY_POOL, dailyFor, dailyQuests, MEGA_QUESTS, megaToShow, settleResult, todayKey } from '../shared/quests';
import { cleanWallet } from '../shared/wallet';

const stats = (o: Partial<CareerStats> = {}): CareerStats => ({ races: 0, wins: 0, podiums: 0, bestLap: null, bestLaps: {}, totalLaps: 0, ...o });
const race = (position: number, o: Partial<RaceRecord> = {}): RaceRecord => {
  const e = CAREER_EVENTS[0];
  return { track: e.track, position, fieldSize: e.rivals + 1, laps: e.laps, difficulty: e.difficulty, totalTime: 200, bestLap: 90, event: e.id, ...o };
};

describe('mega quests', () => {
  it('have unique ids and big rewards', () => {
    expect(new Set(MEGA_QUESTS.map((q) => q.id)).size).toBe(MEGA_QUESTS.length);
    for (const q of MEGA_QUESTS) expect(q.reward).toBeGreaterThanOrEqual(25000);
  });

  it('pay out once, and only when finished', () => {
    const w = newWallet();
    expect(claimQuest(w, stats({ wins: 24 }), 'wins-25')).toBe('That quest is not finished yet.');
    const won = claimQuest(w, stats({ wins: 25 }), 'wins-25');
    if (typeof won === 'string') throw new Error(won);
    expect(won.credits).toBe(w.credits + 50000);
    expect(claimQuest(won, stats({ wins: 25 }), 'wins-25')).toBe('Already claimed.');
    expect(claimQuest(w, stats(), 'nope')).toBe('Unknown quest.');
  });

  it('lists rewards waiting to be claimed first, and hides claimed ones', () => {
    const s = stats({ races: 100 });
    expect(megaToShow(newWallet(), s)[0].id).toBe('races-100');
    expect(megaToShow({ ...newWallet(), quests: ['races-100'] }, s).some((q) => q.id === 'races-100')).toBe(false);
  });
});

describe('daily quests', () => {
  it('picks three different quests a day, the same for everyone, changing day to day', () => {
    const a = dailyQuests('2026-10-28');
    expect(a).toHaveLength(DAILY_COUNT);
    expect(new Set(a.map((q) => q.id)).size).toBe(DAILY_COUNT);
    expect(dailyQuests('2026-10-28').map((q) => q.id)).toEqual(a.map((q) => q.id));
    const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d) =>
      dailyQuests(d)
        .map((q) => q.id)
        .join(),
    );
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('counts the day’s races, pays each finished quest once, and resets the next day', () => {
    const day = '2026-10-28';
    let w = newWallet();
    for (let k = 0; k < 3; k++) {
      const s = settleResult(w, race(1), day);
      if (typeof s === 'string') throw new Error(s);
      w = s.wallet;
    }
    const d = dailyFor(w, day);
    expect(d.races).toBe(3);
    expect(d.wins).toBe(3);
    expect(d.laps).toBe(3 * CAREER_EVENTS[0].laps);
    expect(d.night).toBe(3); // the first event is at night
    // Whatever today's quests are, the ones that are done can be claimed once.
    for (const q of dailyQuests(day)) {
      const claimed = claimDaily(w, q.id, day);
      if (q.progress(d) >= q.goal) {
        if (typeof claimed === 'string') throw new Error(claimed);
        expect(claimed.credits).toBe(w.credits + q.reward);
        expect(claimDaily(claimed, q.id, day)).toBe('Already claimed today.');
      } else {
        expect(claimed).toBe('That quest is not finished yet.');
      }
    }
    // Not one of today's quests.
    const other = DAILY_POOL.find((q) => !dailyQuests(day).includes(q))!;
    expect(claimDaily(w, other.id, day)).toBe('That is not one of today’s quests.');
    // A new day starts from zero.
    expect(dailyFor(w, '2026-10-29').races).toBe(0);
    expect(todayKey(Date.UTC(2026, 9, 28, 23, 59))).toBe('2026-10-28');
  });

  it('keeps stored progress sane', () => {
    const w = cleanWallet({
      credits: 1,
      owned: [],
      quests: ['wins-25', 'bogus'],
      daily: { day: '2026-10-28', races: 2, wins: -4, tracks: ['tokyo', 'mars'], claimed: ['d-win', 'x'] },
    });
    expect(w.quests).toEqual(['wins-25']);
    expect(w.daily).toMatchObject({ day: '2026-10-28', races: 2, wins: 0, tracks: ['tokyo'], claimed: ['d-win'] });
  });
});
