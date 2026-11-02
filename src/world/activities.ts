import type { CityCourseId } from '../../shared/api';
import { createRng, mod } from '../core/math';
import { TrackPath } from '../track/TrackPath';
import { CITY_COURSE_DEFS } from '../track/tracks';

/**
 * Things to do in free drive, placed on the map:
 * - race markers at the start of each city course (stop in one to race it);
 * - speed traps on the fast roads (how fast were you going past the camera?);
 * - jump ramps (how far did you fly?);
 * - drift zones (how many drift points in one go?);
 * - lucky cats to find all over the map;
 * - boost pads round town.
 * Everything's worked out from the map itself, the same every time.
 */
export interface Ramp {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Direction you drive up it. */
  heading: number;
  length: number;
  width: number;
  height: number;
}

export interface SpeedTrap {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
}

export interface DriftZone {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
}

export interface RaceMarker {
  course: CityCourseId;
  x: number;
  z: number;
  heading: number;
}

export interface FreeActivities {
  markers: RaceMarker[];
  traps: SpeedTrap[];
  ramps: Ramp[];
  zones: DriftZone[];
  cats: { x: number; y: number; z: number }[];
  pads: { x: number; z: number; heading: number }[];
}

/** Star thresholds: speed traps (km/h), jumps (m), drift zones (points). */
export const TRAP_STARS = [160, 210, 255];
export const JUMP_STARS = [25, 40, 55];
export const ZONE_STARS = [1500, 4000, 8000];

export function starsFor(value: number, thresholds: number[]): number {
  return thresholds.filter((t) => value >= t).length;
}

interface Road {
  kind: 'ring' | 'street' | 'slip' | 'trail';
  pts: [number, number][];
  width: number;
}

export interface PlaceInput {
  roads: Road[];
  /** The ring road round the city. */
  ring: TrackPath;
  surfaceAt(x: number, z: number): number;
  /** Is (x, z) clear of buildings and trees by `r` metres? */
  clear(x: number, z: number, r: number): boolean;
  landmarks: { x: number; z: number; r: number }[];
  bounds: { cx: number; cz: number; half: number };
}

const COMPASS = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
/** Compass name of the direction from the centre of town (z points south on the map). */
const compass = (x: number, z: number) => COMPASS[mod(Math.round(Math.atan2(z, x) / (Math.PI / 4)), 8)];

