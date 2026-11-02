import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import { damp, wrapAngle } from '../core/math';
import { type CityStreet, StreetField, streetLayout } from './cityPlan';
import { GeometryBuilder } from './GeometryBuilder';

/**
 * City traffic for free drive: little cars - kei cars, saloons, taxis and vans - driving the
 * streets in the left lane (they drive on the left), turning at junctions, stopping at red
 * lights on the main roads, queueing behind each other and braking for you. They're solid: hit
 * one and it stops for a moment. Drawn as instanced low-poly models with their lights on after
 * dark.
 */
export interface TrafficBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  angle: number;
}

interface Car {
  type: number;
  k: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  cruise: number;
  /** Seconds stopped after being hit. */
  stunned: number;
  /** Drawn position and heading (eased, so turns are smooth). */
  x: number;
  z: number;
  heading: number;
  /** Seconds before it may turn again (so it doesn't flip-flop at a junction). */
  turnWait: number;
  /** Which lane on a two-lane road: 0 the inside (overtaking, turning right), 1 the outside. */
  lane: number;
}

/** A junction with traffic lights: which streets cross there (road a, road b). */
export interface SignalJunction {
  x: number;
  z: number;
  a: number;
  b: number;
}

/** Cars further than this from you are moved to a street near you. */
const NEAR = 450;

const TYPES = [
  // length, width, height, cabin start (from the back), cabin length, colours
  { len: 3.4, wid: 1.48, hi: 1.7, cab0: 0.5, cabLen: 2.4, paints: [0xf2f2f2, 0xe7d9a8, 0x9fd3e8, 0xf4b6c2, 0xd8d8d8] }, // kei car (tall box)
  { len: 4.6, wid: 1.75, hi: 1.45, cab0: 1.2, cabLen: 2.3, paints: [0x1c1c22, 0xe8e8e8, 0x8a8f99, 0x2b3a67, 0x7a1f24] }, // saloon
  { len: 4.6, wid: 1.72, hi: 1.5, cab0: 1.2, cabLen: 2.2, paints: [0xf2c200, 0x2c4a7a, 0x111111, 0x2e7d4f] }, // taxi
  { len: 4.8, wid: 1.85, hi: 2.0, cab0: 0.2, cabLen: 3.6, paints: [0xf2f2f2, 0xdadada, 0x3d6eb5] }, // van
];

export class CityTraffic {
  readonly group = new THREE.Group();
  /** Where each car is, as a box (for the player's collisions). */
  readonly boxes: TrafficBox[] = [];
  private readonly field: StreetField;
  private readonly cars: Car[] = [];
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly glass: THREE.InstancedMesh[] = [];
  private readonly lights: THREE.InstancedMesh[] = [];
  private readonly lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private recycle = 0;

  constructor(
    private readonly streets: CityStreet[],
    private readonly signals: SignalJunction[],
    count: number,
    private readonly rng: () => number,
  ) {
    this.group.name = 'traffic';
    this.field = new StreetField(streets);
    const total = streets.reduce((s, _, k) => s + this.field.length(k), 0);
    for (let i = 0; i < count; i++) {
      // A random spot, weighted by street length (busier on the big roads).
      let pick = this.rng() * total;
      let k = 0;
      while (k < streets.length - 1 && pick > this.field.length(k)) pick -= this.field.length(k++);
      const type = Math.floor(this.rng() * TYPES.length);
      const cruise = (streets[k].width >= 14 ? 13 : 9) + this.rng() * 3;
      const lane = this.rng() < 0.6 ? 1 : 0;
      const car: Car = { type, k, s: pick, dir: this.rng() < 0.5 ? 1 : -1, speed: cruise, cruise, stunned: 0, x: 0, z: 0, heading: 0, turnWait: 0, lane };
      const p = this.target(car);
      car.x = p.x;
      car.z = p.z;
      car.heading = p.heading;
      this.cars.push(car);
      this.boxes.push({ x: p.x, z: p.z, hw: TYPES[type].wid / 2, hd: TYPES[type].len / 2, angle: p.heading });
    }
    this.buildMeshes();
  }

  /** Where a car should be: in its lane on the left of its street, facing its way along it. */
  private target(c: Car): { x: number; z: number; heading: number } {
    const p = this.field.at(c.k, c.s);
    const fx = p.tx * c.dir;
    const fz = p.tz * c.dir;
    const lanes = streetLayout(this.streets[c.k].width).lanes;
    const lane = lanes[Math.min(c.lane, lanes.length - 1)];
    // Left of the way it's going is (fz, -fx).
    return { x: p.x + fz * lane, z: p.z - fx * lane, heading: Math.atan2(fx, fz) };
  }

