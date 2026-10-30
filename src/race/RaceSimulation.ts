import type { Difficulty } from '../../shared/api';
import { AIDriver, type AIProfile, type TrafficCar } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { clamp, createRng, smoothstep, wrapAngle } from '../core/math';
import { collideCars, collideWithWalls, type WallContact } from '../physics/Collisions';
import { neutralControls, SPORTS_CAR, type VehicleControls, VehiclePhysics, type VehicleSpec } from '../physics/VehiclePhysics';
import { createProjection, type TrackLayout, TrackPath, type TrackProjection } from '../track/TrackPath';
import { NITRO_PICKUP, PICKUP_RESPAWN, type Pickup, type PickupKind, pickupAt, pickupNear, placePickups, SUPER_SECONDS } from './Pickups';
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
  /** Free drive: the player can leave the road and drive anywhere on this ground (the AI keep to the road). */
  freeRoam?: FreeRoamGround;
}

/** The ground of a free drive map (see World.freeRoam). */
export interface FreeRoamGround {
  surfaceAt(x: number, z: number): number;
  /**
   * Solid boxes (buildings, landmarks, trees): centre and half sizes. A tree drawn as instance
   * `index` of `layer` isn't there once the detail level has thinned it out (index >= count).
   */
  obstacles: { x: number; z: number; hw: number; hd: number; layer?: { count: number }; index?: number }[];
  bounds: { cx: number; cz: number; half: number };
  /** Nitro bottles off the ring road (in town). */
  pickups?: { x: number; y: number; z: number; kind: PickupKind }[];
  /**
   * The point `look` metres further along the road nearest (x, z), going in direction (dx, dz),
   * or null if no road is near. Drifts on any road are guided round its bends with this.
   */
  roadAhead?(x: number, z: number, dx: number, dz: number, look: number): { x: number; z: number } | null;
}

/** A free-roaming car's footprint against buildings (m). */
const FREE_CAR_RADIUS = 2.1;
/** Ground steeper than this (rise over run) is a rock face: the car can't climb it. */
export const STEEPEST_CLIMB = 0.62;
/** Where the wheels touch, from the car's centre: along and across it (m). */
const WHEEL_ALONG = 1.4;
const WHEEL_ACROSS = 0.85;

/**
 * Swing a sliding car's direction of travel (and the car with it, so the drift angle is kept) by
 * up to `accel` worth of cornering toward `err` radians off, scrubbing `scrub` m/s^2 of speed.
 */
