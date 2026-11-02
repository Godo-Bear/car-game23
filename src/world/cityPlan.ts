/**
 * The free drive city's plan, worked out from its streets (no 3D here, so it can be tested on
 * its own): parks in the middle of the bigger blocks, then building lots lining every street,
 * facing it, district by district - tall towers downtown, narrow shop buildings in the
 * shopping districts, flats and little houses further out, warehouses at the edge of town.
 * Lots go in layers back from the street, never overlapping each other, a street or its
 * pavement, a park or a landmark's ground.
 */

export type District = 'downtown' | 'commercial' | 'residential' | 'outer';

export interface CityStreet {
  pts: [number, number][];
  width: number;
}

export interface Lot {
  x: number;
  z: number;
  /** Rotation about the vertical (the box's local x runs along the street). */
  angle: number;
  /** Frontage (along the street) and depth (away from it). */
  w: number;
  d: number;
  h: number;
  district: District;
  /** Unit vector from the lot toward the street it faces. */
  fx: number;
  fz: number;
  /** 0 = on the street, 1 and 2 = further back in the block. */
  layer: number;
  /** A little traditional house instead of a block. */
  house: boolean;
}

export interface Park {
  x: number;
  z: number;
  r: number;
}

export interface CityPlan {
  lots: Lot[];
  parks: Park[];
}

/** Pavement each side of every street (matches the street ribbons in World.ts). */
export const PAVEMENT = 2.4;

export function districtAt(x: number, z: number): District {
  const r = Math.hypot(x, z);
  return r < 330 ? 'downtown' : r < 720 ? 'commercial' : r < 1050 ? 'residential' : 'outer';
}

/** Lot sizes per district: frontage, depth and the gap to the next lot (m). */
const SPEC: Record<District, { w: [number, number]; d: [number, number]; gap: [number, number]; layers: number }> = {
  downtown: { w: [22, 38], d: [20, 34], gap: [3, 8], layers: 3 },
  commercial: { w: [9, 18], d: [13, 24], gap: [0.4, 1.8], layers: 3 },
  residential: { w: [12, 26], d: [10, 18], gap: [1.5, 4], layers: 2 },
  outer: { w: [22, 44], d: [18, 32], gap: [3, 8], layers: 1 },
};

/** Numbers stored per street segment: its ends, half-width, street and index along the street. */
const SEG = 7;

/** Distances from street centre lines, on a grid of their segments. */
export class StreetField {
  private readonly grid = new Map<number, number[]>();
  private readonly segs: number[] = [];
  readonly lengths: number[][] = [];
  private static readonly C = 40;

  constructor(readonly streets: CityStreet[]) {
    const C = StreetField.C;
    streets.forEach((s, k) => {
      const cum = [0];
      for (let i = 1; i < s.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]));
      this.lengths.push(cum);
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const [ax, az] = s.pts[i];
        const [bx, bz] = s.pts[i + 1];
        const id = this.segs.length / SEG;
        this.segs.push(ax, az, bx, bz, s.width / 2, k, i);
        const pad = s.width / 2;
        for (let gx = Math.floor((Math.min(ax, bx) - pad) / C); gx <= Math.floor((Math.max(ax, bx) + pad) / C); gx++) {
          for (let gz = Math.floor((Math.min(az, bz) - pad) / C); gz <= Math.floor((Math.max(az, bz) + pad) / C); gz++) {
            const key = gx * 65536 + gz;
            const list = this.grid.get(key);
            if (list) list.push(id);
            else this.grid.set(key, [id]);
          }
        }
      }
    });
  }

  /** Distance from (x, z) to the nearest street's edge (negative on a street), up to `max`. */
  edge(x: number, z: number, max = 40): number {
    const C = StreetField.C;
    const reach = Math.ceil((max + 10) / C);
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    let best = max;
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        for (const id of this.grid.get(i * 65536 + j) ?? []) {
          const o = id * SEG;
          const ax = this.segs[o];
          const az = this.segs[o + 1];
          const dx = this.segs[o + 2] - ax;
          const dz = this.segs[o + 3] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - this.segs[o + 4];
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Is (x, z) at least `room` metres from every street's edge (but street `skip`)? (Stops at the first that's closer.) */
  clear(x: number, z: number, room: number, skip = -1): boolean {
    const C = StreetField.C;
    const reach = Math.ceil((room + 10) / C);
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        const list = this.grid.get(i * 65536 + j);
        if (!list) continue;
        for (const id of list) {
          const o = id * SEG;
          const ax = this.segs[o];
          const az = this.segs[o + 1];
          const dx = this.segs[o + 2] - ax;
          const dz = this.segs[o + 3] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          if (this.segs[o + 5] === skip) continue;
          const lim = room + this.segs[o + 4];
          const ex = x - ax - dx * t;
          const ez = z - az - dz * t;
          if (ex * ex + ez * ez < lim * lim) return false;
        }
      }
    }
    return true;
  }

  /**
   * The nearest street to (x, z) other than `skip` whose surface is within `max` metres: its index
   * and how far along it (m), or null.
   */
  nearest(x: number, z: number, max: number, skip = -1): { k: number; s: number } | null {
    const C = StreetField.C;
    const reach = Math.ceil((max + 10) / C);
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    let best: { k: number; s: number } | null = null;
    let bestD = max;
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        for (const id of this.grid.get(i * 65536 + j) ?? []) {
          const o = id * SEG;
          const k = this.segs[o + 5];
          if (k === skip) continue;
          const ax = this.segs[o];
          const az = this.segs[o + 1];
          const dx = this.segs[o + 2] - ax;
          const dz = this.segs[o + 3] - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - this.segs[o + 4];
          if (d < bestD) {
            bestD = d;
            const seg = this.segs[o + 6];
            best = { k, s: this.lengths[k][seg] + t * Math.hypot(dx, dz) };
          }
        }
      }
    }
    return best;
  }

  /** Point and unit tangent `s` metres along street `k`. */
  at(k: number, s: number): { x: number; z: number; tx: number; tz: number } {
    const P = this.streets[k].pts;
    const cum = this.lengths[k];
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
    const [ax, az] = P[i - 1];
    const [bx, bz] = P[i];
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / seg, tz: (bz - az) / seg };
  }

  length(k: number): number {
    const cum = this.lengths[k];
    return cum[cum.length - 1];
  }
}

