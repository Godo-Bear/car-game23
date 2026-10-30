import { describe, expect, it } from 'vitest';
import { eventsFinished, FREE_DRIVE_EVENTS, freeDriveUnlocked } from '../shared/career';
import { newWallet } from '../shared/economy';
import { neutralControls, type VehicleControls } from '../src/physics/VehiclePhysics';
import { type FreeRoamGround, RaceSimulation, STEEPEST_CLIMB } from '../src/race/RaceSimulation';
import { TrackPath } from '../src/track/TrackPath';
import { FREE_ROAM_DEF } from '../src/track/tracks';
import { FREE_DRIVE_SPOTS, mapFraction, mapPosition } from '../src/world/freeDrive';

const drive = (o: Partial<VehicleControls>): VehicleControls => ({ ...neutralControls(), ...o });

/** The free drive ring road, on gently sloping ground with one building, inside a 3 km square. */
function freeSim(extra: Partial<FreeRoamGround> = {}): RaceSimulation {
  const ground: FreeRoamGround = {
    surfaceAt: (x) => x * 0.02,
    obstacles: [{ x: 0, z: 60, hw: 15, hd: 10 }],
    bounds: { cx: 0, cz: 0, half: 3000 },
    ...extra,
  };
  const sim = new RaceSimulation(new TrackPath(FREE_ROAM_DEF.layout), { opponents: 0, freeRoam: ground });
  sim.startRace();
  return sim;
}

