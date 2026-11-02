import * as THREE from 'three';
import { createRng } from '../core/math';
import type { Footprint } from './City';
import { type CityStreet, PAVEMENT, StreetField, streetLayout } from './cityPlan';
import { GeometryBuilder } from './GeometryBuilder';
import { ATLAS_H, ATLAS_W, DECAL, type DecalKind, markingAtlas, PAVING_TILE, pavementTexture, ROAD_TILE, streetAsphalt, wornPaint } from './streetTextures';
import { applyRoadDetail } from './surfaces';

/**
 * The free drive city's streets, made like Japanese town streets:
 * - asphalt with wheel tracks worn into every lane, plain at the junctions;
 * - kerbed, paved pavements (a yellow tactile strip down the main roads), a concrete gutter at
 *   the kerb with drain grates, and rounded kerbs at every street corner;
 * - the markings: a yellow double centre line and lane lines on the main roads, a dashed centre
 *   line and wide shoulders on the side streets, zebra crossings, stop lines, lane arrows at the
 *   traffic lights, 止まれ where a side street meets a bigger one, ◇ (crossing ahead), speed
 *   limits, blue cycle arrows, manhole covers;
 * - white guard rails along the main roads' pavements, bus stops and post boxes.
 * (The street plan itself - cityStreets in World.ts - is plain data, so the tests can use it.)
 */

type V2 = [number, number];
type V3 = [number, number, number];
type Span = [number, number];

/** The road surface's height: the bigger roads a little higher, so they're drawn cleanly over the smaller where they cross. */
export function streetHeight(width: number): number {
  return width >= 16 ? 0.08 : width >= 14 ? 0.07 : 0.06;
}

/** The pavement's top. */
const KERB = 0.14;
const PAINT_LIFT = 0.012;
const DECAL_LIFT = 0.016;
/** Paving keeps this far back from another street's edge (the corner between gets a rounded kerb). */
const CORNER = 3.8;
/** The kerb stone band in the pavement texture (v, with the road side at v = 1). */
const KERB_V = 1 - 12 / 128;
/** Where in the pavement texture the gutter takes its concrete from. */
const GUTTER = 0.45;

/** A street's centre line, measured: arc lengths and (averaged) normals to the right of +s. */
class Line {
  readonly cum: number[] = [0];
  readonly nrm: V2[] = [];
  readonly length: number;

  constructor(readonly pts: V2[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      this.nrm.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]);
    }
  }

  private seg(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m - 1;
    }
    return Math.max(0, lo);
  }

  /** The point `o` metres right of the centre line, `s` metres along. */
  at(s: number, o = 0): V2 {
    const i = this.seg(s);
    const t = Math.max(0, Math.min(1, (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1)));
    const [ax, az] = this.pts[i];
    const [bx, bz] = this.pts[i + 1];
    const nx = this.nrm[i][0] + (this.nrm[i + 1][0] - this.nrm[i][0]) * t;
    const nz = this.nrm[i][1] + (this.nrm[i + 1][1] - this.nrm[i][1]) * t;
    return [ax + (bx - ax) * t + nx * o, az + (bz - az) * t + nz * o];
  }

  /** The unit direction of +s at s. */
  dir(s: number): V2 {
    const i = this.seg(s);
    const [ax, az] = this.pts[i];
    const [bx, bz] = this.pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / l, (bz - az) / l];
  }

  /** s0, every corner of the line between, s1. */
  stations(s0: number, s1: number, step = Infinity): number[] {
    const out = [s0];
    const push = (s: number) => {
      const last = out[out.length - 1];
      const n = Math.ceil((s - last) / step);
      for (let k = 1; k < n; k++) out.push(last + ((s - last) * k) / n);
      out.push(s);
    };
    for (let i = 1; i < this.cum.length - 1; i++) if (this.cum[i] > s0 + 0.05 && this.cum[i] < s1 - 0.05) push(this.cum[i]);
    push(s1);
    return out;
  }
}

/** A quad with its own UV at each corner, wound to face up (or toward `facing`, for walls). */
function quad(b: GeometryBuilder, p: V3[], uv: V2[], color?: THREE.Color, facing?: V2): void {
  const ux = p[1][0] - p[0][0];
  const uy = p[1][1] - p[0][1];
  const uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0];
  const vy = p[2][1] - p[0][1];
  const vz = p[2][2] - p[0][2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const wrong = facing ? nx * facing[0] + nz * facing[1] < 0 : ny < 0;
  const order = wrong ? [0, 3, 2, 1] : [0, 1, 2, 3];
  if (wrong) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  const n: V3 = [nx / l, ny / l, nz / l];
  const i = order.map((k) => b.vertex(p[k], n, uv[k][0], uv[k][1], color));
  b.triangle(i[0], i[1], i[2]);
  b.triangle(i[0], i[2], i[3]);
}

