import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeOfDay } from '../../shared/api';
import { damp, dampAngle } from '../core/math';
import type { BusStopSpot, SignalJunction } from './CityTraffic';
import { type CityStreet, PAVEMENT, StreetField, streetApproaches, streetJunctions, streetLayout } from './cityPlan';

/**
 * People in town (free drive): walking the pavements (busiest downtown and in the shopping
 * streets), crossing at the zebra crossings - waiting for the green man at the traffic lights -
 * waiting at the bus stops (and getting on when the bus comes), looking in shop windows,
 * stopping for a chat; school kids with yellow caps and their randoseru, people with bags, and
 * after dark (it's been raining) clear umbrellas. Cyclists on their mamachari ride the side
 * streets' shoulders and the main roads' pavements. Anyone a car comes at steps out of the way -
 * and jumps, arms up, if it's close.
 */

type Mode = 'walk' | 'wait' | 'cross' | 'idle' | 'busWait' | 'board';

interface Walker {
  k: number;
  s: number;
  dir: 1 | -1;
  /** Which pavement: right (+1) or left (-1) of the street. */
  side: 1 | -1;
  speed: number;
  /** How far toward the buildings they've stepped to let a car past (m). */
  dodge: number;
  phase: number;
  x: number;
  z: number;
  heading: number;
  mode: Mode;
  timer: number;
  /** Across the pavement (from the street's edge, m) when standing about; the way they face. */
  out: number;
  face: number;
  /** Crossing: how far across (0 to 1), and the crossing's light (or none). */
  across: number;
  light: { sig: SignalJunction; road: 'a' | 'b' } | null;
  /** The bus stop they're waiting at. */
  stop: number;
  /** A hop (m) and arms up (0-1), when a car comes too close. */
  hop: number;
  scare: number;
  scale: number;
  kid: boolean;
  bag: number;
  umbrella: number;
}

interface Rider {
  k: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  cruise: number;
  x: number;
  z: number;
  heading: number;
  phase: number;
  swerve: number;
  scale: number;
}

/** A zebra crossing on street k: its middle (s), and the lights for people crossing, if any. */
interface Crossing {
  s: number;
  light: { sig: SignalJunction; road: 'a' | 'b' } | null;
}

const SKIN = [0xf1d0b0, 0xe8bf9a, 0xd9a882, 0xc68e66, 0xf6dcc4];
const HAIR = [0x111111, 0x111111, 0x161210, 0x1c1410, 0x2a1a12, 0x2a1a12, 0x4a3020, 0x8a8a88, 0xd8d4cc, 0xa8743c];
const SUITS = [0x1c2230, 0x222326, 0x3a3f48, 0x2b2f3a];
const TOPS = [0xf2f2ee, 0xb0413e, 0x3d5a80, 0xe9c46a, 0x8d99ae, 0x264653, 0xf4a261, 0x9c6644, 0x6a994e, 0xd8a7b1, 0xe0e0e0, 0x111111, 0x7a5c8a];
const BOTTOMS = [0x1c1f2a, 0x26282e, 0x3d4250, 0x2f4a6b, 0x2f4a6b, 0xb8a888, 0x5a5e66];
const UMBRELLAS = [0xf4f6f8, 0xf4f6f8, 0xf4f6f8, 0x2b3a55, 0xb83a3a, 0x1d1d1d, 0x6e8f6a];
const BAGS = [0x2a2420, 0x6b4a2e, 0xe8e4dc, 0x9a2c2c, 0x1d2a44];
const RANDOSERU = [0xb01e24, 0x1d1d22, 0x6b3a2a, 0xb01e24];
const BIKES = [0xe8e8e4, 0x1d1d22, 0x9fc4d8, 0xb0413e, 0xd8c9a0, 0x6a994e];
const HIP = 0.92;
const SHOULDER = 1.44;

