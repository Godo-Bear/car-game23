import type { CityCourseId } from '../../shared/api';
import { mod } from '../core/math';
import { SCENES } from '../world/scenes';
import { cityStreets } from '../world/World';
import type { CityCourseData } from './cityCourseData';
import { inSpan } from './span';
import { createProjection, type TrackLayout, TrackPath, type TrackVertex } from './TrackPath';

/**
 * Works out the city courses from the free drive city's streets (run by the tests; the results
 * are saved in cityCourseData.ts so the game doesn't have to build the city to race in it).
 *
 * A course follows the avenues and ring roads: either a whole ring road, or a "sector": out
 * along one avenue, round an arc of the outer ring, back in along the next avenue and round
 * the inner ring to the start. Its line is smoothed into a circuit (corners rounded at the
 * junctions), then the side streets that leave the course and rejoin it further on are found:
 * the best few that save real distance become the official shortcuts. Checkpoint gates go every
 * GATE_SPACING metres round the lap, but not along a shortcut - so cutting through anywhere
 * else that skips a gate doesn't count.
 */

type P = [number, number];

interface CourseSpec {
  id: CityCourseId;
  name: string;
  /** A whole ring road (index among the three rings, inside out)... */
  ring?: number;
  /** Where on the ring the start line goes (degrees). */
  startAngle?: number;
  /** ...or a sector: two avenues (spoke indices, in race order) between two rings. */
  spokes?: [number, number];
  rings?: [number, number];
}

const SPECS: CourseSpec[] = [
  { id: 'city-ring', name: 'Inner Ring Loop', ring: 0, startAngle: 80 },
  { id: 'city-tower', name: 'Tower District', spokes: [5, 0], rings: [0, 1] },
  { id: 'city-wheel', name: 'Big Wheel Run', spokes: [0, 1], rings: [1, 2] },
  { id: 'city-castle', name: 'Castle Quarter', spokes: [4, 5], rings: [1, 2] },
];

/** Avenues, then the roundabout, then the three ring roads, then the local streets. */
const SPOKES = 7;
const FIRST_RING = SPOKES + 1;
const LOCALS = FIRST_RING + 3;
export const GATE_SPACING = 150;
/** The road's height on the city's streets (they sit a little above the flat basin). */
const ROAD_Y = 0.07;

export function generateCityCourses(): CityCourseData[] {
  const scene = SCENES.freeroam;
  if (scene.kind !== 'rural' || !scene.city || !scene.cityRadius) throw new Error('No free drive city');
  const net = cityStreets(scene.cityRadius, scene.city);
  const streets = net.streets.map((s) => s.pts);
  return SPECS.map((spec) => {
    const line = spec.ring !== undefined ? ringLoop(streets[FIRST_RING + spec.ring]) : sectorLoop(streets, spec);
    const start = spec.ring !== undefined ? ringPoint(streets[FIRST_RING + spec.ring], spec.startAngle ?? 0) : along(line.pts.slice(0, line.split), 0.65);
    const layout = toLayout(spec.name, line.pts, start);
    const track = new TrackPath(layout);
    const shortcuts = findShortcuts(track, streets.slice(LOCALS));
    const gates: number[] = [];
    for (let d = 60; d < track.length - 30; d += GATE_SPACING) {
      if (!shortcuts.some((s) => inSpan(d, s.from - 40, s.to + 40, track.length))) gates.push(Math.round(d));
    }
    // A gate just either side of each shortcut, so it's the only way through that stretch.
    for (const s of shortcuts) gates.push(Math.round(mod(s.from - 25, track.length)), Math.round(mod(s.to + 25, track.length)));
    gates.sort((a, b) => a - b);
    return { id: spec.id, layout, gates, shortcuts };
  });
}

// ---------------------------------------------------------------- routes

function ringLoop(ring: P[]): { pts: P[]; split: number } {
  // The ring's points go once round, with the first repeated at the end.
  const pts = ring.slice(0, -1);
  return { pts, split: pts.length };
}

function ringPoint(ring: P[], deg: number): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  let best = ring[0];
  for (const p of ring) if (Math.abs(wrap(Math.atan2(p[1], p[0]) - a)) < Math.abs(wrap(Math.atan2(best[1], best[0]) - a))) best = p;
  return { x: best[0], z: best[1] };
}

/** Out along spoke A, round the outer ring to spoke B, in along B, round the inner ring back to A. */
function sectorLoop(streets: P[][], spec: CourseSpec): { pts: P[]; split: number } {
  const [a, b] = spec.spokes!;
  const [inner, outer] = spec.rings!.map((k) => streets[FIRST_RING + k]);
  const A = streets[a];
  const B = streets[b];
  const aIn = cross(A, inner);
  const aOut = cross(A, outer);
  const bIn = cross(B, inner);
  const bOut = cross(B, outer);
  const leg1 = slice(A, aIn.s, aOut.s);
  const leg2 = arc(outer, aOut.t, bOut.t);
  const leg3 = slice(B, bOut.s, bIn.s);
  const leg4 = arc(inner, bIn.t, aIn.t);
  const pts: P[] = [];
  for (const leg of [leg1, leg2, leg3, leg4]) {
    for (const p of leg) if (!pts.length || dist(pts[pts.length - 1], p) > 0.5) pts.push(p);
  }
  if (dist(pts[0], pts[pts.length - 1]) < 0.5) pts.pop();
  return { pts, split: leg1.length };
}

/** Where polylines S and T cross: the fractional point index on each. */
function cross(S: P[], T: P[]): { s: number; t: number } {
  let best = { s: 0, t: 0, d: Infinity };
  for (let i = 0; i + 1 < S.length; i++) {
    for (let j = 0; j + 1 < T.length; j++) {
      const hit = segmentHit(S[i], S[i + 1], T[j], T[j + 1]);
      if (hit) return { s: i + hit[0], t: j + hit[1] };
      const d = dist(S[i], T[j]);
      if (d < best.d) best = { s: i, t: j, d };
    }
  }
  return best;
}

