import { clamp, mod, smoothstep, wrapAngle } from '../core/math';

/**
 * A corner of the circuit polygon. The racing surface follows straight lines between
 * vertices and is rounded at each vertex with an arc of `radius` metres, which gives
 * the clean "straights + 90° corners" feel of a city street circuit.
 */
export interface TrackVertex {
  x: number;
  z: number;
  radius: number;
  /** Road elevation (m) at the middle of this corner. Interpolated smoothly between corners. */
  y?: number;
}

export interface TrackLayout {
  name: string;
  /** Drivable road width in metres. */
  width: number;
  /** Gap between the road edge and the face of the concrete barrier. */
  wallMargin: number;
  vertices: TrackVertex[];
  /** Any point near the path; it is projected onto the centre line to place the start/finish line. */
  start: { x: number; z: number };
  sampleSpacing: number;
  /**
   * Where the course crosses itself, which pass goes over the other (in the order the crossings
   * come round the lap, by their first pass): 'first' or 'second'. By default the pass that is
   * already higher goes over (a mountain road may clear the other one without any lift; city
   * roads are raised onto a flyover with ramps). See TrackPath.crossings.
   */
  over?: ('first' | 'second')[];
}

/** A place where the course passes over itself. */
export interface TrackCrossing {
  /** Sample index on the bridge, and on the road underneath. */
  upper: number;
  lower: number;
  /** Height of the bridge deck above the road below (m). */
  clearance: number;
}

/** Road surface to road surface where one pass goes over another (deck ~1.2 m, ~7 m headroom). */
export const BRIDGE_CLEARANCE = 8.5;

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent in the direction of travel. */
  tx: number;
  tz: number;
  /** Unit vector pointing to the right-hand side of the road. */
  rx: number;
  rz: number;
  heading: number;
  /** Distance from the start/finish line along the centre line. */
  dist: number;
  /** Signed curvature in 1/m. Positive = left-hand corner. */
  curvature: number;
  /** dy/ds along the direction of travel. */
  slope: number;
  /**
   * Height of the road above the ground where it bridges another part of the course (m; 0 =
   * on the ground). The terrain and scenery use `y - bridge`; the track draws a deck on pillars.
   */
  bridge: number;
}

export interface TrackProjection {
  index: number;
  /** Signed offset from the centre line, positive to the right. */
  lateral: number;
  /** Distance along the lap in [0, length). */
  distance: number;
  y: number;
  heading: number;
  slope: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
}

export function createProjection(): TrackProjection {
  return { index: 0, lateral: 0, distance: 0, y: 0, heading: 0, slope: 0, tx: 0, tz: 1, rx: -1, rz: 0 };
}

interface Primitive {
  start: number;
  length: number;
  /** Point at local arc-length `s` in [0, length]. */
  at(s: number, out: { x: number; z: number }): void;
}

interface CornerInfo {
  tin: { x: number; z: number };
  tout: { x: number; z: number };
  arc: Primitive;
}