export function placeActivities(input: PlaceInput): FreeActivities {
  const rng = createRng(4242);
  const { roads, ring } = input;
  const avenues = roads.filter((r) => r.kind === 'street' && r.width >= 16);
  const locals = roads.filter((r) => r.kind === 'street' && r.width < 14);
  const slips = roads.filter((r) => r.kind === 'slip');
  const trails = roads.filter((r) => r.kind === 'trail');
  const at = (pts: [number, number][], radius: number) => {
    // The point of an avenue nearest `radius` from the centre, and its heading (outward).
    let k = 1;
    for (let i = 1; i < pts.length - 1; i++) if (Math.abs(Math.hypot(...pts[i]) - radius) < Math.abs(Math.hypot(...pts[k]) - radius)) k = i;
    const [x, z] = pts[k];
    return { x, z, heading: Math.atan2(pts[k + 1][0] - pts[k - 1][0], pts[k + 1][1] - pts[k - 1][1]) };
  };

  // Race markers: on each city course's start line.
  const markers = Object.values(CITY_COURSE_DEFS).map((def): RaceMarker => {
    const s = new TrackPath(def.data.layout).samples[0];
    return { course: def.id, x: s.x, z: s.z, heading: s.heading };
  });

  // Speed traps: the three longest straights of the ring road, and three avenues out of town.
  const S = ring.samples;
  const straight = S.map((_, i) => {
    let bend = 0;
    for (let k = -60; k <= 60; k += 4) bend += Math.abs(S[mod(i + k, S.length)].curvature);
    return bend;
  });
  const traps: SpeedTrap[] = [];
  const picked: number[] = [];
  for (const i of [...S.keys()].sort((a, b) => straight[a] - straight[b])) {
    if (picked.length >= 3) break;
    if (picked.some((j) => Math.min(mod(i - j, S.length), mod(j - i, S.length)) < S.length / 5)) continue;
    picked.push(i);
    const s = S[i];
    traps.push({ id: `trap-ring-${picked.length}`, name: `Ring Road ${compass(s.x, s.z)}`, x: s.x, z: s.z, heading: s.heading });
  }
  for (const k of [0, 2, 4]) {
    const a = avenues[k];
    if (!a) continue;
    const p = at(a.pts, 920);
    traps.push({ id: `trap-avenue-${k}`, name: `${compass(p.x, p.z)} Avenue`, ...p });
  }

  // Jump ramps: one at the start of each slip road out of town (flat ground, and you come at it
  // flat out down the avenue), on the road itself, leaping out over the fields.
  const ramps: Ramp[] = [];
  for (const s of slips) {
    const P = s.pts;
    const k = Math.min(5, P.length - 2);
    const [x, z] = P[k];
    const heading = Math.atan2(P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]);
    const h = (d: number, side: number) =>
      input.surfaceAt(x + Math.sin(heading) * d + Math.cos(heading) * side, z + Math.cos(heading) * d - Math.sin(heading) * side);
    const flat = Math.abs(h(-6, 0) - h(6, 0)) < 0.8 && Math.abs(h(0, -3) - h(0, 3)) < 0.4;
    if (!flat || !input.clear(x, z, 6)) continue;
    const base = `${compass(x, z)} Gate Jump`;
    const same = ramps.filter((r) => r.name.startsWith(base)).length;
    ramps.push({ id: `ramp-${ramps.length + 1}`, name: same ? `${base} ${same + 1}` : base, x, z, heading, length: 9, width: 7, height: 2.2 });
  }

  // Drift zones: the roundabout in the middle of town, and the two twistiest bits of the ring road.
  const zones: DriftZone[] = [{ id: 'zone-roundabout', name: 'Central Roundabout', x: 0, z: 0, r: 75 }];
  const twisty = [...S.keys()].sort((a, b) => straight[b] - straight[a]);
  const zonePicks: number[] = [];
  for (const i of twisty) {
    if (zonePicks.length >= 2) break;
    if (zonePicks.some((j) => Math.min(mod(i - j, S.length), mod(j - i, S.length)) < S.length / 4)) continue;
    zonePicks.push(i);
    const s = S[i];
    zones.push({ id: `zone-ring-${zonePicks.length}`, name: `Ring Road ${compass(s.x, s.z)} Bends`, x: s.x, z: s.z, r: 130 });
  }

  // Lucky cats: down side streets, by the landmarks, out on the trails, beside the ring road and
  // up in the hills.
  const cats: { x: number; y: number; z: number }[] = [];
  const add = (x: number, z: number) => {
    if (!input.clear(x, z, 3)) return false;
    if (cats.some((c) => Math.hypot(c.x - x, c.z - z) < 60)) return false;
    cats.push({ x, y: input.surfaceAt(x, z), z });
    return true;
  };
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const tries = (n: number, f: () => boolean) => {
    for (let got = 0, t = 0; got < n && t < n * 40; t++) if (f()) got++;
  };
  tries(10, () => {
    const st = pick(locals);
    if (!st) return false;
    const [x, z] = pick(st.pts);
    return add(x, z);
  });
  for (const l of input.landmarks) {
    const a = rng() * Math.PI * 2;
    add(l.x + Math.cos(a) * (l.r + 6), l.z + Math.sin(a) * (l.r + 6));
  }
  tries(6, () => {
    const t = pick(trails);
    if (!t) return false;
    const [x, z] = pick(t.pts);
    return add(x + (rng() - 0.5) * 10, z + (rng() - 0.5) * 10);
  });
  tries(4, () => {
    const p = ring.pointAt(rng() * ring.length, (rng() < 0.5 ? -1 : 1) * (ring.wallOffset + 6));
    return add(p.x, p.z);
  });
  const b = input.bounds;
  tries(30 - cats.length, () => {
    const x = b.cx + (rng() - 0.5) * b.half * 1.8;
    const z = b.cz + (rng() - 0.5) * b.half * 1.8;
    const r = Math.hypot(x, z);
    if (r < 1250) return false;
    const grade = Math.abs(input.surfaceAt(x + 4, z) - input.surfaceAt(x - 4, z)) / 8 + Math.abs(input.surfaceAt(x, z + 4) - input.surfaceAt(x, z - 4)) / 8;
    return grade < 0.35 && add(x, z);
  });

  // Boost pads on the avenues (both ways).
  const pads: FreeActivities['pads'] = [];
  avenues.forEach((a, k) => {
    for (const radius of [540, 880]) {
      const p = at(a.pts, radius + (k % 2) * 40);
      pads.push({ x: p.x + Math.cos(p.heading) * 3.5, z: p.z - Math.sin(p.heading) * 3.5, heading: p.heading });
      pads.push({ x: p.x - Math.cos(p.heading) * 3.5, z: p.z + Math.sin(p.heading) * 3.5, heading: p.heading + Math.PI });
    }
  });

  return { markers, traps, ramps, zones, cats, pads };
}

/** Height of a ramp's surface above the ground under it at (x, z), or 0 off it. */
export function rampHeight(r: Ramp, x: number, z: number): number {
  const dx = x - r.x;
  const dz = z - r.z;
  const along = dx * Math.sin(r.heading) + dz * Math.cos(r.heading) + r.length / 2;
  const across = dx * Math.cos(r.heading) - dz * Math.sin(r.heading);
  if (along < 0 || along > r.length || Math.abs(across) > r.width / 2) return 0;
  return (r.height * along) / r.length;
}