function segmentHit(a: P, b: P, c: P, d: P): [number, number] | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

function at(S: P[], s: number): P {
  const i = Math.min(Math.floor(s), S.length - 2);
  const f = s - i;
  return [S[i][0] + (S[i + 1][0] - S[i][0]) * f, S[i][1] + (S[i + 1][1] - S[i][1]) * f];
}

/** An open street from point index `from` to `to` (either way). */
function slice(S: P[], from: number, to: number): P[] {
  const out: P[] = [at(S, from)];
  if (to > from) for (let i = Math.ceil(from); i <= Math.floor(to); i++) out.push(S[i]);
  else for (let i = Math.floor(from); i >= Math.ceil(to); i--) out.push(S[i]);
  out.push(at(S, to));
  return out;
}

/** The shorter way round a ring road from point index `from` to `to`. */
function arc(ring: P[], from: number, to: number): P[] {
  const n = ring.length - 1;
  const fwd = mod(to - from, n);
  const out: P[] = [at(ring, from)];
  if (fwd <= n / 2) {
    for (let k = Math.ceil(from); k <= from + fwd; k++) out.push(ring[mod(k, n)]);
  } else {
    for (let k = Math.floor(from); k >= from - (n - fwd); k--) out.push(ring[mod(k, n)]);
  }
  out.push(at(ring, to));
  return out;
}

function along(pts: P[], f: number): { x: number; z: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let left = total * f;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (d >= left) {
      const t = left / d;
      return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, z: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t };
    }
    left -= d;
  }
  return { x: pts[0][0], z: pts[0][1] };
}

// ---------------------------------------------------------------- the circuit

/** Simplify the line into corners, rounded tight at the junctions and gently elsewhere. */
function toLayout(name: string, pts: P[], start: { x: number; z: number }): TrackLayout {
  const closed = [...pts, pts[0]];
  const keep = douglasPeucker(closed, 0.7);
  keep.pop();
  const n = keep.length;
  const vertices: TrackVertex[] = keep.map((v, i) => {
    const p = keep[mod(i - 1, n)];
    const q = keep[(i + 1) % n];
    const d1 = norm(p[0] - v[0], p[1] - v[1]);
    const d2 = norm(q[0] - v[0], q[1] - v[1]);
    const interior = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    const turn = Math.PI - interior;
    // A junction (a sharp turn) gets a tight corner; a bend in the road follows its curve.
    const want = turn > 0.6 ? 15 : 90;
    const fit = 0.48 * Math.min(dist(p, v), dist(q, v)) * Math.tan(interior / 2);
    return { x: round(v[0]), z: round(v[1]), radius: round(Math.max(0.5, Math.min(want, fit))), y: ROAD_Y };
  });
  return { name, width: 12, wallMargin: 1, sampleSpacing: 2, start: { x: round(start.x), z: round(start.z) }, vertices };
}

function douglasPeucker(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tol) return [a, b];
  const left = douglasPeucker(pts.slice(0, index + 1), tol);
  const right = douglasPeucker(pts.slice(index), tol);
  return [...left.slice(0, -1), ...right];
}

// ---------------------------------------------------------------- shortcuts

/**
 * Side streets that leave the course and come back to it further on, saving distance. Each
 * becomes a shortcut from where it leaves (lap distance) to where it rejoins.
 */
function findShortcuts(track: TrackPath, locals: P[][]): CityCourseData['shortcuts'] {
  const L = track.length;
  const found: { from: number; to: number; pts: P[]; gain: number }[] = [];
  const proj = createProjection();
  for (const S of locals) {
    const on = S.map(([x, z]) => {
      track.project(x, z, -1, proj);
      return Math.abs(proj.lateral) < track.halfWidth ? proj.distance : null;
    });
    // Runs of points off the course, between two points on it.
    for (let i = 0; i < S.length; i++) {
      if (on[i] === null || on[i + 1] !== null || i + 1 >= S.length) continue;
      let j = i + 1;
      while (j < S.length && on[j] === null) j++;
      if (j >= S.length) break;
      const path = S.slice(i, j + 1);
      let length = 0;
      for (let k = 1; k < path.length; k++) length += dist(path[k - 1], path[k]);
      let from = on[i]!;
      let to = on[j]!;
      let pts = path;
      // Drive it whichever way runs with the race.
      if (mod(to - from, L) > L / 2) {
        [from, to] = [to, from];
        pts = path.slice().reverse();
      }
      const skip = mod(to - from, L);
      // A real saving - a few seconds - but not a quarter of the lap.
      const gain = skip - length;
      if (skip >= 160 && skip <= L * 0.22 && gain >= 70 && gain <= 230) found.push({ from, to, pts, gain });
      i = j - 1;
    }
  }
  // Closest to a saving of ~150 m first.
  found.sort((a, b) => Math.abs(a.gain - 150) - Math.abs(b.gain - 150));
  const chosen: typeof found = [];
  for (const s of found) {
    if (chosen.length >= 2) break;
    if (chosen.some((c) => inSpan(s.from, c.from - 60, c.to + 60, L) || inSpan(c.from, s.from - 60, s.to + 60, L))) continue;
    chosen.push(s);
  }
  return chosen.map((s) => ({ from: Math.round(s.from), to: Math.round(s.to), pts: s.pts.map(([x, z]) => [round(x), round(z)] as P) }));
}

// ---------------------------------------------------------------- maths

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v: number) => Math.round(v * 10) / 10;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function norm(x: number, z: number): P {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
