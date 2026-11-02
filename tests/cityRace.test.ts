import { describe, expect, it } from 'vitest';
import { CITY_COURSE_IDS } from '../shared/api';
import { neutralControls } from '../src/physics/VehiclePhysics';
import type { RaceEvent } from '../src/race/RaceManager';
import { type FreeRoamGround, RaceSimulation } from '../src/race/RaceSimulation';
import { CITY_COURSE_DEFS } from '../src/track/tracks';

const STEP = RaceSimulation.STEP;
/** The flat city: no buildings in the way (the course rules don't care). */
const flat: FreeRoamGround = { surfaceAt: () => 0.06, obstacles: [], bounds: { cx: 0, cz: 0, half: 3000 } };

function cityRace(id: (typeof CITY_COURSE_IDS)[number]): RaceSimulation {
  const def = CITY_COURSE_DEFS[id];
  return new RaceSimulation(def.data.layout, { opponents: 3, laps: 2, items: true, freeRoam: flat, gates: def.data.gates, seed: 5 });
}

/** Teleport the player to (x, z) facing `heading`, moving at `speed`. */
function warp(sim: RaceSimulation, x: number, z: number, heading: number, speed = 10): void {
  const p = sim.player.physics;
  p.place(x, z, heading, 0.06);
  p.vx = Math.sin(heading) * speed;
  p.vz = Math.cos(heading) * speed;
}

describe('city courses', () => {
  it.each(CITY_COURSE_IDS)(
    '%s: a field of AI races two laps to the finish',
    (id) => {
      const sim = cityRace(id);
      for (const c of sim.cars) c.autopilot = true;
      sim.startRace();
      for (let t = 0; t < 400 && !sim.race.racers.every((r) => r.finished); t += STEP) sim.step(neutralControls());
      expect(sim.race.racers.every((r) => r.finished)).toBe(true);
    },
    120_000,
  );

  it('a shortcut down a side street counts, and saves ground', () => {
    const id = 'city-tower';
    const sc = CITY_COURSE_DEFS[id].data.shortcuts[0];
    const sim = cityRace(id);
    sim.startRace();
    const me = sim.player;
    const L = sim.track.length;
    // On the course just before the shortcut...
    const before = sim.track.pointAt(sc.from - 15, 0);
    warp(sim, before.x, before.z, before.heading);
    sim.track.project(before.x, before.z, -1, me.proj);
    sim.step(neutralControls());
    const start = sim.race.racers[me.id].totalDistance;
    // ...down the side street (off the course: progress waits)...
    for (const [x, z] of sc.pts.slice(2, -2)) {
      warp(sim, x, z, before.heading);
      sim.step(neutralControls());
    }
    expect(sim.offCourseTime).toBeGreaterThan(0);
    expect(sim.race.racers[me.id].totalDistance).toBeCloseTo(start, -1);
    // ...and back on it where the street comes out: the whole skipped stretch counts.
    const after = sim.track.pointAt(sc.to + 5, 0);
    warp(sim, after.x, after.z, after.heading);
    const events: RaceEvent[] = sim.step(neutralControls());
    expect(events.some((e) => e.type === 'checkpoint')).toBe(false);
    const gained = sim.race.racers[me.id].totalDistance - start;
    expect(gained).toBeGreaterThan(((sc.to - sc.from + L) % L) * 0.9);
  });

  it('cutting through anywhere else that skips a checkpoint puts you back where you left', () => {
    const id = 'city-wheel';
    const gates = CITY_COURSE_DEFS[id].data.gates;
    const sim = cityRace(id);
    sim.startRace();
    const me = sim.player;
    // Leave the course just before one gate...
    const g = gates.find((d) => d > 300)!;
    const leave = sim.track.pointAt(g - 30, 0);
    warp(sim, leave.x, leave.z, leave.heading);
    sim.track.project(leave.x, leave.z, -1, me.proj);
    sim.step(neutralControls());
    // ...go off it (far to the side)...
    warp(sim, leave.x + 60, leave.z + 60, leave.heading);
    sim.step(neutralControls());
    expect(sim.offCourseTime).toBeGreaterThanOrEqual(0);
    // ...and come back on it 200 m further round, past the gate.
    const back = sim.track.pointAt(g + 170, 0);
    warp(sim, back.x, back.z, back.heading);
    const events = sim.step(neutralControls());
    expect(events).toContainEqual({ type: 'checkpoint', racerId: me.id });
    // Put back where it left the course (a little behind it).
    expect(Math.hypot(me.physics.x - leave.x, me.physics.z - leave.z)).toBeLessThan(30);
  });

  it('a lost player is put back on the course after a while', () => {
    const sim = cityRace('city-ring');
    sim.startRace();
    const p = sim.track.pointAt(500, 0);
    warp(sim, p.x, p.z, p.heading, 0);
    sim.track.project(p.x, p.z, -1, sim.player.proj);
    sim.step(neutralControls());
    warp(sim, p.x + 200, p.z + 200, 0, 0);
    for (let t = 0; t < 27; t += STEP) sim.step(neutralControls());
    expect(Math.abs(sim.player.proj.lateral)).toBeLessThan(sim.track.wallOffset);
  }, 60_000);
});
