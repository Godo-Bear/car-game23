import { describe, expect, it } from 'vitest';
import { neutralControls } from '../src/physics/VehiclePhysics';
import { PAD_BOOST, RaceSimulation } from '../src/race/RaceSimulation';
import { TRACKS } from '../src/track/tracks';
import { type Ramp, rampHeight, starsFor, TRAP_STARS } from '../src/world/activities';

describe('free drive activities', () => {
  it('ramps rise from nothing at the foot to their height at the lip', () => {
    const r: Ramp = { id: 'r', name: 'Test', x: 0, z: 0, heading: 0, length: 10, width: 6, height: 2 };
    expect(rampHeight(r, 0, -5.01)).toBe(0);
    expect(rampHeight(r, 0, -4.9)).toBeCloseTo(0.02, 1);
    expect(rampHeight(r, 0, 0)).toBeCloseTo(1, 5);
    expect(rampHeight(r, 2.9, 4.9)).toBeCloseTo(1.98, 1);
    expect(rampHeight(r, 3.1, 0)).toBe(0);
    expect(rampHeight(r, 0, 5.1)).toBe(0);
    // Turned to face east (+x).
    const east = { ...r, heading: Math.PI / 2 };
    expect(rampHeight(east, 4.9, 0)).toBeCloseTo(1.98, 1);
    expect(rampHeight(east, -4.9, 0)).toBeCloseTo(0.02, 1);
  });

  it('counts stars from thresholds', () => {
    expect(starsFor(0, TRAP_STARS)).toBe(0);
    expect(starsFor(TRAP_STARS[0], TRAP_STARS)).toBe(1);
    expect(starsFor(999, TRAP_STARS)).toBe(3);
  });

  it('boost pads give any car driving over one a boost', () => {
    const probe = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 0, seed: 1 });
    const p = probe.track.pointAt(400, 0);
    const sim = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 0, seed: 1, boostPads: [{ x: p.x, z: p.z, heading: p.heading }] });
    sim.startRace();
    const car = sim.player.physics;
    const at = sim.track.pointAt(396, 0);
    car.place(at.x, at.z, at.heading, at.y);
    car.vx = Math.sin(at.heading) * 25;
    car.vz = Math.cos(at.heading) * 25;
    car.gear = 3;
    sim.track.project(at.x, at.z, -1, sim.player.proj);
    let boosted = false;
    for (let t = 0; t < 0.5; t += RaceSimulation.STEP) {
      boosted ||= sim.step({ ...neutralControls(), throttle: 1 }).some((e) => e.type === 'pad');
    }
    expect(boosted).toBe(true);
    expect(car.superTime).toBeGreaterThan(0);
    expect(car.superTime).toBeLessThanOrEqual(PAD_BOOST);
  });
});