export class TrackPath {
  readonly name: string;
  readonly width: number;
  readonly halfWidth: number;
  /** Lateral distance from the centre line to the barrier face. */
  readonly wallOffset: number;
  readonly length: number;
  readonly spacing: number;
  readonly samples: TrackSample[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the course passes over itself (bridges). */
  readonly crossings: TrackCrossing[];

  constructor(layout: TrackLayout) {
    this.name = layout.name;
    this.width = layout.width;
    this.halfWidth = layout.width / 2;
    this.wallOffset = this.halfWidth + layout.wallMargin;

    const { primitives, cornerMid, total } = buildPrimitives(layout.vertices);
    this.length = total;

    const pointAtRaw = (s: number, out: { x: number; z: number }) => {
      s = mod(s, total);
      let lo = 0;
      let hi = primitives.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (primitives[mid].start <= s) lo = mid;
        else hi = mid - 1;
      }
      const p = primitives[lo];
      p.at(clamp(s - p.start, 0, p.length), out);
    };

    // Locate the start line on the raw (unrotated) path.
    const tmp = { x: 0, z: 0 };
    let startRaw = 0;
    let bestD = Infinity;
    for (let s = 0; s < total; s += 0.5) {
      pointAtRaw(s, tmp);
      const d = (tmp.x - layout.start.x) ** 2 + (tmp.z - layout.start.z) ** 2;
      if (d < bestD) {
        bestD = d;
        startRaw = s;
      }
    }

    const heights = layout.vertices.map((v) => v.y ?? 0);
    const heightAtRaw = (s: number): number => {
      const n = cornerMid.length;
      s = mod(s, total);
      for (let i = 0; i < n; i++) {
        const a = cornerMid[i];
        const b = cornerMid[(i + 1) % n];
        const span = mod(b - a, total);
        const t = mod(s - a, total);
        if (t <= span) return heights[i] + (heights[(i + 1) % n] - heights[i]) * smoothstep(0, 1, t / span);
      }
      return heights[0];
    };

    const count = Math.max(16, Math.round(total / layout.sampleSpacing));
    this.spacing = total / count;
    const samples: TrackSample[] = [];
    for (let i = 0; i < count; i++) {
      const raw = startRaw + i * this.spacing;
      pointAtRaw(raw, tmp);
      samples.push({
        x: tmp.x,
        y: heightAtRaw(raw),
        z: tmp.z,
        tx: 0,
        tz: 1,
        rx: -1,
        rz: 0,
        heading: 0,
        dist: i * this.spacing,
        curvature: 0,
        slope: 0,
        bridge: 0,
      });
    }
    this.crossings = raiseBridges(samples, this.spacing, this.wallOffset, layout.over ?? []);
    for (let i = 0; i < count; i++) {
      const prev = samples[mod(i - 1, count)];
      const next = samples[(i + 1) % count];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz);
      const s = samples[i];
      s.tx = dx / len;
      s.tz = dz / len;
      s.rx = -s.tz;
      s.rz = s.tx;
      s.heading = Math.atan2(s.tx, s.tz);
      s.slope = (next.y - prev.y) / (2 * this.spacing);
    }
    for (let i = 0; i < count; i++) {
      const prev = samples[mod(i - 1, count)];
      const next = samples[(i + 1) % count];
      samples[i].curvature = wrapAngle(next.heading - prev.heading) / (2 * this.spacing);
    }
    this.samples = samples;

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  get count(): number {
    return this.samples.length;
  }

  sample(i: number): TrackSample {
    return this.samples[mod(i, this.samples.length)];
  }

  indexAtDistance(d: number): number {
    return mod(Math.round(d / this.spacing), this.samples.length);
  }

  /** Interpolated centre-line point at lap distance `d`, offset `lateral` metres to the right. */
  pointAt(d: number, lateral = 0): { x: number; y: number; z: number; heading: number } {
    const n = this.samples.length;
    const f = mod(d, this.length) / this.spacing;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    const a = this.samples[i0];
    const b = this.samples[i1];
    const rx = a.rx + (b.rx - a.rx) * t;
    const rz = a.rz + (b.rz - a.rz) * t;
    return {
      x: a.x + (b.x - a.x) * t + rx * lateral,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t + rz * lateral,
      heading: a.heading + wrapAngle(b.heading - a.heading) * t,
    };
  }