/** A strip along a street from s0 to s1, between offsets o0 and o1 (following its curves). */
function ribbon(
  b: GeometryBuilder,
  line: Line,
  s0: number,
  s1: number,
  o0: number,
  o1: number,
  y: number,
  uv: (s: number, o: number, x: number, z: number) => V2,
  color?: THREE.Color,
): void {
  if (s1 - s0 < 0.01) return;
  const st = line.stations(s0, s1);
  for (let i = 0; i + 1 < st.length; i++) {
    const p: V3[] = [];
    const t: V2[] = [];
    for (const [s, o] of [
      [st[i], o0],
      [st[i + 1], o0],
      [st[i + 1], o1],
      [st[i], o1],
    ]) {
      const [x, z] = line.at(s, o);
      p.push([x, y, z]);
      t.push(uv(s, o, x, z));
    }
    quad(b, p, t, color);
  }
}

/** A vertical face from a to c, y0 to y1, facing `facing`. */
function wall(b: GeometryBuilder, a: V2, c: V2, y0: number, y1: number, facing: V2, uv: [number, number, number, number], color?: THREE.Color): void {
  const [u0, v0, u1, v1] = uv;
  quad(
    b,
    [
      [a[0], y0, a[1]],
      [c[0], y0, c[1]],
      [c[0], y1, c[1]],
      [a[0], y1, a[1]],
    ],
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
    color,
    facing,
  );
}

/** Where lines P + t d and Q + u e cross (t, u), or null if they're near parallel. */
function cross(P: V2, d: V2, Q: V2, e: V2): V2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 0.08) return null;
  const qx = Q[0] - P[0];
  const qz = Q[1] - P[1];
  return [(qx * e[1] - qz * e[0]) / den, (qx * d[1] - qz * d[0]) / den];
}

