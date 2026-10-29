import { describe, expect, it } from 'vitest';
import { CAR_IDS } from '../shared/api';
import { MAX_UPGRADE, NO_UPGRADES, newWallet, PLAYER_CAR, purchase, raceReward, STARTING_CREDITS, UPGRADE_PARTS, upgradeCost } from '../shared/economy';
import { cleanWallet } from '../shared/wallet';
import { VehiclePhysics } from '../src/physics/VehiclePhysics';
import { CARS, carStats, upgradedSpec } from '../src/vehicles/cars';

const race = { position: 1, fieldSize: 8, laps: 3, difficulty: 'normal' as const };

describe('economy', () => {
  it('starts you with the Kaze GT and a little money', () => {
    expect(newWallet()).toMatchObject({ credits: STARTING_CREDITS, owned: [PLAYER_CAR], upgrades: {}, events: {}, quests: [] });
    expect(PLAYER_CAR).toBe('gt');
    expect(newWallet().daily.races).toBe(0);
  });

  it('pays more for a better place, more laps, harder rivals and a bigger field', () => {
    const win = raceReward(race);
    expect(win).toBeGreaterThan(raceReward({ ...race, position: 2 }));
    expect(raceReward({ ...race, position: 2 })).toBeGreaterThan(raceReward({ ...race, position: 8 }));
    expect(raceReward({ ...race, laps: 5 })).toBeGreaterThan(win);
    expect(raceReward({ ...race, difficulty: 'hard' })).toBeGreaterThan(win);
    expect(raceReward({ ...race, difficulty: 'easy' })).toBeLessThan(win);
    expect(raceReward({ ...race, fieldSize: 4 })).toBeLessThan(win);
    // Last place still earns something.
    expect(raceReward({ ...race, position: 8 })).toBeGreaterThan(0);
  });

  it('does not sell cars, and only upgrades the Kaze GT', () => {
    const rich = { ...newWallet(), credits: 1_000_000 };
    expect(purchase(rich, { kind: 'car', car: 'hatch' })).toBe('Cars are not for sale: the Kaze GT is your car.');
    expect(purchase(rich, { kind: 'upgrade', car: 'super', part: 'engine' })).toBe('You can only upgrade your Kaze GT.');
  });

  it('upgrades your car level by level up to the maximum', () => {
    let wallet = { ...newWallet(), credits: 1_000_000 };
    for (let level = 1; level <= MAX_UPGRADE; level++) {
      const next = purchase(wallet, { kind: 'upgrade', car: PLAYER_CAR, part: 'engine' });
      if (typeof next === 'string') throw new Error(next);
      expect(next.credits).toBe(wallet.credits - upgradeCost('engine', level));
      expect(next.upgrades[PLAYER_CAR]).toEqual({ ...NO_UPGRADES, engine: level });
      wallet = next;
    }
    expect(purchase(wallet, { kind: 'upgrade', car: PLAYER_CAR, part: 'engine' })).toBe('Already fully upgraded.');
    // Each level costs more; the first engine level is a race win or so away.
    expect(upgradeCost('engine', 2)).toBeGreaterThan(upgradeCost('engine', 1));
    expect(upgradeCost('engine', 1) / raceReward(race)).toBeLessThan(1);
  });

  it('cleans stored wallets: bad values fall back, the Kaze GT is always yours', () => {
    expect(cleanWallet(null)).toEqual(newWallet());
    expect(cleanWallet({})).toEqual(newWallet());
    const w = cleanWallet({ credits: 5000, owned: ['gt', 'bogus'], upgrades: { gt: { engine: 9, tyres: -2, nitro: 1.5, aero: 2 } } });
    expect(w.credits).toBe(5000);
    expect(w.owned).toEqual([PLAYER_CAR]);
    expect(w.upgrades).toEqual({ gt: { ...NO_UPGRADES, engine: MAX_UPGRADE, aero: 2 } });
    // Old saves had a single "handling" upgrade: it carries over to tyres, suspension and brakes.
    const old = cleanWallet({ credits: 0, owned: [], upgrades: { starter: { engine: 2, handling: 3, nitro: 1 } } });
    expect(old.upgrades.gt).toEqual({ ...NO_UPGRADES, engine: 2, tyres: 3, suspension: 3, brakes: 3, nitro: 1 });
  });

  it('refunds cars bought before there was only one, and keeps their best upgrades on the GT', () => {
    const w = cleanWallet({
      credits: 1000,
      owned: ['starter', 'hatch', 'gt', 'super'],
      upgrades: { hatch: { engine: 4, brakes: 1 }, gt: { engine: 1, tyres: 3 }, super: { nitro: 2 } },
    });
    // The hatch and the hypercar come back as money (the GT stays yours).
    expect(w.credits).toBe(1000 + 30_000 + 220_000);
    expect(w.owned).toEqual([PLAYER_CAR]);
    expect(w.upgrades).toEqual({ gt: { ...NO_UPGRADES, engine: 4, brakes: 1, tyres: 3, nitro: 2 } });
    // Cleaning again changes nothing (the refund is paid once).
    expect(cleanWallet(w)).toEqual(w);
    expect(cleanWallet({ credits: -5 }).credits).toBe(STARTING_CREDITS);
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

  it('sells cosmetics once: DP items for drift points, finishes for money', () => {
    const w = { ...newWallet(), dp: 7000, credits: 25000 };
    expect(purchase(w, { kind: 'item', item: 'nope' })).toBe('Unknown item.');
    const glow = purchase(w, { kind: 'item', item: 'glow-blue' });
    if (typeof glow === 'string') throw new Error(glow);
    expect(glow.dp).toBe(1000);
    expect(glow.credits).toBe(25000);
    expect(glow.items).toEqual(['glow-blue']);
    expect(purchase(glow, { kind: 'item', item: 'glow-blue' })).toBe('You already own this.');
    expect(purchase(glow, { kind: 'item', item: 'glow-gold' })).toBe('Not enough drift points.');
    const satin = purchase(glow, { kind: 'item', item: 'finish-satin' });
    if (typeof satin === 'string') throw new Error(satin);
    expect(satin.credits).toBe(5000);
    expect(purchase(satin, { kind: 'item', item: 'finish-chrome' })).toBe('Not enough money.');
  });
});
