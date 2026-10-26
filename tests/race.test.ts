import { describe, expect, it } from 'vitest';
import { neutralControls } from '../src/physics/VehiclePhysics';
import { formatTime, RaceManager } from '../src/race/RaceManager';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { TOKYO_CIRCUIT } from '../src/track/tokyoCircuit';

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

describe('RaceSimulation (headless full race)', () => {
  it('runs a clean 2-lap race where every AI finishes without getting wedged', () => {
    const sim = new RaceSimulation(TOKYO_CIRCUIT, { laps: 2, opponents: 7, difficulty: 'normal' });
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
    for (const r of sim.race.racers) {
      expect(r.bestLapTime!).toBeGreaterThan(65);
      expect(r.bestLapTime!).toBeLessThan(85);
    }
    const positions = sim.race.standings().map((r) => r.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }, 30_000);
});