export class CityPeople {
  readonly group = new THREE.Group();
  /** Where people are out in the road right now (the traffic stops for them). */
  readonly inRoad: { x: number; z: number }[] = [];
  private readonly field: StreetField;
  private readonly walkers: Walker[] = [];
  private readonly riders: Rider[] = [];
  private readonly crossings: Crossing[][];
  private readonly stops: BusStopSpot[];
  private readonly torsos: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly bags: THREE.InstancedMesh;
  private readonly packs: THREE.InstancedMesh;
  private readonly umbrellas: THREE.InstancedMesh;
  private readonly bikes: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();
  private readonly rot = new THREE.Matrix4();
  private readonly move = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private recycle = 0;
  private night = false;

  constructor(
    private readonly streets: CityStreet[],
    count: number,
    private readonly rng: () => number,
    opts: { signals?: SignalJunction[]; busStops?: BusStopSpot[] } = {},
  ) {
    this.group.name = 'people';
    this.field = new StreetField(streets);
    this.stops = opts.busStops ?? [];
    const signals = opts.signals ?? [];
    // The zebra crossings on each street, with their lights.
    const junctions = streetJunctions(streets, this.field);
    this.crossings = streets.map((_, k) => {
      const out: Crossing[] = [];
      for (const A of streetApproaches(junctions[k], this.field.length(k))) {
        if (!A.zebra) continue;
        const mid = this.field.at(k, (A.zebra[0] + A.zebra[1]) / 2);
        const sig = signals.find((g) => ((g.a === k && g.b === A.j) || (g.a === A.j && g.b === k)) && Math.hypot(g.x - mid.x, g.z - mid.z) < 50);
        out.push({ s: (A.zebra[0] + A.zebra[1]) / 2, light: sig ? { sig, road: sig.a === k ? 'a' : 'b' } : null });
      }
      return out;
    });
    // More people the nearer the middle of town.
    const weight = streets.map((_, k) => {
      const mid = this.field.at(k, this.field.length(k) / 2);
      const r = Math.hypot(mid.x, mid.z);
      return this.field.length(k) * (r < 330 ? 3 : r < 720 ? 2 : r < 1050 ? 0.8 : 0.3);
    });
    const total = weight.reduce((a, b) => a + b, 0);
    let bags = 0;
    let packs = 0;
    let umbrellas = 0;
    for (let i = 0; i < count; i++) {
      let pick = rng() * total;
      let k = 0;
      while (k < streets.length - 1 && pick > weight[k]) pick -= weight[k++];
      const mid = this.field.at(k, this.field.length(k) / 2);
      const r = Math.hypot(mid.x, mid.z);
      const kid = r > 330 && r < 1050 && rng() < 0.12;
      const elderly = !kid && rng() < 0.1;
      const w: Walker = {
        k,
        s: rng() * this.field.length(k),
        dir: rng() < 0.5 ? 1 : -1,
        side: rng() < 0.5 ? 1 : -1,
        speed: kid ? 1.3 + rng() * 0.5 : elderly ? 0.8 + rng() * 0.3 : 1.15 + rng() * 0.5,
        dodge: 0,
        phase: rng() * 10,
        x: 0,
        z: 0,
        heading: 0,
        mode: 'walk',
        timer: 0,
        out: PAVEMENT / 2,
        face: 0,
        across: 0,
        light: null,
        stop: -1,
        hop: 0,
        scare: 0,
        scale: kid ? 0.6 + rng() * 0.08 : 0.92 + rng() * 0.14,
        kid,
        bag: kid ? packs++ : rng() < 0.35 ? bags++ : -1,
        umbrella: !kid && rng() < 0.4 ? umbrellas++ : -1,
      };
      // Some stand about: in front of a shop or chatting (index 0 always walks).
      if (i > 0 && i % 9 === 4) this.idle(w, 8 + rng() * 30);
      this.place(w, 0);
      this.walkers.push(w);
    }
    // A few waiting at the bus stops to begin with.
    this.stops.forEach((_, i) => {
      if (i % 3 !== 0) return;
      const w = this.walkers[(i * 7 + 3) % this.walkers.length];
      if (w !== this.walkers[0]) this.toBusStop(w, i);
    });
    // Cyclists.
    const nRiders = Math.max(4, Math.round(count * 0.1));
    for (let i = 0; i < nRiders; i++) {
      let pick = rng() * total;
      let k = 0;
      while (k < streets.length - 1 && pick > weight[k]) pick -= weight[k++];
      const cruise = 3.4 + rng() * 1.8;
      const rd: Rider = {
        k,
        s: rng() * this.field.length(k),
        dir: rng() < 0.5 ? 1 : -1,
        speed: cruise,
        cruise,
        x: 0,
        z: 0,
        heading: 0,
        phase: rng() * 10,
        swerve: 0,
        scale: 0.94 + rng() * 0.1,
      };
      this.placeRider(rd, 0);
      this.riders.push(rd);
    }

    // Low-poly figures: a body, head and hair, two legs and two arms that swing from the hips and shoulders.
    const n = this.walkers.length + this.riders.length;
    const torso = new THREE.CylinderGeometry(0.19, 0.16, 0.6, 8).scale(1, 1, 0.66).translate(0, 1.17, 0);
    const head = new THREE.SphereGeometry(0.11, 10, 8).scale(1, 1.08, 1).translate(0, 1.62, 0);
    const hair = new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.635, -0.012);
    const leg = shaded(new THREE.BoxGeometry(0.14, 0.92, 0.16, 1, 10, 1).translate(0, -0.46, 0), (y) => (y < -0.84 ? 0.22 : 1));
    const arm = new THREE.BoxGeometry(0.085, 0.62, 0.095).translate(0, -0.31, 0);
    const lambert = (vertexColors = false) => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors });
    this.torsos = new THREE.InstancedMesh(torso, lambert(), n);
    this.heads = new THREE.InstancedMesh(head, lambert(), n);
    this.hair = new THREE.InstancedMesh(hair, lambert(), n);
    this.legs = new THREE.InstancedMesh(leg, lambert(true), n * 2);
    this.arms = new THREE.InstancedMesh(arm, lambert(), n * 2);
    this.bags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.3, 0.1).translate(0, -0.15, 0), lambert(), Math.max(1, bags));
    this.packs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.32, 0.16).translate(0, 1.18, -0.2), lambert(), Math.max(1, packs));
    const canopy = new THREE.ConeGeometry(0.58, 0.26, 12, 1, true).translate(0, 2.08, 0);
    const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.95, 4).translate(0, 1.55, 0);
    this.umbrellas = new THREE.InstancedMesh(
      mergeGeometries([canopy.toNonIndexed(), shaft.toNonIndexed()])!,
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, roughness: 0.25, side: THREE.DoubleSide, depthWrite: false }),
      Math.max(1, umbrellas),
    );
    this.bags.count = bags;
    this.packs.count = packs;
    this.umbrellas.count = umbrellas;
    this.bikes = new THREE.InstancedMesh(
      bikeGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 }),
      this.riders.length,
    );
    const c = new THREE.Color();
    const pick = (list: number[]) => list[Math.floor(rng() * list.length)];
    for (let i = 0; i < n; i++) {
      const w = i < this.walkers.length ? this.walkers[i] : null;
      const suit = !w?.kid && rng() < 0.3;
      const top = w?.kid ? pick([0xf2f2ee, 0x2a3a5c, 0xe9c46a, 0xd8a7b1]) : suit ? pick(SUITS) : pick(TOPS);
      const bottom = suit ? top : w?.kid ? pick([0x1d2a44, 0x2a2a2e, 0x6a6e78]) : pick(BOTTOMS);
      const skin = pick(SKIN);
      this.torsos.setColorAt(i, c.setHex(top));
      // (Short sleeves now and then.)
      if (!suit && rng() < 0.35) c.setHex(skin);
      this.arms.setColorAt(i * 2, c);
      this.arms.setColorAt(i * 2 + 1, c);
      this.legs.setColorAt(i * 2, c.setHex(bottom));
      this.legs.setColorAt(i * 2 + 1, c);
      this.heads.setColorAt(i, c.setHex(skin));
      // Kids' yellow school caps; grey hair now and then.
      this.hair.setColorAt(i, c.setHex(w?.kid ? 0xf2cf2e : pick(HAIR)));
      if (w && w.bag >= 0) (w.kid ? this.packs : this.bags).setColorAt(w.bag, c.setHex(pick(w.kid ? RANDOSERU : BAGS)));
      if (w && w.umbrella >= 0) this.umbrellas.setColorAt(w.umbrella, c.setHex(pick(UMBRELLAS)));
    }
    this.riders.forEach((_, i) => this.bikes.setColorAt(i, c.setHex(pick(BIKES))));
    for (const mesh of [this.torsos, this.heads, this.hair, this.legs, this.arms, this.bags, this.packs, this.umbrellas, this.bikes]) {
      mesh.frustumCulled = false;
      mesh.userData.noAO = true;
      this.group.add(mesh);
    }
    this.umbrellas.visible = false;
    this.draw(0);
  }

  // ---------------------------------------------------------------- what people do

  /** Stand about: in front of a shop window, or chatting. */
  private idle(w: Walker, seconds: number): void {
    w.mode = 'idle';
    w.timer = seconds;
    const shop = this.rng() < 0.5;
    w.out = shop ? PAVEMENT - 0.35 : PAVEMENT / 2 + (this.rng() - 0.5) * 0.6;
    // Facing the shops (away from the road), or someone along the pavement.
    w.face = shop ? 1 : this.rng() < 0.5 ? 0.5 : -0.5;
  }

  /** Off to wait at bus stop i. */
  private toBusStop(w: Walker, i: number): void {
    const st = this.stops[i];
    w.k = st.k;
    w.side = st.side;
    w.s = st.s + (this.rng() - 0.5) * 4;
    w.out = 0.75 + this.rng() * 0.4;
    w.mode = 'busWait';
    w.stop = i;
    w.timer = 60 + this.rng() * 60;
    w.dodge = 0;
    this.place(w, 0);
  }

  /** The way along street k at s (unit), and the point `o` metres to its right. */
  private at(k: number, s: number, o: number): { x: number; z: number; tx: number; tz: number } {
    const p = this.field.at(k, s);
    return { x: p.x - p.tz * o, z: p.z + p.tx * o, tx: p.tx, tz: p.tz };
  }

  /** Where they should be, by what they're doing; eased there. */
  private place(w: Walker, dt: number): void {
    const L = this.field.length(w.k);
    const hw = this.streets[w.k].width / 2;
    let x: number;
    let z: number;
    let heading: number;
    if (w.mode === 'cross') {
      // Across the road at the crossing, from their side to the other.
      const o = w.side * (hw + 0.5) * (1 - 2 * w.across);
      const p = this.at(w.k, w.s + w.dodge * 0.6, o);
      x = p.x;
      z = p.z;
      // Heading toward the other side: -side times the street's right-hand normal.
      heading = Math.atan2(p.tz * w.side, -p.tx * w.side);
    } else {
      if (w.s < 1 || w.s > L - 1) {
        w.s = Math.max(1, Math.min(L - 1, w.s));
        w.dir = w.dir === 1 ? -1 : 1;
      }
      const off = w.mode === 'wait' ? 0.5 : w.out;
      const p = this.at(w.k, w.s, w.side * (hw + off + w.dodge));
      x = p.x;
      z = p.z;
      const along = Math.atan2(p.tx * w.dir, p.tz * w.dir);
      // (The street's right-hand normal is (-tz, tx): toward the road from this side is -side times that.)
      const road = Math.atan2(p.tz * w.side, -p.tx * w.side);
      if (w.mode === 'walk') heading = along;
      else if (w.mode === 'wait' || w.mode === 'busWait' || w.mode === 'board') heading = road;
      else heading = w.face === 1 ? road + Math.PI : Math.atan2(p.tx * Math.sign(w.face), p.tz * Math.sign(w.face));
    }
    if (dt === 0) {
      w.x = x;
      w.z = z;
      w.heading = heading;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      w.x += (x - w.x) * k;
      w.z += (z - w.z) * k;
      w.heading = dampAngle(w.heading, heading, 9, dt);
    }
  }

  /** Can people cross street k at this crossing now? (A green man: the street's traffic has a red, with time to get over.) */
  private greenMan(c: Crossing, t: number): boolean {
    if (!c.light) return true;
    // Road a has green for 0-11 s of the 24 s cycle, road b for 12-23.
    return c.light.road === 'a' ? t > 11.5 && t < 15 : t > 23.5 || t < 3;
  }

  /** Walk everyone on; anyone a car's coming at steps aside. */
  update(dt: number, time: number, car: { x: number; z: number; speed: number }, buses: ReadonlySet<number> = new Set(), signalTime = time): void {
    // People are about where you are: anyone far off turns up on a pavement nearer you (some at a bus stop).
    for (let n = 0; n < 4; n++) {
      const w = this.walkers[this.recycle++ % this.walkers.length];
      if ((w.x - car.x) ** 2 + (w.z - car.z) ** 2 > 300 * 300 || (w.mode === 'board' && w.timer <= 0)) this.respawn(w, car);
    }
    const t = ((signalTime % 24) + 24) % 24;
    this.inRoad.length = 0;
    for (const w of this.walkers) {
      const d = Math.hypot(car.x - w.x, car.z - w.z);
      const threat = d < 9 && car.speed > 2;
      w.dodge = damp(w.dodge, threat ? 2.2 : 0, threat ? 14 : 2, dt);
      // Too close (you came round a corner fast): a jump clear, arms up.
      if (d < 2.4 && car.speed > 2) {
        w.dodge = 2.6;
        if (w.hop <= 0.01) w.hop = 0.35;
        w.scare = 1;
      }
      w.hop = Math.max(0, w.hop - dt * 1.4);
      w.scare = damp(w.scare, threat && d < 5 ? 1 : 0, 3, dt);
      this.act(w, dt, t, buses, threat);
      this.place(w, dt);
      if (w.mode === 'cross' && w.across > 0.03 && w.across < 0.97 && (w.x - car.x) ** 2 + (w.z - car.z) ** 2 < 200 * 200) this.inRoad.push({ x: w.x, z: w.z });
    }
    for (const r of this.riders) {
      const d = Math.hypot(car.x - r.x, car.z - r.z);
      const threat = d < 10 && car.speed > 2;
      r.swerve = damp(r.swerve, threat ? 1 : 0, threat ? 6 : 1.5, dt);
      r.speed = damp(r.speed, threat ? r.cruise * 0.4 : r.cruise, 2, dt);
      r.s += r.speed * r.dir * dt;
      if ((r.x - car.x) ** 2 + (r.z - car.z) ** 2 > 320 * 320) {
        const hit = this.near(car);
        if (hit) {
          r.k = hit.k;
          r.s = hit.s;
          this.placeRider(r, 0);
        }
      }
      this.placeRider(r, dt);
    }
    this.draw(time);
  }

  /** What each person does next. */
  private act(w: Walker, dt: number, t: number, buses: ReadonlySet<number>, threat: boolean): void {
    switch (w.mode) {
      case 'walk': {
        const before = w.s;
        w.s += w.speed * w.dir * dt;
        // Passing a zebra crossing: sometimes cross the road there.
        for (const c of this.crossings[w.k]) {
          if ((before - c.s) * (w.s - c.s) <= 0 && this.rng() < 0.35) {
            w.s = c.s + (this.rng() - 0.5) * 2.4;
            w.light = c.light;
            w.mode = this.greenMan(c, t) ? 'cross' : 'wait';
            w.across = 0;
            break;
          }
        }
        // And now and then stop to look in a window or chat.
        if (w.mode === 'walk' && this.rng() < dt * 0.008) this.idle(w, 6 + this.rng() * 20);
        break;
      }
      case 'wait':
        if (!w.light || this.greenMan({ s: w.s, light: w.light }, t)) {
          w.mode = 'cross';
          w.across = 0;
        }
        break;
      case 'cross': {
        const hw = this.streets[w.k].width / 2;
        w.across += (w.speed * (threat ? 1.8 : 1.25) * dt) / (2 * hw + 1);
        if (w.across >= 1) {
          w.side = w.side === 1 ? -1 : 1;
          w.mode = 'walk';
          w.out = PAVEMENT / 2;
          w.dir = this.rng() < 0.5 ? 1 : -1;
          w.s += w.dodge * 0.6;
        }
        break;
      }
      case 'idle':
        w.timer -= dt;
        if (w.timer <= 0) {
          w.mode = 'walk';
          w.out = PAVEMENT / 2;
        }
        break;
      case 'busWait':
        w.timer -= dt;
        // The bus is here: on they get.
        if (buses.has(w.stop)) {
          w.mode = 'board';
          w.timer = 1.4;
        } else if (w.timer <= 0) {
          w.mode = 'walk';
          w.out = PAVEMENT / 2;
        }
        break;
      case 'board':
        w.out = damp(w.out, -0.4, 3, dt);
        w.timer -= dt;
        break;
    }
  }

  /** A street point 80-280 m from you (on a pavement), or null. */
  private near(car: { x: number; z: number }): { k: number; s: number } | null {
    const a = this.rng() * Math.PI * 2;
    const r = 80 + this.rng() * 200;
    return this.field.nearest(car.x + Math.cos(a) * r, car.z + Math.sin(a) * r, 30);
  }

  /** Bring someone back on a pavement near you: walking, or now and then waiting for a bus. */
  private respawn(w: Walker, car: { x: number; z: number }): void {
    w.dodge = 0;
    w.hop = 0;
    w.scare = 0;
    if (this.stops.length && this.rng() < 0.2) {
      let best = -1;
      let bestD = 260;
      this.stops.forEach((st, i) => {
        const p = this.field.at(st.k, st.s);
        const d = Math.hypot(p.x - car.x, p.z - car.z);
        const waiting = this.walkers.filter((o) => o.mode === 'busWait' && o.stop === i).length;
        if (d > 60 && d < bestD && waiting < 3) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        this.toBusStop(w, best);
        return;
      }
    }
    const hit = this.near(car);
    if (!hit) return;
    w.k = hit.k;
    w.s = hit.s;
    w.mode = 'walk';
    w.out = PAVEMENT / 2;
    if (this.rng() < 0.12) this.idle(w, 8 + this.rng() * 25);
    this.place(w, 0);
  }

  /** Cyclists ride on the left: on a side street's shoulder, on a main road's pavement. */
  private placeRider(r: Rider, dt: number): void {
    const L = this.field.length(r.k);
    if (r.s < 1 || r.s > L - 1) {
      // The end of the street: onto whatever it meets, or round and back.
      const end = this.field.at(r.k, Math.max(0, Math.min(L, r.s)));
      const other = this.field.nearest(end.x, end.z, 3, r.k);
      if (other) {
        const p = this.field.at(other.k, other.s);
        r.k = other.k;
        r.s = other.s;
        r.dir = p.tx * end.tx * r.dir + p.tz * end.tz * r.dir >= 0 ? 1 : -1;
        if (this.rng() < 0.4) r.dir = r.dir === 1 ? -1 : 1;
      } else {
        r.s = Math.max(1, Math.min(L - 1, r.s));
        r.dir = r.dir === 1 ? -1 : 1;
      }
    }
    const st = this.streets[r.k];
    const o = st.width >= 14 ? st.width / 2 + 0.9 : streetLayout(st.width).edge + 0.65;
    // Left of the way they're going: the right-hand side times -dir.
    const p = this.at(r.k, r.s, -r.dir * (o + r.swerve * 0.7));
    const heading = Math.atan2(p.tx * r.dir, p.tz * r.dir);
    if (dt === 0) {
      r.x = p.x;
      r.z = p.z;
      r.heading = heading;
    } else {
      const k = 1 - Math.exp(-dt * 4);
      r.x += (p.x - r.x) * k;
      r.z += (p.z - r.z) * k;
      r.heading = dampAngle(r.heading, heading, 5, dt);
    }
  }

  // ---------------------------------------------------------------- drawing

  private draw(time: number): void {
    const nW = this.walkers.length;
    this.walkers.forEach((w, i) => {
      const moving = w.mode === 'walk' || w.mode === 'cross' || w.mode === 'board';
      const step = (time + w.phase) * w.speed * (w.kid ? 5.2 : 4.2);
      const bob = moving ? Math.abs(Math.sin(step)) * 0.05 * w.scale : 0;
      const swing = moving ? Math.sin(step) * 0.45 : 0;
      // Standing about: a little sway; chatting: hands going now and then.
      const talk = w.mode === 'idle' && w.face !== 1 ? Math.max(0, Math.sin(time * 1.7 + w.phase)) * 0.7 : 0;
      this.figure(i, w.x, 0.14 + bob + w.hop, w.z, w.heading + (moving ? 0 : Math.sin(time * 0.6 + w.phase) * 0.15), w.scale, swing, swing, talk, w.scare, 0);
      if (w.bag >= 0) {
        this.q.setFromAxisAngle(this.up, w.heading);
        if (w.kid) {
          this.m.compose(this.v.set(w.x, 0.14 + bob + w.hop, w.z), this.q, this.sc.set(w.scale, w.scale, w.scale));
          this.packs.setMatrixAt(w.bag, this.m);
        } else {
          // Carried in the right hand, swinging with the arm.
          this.v2.set(-0.27 * w.scale, (SHOULDER - 0.62) * w.scale, Math.sin(-swing * 0.7) * 0.6 * w.scale).applyQuaternion(this.q);
          this.m.compose(this.v.set(w.x + this.v2.x, 0.14 + bob + w.hop + this.v2.y, w.z + this.v2.z), this.q, this.sc.set(w.scale, w.scale, w.scale));
          this.bags.setMatrixAt(w.bag, this.m);
        }
      }
      if (w.umbrella >= 0) {
        this.q.setFromAxisAngle(this.up, w.heading);
        this.m.compose(this.v.set(w.x, 0.14 + bob + w.hop, w.z), this.q, this.sc.set(w.scale, w.scale, w.scale));
        this.umbrellas.setMatrixAt(w.umbrella, this.m);
      }
    });
    this.riders.forEach((r, i) => {
      const y = 0.07;
      this.q.setFromAxisAngle(this.up, r.heading);
      this.m.compose(this.v.set(r.x, y, r.z), this.q, this.sc.set(1, 1, 1));
      this.bikes.setMatrixAt(i, this.m);
      // On the saddle, leaning forward a little, pedalling, hands on the bars.
      const pedal = (time + r.phase) * r.speed * 1.6;
      this.figure(nW + i, r.x, y, r.z, r.heading, r.scale, 0.3 + Math.sin(pedal) * 0.3, 0.3 - Math.sin(pedal) * 0.3, 0, 0, 0.25, true);
    });
    for (const mesh of [this.torsos, this.heads, this.hair, this.legs, this.arms, this.bags, this.packs, this.umbrellas, this.bikes])
      mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Pose figure i at (x, y, z) facing `heading`: legs swung by legA / legB (radians, forward
   * positive), arms opposite; `talk` lifts a hand, `scare` throws both arms up, `lean` tips the
   * body forward from the hips; `riding` puts them on a saddle with their hands on the bars.
   */
  private figure(
    i: number,
    x: number,
    y: number,
    z: number,
    heading: number,
    s: number,
    legA: number,
    legB: number,
    talk: number,
    scare: number,
    lean: number,
    riding = false,
  ): void {
    const base = this.base.compose(this.v.set(x, y, z), this.q.setFromAxisAngle(this.up, heading), this.sc.set(s, s, s));
    const seat = riding ? 0.94 - HIP : 0;
    // The body (head and hair with it) tips forward about the hips.
    this.pivot(this.m, base, 0, HIP + seat, riding ? -0.05 : 0, lean, -HIP);
    this.torsos.setMatrixAt(i, this.m);
    this.heads.setMatrixAt(i, this.m);
    this.hair.setMatrixAt(i, this.m);
    for (const side of [-1, 1] as const) {
      const swing = side < 0 ? legA : legB;
      this.pivot(this.m, base, side * 0.085, HIP + seat, riding ? -0.05 : 0, -swing, 0);
      this.legs.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
      let arm = riding ? -1.05 : swing * 0.7;
      if (talk > 0 && side > 0) arm = -0.5 - talk;
      if (scare > 0.05) arm = arm * (1 - scare) - 2.6 * scare;
      this.pivot(this.m, base, side * 0.235, SHOULDER + seat, riding ? 0.1 : 0, lean + arm, 0);
      this.arms.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
    }
  }

  /** out = base · translate(px, py, pz) · rotateX(angle) · translate(0, dy, 0). */
  private pivot(out: THREE.Matrix4, base: THREE.Matrix4, px: number, py: number, pz: number, angle: number, dy: number): void {
    out.makeTranslation(px, py, pz).premultiply(base);
    if (angle) out.multiply(this.rot.makeRotationX(angle));
    if (dy) out.multiply(this.move.makeTranslation(0, dy, 0));
  }

  setTimeOfDay(tod: TimeOfDay): void {
    // After dark it's been raining: out come the umbrellas.
    this.night = tod === 'night';
    this.umbrellas.visible = this.night;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }
}

/** Shade a geometry's vertices by height (vertex colours): `f(y)` gives the brightness. */
function shaded(g: THREE.BufferGeometry, f: (y: number) => number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const v = f(p.getY(i));
    colors.push(v, v, v);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/** A mamachari: step-through frame (painted per bike), black tyres, a basket at the front, a saddle, a carrier. */
function bikeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, hex: number | null) => {
    const c = new THREE.Color(hex ?? 0xffffff);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  /** A bar from a to b (in the bike's y-z plane, at x). */
  const bar = (az: number, ay: number, bz: number, by: number, r: number, hex: number | null, x = 0) => {
    const len = Math.hypot(bz - az, by - ay);
    const g = new THREE.BoxGeometry(r, len, r);
    g.rotateX(Math.atan2(bz - az, by - ay));
    g.translate(x, (ay + by) / 2, (az + bz) / 2);
    paint(g, hex);
  };
  for (const z of [0.52, -0.52]) {
    const tyre = new THREE.TorusGeometry(0.31, 0.025, 4, 18).rotateY(Math.PI / 2).translate(0, 0.33, z);
    paint(tyre, 0x161616);
    bar(z, 0.06, z, 0.6, 0.01, 0x9a9da3);
    bar(z - 0.27, 0.33, z + 0.27, 0.33, 0.01, 0x9a9da3);
  }
  bar(0.52, 0.33, 0.42, 0.98, 0.04, null);
  bar(0.42, 0.86, 0.0, 0.3, 0.045, null);
  bar(0.0, 0.3, -0.12, 0.86, 0.04, null);
  bar(0.0, 0.3, -0.52, 0.33, 0.03, null);
  bar(-0.1, 0.8, -0.52, 0.33, 0.03, null);
  // Handlebars, saddle, basket, carrier, mudguards.
  const handle = new THREE.BoxGeometry(0.56, 0.03, 0.03).translate(0, 1.0, 0.38);
  paint(handle, 0x2a2a2a);
  paint(new THREE.BoxGeometry(0.16, 0.06, 0.26).translate(0, 0.9, -0.14), 0x1a1a1a);
  paint(new THREE.BoxGeometry(0.34, 0.24, 0.3).translate(0, 0.86, 0.62), 0xb8bcc2);
  paint(new THREE.BoxGeometry(0.2, 0.03, 0.36).translate(0, 0.8, -0.42), 0x9a9da3);
  return mergeGeometries(parts)!;
}
