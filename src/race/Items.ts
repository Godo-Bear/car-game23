import { clamp, createRng, mod, wrapAngle } from '../core/math';
import type { VehicleControls, VehiclePhysics } from '../physics/VehiclePhysics';
import type { TrackPath, TrackProjection } from '../track/TrackPath';

/**
 * Items (kart-racing style): drive through a glowing item box and, after a short roulette, you
 * hold one of these. Each racer holds one at a time. Racers further back get the stronger ones.
 *
 * - Ramune Rocket: a short, strong boost (the Triple has three).
 * - Oil Slick: dropped behind you; whoever drives into it spins out.
 * - Shuriken: thrown straight down the road; spins out the first car it hits.
 * - Paper Lantern: a homing lantern that chases the car one place ahead of you.
 * - Lucky Cat: a charm that soaks up the next hit (for a while).
 * - Thunder Drum: everyone ahead of you is stunned: slowed right down, and shrunk for a moment.
 */
export type ItemId = 'ramune' | 'ramune3' | 'oil' | 'shuriken' | 'lantern' | 'luckycat' | 'thunder';

export const ITEM_IDS: ItemId[] = ['ramune', 'ramune3', 'oil', 'shuriken', 'lantern', 'luckycat', 'thunder'];

export const ITEM_NAMES: Record<ItemId, string> = {
  ramune: 'Ramune Rocket',
  ramune3: 'Triple Ramune',
  oil: 'Oil Slick',
  shuriken: 'Shuriken',
  lantern: 'Paper Lantern',
  luckycat: 'Lucky Cat',
  thunder: 'Thunder Drum',
};

/** A car's items and what they're doing to it. */
export interface ItemState {
  /** The item held (or being rolled for), null when empty-handed. */
  held: ItemId | null;
  /** Roulette: seconds until the held item can be used. */
  rolling: number;
  /** Uses left of the held item (a Triple Ramune has three). */
  uses: number;
  /** Lucky Cat: seconds of protection left. */
  shield: number;
  /** Spinning out: seconds left, and the extra yaw (radians) the car is drawn with. */
  spin: number;
  spinAngle: number;
  /** Stunned by a Thunder Drum: seconds left. */
  stun: number;
  /** AI: seconds before it thinks about using what it holds. */
  think: number;
}

/** A row of item boxes across the road. */
export interface ItemBox {
  x: number;
  y: number;
  z: number;
  /** Lap distance (for the AI and the map). */
  distance: number;
  /** Time it's back after being taken (0 = there). */
  backAt: number;
}

/** A Shuriken or a Paper Lantern in flight, following the road. */
export interface Shot {
  kind: 'shuriken' | 'lantern';
  owner: number;
  /** Car being chased (Paper Lantern), or -1. */
  target: number;
  distance: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  life: number;
  /** Seconds since thrown (it can't hit its owner straight away). */
  age: number;
}

/** An Oil Slick on the road. */
export interface Slick {
  owner: number;
  x: number;
  y: number;
  z: number;
  life: number;
  age: number;
}

export type ItemEvent =
  | { type: 'itemReady'; racerId: number; item: ItemId }
  | { type: 'itemUse'; racerId: number; item: ItemId }
  | { type: 'itemHit'; racerId: number; by: number; item: ItemId }
  | { type: 'itemBlocked'; racerId: number; item: ItemId };

/** The cars the item system acts on (a subset of RaceSimulation's SimCar). */
export interface ItemCar {
  id: number;
  isPlayer: boolean;
  autopilot: boolean;
  physics: VehiclePhysics;
  proj: TrackProjection;
}

/** Seconds before a taken box is back, and how long the roulette spins. */
export const BOX_RESPAWN = 4;
export const ROLL_TIME = 1.1;
/** How close (m) a car must pass to take a box, or be hit by a shot or an oil slick. */
const BOX_REACH = 2.6;
const HIT_REACH = 2.2;
const SLICK_REACH = 2.3;
/** Effects (seconds). */
export const SPIN_TIME = 1.15;
export const STUN_TIME = 2.6;
export const SHIELD_TIME = 10;
export const ROCKET_TIME = 1.3;
const SLICK_LIFE = 35;
const SHURIKEN_LIFE = 3.2;
const LANTERN_LIFE = 9;

/**
 * Item odds by place: [item, weight] for the front, the middle and the back of the field. The
 * Thunder Drum only ever comes to the last two cars.
 */
