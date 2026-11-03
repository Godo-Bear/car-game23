import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import { damp } from '../core/math';
import { type Approach, type CityStreet, isCentral, StreetField, type StreetJunction, streetApproaches, streetJunctions, streetLayout } from './cityPlan';
import { contactShadowMaterial } from './foliage';
import { beamTexture, type VehicleModel, vehicleModels, wheelGeometry } from './trafficModels';

/**
 * City traffic for free drive: kei cars, hatchbacks, saloons, taxis, minivans, kei trucks,
 * delivery trucks, buses and the odd police car, driving on the left in their lanes. They plan
 * each junction as it comes - straight on, or a turn with the indicator going, slowing and
 * moving to the right lane first - and drive a smooth curve round the corner (turning right,
 * they wait for a gap in the oncoming traffic). They stop at red lights and at the 止まれ
 * lines, give way to people on the crossings, overtake slow traffic on the main roads, queue
 * behind each other and brake for you (and honk if you sit in their way). Buses pull in at the
 * bus stops. Hit one and it stops with its hazards flashing. Brake lights, indicators,
 * headlights (with their beams on the road after dark), spinning wheels.
 */
export interface TrafficBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  angle: number;
}

/** A junction with traffic lights: which streets cross there (road a, road b). */
export interface SignalJunction {
  x: number;
  z: number;
  a: number;
  b: number;
}

/** A bus stop: on street k, s metres along it, on the pavement to its right (+1) or left (-1). */
export interface BusStopSpot {
  k: number;
  s: number;
  side: 1 | -1;
}

type V2 = [number, number];

/** A turn planned at the junction ahead. */
interface Plan {
  /** Which junction on the street. */
  index: number;
  /** +1 left, -1 right, 0 straight on. */
  turn: number;
  /** Where the lane lines cross (the corner the curve is drawn round), and where it ends. */
  I: V2;
  P2: V2;
  /** How far before I the curve starts. */
  R: number;
  k2: number;
  s2: number;
  dir2: 1 | -1;
  lane2: number;
  /** Seconds spent waiting to turn (across the oncoming traffic). */
  waited: number;
  /** The way the new lane runs where the turn ends. */
  f2: V2;
}

/** A turn in progress: a curve from p0 to p3 (leaving along c1, arriving from c2). */
interface Turn {
  p0: V2;
  c1: V2;
  c2: V2;
  p3: V2;
  u: number;
  /** Distance driven along it, and its length at u = 0, 1/16, ... 1 (so it's driven at an even speed). */
  dist: number;
  lut: number[];
  k: number;
  s: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
}

interface Car {
  model: number;
  /** Its instance in its model's meshes. */
  slot: number;
  k: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  cruise: number;
  /** Lane wanted (0 the inside one) and the actual distance left of the centre line. */
  lane: number;
  off: number;
  plan: Plan | null;
  turn: Turn | null;
  /** Indicator: +1 left, -1 right; seconds left on it (when not turning). */
  blink: number;
  blinkTime: number;
  hazard: number;
  stunned: number;
  /** The stop line it last stopped at (so it then moves on), and how long it's waited there. */
  served: number;
  wait: number;
  /** The bus stop it's stopped at or last served. */
  busStop: number;
  braking: boolean;
  x: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  spin: number;
  /** Stuck behind you: seconds, and till it may honk again. */
  blocked: number;
  hornCool: number;
  /** Stuck behind another car for ages (a jam at a junction): ignores other cars for a moment. */
  stuck: number;
  ghost: number;
  /** Seconds before it may change lanes again. */
  laneCool: number;
}

