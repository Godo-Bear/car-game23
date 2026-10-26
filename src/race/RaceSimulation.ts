import { AIDriver, type AIProfile, type TrafficCar } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { clamp, createRng } from '../core/math';
import { collideCars, collideWithWalls } from '../physics/Collisions';
import { neutralControls, VehiclePhysics, type VehicleControls } from '../physics/VehiclePhysics';
import { createProjection, TrackPath, type TrackLayout, type TrackProjection } from '../track/TrackPath';
import { RaceManager, type RaceEvent } from './RaceManager';

import type { Difficulty } from '../../shared/api';

export type { Difficulty };

export interface RaceSettings {
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  /** 0-based grid slot of the player (0 = pole). */
  playerGridSlot: number;
  /** Player's stability-control strength, 0..1. */
  playerAssist: number;
  seed: number;
}

export const DEFAULT_SETTINGS: RaceSettings = {
  laps: 3,
  opponents: 7,
  difficulty: 'normal',
  playerGridSlot: 4,
  playerAssist: 0.7,
  seed: 23,
};

/** AI tuning per difficulty: [min, max] cornering grip (g), braking (m/s^2), engine power scale. */
const DIFFICULTY_TUNING: Record<Difficulty, { grip: [number, number]; brake: number; power: number }> = {
  easy: { grip: [0.94, 1.04], brake: 7.5, power: 0.9 },
  normal: { grip: [1.14, 1.24], brake: 9, power: 0.97 },
  hard: { grip: [1.24, 1.32], brake: 10, power: 1.0 },
};

/** Grid slot k: two staggered columns behind the start line. */
export function gridSlot(track: TrackPath, slot: number): { distance: number; lateral: number } {
  const row = Math.floor(slot / 2);
  const right = slot % 2 === 1;
  return {
    distance: track.length - (10 + row * 12 + (right ? 6 : 0)),
    lateral: right ? 3.2 : -3.2,
  };
}

export const DRIVER_NAMES = ['K. Takeda', 'R. Sato', 'M. Ishikawa', 'Y. Mori', 'H. Nakamura', 'S. Fujita', 'A. Kimura', 'T. Ono', 'N. Hayashi', 'D. Ueda', 'E. Kobayashi'];

export interface SimCar {
  id: number;
  name: string;
  isPlayer: boolean;
  physics: VehiclePhysics;
  proj: TrackProjection;
  ai: AIDriver;
  /** The player's car is handed to the AI after the chequered flag. */
  autopilot: boolean;
  controls: VehicleControls;
  /** Strongest impact this frame (m/s), for sound and camera shake. */
  impact: number;
  stuckTime: number;
  /** 0..1 strength of the tow from a car ahead. */
  slipstream: number;
  // Previous physics state, for render interpolation.
  prevX: number;
  prevZ: number;
  prevY: number;
  prevHeading: number;
}

export type RacePhase = 'grid' | 'racing';

/**
 * Everything that happens on track, independent of rendering: physics, collisions, AI, laps.
 * Runs at a fixed time step so behaviour is identical at any frame rate (and in unit tests).
 */
export class RaceSimulation {
  static readonly STEP = 1 / 120;

  readonly track: TrackPath;
  readonly line: RacingLine;
  readonly settings: RaceSettings;
  readonly cars: SimCar[] = [];
  race: RaceManager;
  phase: RacePhase = 'grid';
  private traffic: TrafficCar[] = [];

  constructor(layout: TrackLayout | TrackPath, settings: Partial<RaceSettings> = {}, line?: RacingLine) {
    this.track = layout instanceof TrackPath ? layout : new TrackPath(layout);
    this.line = line ?? new RacingLine(this.track);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const s = this.settings;
    const rng = createRng(s.seed);
    const tuning = DIFFICULTY_TUNING[s.difficulty];
    const total = s.opponents + 1;
    const playerSlot = clamp(s.playerGridSlot, 0, total - 1);

    let aiIndex = 0;
    for (let slot = 0; slot < total; slot++) {
      const isPlayer = slot === playerSlot;
      const physics = new VehiclePhysics();
      // Pace is shuffled across the grid so quicker drivers have to work their way forward.
      const profile: AIProfile = {
        cornerGrip: tuning.grip[0] + (tuning.grip[1] - tuning.grip[0]) * (isPlayer ? 0.5 : rng()),
        brakeDecel: tuning.brake,
        laneBias: (rng() - 0.5) * 1.2,
        aggression: 0.4 + rng() * 0.6,
      };
      if (isPlayer) {
        physics.stabilityAssist = s.playerAssist;
      } else {
        physics.stabilityAssist = 0.9;
        physics.powerScale = tuning.power;
      }
      const name = isPlayer ? 'YOU' : DRIVER_NAMES[aiIndex % DRIVER_NAMES.length];
      if (!isPlayer) aiIndex++;
      this.cars.push({
        id: slot,
        name,
        isPlayer,
        physics,
        proj: createProjection(),
        ai: new AIDriver(this.line, profile),
        autopilot: false,
        controls: neutralControls(),
        impact: 0,
        stuckTime: 0,
        slipstream: 0,
        prevX: 0,
        prevZ: 0,
        prevY: 0,
        prevHeading: 0,
      });
    }
    this.traffic = this.cars.map((c) => ({ car: c.physics, proj: c.proj }));
    this.race = this.placeOnGrid();
  }

  get player(): SimCar {
    return this.cars.find((c) => c.isPlayer)!;
  }

