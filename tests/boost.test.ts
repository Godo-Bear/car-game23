import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP, PERFECT_WINDOW, type VehicleControls, VehiclePhysics } from '../src/physics/VehiclePhysics';
import { NITRO_PICKUP, PICKUP_RESPAWN, pickupAt, placePickups, SUPER_EVERY } from '../src/race/Pickups';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { TrackPath } from '../src/track/TrackPath';
import { TRACKS } from '../src/track/tracks';

const DT = 1 / 120;
const input = (o: Partial<VehicleControls>): VehicleControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o });

function cruising(speed: number): VehiclePhysics {
  const car = new VehiclePhysics();
  car.place(0, 0, 0);
  car.vz = speed;
  car.gear = 4;
  return car;
}

/** Speed gained (m/s) over `seconds` with the given nitro presses. */
function gain(car: VehiclePhysics, seconds: number, nitro: (t: number) => boolean): number {
  const v0 = Math.hypot(car.vx, car.vz);
  for (let t = 0; t < seconds; t += DT) car.step(input({ throttle: 1, nitro: nitro(t) }), DT);
  return car.forwardSpeed - v0;
}

describe('special boosts', () => {
  it('double-tapping the nitro with a full tank fires a shockwave that burns the whole tank', () => {
    const car = cruising(30);
    let event = null;
    for (let t = 0; t < 0.4; t += DT) {
      // Two short presses, DOUBLE_TAP apart.
      car.step(input({ throttle: 1, nitro: t < 0.05 || (t > DOUBLE_TAP * 0.5 && t < DOUBLE_TAP * 0.5 + 0.05) }), DT);
      event ??= car.boostEvent;
    }
    expect(event).toBe('shockwave');
    expect(car.boostKind).toBe('shockwave');
    // It keeps burning without the button held, until the tank is empty.
    for (let t = 0; t < 4; t += DT) car.step(input({ throttle: 1 }), DT);
    expect(car.nitro).toBeLessThan(0.05);
    expect(car.boostKind).toBe('normal');
  });

  it('a shockwave pushes harder than holding the nitro', () => {
    const normal = gain(cruising(30), 1.2, () => true);
    const shock = gain(cruising(30), 1.2, (t) => t < 0.03 || (t > 0.12 && t < 0.15));
    expect(shock).toBeGreaterThan(normal * 1.2);
  });

  it('firing the nitro just as a drift ends is a perfect nitro', () => {
    const car = cruising(25);
    for (let t = 0; t < 0.8; t += DT) car.step(input({ throttle: 1, steer: 0.8, handbrake: t < 0.3 }), DT);
    // Wait for the drift to end, then fire inside the window.
    let ended = 0;
    while (car.drifting && ended < 5) {
      car.step(input({ throttle: 1 }), DT);
      ended += DT;
    }
    let event = null;
    for (let t = 0; t < 0.3; t += DT) {
      car.step(input({ throttle: 1, nitro: true }), DT);
      event ??= car.boostEvent;
    }
    expect(event).toBe('perfect');
  });

  it('no perfect nitro long after a drift', () => {
    const car = cruising(25);
    for (let t = 0; t < PERFECT_WINDOW + 1; t += DT) car.step(input({ throttle: 1 }), DT);
    car.step(input({ throttle: 1, nitro: true }), DT);
    expect(car.boostEvent).toBeNull();
    expect(car.boostKind).toBe('normal');
  });

  it('a super boost pushes for a few seconds without using the tank', () => {
    const car = cruising(30);
    car.nitro = 0.2;
    car.superBoost(2);
    expect(car.nitro).toBe(1);
    const v = gain(car, 1, () => false);
    expect(car.nitroActive).toBe(true);
    expect(car.nitro).toBe(1);
    expect(v).toBeGreaterThan(gain(cruising(30), 1, () => false) + 2);
    gain(car, 1.5, () => false);
    expect(car.nitroActive).toBe(false);
    expect(car.boostKind).toBe('normal');
  });
});

describe('nitro pickups', () => {
  it('are spread round every circuit, with gold super boosts among them', () => {
    for (const t of Object.values(TRACKS)) {
      const track = new TrackPath(t.layout);
      const pickups = placePickups(track);
      expect(pickups.length).toBeGreaterThan(8);
      expect(pickups.filter((p) => p.kind === 'super').length).toBe(Math.floor(pickups.length / SUPER_EVERY));
      for (const p of pickups) expect(Math.abs(p.lateral)).toBeLessThan(track.halfWidth);
    }
  });

  it('are collected by driving through them, and come back later', () => {
    const sim = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 0 });
    const p = sim.pickups.find((x) => x.kind === 'nitro')!;
    const L = sim.track.length;
    expect(pickupAt(sim.pickups, L, p.distance + 1, p.lateral + 1, 0)).toBe(p);
    expect(pickupAt(sim.pickups, L, p.distance + 10, p.lateral, 0)).toBeNull();
    expect(pickupAt(sim.pickups, L, p.distance, p.lateral + 4, 0)).toBeNull();

    // Put the player on it mid-race: the tank tops up and the bottle is gone for a while.
    sim.startRace();
    const car = sim.player;
    const at = sim.track.pointAt(p.distance - 0.5, p.lateral);
    car.physics.place(at.x, at.z, at.heading, at.y);
    car.physics.nitro = 0.1;
    sim.track.project(at.x, at.z, -1, car.proj);
    const events = sim.step(input({}));
    expect(events).toContainEqual({ type: 'pickup', racerId: car.id, kind: 'nitro' });
    expect(car.physics.nitro).toBeCloseTo(0.1 + NITRO_PICKUP, 1);
    expect(p.backAt).toBeCloseTo(sim.time + PICKUP_RESPAWN, 1);
    expect(pickupAt(sim.pickups, L, p.distance, p.lateral, sim.time)).toBeNull();
  });
});