  /**
   * Project a world position onto the track. Pass the previous result's index as `hint`
   * so only a small window of samples is searched (fast, and never snaps to a different
   * part of the circuit that happens to be nearby). Without a hint, pass the height `y` too
   * where the course crosses itself, so a car on a bridge isn't put on the road below.
   */
  project(x: number, z: number, hint: number, out: TrackProjection, y?: number): TrackProjection {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      const window = 30;
      for (let k = -window; k <= window; k++) {
        const i = mod(hint + k, n);
        const s = this.samples[i];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0 || bestD > (this.wallOffset + 15) ** 2) {
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2 + (y === undefined ? 0 : (4 * (s.y - y)) ** 2);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }

    let s = this.samples[best];
    let along = (x - s.x) * s.tx + (z - s.z) * s.tz;
    if (along < 0) {
      best = mod(best - 1, n);
      s = this.samples[best];
      along = (x - s.x) * s.tx + (z - s.z) * s.tz;
    }
    const next = this.samples[(best + 1) % n];
    const t = clamp(along / this.spacing, 0, 1);

    out.index = best;
    out.lateral = (x - s.x) * s.rx + (z - s.z) * s.rz;
    out.distance = mod(s.dist + along, this.length);
    out.y = s.y + (next.y - s.y) * t;
    out.heading = s.heading + wrapAngle(next.heading - s.heading) * t;
    out.slope = s.slope + (next.slope - s.slope) * t;
    out.tx = s.tx;
    out.tz = s.tz;
    out.rx = s.rx;
    out.rz = s.rz;
    return out;
  }
}

function buildPrimitives(vertices: TrackVertex[]): { primitives: Primitive[]; cornerMid: number[]; total: number } {
  const n = vertices.length;
  if (n < 3) throw new Error('A circuit needs at least 3 vertices');

  const corners: CornerInfo[] = [];
  const tangentLen: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const p = vertices[mod(i - 1, n)];
    const q = vertices[(i + 1) % n];
    const d1 = normalize(p.x - v.x, p.z - v.z);
    const d2 = normalize(q.x - v.x, q.z - v.z);
    const interior = Math.acos(clamp(d1.x * d2.x + d1.z * d2.z, -1, 1));
    const half = interior / 2;
    const t = v.radius / Math.tan(half);
    tangentLen.push(t);
    const tin = { x: v.x + d1.x * t, z: v.z + d1.z * t };
    const tout = { x: v.x + d2.x * t, z: v.z + d2.z * t };
    const bis = normalize(d1.x + d2.x, d1.z + d2.z);
    const cDist = v.radius / Math.sin(half);
    const cx = v.x + bis.x * cDist;
    const cz = v.z + bis.z * cDist;
    const a0 = Math.atan2(tin.z - cz, tin.x - cx);
    const sweep = wrapAngle(Math.atan2(tout.z - cz, tout.x - cx) - a0);
    const r = v.radius;
    const arcLen = r * Math.abs(sweep);
    corners.push({
      tin,
      tout,
      arc: {
        start: 0,
        length: arcLen,
        at(s, out) {
          const a = a0 + sweep * (arcLen > 0 ? s / arcLen : 0);
          out.x = cx + Math.cos(a) * r;
          out.z = cz + Math.sin(a) * r;
        },
      },
    });
  }

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const edge = Math.hypot(b.x - a.x, b.z - a.z);
    if (tangentLen[i] + tangentLen[(i + 1) % n] > edge + 1e-6) {
      throw new Error(`Corner radii at vertices ${i} and ${(i + 1) % n} are too large for the ${edge.toFixed(1)} m edge between them`);
    }
  }

  const primitives: Primitive[] = [];
  const cornerMid: number[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    c.arc.start = cursor;
    primitives.push(c.arc);
    cornerMid.push(cursor + c.arc.length / 2);
    cursor += c.arc.length;

    const from = c.tout;
    const to = corners[(i + 1) % n].tin;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    if (len > 1e-6) {
      primitives.push({
        start: cursor,
        length: len,
        at(s, out) {
          const t = s / len;
          out.x = from.x + (to.x - from.x) * t;
          out.z = from.z + (to.z - from.z) * t;
        },
      });
      cursor += len;
    }
  }
  return { primitives, cornerMid, total: cursor };
}

/**
 * Find where the centre line crosses itself and lift one pass over the other on a bridge with
 * ramps either side (only as much as needed: a mountain road already high above the other pass
 * stays as it is). Returns the crossings; adds the lift to the samples' heights.
 */
