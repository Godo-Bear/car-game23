import { describe, expect, it } from 'vitest';
import { neutralControls } from '../src/physics/VehiclePhysics';
import { formatTime, RaceManager } from '../src/race/RaceManager';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { TOKYO_CIRCUIT } from '../src/track/tokyoCircuit';
import { TRACKS } from '../src/track/tracks';
import { aiField, CARS } from '../src/vehicles/cars';

const racers = [
  { id: 0, name: 'A', isPlayer: true },
  { id: 1, name: 'B', isPlayer: false },
];

describe('RaceManager', () => {
  it('counts a lap only after a full forward lap from the grid', () => {
    const rm = new RaceManager(1000, 2, racers, [990, 980]);
    rm.start();
    expect(rm.racers[0].totalDistance).toBe(-10);
    // Cross the line: lap 1 starts, nothing completed yet.
    rm.update(1, [5, 2]);
    expect(rm.racers[0].lapsCompleted).toBe(0);
    for (let d = 100; d <= 900; d += 100) rm.update(1, [d, d - 50]);
    const events = rm.update(1, [10, 950]);
    expect(rm.racers[0].lapsCompleted).toBe(1);
    expect(rm.racers[0].currentLap).toBe(2);
    expect(events.some((e) => e.type === 'lap' && e.racerId === 0)).toBe(true);
    expect(events.some((e) => e.type === 'finalLap' && e.racerId === 0)).toBe(true);
    expect(rm.standings()[0].id).toBe(0);
  });

  it('does not count reversing back and forth over the line', () => {
    const rm = new RaceManager(1000, 3, racers, [995, 990]);
    rm.start();
    for (let i = 0; i < 10; i++) {
      rm.update(0.5, [5, 990]);
      rm.update(0.5, [995, 990]);
    }
    expect(rm.racers[0].lapsCompleted).toBe(0);
  });

  it('interpolates the exact crossing time for lap times', () => {
    const rm = new RaceManager(1000, 1, racers, [999, 998]);
    rm.start();
    for (let d = 100; d < 1000; d += 100) rm.update(1, [d, 1]);
    // Previous 900 -> now 20: crossed 100 m into a 120 m step => 1/6 of the step ago.
    const events = rm.update(1, [20, 2]);
    const lap = events.find((e) => e.type === 'lap');
    expect(lap && lap.type === 'lap' ? lap.time : 0).toBeCloseTo(10 - 1 / 6, 5);
    expect(rm.racers[0].finished).toBe(true);
    expect(rm.racers[0].position).toBe(1);
  });

  it('formats times as m:ss.mmm', () => {
    expect(formatTime(74.4371)).toBe('1:14.437');
    expect(formatTime(5.2)).toBe('0:05.200');
    expect(formatTime(null)).toBe('--:--.---');
  });
});