  /** Put a car on a street 150-380 m from (x, z). */
  private respawnNear(c: Car, at: { x: number; z: number }): void {
    for (let tries = 0; tries < 6; tries++) {
      const a = this.rng() * Math.PI * 2;
      const r = 150 + this.rng() * 230;
      const hit = this.field.nearest(at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, 40);
      if (!hit) continue;
      c.k = hit.k;
      c.s = Math.max(1, Math.min(this.field.length(hit.k) - 1, hit.s));
      c.dir = this.rng() < 0.5 ? 1 : -1;
      c.cruise = (this.streets[hit.k].width >= 14 ? 13 : 9) + this.rng() * 3;
      c.speed = c.cruise;
      c.stunned = 0;
      const p = this.target(c);
      c.x = p.x;
      c.z = p.z;
      c.heading = p.heading;
      return;
    }
  }

  /** A car got hit: it stops for a moment. */
  bump(i: number): void {
    this.cars[i].stunned = 2.5;
    this.cars[i].speed = 0;
  }

  /**
   * Move the traffic on. `player`: your car (they brake for it). `signalTime`: the traffic
   * lights' clock (StreetFurniture's cycle: road a green for the first 10 s of 24, b from 12 to 22).
   */
  update(dt: number, player: { x: number; z: number }, signalTime: number): void {
    // Traffic lives around you: a car that's got far away comes back on a street near you
    // (out past the next few blocks), so the streets you're on are always busy.
    for (let n = 0; n < 3; n++) {
      const c = this.cars[this.recycle++ % this.cars.length];
      if ((c.x - player.x) ** 2 + (c.z - player.z) ** 2 > NEAR * NEAR) this.respawnNear(c, player);
    }
    const t = signalTime % 24;
    const greenA = t < 11;
    const greenB = t >= 12 && t < 23;
    this.cars.forEach((c, i) => {
      const L = this.field.length(c.k);
      c.turnWait = Math.max(0, c.turnWait - dt);
      let want = c.cruise;
      if (c.stunned > 0) {
        c.stunned -= dt;
        want = 0;
      }
      const p = this.field.at(c.k, c.s);
      const fx = p.tx * c.dir;
      const fz = p.tz * c.dir;
      // Something ahead: another car in the same lane, or you.
      const ahead = (x: number, z: number) => {
        const dx = x - c.x;
        const dz = z - c.z;
        const along = dx * fx + dz * fz;
        const across = Math.abs(dx * fz - dz * fx);
        return along > 0 && across < 2.6 ? along : Infinity;
      };
      let gap = ahead(player.x, player.z) - 3;
      for (const o of this.cars) if (o !== c) gap = Math.min(gap, ahead(o.x, o.z) - TYPES[o.type].len / 2 - TYPES[c.type].len / 2);
      // A red light at the junction coming up (main roads only): wait at the stop line, which
      // is painted 10.5 m back from the edge of the road crossing.
      for (const j of this.signals) {
        const road = j.a === c.k ? 'a' : j.b === c.k ? 'b' : null;
        if (!road || (road === 'a' ? greenA : greenB)) continue;
        const other = this.streets[road === 'a' ? j.b : j.a];
        const stopAt = (other ? other.width / 2 : 7) + 11;
        // (The junction's middle is on the street's centre line, off to the side of the lane.)
        const dx = j.x - c.x;
        const dz = j.z - c.z;
        const d = dx * fx + dz * fz;
        if (Math.abs(dx * fz - dz * fx) > this.streets[c.k].width / 2 + 2) continue;
        if (d > stopAt - 3 && d < stopAt + 50) gap = Math.min(gap, d - stopAt);
      }
      if (gap < 30) want = Math.min(want, Math.max(0, (gap - 2) * 0.9));
      c.speed = damp(c.speed, want, want < c.speed ? 4 : 1.2, dt);
      c.s += c.speed * c.dir * dt;

      // At a junction (another street crossing here): maybe turn onto it.
      if (c.turnWait <= 0 && this.rng() < dt * 0.9) {
        const other = this.field.nearest(p.x, p.z, -this.streets[c.k].width / 2 + 0.5, c.k);
        if (other && this.rng() < 0.45) this.turn(c, other.k, other.s, fx, fz);
        c.turnWait = 2.5;
      }
      // The end of the street: onto whatever it meets, or round and back.
      if (c.s < 0 || c.s > L) {
        const end = this.field.at(c.k, Math.max(0, Math.min(L, c.s)));
        const other = this.field.nearest(end.x, end.z, 3, c.k);
        if (other) this.turn(c, other.k, other.s, fx, fz, true);
        else {
          c.s = Math.max(0, Math.min(L, c.s));
          c.dir = c.dir === 1 ? -1 : 1;
        }
      }
      // Ease the drawn car toward its lane position.
      const target = this.target(c);
      const k = 1 - Math.exp(-dt * 6);
      c.x += (target.x - c.x) * k;
      c.z += (target.z - c.z) * k;
      c.heading += wrapAngle(target.heading - c.heading) * k;
      const b = this.boxes[i];
      b.x = c.x;
      b.z = c.z;
      b.angle = c.heading;
    });
    this.draw();
  }