  gridPosition(slot: number): { distance: number; lateral: number } {
    return gridSlot(this.track, slot);
  }

  private placeOnGrid(): RaceManager {
    const startDistances: number[] = [];
    for (const car of this.cars) {
      const g = this.gridPosition(car.id);
      const p = this.track.pointAt(g.distance, g.lateral);
      car.physics.place(p.x, p.z, p.heading, p.y);
      car.ai.reset();
      car.autopilot = false;
      car.stuckTime = 0;
      this.track.project(p.x, p.z, -1, car.proj);
      this.savePrev(car);
      startDistances.push(car.proj.distance);
    }
    this.phase = 'grid';
    return new RaceManager(this.track.length, this.settings.laps, this.cars, startDistances);
  }

  restart(): void {
    this.race = this.placeOnGrid();
  }

  startRace(): void {
    this.phase = 'racing';
    this.race.start();
  }

  /** Advance one fixed step. Returns lap/finish events produced during the step. */
  step(playerInput: VehicleControls): RaceEvent[] {
    const dt = RaceSimulation.STEP;
    for (const car of this.cars) {
      this.savePrev(car);
      car.impact = 0;
    }

    if (this.phase === 'grid') {
      // Cars are held on the brakes; let the player blip the throttle for the sound.
      const p = this.player.physics;
      p.rpm += ((p.spec.idleRpm + playerInput.throttle * 6200 - p.rpm) * Math.min(1, dt * 8));
      p.throttleApplied = playerInput.throttle;
      return [];
    }

    this.updateSlipstream();
    for (const car of this.cars) {
      const r = this.race.racers[car.id];
      let controls: VehicleControls;
      if (car.isPlayer && !car.autopilot) {
        controls = playerInput;
      } else {
        controls = car.ai.drive(car.physics, car.proj, this.traffic, dt);
        if (r.finished && !car.isPlayer) {
          // Cool-down lap: cruise and stay out of the way.
          controls.throttle = Math.min(controls.throttle, car.physics.forwardSpeed > 22 ? 0 : 0.5);
        }
      }
      car.controls = controls;
      const slope = car.proj.slope * Math.cos(car.physics.heading - car.proj.heading);
      car.physics.step(controls, dt, slope);
    }

    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const hit = collideCars(this.cars[i].physics, this.cars[j].physics);
        if (hit > 0) {
          this.cars[i].impact = Math.max(this.cars[i].impact, hit);
          this.cars[j].impact = Math.max(this.cars[j].impact, hit);
        }
      }
    }

    for (const car of this.cars) {
      const ph = car.physics;
      this.track.project(ph.x, ph.z, car.proj.index, car.proj);
      const hit = collideWithWalls(ph, car.proj, this.track.wallOffset);
      if (hit > 0) {
        car.impact = Math.max(car.impact, hit);
        this.track.project(ph.x, ph.z, car.proj.index, car.proj);
      }
      ph.y = car.proj.y;
      this.updateStuck(car, dt);
    }

    return this.race.update(
      dt,
      this.cars.map((c) => c.proj.distance),
    );
  }

  /** Put a car back on the racing line (used by the player's reset key and for wedged AI cars). */
  respawn(car: SimCar): void {
    const back = 12;
    const d = car.proj.distance - back;
    let best = this.line.offsets[this.track.indexAtDistance(d)];
    // Avoid dropping onto another car.
    for (const lateral of [best, -3.5, 3.5, 0, -5, 5]) {
      const p = this.track.pointAt(d, lateral);
      const clear = this.cars.every((o) => o === car || Math.hypot(o.physics.x - p.x, o.physics.z - p.z) > 6);
      if (clear) {
        best = lateral;
        break;
      }
    }
    const p = this.track.pointAt(d, best);
    // Respawning must never gain ground: keep the race distance consistent.
    car.physics.place(p.x, p.z, p.heading, p.y);
    car.physics.gear = 1;
    this.track.project(p.x, p.z, -1, car.proj);
    car.ai.reset();
    car.stuckTime = 0;
    this.savePrev(car);
  }

  /** Following closely behind another car cuts drag by up to 35% (tow on the straights). */
  private updateSlipstream(): void {
    const L = this.track.length;
    for (const car of this.cars) {
      let best = 0;
      for (const other of this.cars) {
        if (other === car) continue;
        let ds = other.proj.distance - car.proj.distance;
        if (ds < -L / 2) ds += L;
        if (ds < 3 || ds > 30) continue;
        const dLat = Math.abs(other.proj.lateral - car.proj.lateral);
        if (dLat > 2.2) continue;
        best = Math.max(best, (1 - (ds - 3) / 27) * (1 - dLat / 2.2));
      }
      car.slipstream = best;
      car.physics.dragScale = 1 - 0.35 * best;
    }
  }

  private updateStuck(car: SimCar, dt: number): void {
    const controlledByAI = !car.isPlayer || car.autopilot;
    if (!controlledByAI) return;
    if (Math.abs(car.physics.forwardSpeed) < 2) car.stuckTime += dt;
    else car.stuckTime = Math.max(0, car.stuckTime - dt * 2);
    if (car.stuckTime > 6) this.respawn(car);
  }

  private savePrev(car: SimCar): void {
    car.prevX = car.physics.x;
    car.prevZ = car.physics.z;
    car.prevY = car.physics.y;
    car.prevHeading = car.physics.heading;
  }
}
