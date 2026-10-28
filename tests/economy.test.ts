import { describe, expect, it } from 'vitest';
import { CAR_IDS } from '../shared/api';
import {
  CAR_PRICES,
  cleanWallet,
  MAX_UPGRADE,
  NO_UPGRADES,
  newWallet,
  purchase,
  raceReward,
  STARTER_CAR,
  STARTING_CREDITS,
  UPGRADE_PARTS,
  upgradeCost,
} from '../shared/economy';
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
import { CARS, carStats, upgradedSpec } from '../src/vehicles/cars';

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
      expect(next.upgrades[STARTER_CAR]).toEqual({ ...NO_UPGRADES, engine: level });
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
    const w = cleanWallet({ credits: 5000, owned: ['gt', 'bogus'], upgrades: { gt: { engine: 9, tyres: -2, nitro: 1.5, aero: 2 }, super: { engine: 3 } } });
    expect(w.credits).toBe(5000);
    expect(w.owned).toEqual([STARTER_CAR, 'gt']);
    expect(w.upgrades).toEqual({ gt: { ...NO_UPGRADES, engine: MAX_UPGRADE, aero: 2 } }); // not super: not owned
    // Old saves had a single "handling" upgrade: it carries over to tyres, suspension and brakes.
    const old = cleanWallet({ credits: 0, owned: [], upgrades: { starter: { engine: 2, handling: 3, nitro: 1 } } });
    expect(old.upgrades.starter).toEqual({ ...NO_UPGRADES, engine: 2, tyres: 3, suspension: 3, brakes: 3, nitro: 1 });
    expect(cleanWallet({ credits: -5, owned: CAR_IDS }).credits).toBe(STARTING_CREDITS);
  });

  it('starts every car with similar stats, and maxes every stat when fully upgraded', () => {
    const maxed = Object.fromEntries(UPGRADE_PARTS.map((p) => [p, MAX_UPGRADE])) as typeof NO_UPGRADES;
    for (const car of CAR_IDS) {
      const base = carStats(CARS[car], NO_UPGRADES);
      for (const v of Object.values(base)) {
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThanOrEqual(7);
      }
      for (const v of Object.values(carStats(CARS[car], maxed))) expect(v).toBe(10);
    }
  });

  it('gives every fully upgraded car the same pace, and a clear gain over stock', () => {
    const maxed = Object.fromEntries(UPGRADE_PARTS.map((p) => [p, MAX_UPGRADE])) as typeof NO_UPGRADES;
    const t100 = (car: (typeof CAR_IDS)[number], u: typeof NO_UPGRADES) => {
      const p = new VehiclePhysics(upgradedSpec(CARS[car].spec, u));
      p.place(0, 0, 0);
      for (let t = 0; t < 20; t += 1 / 120) {
        p.step({ throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }, 1 / 120);
        if (p.speedKmh >= 100) return t;
      }
      return 20;
    };
    const stock = CAR_IDS.map((c) => t100(c, NO_UPGRADES));
    const tuned = CAR_IDS.map((c) => t100(c, maxed));
    // Stock cars are within a couple of seconds of each other; maxed ones within half a second.
    expect(Math.max(...stock) - Math.min(...stock)).toBeLessThan(2.2);
    expect(Math.max(...tuned) - Math.min(...tuned)).toBeLessThan(0.6);
    stock.forEach((s, i) => expect(tuned[i]).toBeLessThan(s - 0.5));
  });
});
