import { describe, expect, it } from 'vitest';
import type { CareerStats } from '../shared/api';
import { newWallet } from '../shared/economy';
import { claimQuest, QUESTS, questsToShow } from '../shared/quests';
import { cleanWallet } from '../shared/wallet';

const stats = (o: Partial<CareerStats> = {}): CareerStats => ({ races: 0, wins: 0, podiums: 0, bestLap: null, bestLaps: {}, totalLaps: 0, ...o });

describe('quests', () => {
  it('have unique ids and real rewards', () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    for (const q of QUESTS) {
      expect(q.reward).toBeGreaterThan(0);
      expect(q.goal).toBeGreaterThan(0);
    }
  });

  it('pay out once, and only when finished', () => {
    const w = newWallet();
    expect(claimQuest(w, stats(), 'first-win')).toBe('That quest is not finished yet.');
    const won = claimQuest(w, stats({ wins: 1 }), 'first-win');
    if (typeof won === 'string') throw new Error(won);
    expect(won.credits).toBe(w.credits + QUESTS.find((q) => q.id === 'first-win')!.reward);
    expect(won.quests).toEqual(['first-win']);
    expect(claimQuest(won, stats({ wins: 1 }), 'first-win')).toBe('Already claimed.');
    expect(claimQuest(w, stats(), 'nope')).toBe('Unknown quest.');
  });

  it('shows rewards waiting to be claimed first, and hides claimed ones', () => {
    const s = stats({ races: 10, wins: 0 });
    const shown = questsToShow(newWallet(), s, 4);
    expect(shown[0].id).toBe('races-10'); // done, so first
    const claimed = { ...newWallet(), quests: ['races-10'] };
    expect(questsToShow(claimed, s, 4).some((q) => q.id === 'races-10')).toBe(false);
  });

  it('keeps only known quests in stored wallets', () => {
    expect(cleanWallet({ credits: 1, owned: [], quests: ['first-win', 'bogus', 7] }).quests).toEqual(['first-win']);
  });
});