describe.each(Object.values(TRACKS))('RaceSimulation on $name (headless full race)', (def) => {
  it('runs a clean 2-lap race where every AI finishes without getting wedged', () => {
    const sim = new RaceSimulation(def.layout, { laps: 2, opponents: 7, difficulty: 'normal' });
    sim.player.autopilot = true;
    let respawns = 0;
    const respawn = sim.respawn.bind(sim);
    sim.respawn = (car) => {
      respawns++;
      respawn(car);
    };
    sim.startRace();
    const input = neutralControls();
    while (sim.race.raceTime < 300 && !sim.race.racers.every((r) => r.finished)) sim.step(input);

    expect(sim.race.racers.every((r) => r.finished)).toBe(true);
    expect(respawns).toBe(0);
    // Average lap speed in a believable band for each circuit (roughly 100-165 km/h).
    for (const r of sim.race.racers) {
      const kmh = (sim.track.length / r.bestLapTime!) * 3.6;
      expect(kmh).toBeGreaterThan(100);
      expect(kmh).toBeLessThan(165);
    }
    const positions = sim.race.standings().map((r) => r.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }, 60_000);
});

describe.each(Object.values(CARS))('One-make race in the $name', (car) => {
  it('lets the AI drive this car cleanly round Sakura Valley', () => {
    const sim = new RaceSimulation(TRACKS.sakura.layout, { laps: 1, opponents: 5, carSpec: car.spec, aiGrip: car.aiGrip, seed: 7 });
    sim.player.autopilot = true;
    let respawns = 0;
    const respawn = sim.respawn.bind(sim);
    sim.respawn = (c) => {
      respawns++;
      respawn(c);
    };
    sim.startRace();
    const input = neutralControls();
    while (sim.race.raceTime < 150 && !sim.race.racers.every((r) => r.finished)) sim.step(input);
    expect(sim.race.racers.every((r) => r.finished)).toBe(true);
    expect(respawns).toBe(0);
  }, 30_000);
});

describe('Mixed field', () => {
  it('races you against your class and the ones either side, a few matching you, engines evened out', () => {
    const field = aiField('hatch', 7, 11);
    expect(new Set(field.map((f) => f.car.id))).toEqual(new Set(['starter', 'hatch', 'gt']));
    expect(field.filter((f) => f.car.id === 'hatch').length).toBeGreaterThanOrEqual(2);
    for (const f of field) expect(f.power).toBeGreaterThanOrEqual(0.85);
    // The GT is slowed toward the roadster's pace, the starter car helped; another roadster is left alone.
    expect(field.find((f) => f.car.id === 'gt')!.power).toBeLessThan(1);
    expect(field.find((f) => f.car.id === 'starter')!.power).toBeGreaterThan(1);
    expect(field.find((f) => f.car.id === 'hatch')!.power).toBe(1);
    // A starter-car race has no hypercars in it.
    expect(aiField('starter', 7, 3).every((f) => f.car.id === 'starter' || f.car.id === 'hatch')).toBe(true);
  });

  it('lets the AI race a mixed field cleanly round Sakura Valley', () => {
    const field = aiField('gt', 7, 11);
    const sim = new RaceSimulation(TRACKS.sakura.layout, {
      laps: 1,
      opponents: 7,
      carSpec: CARS.gt.spec,
      aiGrip: CARS.gt.aiGrip,
      aiCars: field.map((f) => ({ spec: f.car.spec, aiGrip: f.car.aiGrip, power: f.power })),
      seed: 11,
    });
    sim.player.autopilot = true;
    let respawns = 0;
    const respawn = sim.respawn.bind(sim);
    sim.respawn = (c) => {
      respawns++;
      respawn(c);
    };
    sim.startRace();
    const input = neutralControls();
    while (sim.race.raceTime < 150 && !sim.race.racers.every((r) => r.finished)) sim.step(input);
    expect(sim.race.racers.every((r) => r.finished)).toBe(true);
    expect(respawns).toBe(0);
  }, 30_000);
});

describe('AI respects the player', () => {
  // The whole field has to get past a stationary player: on the racing line, or spun sideways.
  for (const [label, distance, turn] of [
    ['parked on the racing line', 800, 0],
    ['spun sideways after Turn 1', 420, Math.PI / 2],
  ] as const) {
    it(`never hits a player ${label}`, () => {
      const sim = new RaceSimulation(TOKYO_CIRCUIT, { laps: 3, opponents: 7, difficulty: 'hard', seed: 3 });
      const lateral = turn === 0 ? sim.line.offsets[sim.track.indexAtDistance(distance)] : 1.5;
      const spot = sim.track.pointAt(distance, lateral);
      sim.player.physics.place(spot.x, spot.z, spot.heading + turn, spot.y);
      sim.track.project(spot.x, spot.z, -1, sim.player.proj);
      sim.startRace();
      // Handbrake only: holding the brake while stopped would engage reverse.
      const parked = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false };
      let contacts = 0;
      let passed = 0;
      // Long enough for the whole field to arrive and squeeze past (one lane is left at a corner exit).
      for (let t = 0; t < 75; t += RaceSimulation.STEP) {
        sim.step(parked);
        if (sim.player.impact > 0) contacts++;
      }
      for (const car of sim.cars) {
        const r = sim.race.racers[car.id];
        if (!car.isPlayer && (r.currentLap > 1 || car.proj.distance > distance + 20)) passed++;
      }
      expect(contacts).toBe(0);
      expect(passed).toBe(7); // and they all actually got by
    });
  }
});
