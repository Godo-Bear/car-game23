import { describe, expect, it } from 'vitest';
import { CAR_IDS } from '../shared/api';
import { CAR_PRICES, cleanWallet, MAX_UPGRADE, newWallet, purchase, raceReward, STARTER_CAR, STARTING_CREDITS, upgradeCost } from '../shared/economy';

const race = { position: 1, fieldSize: 8, laps: 3, difficulty: 'normal' as const };

describe('economy', () => {
  it('starts you with the starter car and a little money', () => {
    expect(newWallet()).toEqual({ credits: STARTING_CREDITS, owned: [STARTER_CAR], upgrades: {} });
    expect(CAR_PRICES[STARTER_CAR]).toBe(0);
  });

  it('pays more for a better place, more laps, harder rivals and a bigger field', () => {
    const win = raceReward(race);
    expect(win).toBeGreaterThan(raceReward({ ...race, position: 2 }));
    expect(raceReward({ ...race, position: 2 })).toBeGreaterThan(raceReward({ ...race, position: 8 }));
    expect(raceReward({ ...race, laps: 5 })).toBeGreaterThan(win);
    expect(raceReward({ ...race, difficulty: 'hard' })).toBeGreaterThan(win);
    expect(raceReward({ ...race, difficulty: 'easy' })).toBeLessThan(win);
    expect(raceReward({ ...race, fieldSize: 4 })).toBeLessThan(win);
    // Last place still earns something; the first car is a few wins away.
    expect(raceReward({ ...race, position: 8 })).toBeGreaterThan(0);
    expect(CAR_PRICES.hatch / win).toBeGreaterThan(2);
    expect(CAR_PRICES.hatch / win).toBeLessThan(5);
  });

  it('sells cars once, only when you can afford them', () => {
    expect(purchase(newWallet(), { kind: 'car', car: 'hatch' })).toBe('Not enough money.');
    const rich = { ...newWallet(), credits: 100_000 };
    const bought = purchase(rich, { kind: 'car', car: 'hatch' });
    expect(bought).toEqual({ ...rich, credits: 100_000 - CAR_PRICES.hatch, owned: [STARTER_CAR, 'hatch'] });
    expect(purchase(bought as typeof rich, { kind: 'car', car: 'hatch' })).toBe('You already own this car.');
    expect(purchase(rich, { kind: 'car', car: 'nope' as never })).toBe('Unknown car.');
  });

  it('upgrades owned cars level by level up to the maximum', () => {
    let wallet = { ...newWallet(), credits: 1_000_000 };
    expect(purchase(wallet, { kind: 'upgrade', car: 'gt', part: 'engine' })).toBe('Buy the car first.');
    for (let level = 1; level <= MAX_UPGRADE; level++) {
      const next = purchase(wallet, { kind: 'upgrade', car: STARTER_CAR, part: 'engine' });
      if (typeof next === 'string') throw new Error(next);
      expect(next.credits).toBe(wallet.credits - upgradeCost(STARTER_CAR, 'engine', level));
      expect(next.upgrades[STARTER_CAR]).toEqual({ engine: level, handling: 0, nitro: 0 });
      wallet = next;
    }
    expect(purchase(wallet, { kind: 'upgrade', car: STARTER_CAR, part: 'engine' })).toBe('Already fully upgraded.');
    // Each level costs more, and tuning a dearer car costs more.
    expect(upgradeCost('gt', 'engine', 2)).toBeGreaterThan(upgradeCost('gt', 'engine', 1));
    expect(upgradeCost('super', 'engine', 1)).toBeGreaterThan(upgradeCost(STARTER_CAR, 'engine', 1));
  });

  it('cleans stored wallets: bad values fall back, the starter car is always yours', () => {
    expect(cleanWallet(null)).toEqual(newWallet());
    expect(cleanWallet({})).toEqual(newWallet());
    const w = cleanWallet({ credits: 5000, owned: ['gt', 'bogus'], upgrades: { gt: { engine: 9, handling: -2, nitro: 1.5 }, super: { engine: 3 } } });
    expect(w.credits).toBe(5000);
    expect(w.owned).toEqual([STARTER_CAR, 'gt']);
    expect(w.upgrades).toEqual({ gt: { engine: MAX_UPGRADE, handling: 0, nitro: 0 } }); // not super: not owned
    expect(cleanWallet({ credits: -5, owned: CAR_IDS }).credits).toBe(STARTING_CREDITS);
  });
});