function bezier(a: V2, c: V2, b: V2, t: number): V2 {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** `spans` with `cuts` taken out (both sorted or not; pieces shorter than `min` dropped). */
function subtract(spans: Span[], cuts: Span[], min = 0.5): Span[] {
  let out = spans.map((s): Span => [s[0], s[1]]);
  for (const [c0, c1] of cuts) {
    const next: Span[] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a >= min);
}

/** Where along a street another street crosses or meets it (s from a to b), and which. */
interface Junction {
  a: number;
  b: number;
  j: number;
  /** How this street's traffic goes through it. */
  kind: 'signal' | 'yieldZebra' | 'entry' | 'yield' | 'priority';
}

/** One end of a run of pavement (where it stops for a junction). */
interface End {
  k: number;
  s: number;
  ki: V2;
  ko: V2;
  /** Into the gap. */
  d: V2;
  y: number;
  paired: boolean;
}

const WHITE = new THREE.Color(0xf2f2ee);
const YELLOW = new THREE.Color(0xe9b524);

export class StreetMesh {
  readonly group = new THREE.Group();
  /** Guard rails, bus stops, post boxes (for the car to hit). */
  readonly footprints: Footprint[] = [];
  private readonly field: StreetField;
  private readonly lines: Line[];
  private readonly heights: number[];
  private readonly asphalt = new Map<number, GeometryBuilder>();
  private readonly plain = new GeometryBuilder();
  private readonly paving = [new GeometryBuilder(), new GeometryBuilder()];
  private readonly paint = new GeometryBuilder(true);
  private readonly decals = new GeometryBuilder();
  private readonly rails = new GeometryBuilder();
  private readonly posts: { x: number; z: number; angle: number }[] = [];
  private readonly props = new GeometryBuilder(true);
  private readonly lightBoxes = new GeometryBuilder();
  private readonly lightBoxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  /**
   * `occupied`: what's already on the pavements (lamp posts, trees), for the bus stops to keep
   * clear of.
   */
  constructor(
    private readonly streets: CityStreet[],
    rng: () => number,
    private readonly occupied: Footprint[] = [],
  ) {
    this.group.name = 'streets';
    this.field = new StreetField(streets);
    this.lines = streets.map((s) => new Line(s.pts));
    this.heights = streets.map((s) => streetHeight(s.width));
    const central = streets.map((s) => s.pts.every(([x, z]) => x * x + z * z < 60 * 60));
    const junctions = streets.map((_, k) => this.junctionSpans(k, central));
    const runs = streets.map((_, k) => [this.pavementRuns(k, -1), this.pavementRuns(k, 1)] as const);
    const ends: End[] = [];
    streets.forEach((_, k) => {
      this.surface(k, junctions[k]);
      runs[k].forEach((list, i) => this.pavements(k, i ? 1 : -1, list, ends));
      const zebras = this.markings(k, junctions[k], runs[k], rng);
      this.edgeLines(k, runs[k], zebras);
      this.fittings(k, junctions[k], runs[k], rng);
    });
    const corners = this.corners(ends);
    streets.forEach((s, k) => {
      if (s.width >= 14 && !central[k]) this.furnish(k, junctions[k], runs[k], rng);
    });
    for (const c of corners) if (rng() < 0.16) this.postBox(c, rng);
    this.build();
  }

  // ---------------------------------------------------------------- analysis

  /** Where other streets cross or meet street k: wherever any part of its width is within 1.5 m of one. */
  private junctionSpans(k: number, central: boolean[]): Junction[] {
    const line = this.lines[k];
    const w = this.streets[k].width;
    const hw = w / 2;
    const out: Junction[] = [];
    let cur: Junction | null = null;
    for (let s = 0; s <= line.length + 0.99; s += 1) {
      const ss = Math.min(s, line.length);
      let j = -1;
      const [cx, cz] = line.at(ss);
      if (!this.field.clear(cx, cz, hw + 1.5, k)) {
        for (const o of [0, -hw, hw]) {
          const [x, z] = line.at(ss, o);
          const hit = this.field.nearest(x, z, 1.5, k);
          if (hit) {
            j = hit.k;
            break;
          }
        }
      }
      if (j < 0) continue;
      if (cur && ss - cur.b <= 1.01) cur.b = ss;
      else {
        cur = { a: ss, b: ss, j, kind: 'priority' };
        out.push(cur);
      }
    }
    const major = w >= 14;
    for (const J of out) {
      const wj = this.streets[J.j].width;
      const majorJ = wj >= 14;
      const [mx, mz] = line.at((J.a + J.b) / 2);
      if (central[k]) J.kind = 'priority';
      else if (central[J.j]) J.kind = 'entry';
      else if (major && majorJ) J.kind = Math.hypot(mx, mz) < 60 ? 'priority' : 'signal';
      else if (major) J.kind = 'priority';
      else if (majorJ) J.kind = 'yieldZebra';
      else J.kind = k > J.j ? 'yield' : 'priority';
    }
    return out;
  }

  /** Stretches of pavement on one side of street k: wherever it keeps CORNER metres clear of every other street. */
  private pavementRuns(k: number, side: 1 | -1): Span[] {
    const line = this.lines[k];
    const off = side * (this.streets[k].width / 2 + PAVEMENT / 2);
    const out: Span[] = [];
    let start = -1;
    let last = 0;
    for (let s = 0; s <= line.length + 0.99; s += 1) {
      const ss = Math.min(s, line.length);
      const [x, z] = line.at(ss, off);
      const ok = this.field.clear(x, z, CORNER, k);
      if (ok && start < 0) start = ss;
      if (!ok && start >= 0) {
        out.push([start, last]);
        start = -1;
      }
      last = ss;
    }
    if (start >= 0) out.push([start, line.length]);
    return out.filter(([a, b]) => b - a >= 2);
  }

  // ---------------------------------------------------------------- road surface

  /** The asphalt: lane-worn everywhere but the junctions, which are plain (and the same whichever street draws them). */
  private surface(k: number, junctions: Junction[]): void {
    const line = this.lines[k];
    const w = this.streets[k].width;
    const hw = w / 2;
    const y = this.heights[k];
    let b = this.asphalt.get(w);
    if (!b) {
      b = new GeometryBuilder();
      this.asphalt.set(w, b);
    }
    const plainSpans = junctions.map((J): Span => [Math.max(0, J.a - 1), Math.min(line.length, J.b + 1)]);
    for (const [s0, s1] of subtract([[0, line.length]], plainSpans, 0.01)) {
      ribbon(b, line, s0, s1, -hw, hw, y, (s, o) => [s / ROAD_TILE, (o + hw) / w]);
    }
    for (const [s0, s1] of plainSpans) ribbon(this.plain, line, s0, s1, -hw, hw, y, (_s, _o, x, z) => [x / ROAD_TILE, z / ROAD_TILE]);
  }

  /** Pavements: paving, the kerb's face, the gutter in front of it, and a step down at any end that isn't a corner. */
  private pavements(k: number, side: 1 | -1, runs: Span[], ends: End[]): void {
    const line = this.lines[k];
    const hw = this.streets[k].width / 2;
    const y = this.heights[k];
    const b = this.paving[this.streets[k].width >= 14 ? 1 : 0];
    const gut = this.paving[0];
    for (const [s0, s1] of runs) {
      ribbon(b, line, s0, s1, side * hw, side * (hw + PAVEMENT), KERB, (s, o) => [s / PAVING_TILE, 1 - (Math.abs(o) - hw) / PAVEMENT]);
      ribbon(gut, line, s0, s1, side * (hw - GUTTER), side * hw, y + 0.004, (s, o) => [
        s / PAVING_TILE,
        KERB_V + (1 - KERB_V) * (1 - (hw - Math.abs(o)) / GUTTER),
      ]);
      const st = line.stations(s0, s1);
      for (let i = 0; i + 1 < st.length; i++) {
        const a = line.at(st[i], side * hw);
        const c = line.at(st[i + 1], side * hw);
        const m = line.at((st[i] + st[i + 1]) / 2);
        wall(b, a, c, y, KERB, [m[0] - (a[0] + c[0]) / 2, m[1] - (a[1] + c[1]) / 2], [st[i] / PAVING_TILE, KERB_V, st[i + 1] / PAVING_TILE, 1]);
      }
      for (const [s, gap] of [
        [s0, -1],
        [s1, 1],
      ] as const) {
        const [tx, tz] = line.dir(s);
        const end: End = { k, s, ki: line.at(s, side * hw), ko: line.at(s, side * (hw + PAVEMENT)), d: [tx * gap, tz * gap], y, paired: false };
        // At the very end of the street there's nothing to round the corner onto.
        if (s > 0.5 && s < line.length - 0.5) ends.push(end);
        else this.cap(end);
      }
    }
  }

  /** The end of a pavement: a kerb face across it. */
  private cap(e: End): void {
    wall(this.paving[0], e.ki, e.ko, e.y, KERB, e.d, [0, KERB_V, PAVEMENT / PAVING_TILE, 1]);
  }

  /**
   * Street corners: each pavement end is paired with the nearest end on another street round the
   * corner, and the gap between is filled with paving behind a rounded kerb (and asphalt in front).
   */
  private corners(ends: End[]): { inner: V2[]; outer: V2[] }[] {
    const C = 20;
    const grid = new Map<number, End[]>();
    const key = (x: number, z: number) => Math.floor(x / C) * 65536 + Math.floor(z / C);
    for (const e of ends) {
      const kk = key(e.ko[0], e.ko[1]);
      const list = grid.get(kk);
      if (list) list.push(e);
      else grid.set(kk, [e]);
    }
    const best = (e: End): End | null => {
      let found: End | null = null;
      let bestD = 16;
      const ci = Math.floor(e.ko[0] / C);
      const cj = Math.floor(e.ko[1] / C);
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          for (const f of grid.get(i * 65536 + j) ?? []) {
            if (f.k === e.k) continue;
            const dx = f.ko[0] - e.ko[0];
            const dz = f.ko[1] - e.ko[1];
            const d = Math.hypot(dx, dz);
            if (d >= bestD) continue;
            // Each must lie ahead of the other's gap.
            if (dx * e.d[0] + dz * e.d[1] < -1 || -dx * f.d[0] - dz * f.d[1] < -1) continue;
            bestD = d;
            found = f;
          }
        }
      }
      return found;
    };
    const out: { inner: V2[]; outer: V2[] }[] = [];
    for (const e of ends) {
      if (e.paired) continue;
      const f = best(e);
      if (!f || f.paired || best(f) !== e) continue;
      const c = this.corner(e, f);
      if (!c) continue;
      e.paired = f.paired = true;
      out.push(c);
    }
    for (const e of ends) if (!e.paired) this.cap(e);
    return out;
  }

  private corner(e: End, f: End): { inner: V2[]; outer: V2[] } | null {
    const ti = cross(e.ki, e.d, f.ki, f.d);
    if (!ti || ti[0] < -0.5 || ti[1] < -0.5 || ti[0] > 20 || ti[1] > 20) return null;
    const Ci: V2 = [e.ki[0] + e.d[0] * ti[0], e.ki[1] + e.d[1] * ti[0]];
    const to = cross(e.ko, e.d, f.ko, f.d);
    const Co: V2 =
      to && to[0] > 0 && to[1] > 0 && to[0] < 20 && to[1] < 20
        ? [e.ko[0] + e.d[0] * to[0], e.ko[1] + e.d[1] * to[0]]
        : [(e.ko[0] + f.ko[0]) / 2, (e.ko[1] + f.ko[1]) / 2];
    const N = 10;
    const inner: V2[] = [];
    const outer: V2[] = [];
    for (let i = 0; i <= N; i++) {
      inner.push(bezier(e.ki, Ci, f.ki, i / N));
      outer.push(bezier(e.ko, Co, f.ko, i / N));
    }
    // Nothing else may be under it (a third street close by).
    for (const p of [inner[N / 2], outer[N / 2], [(inner[N / 2][0] + outer[N / 2][0]) / 2, (inner[N / 2][1] + outer[N / 2][1]) / 2] as V2]) {
      if (!this.field.clear(p[0], p[1], 0.3, e.k, f.k)) return null;
    }
    const yLow = Math.min(e.y, f.y);
    const yHigh = Math.max(e.y, f.y);
    const b = this.paving[0];
    let arc = 0;
    // Inward (toward the road) across the kerb, from the middle of the curve.
    const mid = inner[N / 2];
    const inward = (i: number): V2 => {
      const a = inner[Math.max(0, i - 1)];
      const c = inner[Math.min(N, i + 1)];
      let nx = -(c[1] - a[1]);
      let nz = c[0] - a[0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      return nx * (Ci[0] - mid[0]) + nz * (Ci[1] - mid[1]) >= 0 ? [nx, nz] : [-nx, -nz];
    };
    for (let i = 0; i < N; i++) {
      const a = inner[i];
      const c = inner[i + 1];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u0 = arc / PAVING_TILE;
      const u1 = (arc + len) / PAVING_TILE;
      arc += len;
      quad(
        b,
        [
          [a[0], KERB, a[1]],
          [c[0], KERB, c[1]],
          [outer[i + 1][0], KERB, outer[i + 1][1]],
          [outer[i][0], KERB, outer[i][1]],
        ],
        [
          [u0, 1],
          [u1, 1],
          [u1, 0],
          [u0, 0],
        ],
      );
      const na = inward(i);
      const nc = inward(i + 1);
      wall(b, a, c, yLow, KERB, na, [u0, KERB_V, u1, 1]);
      // The gutter round the corner.
      quad(
        b,
        [
          [a[0], yHigh + 0.004, a[1]],
          [c[0], yHigh + 0.004, c[1]],
          [c[0] + nc[0] * GUTTER, yHigh + 0.004, c[1] + nc[1] * GUTTER],
          [a[0] + na[0] * GUTTER, yHigh + 0.004, a[1] + na[1] * GUTTER],
        ],
        [
          [u0, 1],
          [u1, 1],
          [u1, KERB_V],
          [u0, KERB_V],
        ],
      );
      // Asphalt in front of the kerb, out to the corner of the two roads.
      const uv = (p: V2): V2 => [p[0] / ROAD_TILE, p[1] / ROAD_TILE];
      const p0: V3 = [Ci[0], yLow, Ci[1]];
      const p1: V3 = [a[0], yLow, a[1]];
      const p2: V3 = [c[0], yLow, c[1]];
      quad(this.plain, [p0, p1, p2, p2], [uv(Ci), uv(a), uv(c), uv(c)]);
    }
    return { inner, outer };
  }

  // ---------------------------------------------------------------- paint

  /** A painted stripe (following the street) from s0 to s1 between offsets o0 and o1. */
  private stripe(k: number, s0: number, s1: number, o0: number, o1: number, color = WHITE, across = false): void {
    const lo = Math.min(o0, o1);
    const hi = Math.max(o0, o1);
    ribbon(
      this.paint,
      this.lines[k],
      Math.min(s0, s1),
      Math.max(s0, s1),
      lo,
      hi,
      this.heights[k] + PAINT_LIFT,
      (s, o) => (across ? [o / 3, (s - s0) / 0.45] : [s / 3, (o - lo) / (hi - lo)]),
      color,
    );
  }

  /** Dashes along `spans`, `on` metres painted then `off` metres gap (counted from the street's start, so both sides line up). */
  private dashes(k: number, spans: Span[], o: number, width: number, on: number, off: number): void {
    for (const [s0, s1] of spans) {
      for (let s = Math.ceil(s0 / (on + off)) * (on + off); s < s1; s += on + off) {
        const e = Math.min(s + on, s1);
        if (e - s > 0.8) this.stripe(k, s, e, o - width / 2, o + width / 2);
      }
    }
  }

  /** A marking from the atlas, centred at (x, z), reading toward (fx, fz). */
  private decal(kind: DecalKind, x: number, z: number, fx: number, fz: number, w: number, l: number, y: number): void {
    const [px, py, pw, ph] = DECAL[kind];
    const lx = fz;
    const lz = -fx;
    const hw = w / 2;
    const hl = l / 2;
    const u0 = px / ATLAS_W;
    const u1 = (px + pw) / ATLAS_W;
    const vNear = 1 - (py + ph) / ATLAS_H;
    const vFar = 1 - py / ATLAS_H;
    quad(
      this.decals,
      [
        [x - fx * hl + lx * hw, y, z - fz * hl + lz * hw],
        [x - fx * hl - lx * hw, y, z - fz * hl - lz * hw],
        [x + fx * hl - lx * hw, y, z + fz * hl - lz * hw],
        [x + fx * hl + lx * hw, y, z + fz * hl + lz * hw],
      ],
      [
        [u0, vNear],
        [u1, vNear],
        [u1, vFar],
        [u0, vFar],
      ],
    );
  }

  /** A decal on street k at (s, o), reading toward travel `g` (+1 along the street, -1 against), unless it would land on another street. */
  private mark(kind: DecalKind, k: number, s: number, o: number, g: number, w: number, l: number, anywhere = false): boolean {
    const line = this.lines[k];
    if (s < l / 2 || s > line.length - l / 2) return false;
    const [x, z] = line.at(s, o);
    const [tx, tz] = line.dir(s);
    if (!anywhere) {
      for (const d of [-l / 2, 0, l / 2]) if (!this.field.clear(x + tx * d, z + tz * d, 0.4, k)) return false;
    }
    this.decal(kind, x, z, tx * g, tz * g, w, l, this.heights[k] + DECAL_LIFT);
    return true;
  }

  /**
   * Centre and lane lines, and what's painted coming up to each junction. Returns the zebra
   * crossings (s spans), where the edge lines stop.
   */
  private markings(k: number, junctions: Junction[], runs: readonly [Span[], Span[]], rng: () => number): Span[] {
    const line = this.lines[k];
    const L = line.length;
    const w = this.streets[k].width;
    const major = w >= 14;
    const lay = streetLayout(w);
    const zebras: Span[] = [];
    const breaks: Span[] = [];
    const solid: Span[] = [];
    junctions.forEach((J, i) => {
      const prev = i > 0 ? junctions[i - 1].b : -Infinity;
      const next = i + 1 < junctions.length ? junctions[i + 1].a : Infinity;
      const zebra = J.kind === 'signal' || J.kind === 'yieldZebra' || J.kind === 'entry';
      if (J.kind === 'priority') {
        // Through a junction with a bigger road (or the roundabout's spokes): the lines stop.
        if (this.heights[J.j] > this.heights[k]) breaks.push([J.a - 1, J.b + 1]);
      } else breaks.push([J.a - (zebra ? 7 : 3), J.b + (zebra ? 7 : 3)]);
      for (const g of [1, -1] as const) {
        const sJ = g > 0 ? J.a : J.b;
        const room = g > 0 ? sJ - Math.max(prev, 0) : Math.min(next, L) - sJ;
        if ((g > 0 && J.a < 3) || (g < 0 && J.b > L - 3) || room < 12) continue;
        const back = (d: number) => sJ - g * d;
        if (J.kind === 'priority') continue;
        if (zebra) {
          // Zebra crossing: 0.45 m stripes across the whole road, 3-7 m back.
          const z0 = Math.min(back(7), back(3));
          zebras.push([z0, z0 + 4]);
          for (let o = -w / 2 + 0.7; o + 0.45 <= w / 2 - 0.7; o += 0.9) this.stripe(k, z0, z0 + 4, o, o + 0.45);
        }
        // The stop line across this way's lanes.
        const stopAt = zebra ? 9 : 3;
        if (room > stopAt + 2) {
          const s = Math.min(back(stopAt), back(stopAt - 0.45));
          this.stripe(k, s, s + 0.45, -g * 0.35, -g * lay.edge, WHITE, true);
        }
        if (J.kind === 'signal') {
          // Lane arrows: straight or right in the inside lane, straight or left in the outside one.
          for (const d of [13, 43]) {
            if (room < d + 12) break;
            this.mark('arrowRight', k, back(d), -g * lay.lanes[0], g, 1.5, 5);
            this.mark('arrowLeft', k, back(d), -g * lay.lanes[1], g, 1.5, 5);
          }
          // No changing lanes in the last 30 m.
          if (lay.laneLine !== null) solid.push([Math.min(back(37), back(7)), Math.max(back(37), back(7))]);
        } else if (J.kind === 'yield' || J.kind === 'yieldZebra') {
          // 止まれ ("stop") behind the stop line, and ◇ (a crossing ahead) further back.
          const d = stopAt + 1.2 + 3.75;
          if (room > d + 5) this.mark('stop', k, back(d), -g * lay.lanes[0], g, 2, 7.5);
          if (J.kind === 'yieldZebra') for (const dd of [30, 50]) if (room > dd + 12) this.mark('diamond', k, back(dd), -g * lay.lanes[0], g, 1.5, 4.5);
        }
      }
    });
    // Centre line: a yellow double line on the main roads (no overtaking), a dashed white line on the side streets.
    const open = subtract([[0, L]], breaks, 0.8);
    if (major) {
      for (const [s0, s1] of open) {
        for (const side of [-1, 1]) this.stripe(k, s0, s1, side * 0.15, side * lay.middle, YELLOW);
      }
      if (lay.laneLine !== null) {
        const ll = lay.laneLine;
        for (const side of [-1, 1]) {
          this.dashes(k, subtract(open, solid), side * ll, 0.15, 6, 9);
          for (const [s0, s1] of subtract(open, subtract([[0, L]], solid))) this.stripe(k, s0, s1, side * ll - 0.075, side * ll + 0.075);
        }
      }
    } else this.dashes(k, open, 0, 0.15, 5, 5);

    // Speed limits in every lane (50 on the main roads, 40 on the side streets), both ways.
    const quiet = subtract(
      [[0, L]],
      junctions.map((J): Span => [J.a - 30, J.b + 30]),
    );
    const speed: DecalKind = major ? 'speed50' : 'speed40';
    for (const [s0, s1] of quiet) {
      for (let s = s0 + 40 + rng() * 60; s < s1 - 10; s += 260) {
        for (const lane of lay.lanes) {
          this.mark(speed, k, s, -lane, 1, 2, 6);
          if (s + 9 < s1) this.mark(speed, k, s + 9, lane, -1, 2, 6);
        }
      }
    }
    // Blue cycle arrows on the side streets' shoulders, each way.
    if (!major) {
      const calm = subtract(
        [[0, L]],
        junctions.map((J): Span => [J.a - 14, J.b + 14]),
      );
      const o = lay.edge + 0.6;
      for (const [s0, s1] of calm) {
        for (let s = s0 + 6; s < s1 - 2; s += 40) {
          if (runs[0].some(([a, b]) => s > a && s < b)) this.mark('bike', k, s, -o, 1, 0.9, 2.7);
          if (runs[1].some(([a, b]) => s > a && s < b)) this.mark('bike', k, s + 20 < s1 ? s + 20 : s, o, -1, 0.9, 2.7);
        }
      }
    }
    return zebras;
  }

  /** Solid white edge lines, wherever there's a kerb alongside (not across the zebra crossings). */
  private edgeLines(k: number, runs: readonly [Span[], Span[]], zebras: Span[]): void {
    const lay = streetLayout(this.streets[k].width);
    runs.forEach((list, i) => {
      const side = i ? 1 : -1;
      for (const [s0, s1] of subtract(list, zebras, 1.5)) this.stripe(k, s0, s1, side * lay.edge, side * (lay.edge + 0.15));
    });
  }

  /** Manhole covers in the road, drain grates in the gutters. */
  private fittings(k: number, junctions: Junction[], runs: readonly [Span[], Span[]], rng: () => number): void {
    const line = this.lines[k];
    const lay = streetLayout(this.streets[k].width);
    const hw = this.streets[k].width / 2;
    for (let s = 10 + rng() * 30; s < line.length - 5; s += 35 + rng() * 30) {
      const o = (rng() * 2 - 1) * (lay.edge - 1);
      const g = rng() < 0.5 ? 1 : -1;
      if (!junctions.some((J) => s > J.a - 2 && s < J.b + 2)) this.mark('manhole', k, s, o, g, 0.95, 0.95);
    }
    runs.forEach((list, i) => {
      const side = i ? 1 : -1;
      for (const [s0, s1] of list) for (let s = s0 + 4 + rng() * 6; s < s1 - 2; s += 18) this.mark('drain', k, s, side * (hw - 0.22), 1, 0.7, 1, true);
    });
  }

  // ---------------------------------------------------------------- street furniture

  /** Main roads: white guard rails along the kerbs (gaps at the corners and driveways), bus stops. */
  private furnish(k: number, junctions: Junction[], runs: readonly [Span[], Span[]], rng: () => number): void {
    const hw = this.streets[k].width / 2;
    runs.forEach((list, i) => {
      const side = i ? 1 : -1;
      const stops: Span[] = [];
      // A bus stop every 400 m or so, away from the junctions.
      for (const [s0, s1] of list) {
        for (let at = s0 + 60 + rng() * 200; at < s1 - 60; at += 380 + rng() * 120) {
          // (Shuffled along a little to find a gap between the trees and lamps.)
          const s = [0, 5, -5, 10, -10].map((d) => at + d).find((s) => this.stopFits(k, s, side, junctions));
          if (s === undefined) continue;
          this.busStop(k, s, side);
          stops.push([s - 9, s + 9]);
        }
      }
      // Guard rails in pieces of 30-70 m with a gap (a driveway) between.
      const pieces: Span[] = [];
      for (const [s0, s1] of subtract(
        list.map(([a, b]): Span => [a + 6, b - 6]),
        stops,
        4,
      )) {
        let s = s0;
        while (s < s1 - 4) {
          const e = Math.min(s1, s + 30 + rng() * 40);
          if (e - s > 4) pieces.push([s, e]);
          s = e + 4;
        }
      }
      for (const [s0, s1] of pieces) this.rail(k, s0, s1, side * (hw + 0.35));
    });
  }

  /** Room for a bus stop at s: away from junctions and the middle of town, clear of the trees and lamps. */
  private stopFits(k: number, s: number, side: 1 | -1, junctions: Junction[]): boolean {
    const line = this.lines[k];
    if (junctions.some((J) => s > J.a - 40 && s < J.b + 40)) return false;
    const [x, z] = line.at(s);
    if (x * x + z * z < 120 * 120) return false;
    const [bx, bz] = line.at(s, side * (this.streets[k].width / 2 + 1.5));
    return !this.occupied.some((o) => Math.abs(o.x - bx) < 5 && Math.abs(o.z - bz) < 5 && Math.hypot(o.x - bx, o.z - bz) < 3.4 + o.hw);
  }

  /** A white guard rail (ガードパイプ): two rails on posts every 2.5 m. */
  private rail(k: number, s0: number, s1: number, o: number): void {
    const line = this.lines[k];
    const st = line.stations(s0, s1, 6);
    for (let i = 0; i + 1 < st.length; i++) {
      const a = line.at(st[i], o);
      const c = line.at(st[i + 1], o);
      for (const h of [0.45, 0.8]) {
        // A rail drawn as a cross: a vertical and a flat strip.
        const r = 0.03;
        const dx = c[0] - a[0];
        const dz = c[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * r;
        const nz = (dx / l) * r;
        const y = KERB + h;
        this.rails.quad([a[0], y - r, a[1]], [c[0], y - r, c[1]], [c[0], y + r, c[1]], [a[0], y + r, a[1]]);
        this.rails.quad([a[0] - nx, y, a[1] - nz], [c[0] - nx, y, c[1] - nz], [c[0] + nx, y, c[1] + nz], [a[0] + nx, y, a[1] + nz]);
      }
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[1] + c[1]) / 2;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      this.footprints.push({ x: mx, z: mz, hw: len / 2, hd: 0.12, angle: Math.atan2(-(c[1] - a[1]), c[0] - a[0]) });
    }
    for (let s = s0; s <= s1 + 0.01; s += (s1 - s0) / Math.max(1, Math.round((s1 - s0) / 2.5))) {
      const [x, z] = line.at(Math.min(s, s1), o);
      const [tx, tz] = line.dir(Math.min(s, s1));
      this.posts.push({ x, z, angle: Math.atan2(-tz, tx) });
    }
  }

  /** A bus stop: a shelter with a bench at the back of the pavement, the stop's sign by the kerb. */
  private busStop(k: number, s: number, side: 1 | -1): void {
    const line = this.lines[k];
    const hw = this.streets[k].width / 2;
    const [tx, tz] = line.dir(s);
    const angle = Math.atan2(-tz, tx);
    const at = (along: number, out: number): V2 => {
      const [x, z] = line.at(s + along, side * (hw + out));
      return [x, z];
    };
    const frame = new THREE.Color(0xb7bcc2);
    const roof = new THREE.Color(0x5d6670);
    const glass = new THREE.Color(0x6f8796);
    const seat = new THREE.Color(0x8a5a3a);
    const p = this.props;
    // Shelter: posts, roof, back panel, bench.
    for (const along of [-1.9, 1.9]) {
      for (const out of [1.45, 2.25]) {
        const [x, z] = at(along, out);
        p.box(x, KERB, z, 0.08, 2.4, 0.08, angle, { color: frame });
      }
    }
    const [cx, cz] = at(0, 1.85);
    p.box(cx, KERB + 2.4, cz, 4.4, 0.1, 1.5, angle, { color: roof });
    const [bx, bz] = at(0, 2.27);
    p.box(bx, KERB + 0.15, bz, 3.7, 2.1, 0.04, angle, { color: glass });
    const [sx, sz] = at(0, 2.0);
    p.box(sx, KERB + 0.42, sz, 2.6, 0.06, 0.38, angle, { color: seat });
    // A lit advert at the end.
    const [ax, az] = at(-2.05, 1.85);
    this.lightBoxes.box(ax, KERB + 0.3, az, 0.12, 1.75, 1.1, angle);
    // The sign: a pole with a round plate and a timetable.
    const [px, pz] = at(2.6, 0.45);
    p.cylinder(px, KERB, pz, 0.04, 0.04, 2.7, 6, frame);
    p.box(px, KERB + 1.1, pz, 0.36, 0.6, 0.12, angle, { color: new THREE.Color(0xf4f4f0) });
    p.box(px, KERB + 2.05, pz, 0.62, 0.62, 0.05, angle, { color: new THREE.Color(0xe04a2a) });
    p.box(px, KERB + 2.14, pz, 0.42, 0.42, 0.07, angle, { color: new THREE.Color(0xf4f4f0) });
    this.footprints.push({ x: cx, z: cz, hw: 2.1, hd: 0.55, angle });
    this.footprints.push({ x: px, z: pz, hw: 0.15, hd: 0.15 });
  }

  /** A red post box on a corner, at the back of the pavement. */
  private postBox(c: { inner: V2[]; outer: V2[] }, rng: () => number): void {
    const i = 5;
    const x = c.inner[i][0] + (c.outer[i][0] - c.inner[i][0]) * 0.72;
    const z = c.inner[i][1] + (c.outer[i][1] - c.inner[i][1]) * 0.72;
    const facing = Math.atan2(c.inner[i][0] - c.outer[i][0], c.inner[i][1] - c.outer[i][1]);
    const red = new THREE.Color(0xc8202a);
    const p = this.props;
    if (rng() < 0.4) {
      // The old round kind.
      p.cylinder(x, KERB, z, 0.26, 0.26, 1.15, 12, red);
      p.cylinder(x, KERB + 1.15, z, 0.3, 0.3, 0.1, 12, red);
      p.box(x, KERB + 1.25, z, 0.3, 0.06, 0.3, facing, { color: red });
    } else {
      // The modern square one, on a stand, with a white panel.
      p.box(x, KERB, z, 0.2, 0.5, 0.2, facing, { color: new THREE.Color(0x3a3c40) });
      p.box(x, KERB + 0.5, z, 0.55, 0.75, 0.45, facing, { color: red });
      p.box(x, KERB + 1.25, z, 0.6, 0.07, 0.5, facing, { color: red });
      const fx = Math.sin(facing) * 0.23;
      const fz = Math.cos(facing) * 0.23;
      p.box(x + fx, KERB + 0.95, z + fz, 0.3, 0.12, 0.02, facing, { color: new THREE.Color(0xf4f4f0) });
    }
    this.footprints.push({ x, z, hw: 0.32, hd: 0.32 });
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const rng = createRng(91);
    const add = (b: GeometryBuilder, mat: THREE.Material, shadows = true): void => {
      if (b.isEmpty) return;
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.receiveShadow = shadows;
      this.group.add(mesh);
    };
    for (const [w, b] of this.asphalt) {
      const mat = new THREE.MeshStandardMaterial({ map: streetAsphalt(w, streetLayout(w).lanes, rng), roughness: 0.88 });
      applyRoadDetail(mat);
      add(b, mat);
    }
    const plain = new THREE.MeshStandardMaterial({ map: streetAsphalt(16, [], rng), roughness: 0.88 });
    applyRoadDetail(plain);
    add(this.plain, plain);
    add(this.paving[0], new THREE.MeshStandardMaterial({ map: pavementTexture(false, rng), roughness: 0.92 }));
    add(this.paving[1], new THREE.MeshStandardMaterial({ map: pavementTexture(true, rng), roughness: 0.92 }));
    const lift = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    add(this.paint, new THREE.MeshStandardMaterial({ map: wornPaint(rng), vertexColors: true, alphaTest: 0.5, roughness: 0.55, ...lift }));
    add(
      this.decals,
      new THREE.MeshStandardMaterial({ map: markingAtlas(rng), alphaTest: 0.45, roughness: 0.6, ...lift, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    add(this.rails, new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }), false);
    if (this.posts.length) {
      const posts = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.07, 0.9, 0.07).translate(0, KERB + 0.45, 0),
        new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.45, metalness: 0.25 }),
        this.posts.length,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      this.posts.forEach((p, i) => posts.setMatrixAt(i, m.compose(v.set(p.x, 0, p.z), q.setFromAxisAngle(up, p.angle), one)));
      posts.computeBoundingSphere();
      this.group.add(posts);
    }
    add(this.props, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), false);
    add(this.lightBoxes, this.lightBoxMat, false);
  }

  setTimeOfDay(tod: 'day' | 'sunset' | 'night'): void {
    const v = tod === 'night' ? 1.6 : tod === 'sunset' ? 1.15 : 0.95;
    this.lightBoxMat.color.setRGB(v * 0.92, v * 0.97, v);
  }
}