const ODDS: Record<'front' | 'middle' | 'back', [ItemId, number][]> = {
  front: [
    ['oil', 34],
    ['shuriken', 24],
    ['ramune', 22],
    ['luckycat', 20],
  ],
  middle: [
    ['ramune', 20],
    ['shuriken', 20],
    ['lantern', 20],
    ['oil', 14],
    ['luckycat', 14],
    ['ramune3', 12],
  ],
  back: [
    ['ramune3', 30],
    ['lantern', 26],
    ['ramune', 16],
    ['shuriken', 10],
    ['luckycat', 8],
    ['thunder', 10],
  ],
};

/** Pick an item for the car in `position` (1-based) of `field` cars. */
export function rollItem(position: number, field: number, rng: () => number): ItemId {
  const f = field > 1 ? (position - 1) / (field - 1) : 0;
  const band = f < 0.25 ? 'front' : f < 0.7 ? 'middle' : 'back';
  const lastTwo = position >= field - 1 && field > 2;
  const odds = ODDS[band].filter(([id]) => id !== 'thunder' || lastTwo);
  const total = odds.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [id, w] of odds) {
    r -= w;
    if (r < 0) return id;
  }
  return odds[0][0];
}

/** Rows of five boxes across the road, spread round the lap (clear of the start line). */
export function placeItemBoxes(track: TrackPath): ItemBox[] {
  const rows = clamp(Math.round(track.length / 900), 3, 6);
  const out: ItemBox[] = [];
  for (let k = 0; k < rows; k++) {
    // Between the nitro bottles (every 150 m from 120 m), so the two never sit together.
    const d = Math.round((((k + 0.5) / rows) * track.length) / 150) * 150 + 45;
    for (const f of [-0.66, -0.33, 0, 0.33, 0.66]) {
      const p = track.pointAt(d, f * track.halfWidth);
      out.push({ x: p.x, y: p.y, z: p.z, distance: mod(d, track.length), backAt: 0 });
    }
  }
  return out;
}

const fresh = (): ItemState => ({ held: null, rolling: 0, uses: 0, shield: 0, spin: 0, spinAngle: 0, stun: 0, think: 0 });

/**
 * Everything to do with items in one race: the boxes, who holds what, the things flying about
 * and lying on the road, and what they do to the cars. Runs inside RaceSimulation's fixed step.
 */
export class ItemSystem {
  readonly boxes: ItemBox[];
  readonly state: ItemState[];
  readonly shots: Shot[] = [];
  readonly slicks: Slick[] = [];
  private readonly rng: () => number;
  private readonly events: ItemEvent[] = [];
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

  constructor(
    private readonly track: TrackPath,
    cars: number,
    seed: number,
    /** Extra boxes off the course (free drive's town). */
    extraBoxes: ItemBox[] = [],
  ) {
    this.boxes = [...placeItemBoxes(track), ...extraBoxes];
    this.state = Array.from({ length: cars }, fresh);
    this.rng = createRng(seed ^ 0x51ed);
  }

  /** Back to the start of a race: nothing held, nothing on the road. */
  reset(): void {
    for (let i = 0; i < this.state.length; i++) this.state[i] = fresh();
    this.shots.length = 0;
    this.slicks.length = 0;
    for (const b of this.boxes) b.backAt = 0;
  }

  /** The pedals a car actually gets while spinning or stunned. */
  controls(car: ItemCar, c: VehicleControls): VehicleControls {
    const s = this.state[car.id];
    if (s.spin <= 0 && s.stun <= 0) return c;
    const out = Object.assign(this.out, c);
    if (s.spin > 0) {
      out.throttle = 0;
      out.brake = 0.35;
      out.steer = 0;
      out.handbrake = false;
      out.nitro = false;
    } else {
      out.throttle = Math.min(out.throttle, 0.45);
      out.nitro = false;
    }
    return out;
  }

