import { describe, expect, it } from 'vitest';
import { eventsFinished, FREE_DRIVE_EVENTS, freeDriveUnlocked } from '../shared/career';
import { newWallet } from '../shared/economy';
import { neutralControls, type VehicleControls } from '../src/physics/VehiclePhysics';
import { type FreeRoamGround, RaceSimulation } from '../src/race/RaceSimulation';
import { TrackPath } from '../src/track/TrackPath';
import { FREE_ROAM_DEF } from '../src/track/tracks';
import { FREE_DRIVE_SPOTS, mapFraction } from '../src/world/freeDrive';

const drive = (o: Partial<VehicleControls>): VehicleControls => ({ ...neutralControls(), ...o });

/** The free drive ring road, on gently sloping ground with one building, inside a 3 km square. */
function freeSim(): RaceSimulation {
  const ground: FreeRoamGround = {
    surfaceAt: (x) => x * 0.02,
    obstacles: [{ x: 0, z: 60, hw: 15, hd: 10 }],
    bounds: { cx: 0, cz: 0, half: 3000 },
  };
  const sim = new RaceSimulation(new TrackPath(FREE_ROAM_DEF.layout), { opponents: 0, freeRoam: ground });
  sim.startRace();
  return sim;
}

describe('free drive', () => {
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
});