function raiseBridges(samples: TrackSample[], spacing: number, wallOffset: number, over: ('first' | 'second')[]): TrackCrossing[] {
  const n = samples.length;
  // Bucket the segments on a grid, then test pairs that are far apart along the lap.
  const cell = 24;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const keys = new Set([`${Math.floor(a.x / cell)},${Math.floor(a.z / cell)}`, `${Math.floor(b.x / cell)},${Math.floor(b.z / cell)}`]);
    for (const k of keys) {
      const list = buckets.get(k);
      if (list) list.push(i);
      else buckets.set(k, [i]);
    }
  }
  const apart = Math.ceil(120 / spacing);
  const found: [number, number][] = [];
  const seen = new Set<string>();
  for (const list of buckets.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]);
        const j = Math.max(list[p], list[q]);
        if (Math.min(j - i, n - (j - i)) < apart || seen.has(`${i},${j}`)) continue;
        seen.add(`${i},${j}`);
        if (segmentsCross(samples[i], samples[(i + 1) % n], samples[j], samples[(j + 1) % n])) found.push([i, j]);
      }
    }
  }
  // One crossing per pair of passes (neighbouring segment hits are the same crossing).
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossings: [number, number][] = [];
  for (const c of found) {
    if (crossings.some((k) => Math.abs(k[0] - c[0]) < apart && Math.abs(k[1] - c[1]) < apart)) continue;
    crossings.push(c);
  }

  const lift = new Float64Array(n);
  const bridge = new Float64Array(n);
  const out: TrackCrossing[] = [];
  crossings.forEach(([i, j], k) => {
    // By default the pass that is already higher goes over (the least lifting).
    const pick = over[k] ?? (samples[i].y > samples[j].y ? 'first' : 'second');
    const [upper, lower] = pick === 'first' ? [i, j] : [j, i];
    const up = samples[upper];
    const low = samples[lower];
    const needed = Math.max(0, low.y + BRIDGE_CLEARANCE - up.y);
    const rise = up.y + needed - low.y;
    out.push({ upper, lower, clearance: rise });
    // Flat over the road below (longer for a shallow crossing), with ramps at under ~10% grade.
    const dir = (k: number) => {
      const p = samples[k];
      const q = samples[(k + 1) % n];
      const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      return [(q.x - p.x) / len, (q.z - p.z) / len];
    };
    const [ux, uz] = dir(upper);
    const [lx, lz] = dir(lower);
    const sin = Math.abs(ux * lz - uz * lx);
    const flat = clamp((wallOffset + 4) / Math.max(sin, 0.35), 14, 60);
    // The deck comes down to the ground over the ramps (a high mountain road: a viaduct whose
    // ground falls away to the road below).
    // (Ramps up to a flyover stay under ~7%; a viaduct's ground falls away over at most 260 m.)
    const ramp = Math.max(90, Math.min(rise * 20, 260), needed * 20);
    for (let d = -(flat + ramp); d <= flat + ramp; d += spacing) {
      const idx = mod(upper + Math.round(d / spacing), n);
      const t = Math.abs(d) <= flat ? 1 : 1 - smoothstep(0, 1, (Math.abs(d) - flat) / ramp);
      lift[idx] = Math.max(lift[idx], needed * t);
      bridge[idx] = Math.max(bridge[idx], rise * t);
    }
  });
  for (let i = 0; i < n; i++) {
    samples[i].y += lift[i];
    samples[i].bridge = bridge[i];
  }
  return out;
}

function segmentsCross(a: TrackSample, b: TrackSample, c: TrackSample, d: TrackSample): boolean {
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(c.x, c.z, d.x, d.z, a.x, a.z);
  const d2 = cross(c.x, c.z, d.x, d.z, b.x, b.z);
  const d3 = cross(a.x, a.z, b.x, b.z, c.x, c.z);
  const d4 = cross(a.x, a.z, b.x, b.z, d.x, d.z);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function normalize(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}