  /** Use the held item (the player's button, or the AI's choice). Returns whether something happened. */
  use(car: ItemCar, cars: readonly ItemCar[], positions: readonly number[]): boolean {
    const s = this.state[car.id];
    if (!s.held || s.rolling > 0 || s.spin > 0) return false;
    const item = s.held;
    const p = car.physics;
    const pr = car.proj;
    switch (item) {
      case 'ramune':
      case 'ramune3':
        p.itemBoost(ROCKET_TIME);
        break;
      case 'oil': {
        // Behind the car, where it is on the road.
        const back = 4 + p.spec.halfLength;
        this.slicks.push({ owner: car.id, x: p.x - Math.sin(p.heading) * back, y: p.y, z: p.z - Math.cos(p.heading) * back, life: SLICK_LIFE, age: 0 });
        break;
      }
      case 'shuriken':
      case 'lantern': {
        const target = item === 'lantern' ? this.carAhead(car, cars, positions) : -1;
        const lateral = clamp(pr.lateral, -this.track.halfWidth, this.track.halfWidth);
        const shot: Shot = {
          kind: item,
          owner: car.id,
          target,
          distance: pr.distance + 3 + p.spec.halfLength,
          lateral,
          x: p.x,
          y: p.y,
          z: p.z,
          speed: Math.max(p.forwardSpeed + (item === 'lantern' ? 22 : 30), item === 'lantern' ? 58 : 66),
          life: item === 'lantern' ? LANTERN_LIFE : SHURIKEN_LIFE,
          age: 0,
        };
        this.placeShot(shot);
        this.shots.push(shot);
        break;
      }
      case 'luckycat':
        s.shield = SHIELD_TIME;
        break;
      case 'thunder': {
        const mine = positions[car.id];
        for (const other of cars) {
          if (other === car || positions[other.id] >= mine) continue;
          const o = this.state[other.id];
          if (o.shield > 0) {
            o.shield = 0;
            this.events.push({ type: 'itemBlocked', racerId: other.id, item });
            continue;
          }
          o.stun = STUN_TIME;
          other.physics.vx *= 0.55;
          other.physics.vz *= 0.55;
          this.events.push({ type: 'itemHit', racerId: other.id, by: car.id, item });
        }
        break;
      }
    }
    this.events.push({ type: 'itemUse', racerId: car.id, item });
    s.uses -= 1;
    if (s.uses <= 0) s.held = null;
    // A short gap before an AI fires the next rocket of a triple.
    s.think = 0.6 + this.rng() * 0.8;
    return true;
  }

  /**
   * One fixed step, after the cars have moved: boxes, shots, slicks, effects wearing off and
   * the AI deciding what to use. Returns what happened (for the HUD and sounds).
   */
  update(dt: number, time: number, cars: readonly ItemCar[], positions: readonly number[]): ItemEvent[] {
    const field = cars.length;
    for (const car of cars) {
      const s = this.state[car.id];
      const p = car.physics;
      // Effects wearing off.
      if (s.spin > 0) {
        s.spin = Math.max(0, s.spin - dt);
        // Two turns, quick at first and easing into the stop.
        const k = s.spin / SPIN_TIME;
        s.spinAngle = Math.PI * 4 * (1 - k * k);
        const scrub = Math.exp(-2.6 * dt);
        p.vx *= scrub;
        p.vz *= scrub;
        if (s.spin === 0) s.spinAngle = 0;
      }
      if (s.stun > 0) s.stun = Math.max(0, s.stun - dt);
      if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
      if (s.rolling > 0) {
        s.rolling = Math.max(0, s.rolling - dt);
        if (s.rolling === 0 && s.held) this.events.push({ type: 'itemReady', racerId: car.id, item: s.held });
      }
      // Boxes.
      if (!s.held) {
        for (const b of this.boxes) {
          if (time < b.backAt) continue;
          if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 > BOX_REACH * BOX_REACH || Math.abs(b.y - p.y) > 3) continue;
          b.backAt = time + BOX_RESPAWN;
          s.held = rollItem(positions[car.id], field, this.rng);
          s.uses = s.held === 'ramune3' ? 3 : 1;
          s.rolling = ROLL_TIME;
          s.think = 0.5 + this.rng() * 2.5;
          break;
        }
      }
      // The AI (and the player's car once it's on autopilot after the flag).
      if ((!car.isPlayer || car.autopilot) && s.held && s.rolling <= 0) {
        s.think -= dt;
        if (s.think <= 0 && this.aiWants(car, cars, positions)) this.use(car, cars, positions);
      }
    }