function swingDrift(p: VehiclePhysics, dt: number, err: number, accel: number, scrub: number): void {
  const speed = Math.hypot(p.vx, p.vz);
  const maxTurn = (accel / speed) * dt;
  const turn = clamp(err, -maxTurn, maxTurn);
  const v = Math.max(Math.min(speed, 12), speed - scrub * dt);
  const a = Math.atan2(p.vx, p.vz) + turn;
  p.vx = Math.sin(a) * v;
  p.vz = Math.cos(a) * v;
  p.heading += turn;
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
  /** Free drive: sideways tilt of the ground under the car (rise to the left over its width). */
  groundRoll: number;
  /** Free drive: vertical speed (m/s), so the car flies off crests instead of sticking to them. */
  vy: number;
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
  /** Free drive: obstacles bucketed on a grid (key -> boxes) for quick collision checks. */
  private readonly obstacleGrid = new Map<number, FreeRoamGround['obstacles']>();

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
        groundRoll: 0,
        vy: 0,
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
    this.pickups = [
      ...placePickups(this.track),
      ...(this.settings.freeRoam?.pickups ?? []).map((p, i): Pickup => ({ ...p, distance: i * 37, lateral: 0, backAt: 0, free: true })),
    ];
    for (const o of this.settings.freeRoam?.obstacles ?? []) {
      for (let i = Math.floor((o.x - o.hw) / 32); i <= Math.floor((o.x + o.hw) / 32); i++) {
        for (let j = Math.floor((o.z - o.hd) / 32); j <= Math.floor((o.z + o.hd) / 32); j++) {
          const key = i * 65536 + j;
          const list = this.obstacleGrid.get(key);
          if (list) list.push(o);
          else this.obstacleGrid.set(key, [o]);
        }
      }
    }
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
    swingDrift(p, dt, err, accel * k, DRIFT_GUIDE_SCRUB * k * Math.max(smoothstep(0.08, 0.4, Math.abs(err)), over > 0 ? 0.6 : 0));
  }

  /**
   * Free drive: the same drift guide on any road (the ring road, the streets, the slip roads and
   * the trails), whichever way along it you're going. There are no barriers to keep off.
   */
  private freeDriftGuide(car: SimCar, dt: number, ground: FreeRoamGround): void {
    const p = car.physics;
    const speed = Math.hypot(p.vx, p.vz);
    if (!ground.roadAhead || !(p.drifting || (p.sliding && Math.abs(p.driftAngle) > 0.08)) || speed < 12 || p.forwardSpeed < 5) return;
    const target = ground.roadAhead(p.x, p.z, p.vx / speed, p.vz / speed, clamp(speed * 0.75, 16, 55));
    if (!target) return;
    const dir = Math.atan2(p.vx, p.vz);
    const err = wrapAngle(Math.atan2(target.x - p.x, target.z - p.z) - dir);
    // Only round a bend in the road, not a turn across a junction.
    if (Math.abs(err) > 1.1) return;
    const k = this.settings.playerAssist >= 0.3 ? 1 : 0.75;
    swingDrift(p, dt, err, DRIFT_GUIDE_ACCEL * k, DRIFT_GUIDE_SCRUB * k * smoothstep(0.08, 0.4, Math.abs(err)));
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
      const free = car.isPlayer && !car.autopilot && this.settings.freeRoam;
      if (free) {
        controls = playerInput;
      } else if (car.isPlayer && !car.autopilot) {
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
        if (free) this.freeDriftGuide(car, dt, free);
        else this.driftGuide(car, dt);
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
      if (car.isPlayer && !car.autopilot && this.settings.freeRoam) {
        car.impact = Math.max(car.impact, this.freeGround(car, this.settings.freeRoam));
        continue;
      }
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

  /**
   * Free drive: the car sits on whatever is under it (the road, or the ground anywhere else), and
   * bumps off buildings and the edge of the map. Returns the impact speed.
   */
  private freeGround(car: SimCar, ground: FreeRoamGround): number {
    const ph = car.physics;
    const pr = car.proj;
    let impact = 0;
    // Buildings: push the car out of any box it overlaps and take away the speed into it.
    const r = FREE_CAR_RADIUS;
    const seen = new Set<object>();
    for (let i = Math.floor((ph.x - r) / 32); i <= Math.floor((ph.x + r) / 32); i++) {
      for (let j = Math.floor((ph.z - r) / 32); j <= Math.floor((ph.z + r) / 32); j++) {
        for (const o of this.obstacleGrid.get(i * 65536 + j) ?? []) {
          if (seen.has(o) || (o.layer && o.index! >= o.layer.count)) continue;
          seen.add(o);
          const cx = clamp(ph.x, o.x - o.hw, o.x + o.hw);
          const cz = clamp(ph.z, o.z - o.hd, o.z + o.hd);
          let nx = ph.x - cx;
          let nz = ph.z - cz;
          let d = Math.hypot(nx, nz);
          if (d >= r) continue;
          if (d < 1e-6) {
            // Centre inside the box: out through the nearest side.
            const ex = o.hw - Math.abs(ph.x - o.x);
            const ez = o.hd - Math.abs(ph.z - o.z);
            [nx, nz] = ex < ez ? [Math.sign(ph.x - o.x) || 1, 0] : [0, Math.sign(ph.z - o.z) || 1];
            d = -Math.min(ex, ez);
          } else {
            nx /= d;
            nz /= d;
          }
          ph.x += nx * (r - d);
          ph.z += nz * (r - d);
          const into = ph.vx * nx + ph.vz * nz;
          if (into < 0) {
            ph.vx -= into * nx * 1.25;
            ph.vz -= into * nz * 1.25;
            impact = Math.max(impact, -into);
          }
        }
      }
    }
    // The edge of the map.
    const b = ground.bounds;
    for (const [axis, vel, centre] of [
      ['x', 'vx', b.cx],
      ['z', 'vz', b.cz],
    ] as const) {
      const off = ph[axis] - centre;
      if (Math.abs(off) > b.half) {
        ph[axis] = centre + Math.sign(off) * b.half;
        if (Math.sign(ph[vel]) === Math.sign(off)) {
          impact = Math.max(impact, Math.abs(ph[vel]));
          ph[vel] = 0;
        }
      }
    }
    this.track.project(ph.x, ph.z, pr.index, pr);
    // On the ring road? (Check the road really is under the car: far from it, the nearest point
    // can be a long way off.)
    const onRoad = () => {
      const near = this.track.pointAt(pr.distance, pr.lateral);
      return Math.abs(pr.lateral) <= this.track.wallOffset + 0.5 && Math.hypot(near.x - ph.x, near.z - ph.z) < 1;
    };
    const h = (x: number, z: number) => ground.surfaceAt(x, z);
    if (!onRoad()) {
      // Rock faces: too steep to drive up. The slope pushes back like a wall (driving along it
      // or back down is fine).
      const gx = (h(ph.x + 2, ph.z) - h(ph.x - 2, ph.z)) / 4;
      const gz = (h(ph.x, ph.z + 2) - h(ph.x, ph.z - 2)) / 4;
      const grade = Math.hypot(gx, gz);
      if (grade > STEEPEST_CLIMB) {
        // Downhill, along the ground.
        const nx = -gx / grade;
        const nz = -gz / grade;
        const into = ph.vx * nx + ph.vz * nz;
        if (into < 0) {
          ph.vx -= into * nx * 1.2;
          ph.vz -= into * nz * 1.2;
          impact = Math.max(impact, -into * 0.5);
          // Undo this step's climb (keep the sideways part of the move).
          const back = (ph.x - car.prevX) * nx + (ph.z - car.prevZ) * nz;
          if (back < 0) {
            ph.x -= back * nx;
            ph.z -= back * nz;
            this.track.project(ph.x, ph.z, pr.index, pr);
          }
        }
      }
    }
    // On the ring road: its surface. Anywhere else: the ground, sampled under the wheels so the
    // car sits on the slope (pitch and roll) instead of jolting over every bump under its middle.
    // Off the ring road the car isn't "on" the track, so the ring road's pickups and the AI's
    // traffic planning leave it alone.
    const fx = Math.sin(ph.heading);
    const fz = Math.cos(ph.heading);
    let target = pr.y;
    if (!onRoad()) {
      const at = (along: number, across: number) => h(ph.x + fx * along + fz * across, ph.z + fz * along - fx * across);
      // (+across is the car's left.)
      const fl = at(WHEEL_ALONG, WHEEL_ACROSS);
      const fr = at(WHEEL_ALONG, -WHEEL_ACROSS);
      const rl = at(-WHEEL_ALONG, WHEEL_ACROSS);
      const rr = at(-WHEEL_ALONG, -WHEEL_ACROSS);
      target = Math.max((fl + fr + rl + rr) / 4, h(ph.x, ph.z) - 0.15);
      pr.y = target;
      pr.slope = (fl + fr - rl - rr) / (4 * WHEEL_ALONG);
      pr.heading = ph.heading;
      pr.lateral = 1000;
      car.groundRoll = (fl + rl - fr - rr) / (4 * WHEEL_ACROSS);
    } else {
      car.groundRoll = 0;
    }
    // Follow the ground up at once; over a crest, fly (and land) instead of sticking to it.
    const dt = RaceSimulation.STEP;
    // (A few centimetres' leeway, so small folds and kerbs don't throw the car up.)
    const airborne = ph.y + car.vy * dt - 9.81 * dt * dt > target + (ph.y > target ? 0 : 0.06);
    if (airborne) {
      car.vy -= 9.81 * dt;
      ph.y += car.vy * dt;
    } else {
      // Climbing with the ground: its slope times the speed (a kerb's step doesn't launch you).
      car.vy = clamp((ph.vx * fx + ph.vz * fz) * pr.slope * Math.cos(ph.heading - pr.heading), -40, 25);
      ph.y = target;
    }
    return impact;
  }

  /** The player drives through a pickup: a blue bottle tops up the tank, a gold one is a super boost. */
  private collectPickups(): void {
    const car = this.player;
    if (car.autopilot) return;
    const p =
      pickupAt(this.pickups, this.track.length, car.proj.distance, car.proj.lateral, this.time) ??
      (this.settings.freeRoam ? pickupNear(this.pickups, car.physics.x, car.physics.z, this.time) : null);
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