/** The corners of a lot (its local x along the street, z across). */
export function corners(l: { x: number; z: number; angle: number; w: number; d: number }): [number, number][] {
  const c = Math.cos(l.angle);
  const s = Math.sin(l.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [l.x + ((a * l.w) / 2) * c + ((b * l.d) / 2) * s, l.z - ((a * l.w) / 2) * s + ((b * l.d) / 2) * c]);
}

/** Do two lots (oriented rectangles) overlap, with `margin` metres between them? */
export function overlaps(a: Lot, b: Lot, margin: number): boolean {
  const axes = [a.angle, b.angle].flatMap((ang) => [
    [Math.cos(ang), -Math.sin(ang)],
    [Math.sin(ang), Math.cos(ang)],
  ]);
  const half = (l: Lot, [ax, az]: number[]) => {
    const c = Math.cos(l.angle);
    const s = Math.sin(l.angle);
    return (Math.abs(c * ax - s * az) * l.w) / 2 + (Math.abs(s * ax + c * az) * l.d) / 2;
  };
  for (const axis of axes) {
    const gap = Math.abs((b.x - a.x) * axis[0] + (b.z - a.z) * axis[1]);
    if (gap > half(a, axis) + half(b, axis) + margin) return false;
  }
  return true;
}

export function planCity(
  streets: CityStreet[],
  radius: number,
  /** Landmarks' ground (no lots, no parks). */
  reserved: { x: number; z: number; r: number }[],
  rng: () => number,
): CityPlan {
  const field = new StreetField(streets);
  const parks = placeParks(field, radius, reserved);
  const lots: Lot[] = [];
  const grid = new Map<number, number[]>();
  const C = 40;
  const cells = (l: Lot, xs = corners(l)) => {
    const out: number[] = [];
    for (let i = Math.floor(Math.min(...xs.map((p) => p[0])) / C); i <= Math.floor(Math.max(...xs.map((p) => p[0])) / C); i++) {
      for (let j = Math.floor(Math.min(...xs.map((p) => p[1])) / C); j <= Math.floor(Math.max(...xs.map((p) => p[1])) / C); j++) out.push(i * 65536 + j);
    }
    return out;
  };
  const fits = (l: Lot, gap: number): boolean => {
    const diag = Math.hypot(l.w, l.d) / 2;
    if (Math.hypot(l.x, l.z) + diag > radius - 4) return false;
    if (reserved.some((r) => Math.hypot(l.x - r.x, l.z - r.z) < r.r + diag * 0.75)) return false;
    if (parks.some((p) => Math.hypot(l.x - p.x, l.z - p.z) < p.r + diag * 0.7)) return false;
    const cs = corners(l);
    for (const key of cells(l, cs)) {
      for (const k of grid.get(key) ?? []) if (overlaps(l, lots[k], gap)) return false;
    }
    // Clear of every street and its pavement: the corners and the middle of each side.
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cs[i];
      const [bx, bz] = cs[(i + 1) % 4];
      if (!field.clear(ax, az, PAVEMENT + 0.4) || !field.clear((ax + bx) / 2, (az + bz) / 2, PAVEMENT + 0.4)) return false;
    }
    return true;
  };
  const add = (l: Lot) => {
    const k = lots.length;
    lots.push(l);
    for (const key of cells(l)) {
      const list = grid.get(key);
      if (list) list.push(k);
      else grid.set(key, [k]);
    }
  };
  const rand = ([a, b]: [number, number]) => a + rng() * (b - a);

  // Avenues and ring roads first (they get the best frontage), then the side streets.
  const order = streets.map((_, k) => k).sort((a, b) => streets[b].width - streets[a].width);
  for (let layer = 0; layer < 3; layer++) {
    for (const k of order) {
      const L = field.length(k);
      const street = streets[k];
      for (const side of [1, -1]) {
        let s = rng() * 4;
        while (s < L - 3) {
          const p0 = field.at(k, s);
          const district = districtAt(p0.x, p0.z);
          const spec = SPEC[district];
          if (layer >= spec.layers) {
            s += 12;
            continue;
          }
          const house = district === 'residential' && layer < 2 && rng() < 0.5;
          let w = house ? 10.5 + rng() * 2 : rand(spec.w);
          let d = house ? 9.5 : rand(spec.d);
          // Further back, behind the lots along the street.
          const back = layer * (spec.d[1] + 3);
          let placed = false;
          for (let attempt = 0; attempt < 3 && !placed; attempt++) {
            const p = field.at(k, s + w / 2);
            const nx = -p.tz * side;
            const nz = p.tx * side;
            const setback = street.width / 2 + PAVEMENT + 0.6 + back + d / 2;
            const lot: Lot = {
              x: p.x + nx * setback,
              z: p.z + nz * setback,
              angle: Math.atan2(-p.tz, p.tx),
              w,
              d,
              h: 0,
              district,
              fx: -nx,
              fz: -nz,
              layer,
              house,
            };
            if (fits(lot, house ? 1.2 : 0.6)) {
              lot.h = heightFor(lot, rng);
              add(lot);
              placed = true;
              s += w + (house ? 1.5 + rng() * 2 : rand(spec.gap));
            } else if (!house) {
              w *= 0.72;
              d *= 0.82;
              if (w < 7) break;
            } else break;
          }
          if (!placed) s += 5;
        }
      }
    }
  }
  return { lots, parks };
}

