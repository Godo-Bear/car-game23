import type { Difficulty } from '../../shared/api';
import { AIDriver, type AIProfile, type TrafficCar } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { clamp, createRng, smoothstep, wrapAngle } from '../core/math';
import { collideCars, collideWithWalls, type WallContact } from '../physics/Collisions';
import { neutralControls, SPORTS_CAR, type VehicleControls, VehiclePhysics, type VehicleSpec } from '../physics/VehiclePhysics';
import { createProjection, type TrackLayout, TrackPath, type TrackProjection } from '../track/TrackPath';
import { NITRO_PICKUP, PICKUP_RESPAWN, type Pickup, pickupAt, placePickups, SUPER_SECONDS } from './Pickups';
import { type RaceEvent, RaceManager } from './RaceManager';

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
  /** The player's car. */
  carSpec: VehicleSpec;
  /** AI cornering speed scale for that car. */
  aiGrip: number;
  /** What each AI driver races, in grid order; anyone left over drives the player's car. */
  aiCars: AICar[];
}

export interface AICar {
  spec: VehicleSpec;
  aiGrip: number;
  /** Engine scale on top of the difficulty's. */
  power: number;
}

/**
 * Drift guide: while the player is drifting, the direction of travel is swung toward the road a
 * little way ahead, with up to this much extra cornering (m/s^2)...
 */
const DRIFT_GUIDE_ACCEL = 24;
/** ...and if the bend is too tight for the speed, the slide scrubs off speed (m/s^2), like a real drift. */
const DRIFT_GUIDE_SCRUB = 22;
/** About to slide into a barrier: extra push back toward the road (m/s^2). */
const DRIFT_GUIDE_WALL = 30;