    // Shots fly down the road.
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.age += dt;
      shot.life -= dt;
      shot.distance += shot.speed * dt;
      if (shot.kind === 'lantern' && shot.target >= 0) {
        const t = cars.find((c) => c.id === shot.target);
        if (t) {
          // Home in across the road; right onto the car once it's close.
          let ahead = mod(t.proj.distance - shot.distance, this.track.length);
          if (ahead > this.track.length / 2) ahead -= this.track.length;
          const want = clamp(t.proj.lateral, -this.track.halfWidth - 1, this.track.halfWidth + 1);
          const rate = Math.abs(ahead) < 25 ? 30 : 9;
          shot.lateral += clamp(want - shot.lateral, -rate * dt, rate * dt);
          // Never overshoot the car it's chasing.
          if (ahead < 0 && ahead > -6) shot.distance += ahead;
        }
      }
      this.placeShot(shot);
      let hit = false;
      for (const car of cars) {
        if (car.id === shot.owner && shot.age < 0.6) continue;
        const p = car.physics;
        if ((shot.x - p.x) ** 2 + (shot.z - p.z) ** 2 > HIT_REACH * HIT_REACH || Math.abs(shot.y - p.y) > 3) continue;
        this.hitCar(car, shot.owner, shot.kind);
        hit = true;
        break;
      }
      if (hit || shot.life <= 0) this.shots.splice(i, 1);
    }

    // Oil on the road.
    for (let i = this.slicks.length - 1; i >= 0; i--) {
      const slick = this.slicks[i];
      slick.age += dt;
      slick.life -= dt;
      let hit = false;
      for (const car of cars) {
        if (car.id === slick.owner && slick.age < 1) continue;
        const p = car.physics;
        if ((slick.x - p.x) ** 2 + (slick.z - p.z) ** 2 > SLICK_REACH * SLICK_REACH || Math.abs(slick.y - p.y) > 2.5) continue;
        this.hitCar(car, slick.owner, 'oil');
        hit = true;
        break;
      }
      if (hit || slick.life <= 0) this.slicks.splice(i, 1);
    }

    return this.events.splice(0);
  }

  /** What has happened since the last update (e.g. an item just used). */
  flush(): ItemEvent[] {
    return this.events.splice(0);
  }

  /** Free drive: put a car's state back to normal (after a teleport or reset). */
  clearEffects(id: number): void {
    const s = this.state[id];
    s.spin = 0;
    s.spinAngle = 0;
    s.stun = 0;
  }

  private hitCar(car: ItemCar, by: number, item: ItemId): void {
    const s = this.state[car.id];
    if (s.spin > 0) return;
    if (s.shield > 0) {
      s.shield = 0;
      this.events.push({ type: 'itemBlocked', racerId: car.id, item });
      return;
    }
    s.spin = SPIN_TIME;
    car.physics.superTime = 0;
    this.events.push({ type: 'itemHit', racerId: car.id, by, item });
  }

  /** The car one place ahead of `car`, or -1 in the lead. */
  private carAhead(car: ItemCar, cars: readonly ItemCar[], positions: readonly number[]): number {
    const want = positions[car.id] - 1;
    return want < 1 ? -1 : (cars.find((c) => positions[c.id] === want)?.id ?? -1);
  }

  private placeShot(shot: Shot): void {
    const p = this.track.pointAt(shot.distance, shot.lateral);
    shot.x = p.x;
    shot.y = p.y;
    shot.z = p.z;
  }

  /** Does the AI want to use what it holds right now? */
  private aiWants(car: ItemCar, cars: readonly ItemCar[], positions: readonly number[]): boolean {
    const s = this.state[car.id];
    const p = car.physics;
    const L = this.track.length;
    const gapTo = (other: ItemCar) => {
      let d = mod(other.proj.distance - car.proj.distance, L);
      if (d > L / 2) d -= L;
      return d;
    };
    switch (s.held) {
      case 'ramune':
      case 'ramune3': {
        // On a straight-ish bit of road.
        const here = this.track.sample(car.proj.index);
        const later = this.track.sample(car.proj.index + Math.round(60 / this.track.spacing));
        return Math.abs(wrapAngle(later.heading - here.heading)) < 0.35 && p.forwardSpeed > 10;
      }
      case 'oil':
        // Someone close behind, or it's been a while.
        return cars.some((o) => o !== car && gapTo(o) < -3 && gapTo(o) > -30) || s.think < -6;
      case 'shuriken':
        return cars.some((o) => o !== car && gapTo(o) > 5 && gapTo(o) < 70 && Math.abs(o.proj.lateral - car.proj.lateral) < 2.4) || s.think < -9;
      case 'lantern':
        return positions[car.id] > 1 || s.think < -10;
      case 'luckycat':
        return s.shield <= 0;
      case 'thunder':
        return true;
      default:
        return false;
    }
  }
}