  /** Turn onto street `k` at `s`, whichever way along it is nearer to straight on (or any way, at a dead end). */
  private turn(c: Car, k: number, s: number, fx: number, fz: number, forced = false): void {
    const p = this.field.at(k, s);
    const straight = p.tx * fx + p.tz * fz;
    // Mostly the gentler way; sometimes the other (a proper turn).
    let dir: 1 | -1 = straight >= 0 ? 1 : -1;
    if (!forced && this.rng() < 0.4) dir = dir === 1 ? -1 : 1;
    c.k = k;
    c.s = s;
    c.dir = dir;
    c.cruise = (this.streets[k].width >= 14 ? 13 : 9) + this.rng() * 3;
  }

  // ---------------------------------------------------------------- drawing

  private buildMeshes(): void {
    const counts = TYPES.map((_, t) => this.cars.filter((c) => c.type === t).length);
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.1, metalness: 0.6 });
    TYPES.forEach((T, t) => {
      const n = Math.max(1, counts[t]);
      // Body, a darker sill with the wheels, the cabin glasshouse, lights front and back.
      const body = new GeometryBuilder(true);
      const white = new THREE.Color(1, 1, 1);
      const dark = new THREE.Color(0.12, 0.12, 0.13);
      const lower = T.hi * 0.45;
      body.box(0, 0.32, 0, T.wid, lower, T.len, 0, { color: white });
      body.box(0, 0.32 + lower, -T.len / 2 + T.cab0 + T.cabLen / 2, T.wid * 0.92, T.hi - lower - 0.32, T.cabLen, 0, { color: white });
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        body.box((sx * T.wid) / 2 - sx * 0.1, 0, sz * (T.len / 2 - 0.75), 0.24, 0.62, 0.62, 0, { color: dark });
      }
      if (t === 2) body.box(0, T.hi, -T.len / 2 + T.cab0 + T.cabLen / 2, 0.5, 0.22, 0.25, 0, { color: new THREE.Color(1.6, 1.4, 0.6) });
      const bodies = new THREE.InstancedMesh(body.build(), paint.clone(), n);
      (bodies.material as THREE.MeshStandardMaterial).vertexColors = true;
      // Glass: a slightly smaller box inside the cabin, showing through as windows.
      const g = new GeometryBuilder();
      g.box(0, 0.36 + lower, -T.len / 2 + T.cab0 + T.cabLen / 2, T.wid * 0.94, (T.hi - lower - 0.32) * 0.75, T.cabLen * 1.01, 0, { roof: null });
      const glass = new THREE.InstancedMesh(g.build(), glassMat, n);
      // Lights: white at the front, red at the back.
      const l = new GeometryBuilder(true);
      const head = new THREE.Color(1.4, 1.35, 1.2);
      const tail = new THREE.Color(1.6, 0.08, 0.06);
      for (const sx of [-1, 1]) {
        l.box((sx * T.wid) / 2 - sx * 0.3, 0.55, T.len / 2 + 0.01, 0.34, 0.16, 0.04, 0, { color: head, roof: null });
        l.box((sx * T.wid) / 2 - sx * 0.3, 0.6, -T.len / 2 - 0.01, 0.34, 0.14, 0.04, 0, { color: tail, roof: null });
      }
      const lights = new THREE.InstancedMesh(l.build(), this.lightMat, n);
      const c = new THREE.Color();
      this.cars
        .filter((car) => car.type === t)
        .forEach((_, i) => {
          bodies.setColorAt(i, c.setHex(T.paints[Math.floor(this.rng() * T.paints.length)]));
        });
      for (const mesh of [bodies, glass, lights]) {
        mesh.count = counts[t];
        mesh.frustumCulled = false;
        mesh.userData.noAO = true;
        this.group.add(mesh);
      }
      bodies.castShadow = true;
      this.bodies.push(bodies);
      this.glass.push(glass);
      this.lights.push(lights);
    });
    this.draw();
  }

  private draw(): void {
    const index = TYPES.map(() => 0);
    for (const c of this.cars) {
      const i = index[c.type]++;
      this.q.setFromAxisAngle(this.up, c.heading);
      this.m.compose(this.v.set(c.x, 0.08, c.z), this.q, this.one);
      this.bodies[c.type].setMatrixAt(i, this.m);
      this.glass[c.type].setMatrixAt(i, this.m);
      this.lights[c.type].setMatrixAt(i, this.m);
    }
    for (const list of [this.bodies, this.glass, this.lights]) for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const v = tod === 'night' ? 2.2 : tod === 'sunset' ? 1.4 : 0.8;
    this.lightMat.color.setRGB(v, v, v);
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }
}