export const DEFAULT_SETTINGS: RaceSettings = {
  laps: 3,
  opponents: 7,
  difficulty: 'normal',
  playerGridSlot: 4,
  playerAssist: 0.7,
  seed: 23,
  carSpec: SPORTS_CAR,
  aiGrip: 1,
  aiCars: [],
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

export const DRIVER_NAMES = [
  'K. Takeda',
  'R. Sato',
  'M. Ishikawa',
  'Y. Mori',
  'H. Nakamura',
  'S. Fujita',
  'A. Kimura',
  'T. Ono',
  'N. Hayashi',
  'D. Ueda',
  'E. Kobayashi',
];

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
  /** Barrier contact during the latest step. */
  wall: WallContact;
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
  /** Nitro pickups on the road (the player collects them). */
  readonly pickups: Pickup[];
  /** Seconds since the start (for pickups coming back). */
  time = 0;
  private traffic: TrafficCar[] = [];
  private pending: RaceEvent[] = [];

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
      const car = (!isPlayer && s.aiCars[aiIndex]) || { spec: s.carSpec, aiGrip: s.aiGrip, power: 1 };
      const physics = new VehiclePhysics(car.spec);
      // Pace is shuffled across the grid so quicker drivers have to work their way forward.
      const profile: AIProfile = {
        cornerGrip: (tuning.grip[0] + (tuning.grip[1] - tuning.grip[0]) * (isPlayer ? 0.5 : rng())) * car.aiGrip,
        brakeDecel: tuning.brake,
        laneBias: (rng() - 0.5) * 1.2,
        aggression: 0.4 + rng() * 0.6,
      };
      if (isPlayer) {
        physics.stabilityAssist = s.playerAssist;
      } else {
        physics.stabilityAssist = 0.9;
        physics.powerScale = tuning.power * car.power;
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
        wall: { active: false, count: 0, x: 0, z: 0 },
        stuckTime: 0,
        slipstream: 0,
        prevX: 0,
        prevZ: 0,
        prevY: 0,
        prevHeading: 0,
      });
    }
    this.traffic = this.cars.map((c) => ({
      car: c.physics,
      proj: c.proj,
      // The human player gets extra room; once on autopilot they're just another car.
      get cautious() {
        return c.isPlayer && !c.autopilot;
      },
    }));
    this.pickups = placePickups(this.track);
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
      this.track.project(p.x, p.z, -1, car.proj, p.y);
      this.savePrev(car);
      startDistances.push(car.proj.distance);
    }
    this.phase = 'grid';
    this.time = 0;
    for (const p of this.pickups) p.backAt = 0;
    return new RaceManager(this.track.length, this.settings.laps, this.cars, startDistances);
  }

  restart(): void {
    this.race = this.placeOnGrid();
  }

  startRace(): void {
    this.phase = 'racing';
    this.race.start();
  }

  private readonly assisted: VehicleControls = neutralControls();

  /**
   * Barrier assist (scales with the stability-assist setting): if the car is about to run into a
   * wall within the next half second, nudge the steering away from it - harder the closer it is.
   * The player's own steering away from the wall always wins.
   */
  private barrierAssist(car: SimCar, input: VehicleControls): VehicleControls {
    const k = this.settings.playerAssist;
    const p = car.physics;
    const pr = car.proj;
    if (k < 0.3 || p.forwardSpeed < 12) return input;
    const lateralSpeed = p.vx * pr.rx + p.vz * pr.rz;
    const ahead = pr.lateral + lateralSpeed * 0.5;
    const side = Math.sign(ahead);
    const limit = this.track.wallOffset - 1.4;
    const overshoot = Math.abs(ahead) - limit;
    if (overshoot <= 0 || lateralSpeed * side <= 0) return input;
    const out = this.assisted;
    Object.assign(out, input);
    // Positive steer turns right; steer toward the centre line.
    const away = -side * clamp(overshoot / 2.5, 0, 1) * k;
    if (Math.sign(input.steer) !== Math.sign(away)) out.steer = clamp(input.steer + away, -1, 1);
    return out;
  }

  /**
   * Drift guide: a drift follows the corner instead of sliding into the wall, even flat out. The
   * travel direction (and the car with it, so the drift angle is kept) is swung toward a point on
   * the road ahead, and speed is scrubbed when the bend is too tight to make at this speed.
   */
  private driftGuide(car: SimCar, dt: number): void {
    const p = car.physics;
    const speed = Math.hypot(p.vx, p.vz);
    if (!(p.drifting || (p.sliding && Math.abs(p.driftAngle) > 0.08)) || speed < 12 || p.forwardSpeed < 5) return;
    const pr = car.proj;
    const look = clamp(speed * 0.75, 16, 55);
    // Aim inside the barriers (pulled toward the middle of the road).
    const limit = this.track.wallOffset - 2.5;
    const target = this.track.pointAt(pr.distance + look, clamp(pr.lateral, -limit, limit) * 0.3);
    const dir = Math.atan2(p.vx, p.vz);
    let err = wrapAngle(Math.atan2(target.x - p.x, target.z - p.z) - dir);
    const k = this.settings.playerAssist >= 0.3 ? 1 : 0.75;
    let accel = DRIFT_GUIDE_ACCEL;
    // Heading for a barrier within the next ~0.6 s: turn away from it harder.
    const lateralSpeed = p.vx * pr.rx + p.vz * pr.rz;
    const ahead = pr.lateral + lateralSpeed * 0.6;
    // A car sliding sideways sticks out further: keep more room the bigger the drift angle.
    const room = 1.6 + Math.abs(Math.sin(p.driftAngle)) * p.spec.halfLength;
    const over = Math.abs(ahead) - (this.track.wallOffset - room);
    if (over > 0 && lateralSpeed * ahead > 0) {
      // Positive turn is to the left; the right-hand side is positive lateral.
      const away = ahead > 0 ? 1 : -1;
      if (Math.sign(err) !== away) err = away * Math.max(Math.abs(err), 0.2);
      accel += DRIFT_GUIDE_WALL * clamp(over / 2, 0, 1);
    }
    const maxTurn = ((accel * k) / speed) * dt;
    const turn = clamp(err, -maxTurn, maxTurn);
    const scrub = DRIFT_GUIDE_SCRUB * k * Math.max(smoothstep(0.08, 0.4, Math.abs(err)), over > 0 ? 0.6 : 0);
    const v = Math.max(Math.min(speed, 12), speed - scrub * dt);
    const a = dir + turn;
    p.vx = Math.sin(a) * v;
    p.vz = Math.cos(a) * v;
    p.heading += turn;
  }

  /** Advance one fixed step. Returns lap/finish events produced during the step. */
  step(playerInput: VehicleControls): RaceEvent[] {
    const dt = RaceSimulation.STEP;
    for (const car of this.cars) {
      this.savePrev(car);
      car.impact = 0;
      car.wall.active = false;
    }

    if (this.phase === 'grid') {
      // Cars are held on the brakes; let the player blip the throttle for the sound.
      const p = this.player.physics;
      p.rpm += (p.spec.idleRpm + playerInput.throttle * 6200 - p.rpm) * Math.min(1, dt * 8);
      p.throttleApplied = playerInput.throttle;
      return [];
    }

    this.updateSlipstream();
    for (const car of this.cars) {
      const r = this.race.racers[car.id];
      let controls: VehicleControls;
      if (car.isPlayer && !car.autopilot) {
        controls = this.barrierAssist(car, playerInput);
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
      if (car.isPlayer && !car.autopilot) {
        this.driftGuide(car, dt);
        const kind = car.physics.boostEvent;
        if (kind) this.pending.push({ type: 'boost', racerId: car.id, kind });
      }
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
      const hit = collideWithWalls(ph, car.proj, this.track.wallOffset, car.wall);
      car.impact = Math.max(car.impact, hit);
      if (car.wall.active) this.track.project(ph.x, ph.z, car.proj.index, car.proj);
      ph.y = car.proj.y;
      this.updateStuck(car, dt);
    }
    this.time += dt;
    this.collectPickups();

    const events = this.race.update(
      dt,
      this.cars.map((c) => c.proj.distance),
    );
    if (this.pending.length) {
      events.push(...this.pending);
      this.pending = [];
    }
    return events;
  }

  /** The player drives through a pickup: a blue bottle tops up the tank, a gold one is a super boost. */
  private collectPickups(): void {
    const car = this.player;
    if (car.autopilot) return;
    const p = pickupAt(this.pickups, this.track.length, car.proj.distance, car.proj.lateral, this.time);
    if (!p) return;
    p.backAt = this.time + PICKUP_RESPAWN;
    if (p.kind === 'super') car.physics.superBoost(SUPER_SECONDS);
    else car.physics.addNitro(NITRO_PICKUP);
    this.pending.push({ type: 'pickup', racerId: car.id, kind: p.kind });
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
    this.track.project(p.x, p.z, -1, car.proj, p.y);
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

  /** Put a wedged AI car back on track. Reversing counts as stuck, so back-and-forth shuffling is caught. */
  private updateStuck(car: SimCar, dt: number): void {
    const controlledByAI = !car.isPlayer || car.autopilot;
    if (!controlledByAI) return;
    if (car.physics.forwardSpeed < 2) car.stuckTime += dt;
    else car.stuckTime = Math.max(0, car.stuckTime - dt * 2);
    if (car.stuckTime > 8) this.respawn(car);
  }

  private savePrev(car: SimCar): void {
    car.prevX = car.physics.x;
    car.prevZ = car.physics.z;
    car.prevY = car.physics.y;
    car.prevHeading = car.physics.heading;
  }
}