/** Building height by district (tallest in the middle of downtown). */
function heightFor(l: Lot, rng: () => number): number {
  if (l.house) return 6;
  const r = Math.hypot(l.x, l.z);
  switch (l.district) {
    case 'downtown': {
      const core = 1.25 - (r / 330) * 0.55;
      return Math.round((38 + rng() ** 1.4 * 170) * core);
    }
    case 'commercial':
      return Math.round(9 + rng() ** 1.5 * 44);
    case 'residential':
      return Math.round(9 + rng() * 22);
    default:
      return rng() < 0.75 ? Math.round(7 + rng() * 7) : Math.round(10 + rng() * 9);
  }
}

/**
 * Parks: the points furthest from any street (the middle of the big blocks), spread through
 * town, each as big as its block allows.
 */
function placeParks(field: StreetField, radius: number, reserved: { x: number; z: number; r: number }[]): Park[] {
  const candidates: Park[] = [];
  for (let x = -radius; x <= radius; x += 16) {
    for (let z = -radius; z <= radius; z += 16) {
      const r = Math.hypot(x, z);
      if (r > radius - 90 || r < 60) continue;
      if (reserved.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 40)) continue;
      // (Most points are near a street: rule those out cheaply first.)
      if (!field.clear(x, z, 30)) continue;
      const room = field.edge(x, z, 80);
      if (room >= 30) candidates.push({ x, z, r: Math.min(room - 4, 70) });
    }
  }
  candidates.sort((a, b) => b.r - a.r);
  const parks: Park[] = [];
  for (const c of candidates) {
    if (parks.length >= 12) break;
    if (parks.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 260)) continue;
    parks.push(c);
  }
  return parks;
}