/** A turn along a cubic Bézier, measured so it can be driven at an even speed. */
function bezierTurn(p0: V2, c1: V2, c2: V2, p3: V2, k: number, s: number, dir: 1 | -1, lane: number, speed: number): Turn {
  const lut = [0];
  let prev = p0;
  for (let i = 1; i <= 16; i++) {
    const u = i / 16;
    const w0 = (1 - u) ** 3;
    const w1 = 3 * (1 - u) ** 2 * u;
    const w2 = 3 * (1 - u) * u * u;
    const w3 = u ** 3;
    const p: V2 = [w0 * p0[0] + w1 * c1[0] + w2 * c2[0] + w3 * p3[0], w0 * p0[1] + w1 * c1[1] + w2 * c2[1] + w3 * p3[1]];
    lut.push(lut[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  return { p0, c1, c2, p3, u: 0, dist: 0, lut, k, s, dir, lane, speed };
}

/** The way a turn's curve is heading at u. */
function bezierTangent(T: Turn, u: number): V2 {
  const a = 3 * (1 - u) ** 2;
  const b = 6 * (1 - u) * u;
  const e = 3 * u * u;
  return [
    a * (T.c1[0] - T.p0[0]) + b * (T.c2[0] - T.c1[0]) + e * (T.p3[0] - T.c2[0]),
    a * (T.c1[1] - T.p0[1]) + b * (T.c2[1] - T.c1[1]) + e * (T.p3[1] - T.c2[1]),
  ];
}

type RGB = readonly [number, number, number];
function rgb(c: THREE.Color, v: RGB): void {
  c.setRGB(v[0], v[1], v[2]);
}

/** Cars further than this from you are moved to a street near you. */
const NEAR = 450;
/** Comfortable braking (m/s²) when planning a stop. */
const DECEL = 3;

export class CityTraffic {
  readonly group = new THREE.Group();
  /** Where each car is, as a box (for the player's collisions). */
  readonly boxes: TrafficBox[] = [];
  /** Horns sounded this frame (loudness 0-1, by how near you are): the game plays them. */
  readonly horns: number[] = [];
  /** Bus stops (indices) with a bus standing at them right now. */
  readonly busesAt = new Set<number>();
  private readonly field: StreetField;
  private readonly junctions: StreetJunction[][];
  private readonly approaches: Approach[][];
  private readonly oneWay: boolean[];
  /** Closed loops (the ring roads and the roundabout): round and round, no end. */
  private readonly loops: boolean[];
  /** A loop's length once round (its line overlaps its start a little). */
  private readonly loopLength: number[];
  private readonly lanes: number[][];
  private readonly edges: number[];
  private readonly stopsOn = new Map<number, { i: number; s: number; side: number }[]>();
  private readonly models: VehicleModel[];
  private readonly cars: Car[] = [];
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly details: THREE.InstancedMesh[] = [];
  private lamps!: THREE.InstancedMesh;
  private wheels!: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh | null = null;
  private shadows: THREE.InstancedMesh | null = null;
  private tod: TimeOfDay = 'day';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private recycle = 0;

  constructor(
    private readonly streets: CityStreet[],
    private readonly signals: SignalJunction[],
    count: number,
    private readonly rng: () => number,
    busStops: BusStopSpot[] = [],
  ) {
    this.group.name = 'traffic';
    this.field = new StreetField(streets);
    this.junctions = streetJunctions(streets, this.field);
    this.approaches = this.junctions.map((J, k) => streetApproaches(J, this.field.length(k)));
    this.oneWay = streets.map(isCentral);
    this.loops = streets.map((st) => {
      const a = st.pts[0];
      const b = st.pts[st.pts.length - 1];
      return Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
    });
    this.loopLength = streets.map((st, k) => {
      const a = st.pts[0];
      const b = st.pts[st.pts.length - 1];
      return this.field.length(k) - Math.hypot(a[0] - b[0], a[1] - b[1]);
    });
    this.lanes = streets.map((s) => streetLayout(s.width).lanes);
    this.edges = streets.map((s) => streetLayout(s.width).edge);
    busStops.forEach((b, i) => {
      const list = this.stopsOn.get(b.k) ?? [];
      list.push({ i, s: b.s, side: b.side });
      this.stopsOn.set(b.k, list);
    });
    this.models = vehicleModels();
    const total = streets.reduce((s, _, k) => s + this.field.length(k), 0);
    const weights = this.models.reduce((s, m) => s + m.weight, 0);
    const slots = this.models.map(() => 0);
    for (let i = 0; i < count; i++) {
      // A random spot, weighted by street length (busier on the big roads).
      let pick = this.rng() * total;
      let k = 0;
      while (k < streets.length - 1 && pick > this.field.length(k)) pick -= this.field.length(k++);
      let w = this.rng() * weights;
      let model = 0;
      while (model < this.models.length - 1 && w > this.models[model].weight) w -= this.models[model++].weight;
      // (Buses keep to the main roads.)
      if (this.models[model].bus && streets[k].width < 14) model = 2;
      const car: Car = {
        model,
        slot: slots[model]++,
        k,
        s: Math.max(2, Math.min(this.field.length(k) - 2, pick)),
        dir: this.oneWay[k] || this.rng() < 0.5 ? 1 : -1,
        speed: 0,
        cruise: 0,
        lane: this.rng() < 0.65 ? 1 : 0,
        off: 0,
        plan: null,
        turn: null,
        blink: 0,
        blinkTime: 0,
        hazard: 0,
        stunned: 0,
        served: Number.NaN,
        wait: 0,
        busStop: -1,
        braking: false,
        x: 0,
        z: 0,
        heading: 0,
        pitch: 0,
        roll: 0,
        spin: this.rng() * 6,
        blocked: 0,
        hornCool: 0,
        stuck: 0,
        ghost: 0,
        laneCool: 0,
      };
      this.setCruise(car);
      car.speed = car.cruise;
      car.off = this.laneOffset(car);
      this.place(car);
      this.cars.push(car);
      const M = this.models[model];
      this.boxes.push({ x: car.x, z: car.z, hw: M.wid / 2, hd: M.len / 2, angle: car.heading });
    }
    this.buildMeshes();
  }

  private setCruise(c: Car): void {
    const base = this.streets[c.k].width >= 14 ? 13.5 : 9;
    c.cruise = base * this.models[c.model].pace * (0.88 + this.rng() * 0.24);
  }

  /** The distance left of the centre line of the lane it wants. */
  private laneOffset(c: Car): number {
    const lanes = this.lanes[c.k];
    return lanes[Math.min(c.lane, lanes.length - 1)];
  }

  /**
   * A point `off` metres left of street k's centre line, s along it, facing `dir`; and that
   * way (smoothed over a few metres, so the cars don't snap round the corners of the line).
   */
  private lanePoint(k: number, s: number, dir: number, off: number): { x: number; z: number; fx: number; fz: number } {
    const L = this.field.length(k);
    // (Round a ring road: across the join, as if it weren't there.)
    const once = this.loopLength[k];
    const wrap = (v: number) => (this.loops[k] ? (v + once) % once : Math.max(0, Math.min(L, v)));
    const p = this.field.at(k, wrap(s));
    const a = this.field.at(k, wrap(s - 2.5));
    const b = this.field.at(k, wrap(s + 2.5));
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const fx = ((b.x - a.x) / l) * dir;
    const fz = ((b.z - a.z) / l) * dir;
    // Left of the way it's going is (fz, -fx).
    return { x: p.x + fz * off, z: p.z - fx * off, fx, fz };
  }

  /** Put the car where its street, distance along and offset say. */
  private place(c: Car): void {
    const p = this.lanePoint(c.k, c.s, c.dir, c.off);
    c.x = p.x;
    c.z = p.z;
    c.heading = Math.atan2(p.fx, p.fz);
  }

  /** Put a car on a street 150-380 m from (x, z). */
  private respawnNear(c: Car, at: { x: number; z: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rng() * Math.PI * 2;
      const r = 150 + this.rng() * 230;
      const hit = this.field.nearest(at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, 40);
      if (!hit) continue;
      if (this.models[c.model].bus && this.streets[hit.k].width < 14) continue;
      // (Not in a junction: on the road between two.)
      if (this.junctions[hit.k].some((J) => hit.s > J.a - 8 && hit.s < J.b + 8)) continue;
      c.k = hit.k;
      c.s = Math.max(2, Math.min(this.field.length(hit.k) - 2, hit.s));
      c.dir = this.oneWay[c.k] || this.rng() < 0.5 ? 1 : -1;
      this.setCruise(c);
      c.speed = c.cruise;
      c.stunned = c.hazard = c.blink = c.blinkTime = 0;
      c.plan = null;
      c.turn = null;
      c.served = Number.NaN;
      c.busStop = -1;
      c.off = this.laneOffset(c);
      this.place(c);
      return;
    }
  }

  /** A car got hit: it stops for a moment, hazards on (and the driver lets you know). */
  bump(i: number): void {
    const c = this.cars[i];
    c.stunned = 2.5;
    c.speed = 0;
    c.hazard = 5;
    if (c.hornCool <= 0) {
      this.horns.push(0.9);
      c.hornCool = 3;
    }
  }

  /**
   * Move the traffic on. `player`: your car (they brake for it). `signalTime`: the traffic
   * lights' clock (StreetFurniture's cycle: road a green for the first 11 s of 24, b from 12 to 23).
   * `walkers`: people out in the road (they stop for them).
   */
  update(dt: number, player: { x: number; z: number }, signalTime: number, walkers: readonly { x: number; z: number }[] = []): void {
    this.horns.length = 0;
    this.busesAt.clear();
    // Traffic lives around you: a car that's got far away comes back on a street near you
    // (out past the next few blocks), so the streets you're on are always busy.
    for (let n = 0; n < 3; n++) {
      const c = this.cars[this.recycle++ % this.cars.length];
      if ((c.x - player.x) ** 2 + (c.z - player.z) ** 2 > NEAR * NEAR) this.respawnNear(c, player);
    }
    const t = signalTime % 24;
    const green = { a: t < 11, b: t >= 12 && t < 23 };
    this.cars.forEach((c, i) => {
      const speed0 = c.speed;
      const heading0 = c.heading;
      c.hornCool -= dt;
      c.ghost -= dt;
      c.hazard = Math.max(0, c.hazard - dt);
      if (c.turn) this.steerTurn(c, dt, player, walkers);
      else this.drive(c, dt, player, walkers, green);
      // Pitch under braking and acceleration, lean in the turns, the wheels going round.
      const accel = (c.speed - speed0) / Math.max(dt, 1e-3);
      let yaw = c.heading - heading0;
      if (yaw > Math.PI) yaw -= Math.PI * 2;
      if (yaw < -Math.PI) yaw += Math.PI * 2;
      c.pitch = damp(c.pitch, Math.max(-0.035, Math.min(0.035, accel * 0.009)), 6, dt);
      c.roll = damp(c.roll, Math.max(-0.04, Math.min(0.04, ((c.speed * yaw) / Math.max(dt, 1e-3)) * 0.006)), 6, dt);
      c.spin += (c.speed * dt) / this.models[c.model].wheelR;
      const b = this.boxes[i];
      b.x = c.x;
      b.z = c.z;
      b.angle = c.heading;
    });
    this.draw(signalTime);
  }

  /** What's ahead (along the way the car points): the nearest thing to stop for, as a distance to stop in. */
  private gapAhead(c: Car, player: { x: number; z: number }, walkers: readonly { x: number; z: number }[]): { gap: number; who: Car | 'player' | null } {
    const M = this.models[c.model];
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    let gap = Infinity;
    let who: Car | 'player' | null = null;
    const look = (x: number, z: number, width: number): number => {
      const dx = x - c.x;
      const dz = z - c.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > 70) return Infinity;
      return Math.abs(dx * fz - dz * fx) < width ? along : Infinity;
    };
    const gp = look(player.x, player.z, M.wid / 2 + 1.1) - M.len / 2 - 3.2;
    if (gp < gap) {
      gap = gp;
      who = 'player';
    }
    for (const w of walkers) gap = Math.min(gap, look(w.x, w.z, M.wid / 2 + 0.8) - M.len / 2 - 2.2);
    if (c.ghost <= 0) {
      for (const o of this.cars) {
        if (o === c || (o.x - c.x) ** 2 + (o.z - c.z) ** 2 > 4900) continue;
        const om = this.models[o.model];
        const g = look(o.x, o.z, (M.wid + om.wid) / 2 + 0.25) - M.len / 2 - om.len / 2 - 1.8;
        if (g < gap) {
          gap = g;
          who = o;
        }
      }
    }
    return { gap, who };
  }

  /** The speed to be doing with `gap` metres to stop in. */
  private stopping(gap: number): number {
    return Math.sqrt(Math.max(0, 2 * DECEL * (gap - 0.6)));
  }

  private drive(c: Car, dt: number, player: { x: number; z: number }, walkers: readonly { x: number; z: number }[], green: { a: boolean; b: boolean }): void {
    const M = this.models[c.model];
    const L = this.field.length(c.k);
    const { fx, fz } = this.lanePoint(c.k, c.s, c.dir, 0);
    this.planAhead(c);
    let want = c.cruise;
    if (c.stunned > 0) {
      c.stunned -= dt;
      want = 0;
    }
    const { gap, who } = this.gapAhead(c, player, walkers);
    let limit = this.stopping(gap);
    // A red light at the junction coming up: wait at the stop line (10.5 m back from the edge
    // of the road crossing; the junction's middle is on the street's centre line).
    for (const j of this.signals) {
      const road = j.a === c.k ? 'a' : j.b === c.k ? 'b' : null;
      if (!road || green[road]) continue;
      const dx = j.x - c.x;
      const dz = j.z - c.z;
      const d = dx * fx + dz * fz;
      if (Math.abs(dx * fz - dz * fx) > this.streets[c.k].width / 2 + 2) continue;
      const other = this.streets[road === 'a' ? j.b : j.a];
      const toLine = d - ((other ? other.width / 2 : 7) + 10.5) - M.len / 2;
      if (toLine > -2 && toLine < 60) limit = Math.min(limit, this.stopping(toLine + 0.6));
    }
    // A 止まれ line (or the way into the roundabout): stop, look, go.
    const A = this.nextStop(c);
    if (A && A.stop !== null && c.served !== A.stop) {
      const toLine = (A.stop - c.s) * c.dir - M.len / 2;
      if (toLine > -1.5 && toLine < 45) {
        limit = Math.min(limit, this.stopping(toLine + 0.6));
        if (toLine < 1.8 && c.speed < 0.5) {
          c.wait += dt;
          if (c.wait > 1.1) {
            c.served = A.stop;
            c.wait = 0;
          }
        }
      }
    }
    // A bus pulls in at its stops (on its left), waits, then pulls out.
    let pullIn = false;
    if (M.bus) {
      for (const st of this.stopsOn.get(c.k) ?? []) {
        if (st.side !== -c.dir || st.i === c.busStop) continue;
        const d = (st.s - c.s) * c.dir;
        if (d < -1 || d > 70) continue;
        pullIn = true;
        limit = Math.min(limit, this.stopping(d + 0.6));
        if (d > 2) {
          c.blink = 1;
          c.blinkTime = 0.5;
        }
        if (d < 1.5 && c.speed < 0.4) {
          this.busesAt.add(st.i);
          c.wait += dt;
          if (c.wait > 7) {
            c.busStop = st.i;
            c.wait = 0;
            c.blink = -1;
            c.blinkTime = 3;
          }
        }
      }
    }
    // A planned turn: slow for the corner, wait for a gap in the oncoming traffic to turn right.
    const plan = c.plan;
    if (plan && plan.turn !== 0) {
      const toCorner = (plan.I[0] - c.x) * fx + (plan.I[1] - c.z) * fz;
      if (toCorner < 45) {
        c.blink = plan.turn;
        c.blinkTime = 1;
      }
      const vt = plan.turn > 0 ? 5.5 : 7;
      limit = Math.min(limit, Math.sqrt(vt * vt + 2 * 2.5 * Math.max(0, toCorner - plan.R)));
      let go = true;
      if (plan.turn < 0 && toCorner < plan.R + 6 && plan.waited < 7) {
        for (const o of this.cars) {
          if (o === c || o.turn || o.k !== c.k || o.dir === c.dir || o.speed < 1) continue;
          const ahead = (o.s - c.s) * c.dir;
          if (ahead > 0 && ahead < 55) {
            go = false;
            break;
          }
        }
        if (!go) {
          plan.waited += dt;
          limit = Math.min(limit, this.stopping(toCorner - plan.R + 0.6));
        }
      }
      // (The corner must be ahead: where the street kinks it may not be, and it goes straight on.)
      const ix = plan.I[0] - c.x;
      const iz = plan.I[1] - c.z;
      const ahead = (ix * Math.sin(c.heading) + iz * Math.cos(c.heading)) / (Math.hypot(ix, iz) || 1);
      if (toCorner <= plan.R + 0.3 && ahead < 0.7) {
        plan.turn = 0;
        c.blink = 0;
      } else if (go && toCorner <= plan.R + 0.3) {
        c.turn = this.curve([c.x, c.z], [Math.sin(c.heading), Math.cos(c.heading)], plan.I, plan.P2, plan.f2, plan.k2, plan.s2, plan.dir2, plan.lane2, vt);
        c.plan = null;
      }
    }
    want = Math.min(want, limit);
    // Stuck behind you: a honk now and then. Stuck in a jam for ages: squeeze through.
    if (who === 'player' && c.speed < 0.6 && gap < 6) c.blocked += dt;
    else c.blocked = Math.max(0, c.blocked - dt);
    if (c.blocked > 2.2 && c.hornCool <= 0) {
      this.horns.push(Math.max(0, 1 - Math.hypot(player.x - c.x, player.z - c.z) / 70));
      c.hornCool = 4 + this.rng() * 4;
      c.blocked = 0.6;
    }
    if (who && who !== 'player' && c.speed < 0.3 && gap < 3) c.stuck += dt;
    else c.stuck = 0;
    if (c.stuck > 8) {
      c.ghost = 2.5;
      c.stuck = 0;
    }
    this.overtake(c, who, gap, dt);
    c.braking = want < c.speed - 0.4 || (want < 0.3 && c.speed < 0.5);
    c.speed = damp(c.speed, want, want < c.speed ? (want < c.speed * 0.5 ? 5 : 3) : 1.1, dt);
    // (At its speed along its lane: round the outside of a bend the lane is longer than the middle.)
    const here = this.lanePoint(c.k, c.s, c.dir, c.off);
    const there = this.lanePoint(c.k, c.s + c.dir * 0.5, c.dir, c.off);
    const stretch = Math.max(0.4, Math.min(3, Math.hypot(there.x - here.x, there.z - here.z) / 0.5));
    c.s += (c.speed * c.dir * dt) / stretch;
    // Past the junction it planned for.
    if (c.plan) {
      const J = this.junctions[c.k][c.plan.index];
      if ((c.dir > 0 && c.s > J.b + 1) || (c.dir < 0 && c.s < J.a - 1)) c.plan = null;
    }
    if (c.blinkTime > 0) {
      c.blinkTime -= dt;
      if (c.blinkTime <= 0 && !c.plan) c.blink = 0;
    }
    // Into the kerb for the bus stop, or its lane; easing across (as if steering).
    const target = pullIn ? this.edges[c.k] - M.wid / 2 + 0.1 : this.laneOffset(c);
    const across = Math.min(1.3, 0.3 + c.speed * 0.2) * dt;
    const step = Math.max(-across, Math.min(across, target - c.off));
    c.off += step;
    // Round a ring road; or the end of the street: onto whatever's there, or round and back.
    const once = this.loopLength[c.k];
    if (this.loops[c.k] && (c.s < 0 || c.s > once)) c.s = (c.s + once) % once;
    else if (c.s < 0 || c.s > L) this.streetEnd(c, fx, fz);
    if (c.turn) return;
    this.place(c);
    c.heading += Math.atan2(step / Math.max(dt, 1e-3), Math.max(c.speed, 3));
  }

  /** The next stop line ahead this way (not a traffic light), if any. */
  private nextStop(c: Car): Approach | null {
    let best: Approach | null = null;
    let bestD = Infinity;
    for (const A of this.approaches[c.k]) {
      if (A.g !== c.dir || A.kind === 'signal' || A.stop === null) continue;
      const d = (A.stop - c.s) * c.dir;
      if (d > -6 && d < bestD) {
        bestD = d;
        best = A;
      }
    }
    return best;
  }

  /** Coming up to a junction (within 50 m): decide what to do there, and get in lane. */
  private planAhead(c: Car): void {
    const J = this.junctions[c.k];
    let index = -1;
    const L = this.field.length(c.k);
    if (c.dir > 0) index = J.findIndex((j) => j.a > c.s + 0.5);
    else {
      for (let i = J.length - 1; i >= 0 && index < 0; i--) if (J[i].b < c.s - 0.5) index = i;
    }
    // Already in the junction at the end of its street (it got here some other way): it has to turn.
    if (index < 0 && !this.loops[c.k] && J.length) {
      const last = c.dir > 0 ? J.length - 1 : 0;
      if (c.dir > 0 ? J[last].b > L - 0.5 && c.s > J[last].a : J[last].a < 0.5 && c.s < J[last].b) index = last;
    }
    if (index < 0 || (c.plan && c.plan.index === index)) return;
    const d = Math.max(0, c.dir > 0 ? J[index].a - c.s : c.s - J[index].b);
    if (d > 50) return;
    c.plan = this.makePlan(c, index);
  }

  private makePlan(c: Car, index: number): Plan {
    const J = this.junctions[c.k][index];
    const L = this.field.length(c.k);
    const M = this.models[c.model];
    const C = this.field.at(c.k, (J.a + J.b) / 2);
    const fx = C.tx * c.dir;
    const fz = C.tz * c.dir;
    const j = J.j;
    const js = this.field.project(j, C.x, C.z);
    const Cj = this.field.at(j, js);
    const Lj = this.field.length(j);
    const straight = this.loops[c.k] || (c.dir > 0 ? J.b < L - 4 : J.a > 4);
    const options: Plan[] = [];
    for (const dir2 of [1, -1] as const) {
      if (this.oneWay[j] && dir2 !== 1) continue;
      if (M.bus && this.streets[j].width < 14 && straight) continue;
      const f2x = Cj.tx * dir2;
      const f2z = Cj.tz * dir2;
      const dot = fx * f2x + fz * f2z;
      if (dot < -0.5 || dot > 0.85) continue;
      // Left of the way it's going is (fz, -fx): a left turn heads that way.
      const turn = fz * f2x - fx * f2z > 0 ? 1 : -1;
      const lanesK = this.lanes[c.k];
      const lanesJ = this.lanes[j];
      const lane = turn > 0 ? lanesK.length - 1 : 0;
      const lane2 = turn > 0 ? lanesJ.length - 1 : 0;
      const ok = lanesK[lane];
      const oj = lanesJ[lane2];
      // Where this lane's line crosses the new lane's line: the corner the turn goes round.
      const Ax = C.x + fz * ok;
      const Az = C.z - fx * ok;
      const Bx = Cj.x + f2z * oj;
      const Bz = Cj.z - f2x * oj;
      const den = fx * f2z - fz * f2x;
      if (Math.abs(den) < 0.2) continue;
      const tA = ((Bx - Ax) * f2z - (Bz - Az) * f2x) / den;
      if (tA < -20 || tA > 25) continue;
      const I: V2 = [Ax + fx * tA, Az + fz * tA];
      const R = (turn > 0 ? 6.5 : 9) + (M.len > 6 ? 3 : 0);
      let s2 = js + (I[0] + f2x * R - Cj.x) * Cj.tx + (I[1] + f2z * R - Cj.z) * Cj.tz;
      if (this.loops[j]) s2 = (s2 + this.loopLength[j]) % this.loopLength[j];
      else if (s2 < 3 || s2 > Lj - 3) continue;
      // (Ending exactly in the lane, however the new street curves.)
      const end = this.lanePoint(j, s2, dir2, oj);
      const P2: V2 = [end.x, end.z];
      options.push({ index, turn, I, P2, R, k2: j, s2, dir2, lane2, waited: 0, f2: [end.fx, end.fz] });
    }
    let plan: Plan;
    if (straight && (!options.length || this.rng() < (M.bus ? 0.75 : 0.55)))
      plan = { index, turn: 0, I: [0, 0], P2: [0, 0], R: 0, k2: c.k, s2: 0, dir2: c.dir, lane2: c.lane, waited: 0, f2: [0, 0] };
    else if (options.length) plan = options[Math.floor(this.rng() * options.length)];
    else plan = { index, turn: 0, I: [0, 0], P2: [0, 0], R: 0, k2: c.k, s2: 0, dir2: c.dir, lane2: c.lane, waited: 0, f2: [0, 0] };
    // Into the lane for it: the outside one to turn left, the inside one to turn right.
    const lanes = this.lanes[c.k].length;
    if (plan.turn !== 0 && lanes > 1) {
      const want = plan.turn > 0 ? lanes - 1 : 0;
      if (want !== c.lane) c.lane = want;
    }
    return plan;
  }

  /** On a two-lane road, stuck behind something slow: pull out and pass it (and later back in). */
  private overtake(c: Car, who: Car | 'player' | null, gap: number, dt: number): void {
    const lanes = this.lanes[c.k].length;
    if (lanes < 2 || (c.plan && c.plan.turn !== 0) || this.models[c.model].bus) return;
    const nextJ = this.junctions[c.k].find((J) => (c.dir > 0 ? J.a > c.s : J.b < c.s));
    const toJ = nextJ ? (c.dir > 0 ? nextJ.a - c.s : c.s - nextJ.b) : Infinity;
    if (toJ < 60) return;
    const free = (lane: number) =>
      !this.cars.some((o) => o !== c && !o.turn && o.k === c.k && o.dir === c.dir && Math.min(o.lane, lanes - 1) === lane && Math.abs(o.s - c.s) < 16);
    c.laneCool -= dt;
    if (c.laneCool > 0) return;
    const slow = who && who !== 'player' && gap < 20 && who.speed < c.cruise * 0.6;
    if (slow && free(1 - c.lane)) {
      c.lane = 1 - c.lane;
      c.blink = c.lane === 0 ? -1 : 1;
      c.blinkTime = 2.2;
      c.laneCool = 6;
    } else if (c.lane === 0 && this.rng() < dt * 0.06 && free(1)) {
      // Back to the outside lane.
      c.lane = 1;
      c.blink = 1;
      c.blinkTime = 2.2;
      c.laneCool = 6;
    }
  }

  /** Reached the end of its street: round the corner onto whatever it meets, or turn back. */
  private streetEnd(c: Car, fx: number, fz: number): void {
    const L = this.field.length(c.k);
    const end = this.field.at(c.k, Math.max(0, Math.min(L, c.s)));
    const other = this.field.nearest(end.x, end.z, 3, c.k);
    if (other) {
      const p = this.field.at(other.k, other.s);
      let dir: 1 | -1 = p.tx * fx + p.tz * fz >= 0 ? 1 : -1;
      if (this.oneWay[other.k]) dir = 1;
      const Lo = this.field.length(other.k);
      const once = this.loopLength[other.k];
      const s2 = this.loops[other.k] ? (other.s + dir * 9 + once) % once : Math.max(2, Math.min(Lo - 2, other.s + dir * 9));
      const lanes = this.lanes[other.k];
      const o = lanes[Math.min(c.lane, lanes.length - 1)];
      const q = this.lanePoint(other.k, s2, dir, o);
      const reach = Math.hypot(q.x - c.x, q.z - c.z) * 0.45;
      c.turn = bezierTurn([c.x, c.z], [c.x + fx * reach, c.z + fz * reach], [q.x - q.fx * reach, q.z - q.fz * reach], [q.x, q.z], other.k, s2, dir, c.lane, 6);
      c.plan = null;
      return;
    }
    // Nothing there: round in a U-turn and back the way it came.
    const s0 = Math.max(0, Math.min(L, c.s));
    const back: 1 | -1 = this.oneWay[c.k] ? 1 : c.dir === 1 ? -1 : 1;
    const s2 = Math.max(1, Math.min(L - 1, s0 + back * 5));
    const q = this.lanePoint(c.k, s2, back, this.laneOffset(c));
    c.turn = bezierTurn([c.x, c.z], [c.x + fx * 7, c.z + fz * 7], [q.x - q.fx * 7, q.z - q.fz * 7], [q.x, q.z], c.k, s2, back, c.lane, 4);
    c.plan = null;
  }

  /** A turn round the corner `p1` (where the two lanes' lines cross) from p0 to p2. */
  private curve(p0: V2, h0: V2, p1: V2, p2: V2, f2: V2, k: number, s: number, dir: 1 | -1, lane: number, speed: number): Turn {
    // (Leaving the way it's heading and arriving along the new lane exactly: no kinks.)
    const out = (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 2) / 3;
    const c1: V2 = [p0[0] + h0[0] * out, p0[1] + h0[1] * out];
    const back = (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2) / 3;
    const c2: V2 = [p2[0] - f2[0] * back, p2[1] - f2[1] * back];
    return bezierTurn(p0, c1, c2, p2, k, s, dir, lane, speed);
  }

  /** Round the corner on its curve. */
  private steerTurn(c: Car, dt: number, player: { x: number; z: number }, walkers: readonly { x: number; z: number }[]): void {
    const T = c.turn!;
    const { gap } = this.gapAhead(c, player, walkers);
    const want = c.stunned > 0 ? 0 : Math.min(T.speed, this.stopping(gap));
    if (c.stunned > 0) c.stunned -= dt;
    c.braking = want < c.speed - 0.4;
    c.speed = damp(c.speed, want, want < c.speed ? 4 : 1.2, dt);
    // Along the curve at its speed.
    T.dist += c.speed * dt;
    const L = T.lut[T.lut.length - 1];
    if (T.dist >= L) T.u = 1;
    else {
      let i = 1;
      while (T.lut[i] < T.dist) i++;
      const f = (T.dist - T.lut[i - 1]) / (T.lut[i] - T.lut[i - 1] || 1);
      T.u = (i - 1 + f) / (T.lut.length - 1);
    }
    if (T.u >= 1) {
      c.k = T.k;
      c.s = T.s;
      c.dir = T.dir;
      c.lane = T.lane;
      c.off = this.laneOffset(c);
      c.turn = null;
      c.served = Number.NaN;
      c.busStop = -1;
      c.blinkTime = 0.6;
      this.setCruise(c);
      this.place(c);
      return;
    }
    const u = T.u;
    const w0 = (1 - u) ** 3;
    const w1 = 3 * (1 - u) ** 2 * u;
    const w2 = 3 * (1 - u) * u * u;
    const w3 = u ** 3;
    c.x = w0 * T.p0[0] + w1 * T.c1[0] + w2 * T.c2[0] + w3 * T.p3[0];
    c.z = w0 * T.p0[1] + w1 * T.c1[1] + w2 * T.c2[1] + w3 * T.p3[1];
    const [ex, ez] = bezierTangent(T, u);
    c.heading = Math.atan2(ex, ez);
  }

  // ---------------------------------------------------------------- drawing

  private buildMeshes(): void {
    const counts = this.models.map((_, i) => this.cars.filter((c) => c.model === i).length);
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35, vertexColors: true });
    const detail = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.45, vertexColors: true });
    this.models.forEach((M, i) => {
      const n = Math.max(1, counts[i]);
      const body = new THREE.InstancedMesh(M.body, paint, n);
      const det = new THREE.InstancedMesh(M.detail, detail, n);
      for (const mesh of [body, det]) {
        mesh.count = counts[i];
        mesh.frustumCulled = false;
        mesh.userData.noAO = true;
        this.group.add(mesh);
      }
      body.castShadow = true;
      this.bodies.push(body);
      this.details.push(det);
    });
    for (const c of this.cars) {
      const M = this.models[c.model];
      this.bodies[c.model].setColorAt(c.slot, this.col.setHex(M.paints[Math.floor(this.rng() * M.paints.length)]));
    }
    // Every lamp of every car: one mesh of little boxes, each lit by its own colour.
    const lampCount = this.cars.reduce((s, c) => s + this.models[c.model].lamps.length, 0);
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampCount));
    this.lamps.count = lampCount;
    this.wheels = new THREE.InstancedMesh(
      wheelGeometry(),
      new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, vertexColors: true }),
      this.cars.length * 4,
    );
    for (const mesh of [this.lamps, this.wheels]) {
      mesh.frustumCulled = false;
      mesh.userData.noAO = true;
      this.group.add(mesh);
    }
    if (typeof document !== 'undefined') {
      // Headlight beams on the road after dark; a soft shadow under every car.
      const beam = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
      this.beams = new THREE.InstancedMesh(
        beam,
        new THREE.MeshBasicMaterial({
          map: beamTexture(),
          color: 0xffe2b8,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        }),
        this.cars.length,
      );
      this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), contactShadowMaterial(0.5), this.cars.length);
      for (const mesh of [this.beams, this.shadows]) {
        mesh.frustumCulled = false;
        mesh.userData.noAO = true;
        this.group.add(mesh);
      }
      this.beams.visible = false;
    }
    this.draw(0);
  }

  private draw(time: number): void {
    const night = this.tod === 'night';
    const dusk = this.tod === 'sunset';
    const flash = time % 0.8 < 0.4;
    let lamp = 0;
    this.cars.forEach((c, i) => {
      const M = this.models[c.model];
      const y = 0.07;
      // Body: turned to its heading, pitched and rolled a touch.
      this.q.setFromAxisAngle(this.up, c.heading);
      this.q2.setFromAxisAngle(this.xAxis, -c.pitch);
      this.q.multiply(this.q2);
      this.q2.setFromAxisAngle(this.zAxis, c.roll);
      this.q.multiply(this.q2);
      this.m.compose(this.v.set(c.x, y, c.z), this.q, this.one);
      this.bodies[c.model].setMatrixAt(c.slot, this.m);
      this.details[c.model].setMatrixAt(c.slot, this.m);
      for (const L of M.lamps) {
        this.v2.set(L.x, L.y, L.z).applyQuaternion(this.q);
        this.m.compose(this.v2.add(this.v), this.q, this.sc.set(L.w, L.h, L.d));
        this.lamps.setMatrixAt(lamp, this.m);
        const left = L.kind === 'indL' && (c.blink > 0 || c.hazard > 0);
        const right = L.kind === 'indR' && (c.blink < 0 || c.hazard > 0);
        switch (L.kind) {
          case 'head':
            rgb(this.col, night ? [3, 2.9, 2.6] : dusk ? [1.8, 1.75, 1.6] : [0.95, 0.95, 0.9]);
            break;
          case 'tail':
            if (c.braking) this.col.setRGB(3.2, 0.15, 0.1);
            else rgb(this.col, night ? [1.1, 0.06, 0.05] : [0.45, 0.04, 0.04]);
            break;
          case 'indL':
          case 'indR':
            if ((left || right) && flash) this.col.setRGB(3, 1.5, 0.15);
            else this.col.setRGB(0.4, 0.2, 0.04);
            break;
          case 'sign':
            rgb(this.col, night ? [2.6, 2.3, 1.5] : [1.1, 1.0, 0.75]);
            break;
          case 'vacant':
            this.col.setRGB(2.4, 0.25, 0.15);
            break;
          case 'led':
            rgb(this.col, night ? [2.8, 1.5, 0.2] : [1.8, 0.9, 0.15]);
            break;
          case 'beacon':
            if (night && Math.sin(time * 9 + i) > 0) this.col.setRGB(3.5, 0.2, 0.15);
            else this.col.setRGB(0.6, 0.05, 0.05);
            break;
        }
        this.lamps.setColorAt(lamp, this.col);
        lamp++;
      }
      // Wheels: on the ground (not pitched), turning.
      this.q.setFromAxisAngle(this.up, c.heading);
      this.q2.setFromAxisAngle(this.xAxis, c.spin);
      const turned = this.q3.copy(this.q).multiply(this.q2);
      let w = i * 4;
      for (const az of [M.axles[0], M.axles[M.axles.length - 1]]) {
        for (const sx of [-1, 1]) {
          this.v2.set(sx * M.track, M.wheelR, az).applyQuaternion(this.q);
          this.m.compose(this.v2.add(this.v.set(c.x, y, c.z)), turned, this.sc.set(M.tyreW, M.wheelR, M.wheelR));
          this.wheels.setMatrixAt(w++, this.m);
        }
      }
      if (this.shadows) {
        this.m.compose(this.v.set(c.x, y + 0.02, c.z), this.q, this.sc.set(M.wid + 0.7, 1, M.len + 0.9));
        this.shadows.setMatrixAt(i, this.m);
      }
      if (this.beams && night) {
        const fx = Math.sin(c.heading);
        const fz = Math.cos(c.heading);
        this.m.compose(this.v.set(c.x + fx * (M.len / 2 - 0.3), y + 0.03, c.z + fz * (M.len / 2 - 0.3)), this.q, this.sc.set(M.wid * 2.6, 1, 13));
        this.beams.setMatrixAt(i, this.m);
      }
    });
    for (const list of [this.bodies, this.details]) for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    if (this.shadows) this.shadows.instanceMatrix.needsUpdate = true;
    if (this.beams && night) this.beams.instanceMatrix.needsUpdate = true;
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.tod = tod;
    if (this.beams) this.beams.visible = tod === 'night';
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }
}