describe('free drive', { timeout: 30_000 }, () => {
  it('unlocks after finishing three different career events (any position)', () => {
    const w = newWallet();
    expect(freeDriveUnlocked(w)).toBe(false);
    const two = { ...w, events: { 'tokyo-debut': 1, 'sakura-spring': 6 } };
    expect(eventsFinished(two)).toBe(2);
    expect(freeDriveUnlocked(two)).toBe(false);
    expect(freeDriveUnlocked({ ...two, events: { ...two.events, 'hakone-climb': 8 } })).toBe(true);
    expect(FREE_DRIVE_EVENTS).toBe(3);
  });

  it('lets you drive anywhere, on the ground under the car (no barriers off the road)', () => {
    const sim = freeSim();
    const car = sim.player;
    // In the middle of the map, far from the ring road, heading south (+z) away from the building.
    car.physics.place(-400, 0, 0, sim.settings.freeRoam!.surfaceAt(-400, 0));
    sim.track.project(-400, 0, -1, car.proj);
    for (let t = 0; t < 4; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1 }));
    expect(car.physics.z).toBeGreaterThan(40);
    expect(car.physics.y).toBeCloseTo(car.physics.x * 0.02, 1);
    // Steer east, up the slope: the height follows the ground.
    for (let t = 0; t < 3; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1, steer: -1 }));
    expect(car.physics.y).toBeCloseTo(car.physics.x * 0.02, 1);
  });

  it('stops you at buildings and the edge of the map', () => {
    const sim = freeSim();
    const car = sim.player;
    // Drive north into the building (it spans z 50..70).
    car.physics.place(0, 0, 0, 0);
    sim.track.project(0, 0, -1, car.proj);
    let hit = 0;
    for (let t = 0; t < 5; t += RaceSimulation.STEP) {
      sim.step(drive({ throttle: 1 }));
      hit = Math.max(hit, car.impact);
    }
    expect(car.physics.z).toBeLessThan(50);
    expect(hit).toBeGreaterThan(3);
    // Out at the edge of the map.
    car.physics.place(2990, 0, Math.PI / 2, 0);
    for (let t = 0; t < 3; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1 }));
    expect(car.physics.x).toBeLessThanOrEqual(3000);
  });

  it('has starting places that all show on the map picture, with unique ids', () => {
    expect(new Set(FREE_DRIVE_SPOTS.map((s) => s.id)).size).toBe(FREE_DRIVE_SPOTS.length);
    for (const s of FREE_DRIVE_SPOTS) {
      const [fx, fy] = mapFraction(s.x, s.z);
      expect(fx).toBeGreaterThan(0.02);
      expect(fx).toBeLessThan(0.98);
      expect(fy).toBeGreaterThan(0.02);
      expect(fy).toBeLessThan(0.98);
    }
    // The ring road spot really is on the ring road.
    const track = new TrackPath(FREE_ROAM_DEF.layout);
    const ring = FREE_DRIVE_SPOTS.find((s) => s.id === 'ring')!;
    const p = track.project(ring.x, ring.z, -1, { index: 0, lateral: 0, distance: 0, y: 0, heading: 0, slope: 0, tx: 0, tz: 1, rx: -1, rz: 0 });
    expect(Math.abs(p.lateral)).toBeLessThan(2);
  });

  it("won't climb a rock face, but drives up a hill", () => {
    // Flat to z = 20, then a cliff (twice as steep as the steepest climb) going north.
    const steep = STEEPEST_CLIMB * 2;
    const sim = freeSim({ surfaceAt: (_x, z) => Math.max(0, z - 20) * steep, obstacles: [] });
    const car = sim.player;
    car.physics.place(-400, 0, 0, 0);
    for (let t = 0; t < 6; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1 }));
    expect(car.physics.z).toBeLessThan(23);
    expect(car.physics.y).toBeLessThan(2);

    // A gentle hill: up you go.
    const hill = freeSim({ surfaceAt: (_x, z) => Math.max(0, z - 20) * 0.2, obstacles: [] });
    const c2 = hill.player;
    c2.physics.place(-400, 0, 0, 0);
    for (let t = 0; t < 6; t += RaceSimulation.STEP) hill.step(drive({ throttle: 1 }));
    expect(c2.physics.z).toBeGreaterThan(60);
    expect(c2.physics.y).toBeCloseTo((c2.physics.z - 20) * 0.2, 0);
  });

  it('flies off a crest and lands, but a kerb is no ramp', () => {
    // Up a ramp to z = 60, then a sheer drop.
    const sim = freeSim({ surfaceAt: (_x, z) => (z < 20 ? Math.max(0, z) * 0.3 : 0), obstacles: [] });
    const car = sim.player;
    car.physics.place(-400, -20, 0, 0);
    car.physics.vz = 30;
    let air = 0;
    for (let t = 0; t < 5; t += RaceSimulation.STEP) {
      sim.step(drive({ throttle: 1 }));
      if (car.physics.y > sim.settings.freeRoam!.surfaceAt(car.physics.x, car.physics.z) + 0.5) air += RaceSimulation.STEP;
    }
    expect(air).toBeGreaterThan(0.3);
    expect(car.physics.y).toBeCloseTo(0, 1);

    // A 30 cm step up: no jump.
    const kerb = freeSim({ surfaceAt: (_x, z) => (z > 10 ? 0.3 : 0), obstacles: [] });
    const c2 = kerb.player;
    c2.physics.place(-400, 0, 0, 0);
    c2.physics.vz = 30;
    let highest = 0;
    for (let t = 0; t < 1.5; t += RaceSimulation.STEP) {
      kerb.step(drive({ throttle: 1 }));
      highest = Math.max(highest, c2.physics.y);
    }
    expect(highest).toBeLessThan(0.4);
  });

  it('bumps into tree trunks (unless the detail level has thinned that tree out)', () => {
    const layer = { count: 10 };
    const sim = freeSim({ obstacles: [{ x: -400, z: 30, hw: 0.8, hd: 0.8, layer, index: 3 }] });
    const car = sim.player;
    car.physics.place(-400, 0, 0, 0);
    for (let t = 0; t < 4; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1 }));
    expect(car.physics.z).toBeLessThan(30);

    layer.count = 3;
    car.physics.place(-400, 0, 0, 0);
    for (let t = 0; t < 4; t += RaceSimulation.STEP) sim.step(drive({ throttle: 1 }));
    expect(car.physics.z).toBeGreaterThan(40);
  });

  it('has nitro off the ring road too, collected by driving through it', () => {
    const sim = freeSim({ pickups: [{ x: -400, y: 0, z: 30, kind: 'nitro' }], obstacles: [] });
    const car = sim.player;
    car.physics.place(-400, 0, 0, 0);
    car.physics.nitro = 0;
    let got = false;
    for (let t = 0; t < 4; t += RaceSimulation.STEP) got ||= sim.step(drive({ throttle: 1 })).some((e) => e.type === 'pickup');
    expect(got).toBe(true);
    expect(car.physics.nitro).toBeGreaterThan(0.2);
  });

  it('maps map fractions back to world positions', () => {
    const [fx, fy] = mapFraction(123, -456);
    const [x, z] = mapPosition(fx, fy);
    expect(x).toBeCloseTo(123, 6);
    expect(z).toBeCloseTo(-456, 6);
  });
});
