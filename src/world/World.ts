import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { RacingLine } from '../ai/RacingLine';
import { createRng } from '../core/math';
import { gridSlot } from '../race/RaceSimulation';
import { BARRIER_THICKNESS, buildRubberLine, buildTrackVisual, SIDEWALK_WIDTH, type TrackVisual } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import type { TrackDef } from '../track/tracks';
import { City, type Footprint, placeLamps } from './City';
import { windTime } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';
import { type Feature, MountFuji, powerLines, Railway, trafficSignals, vendingMachines } from './japan';
import { SUN_DIRECTION } from './Lighting';
import { NatureWorld } from './Nature';
import { SCENES } from './scenes';
import { ReflectionStreaks, roadWetness } from './surfaces';

/** Everything static around a circuit: the track furniture plus the city or countryside. */
export interface World {
  readonly def: TrackDef;
  readonly group: THREE.Group;
  readonly trackVisual: TrackVisual;
  setTimeOfDay(tod: TimeOfDay): void;
  /** Graphics detail 0..1 (amount of vegetation) and grass density (0 off .. 2 dense). */
  setDetail(detail: number, grass: 0 | 1 | 2): void;
  /** Lay rubber on the racing line once it has been computed (it arrives from a worker). */
  addRacingLine(line: RacingLine): void;
  update(time: number, dt: number, camera: THREE.Camera): void;
  dispose(): void;
  /** The free drive map: what a car can drive on and bump into off the road. */
  readonly freeRoam?: FreeRoamMap;
}

/** Free drive: the ground everywhere, the solid things in the city, where you start and the edge. */
export interface FreeRoamMap {
  /** Height a car's wheels sit at, anywhere off the ring road (streets, slip roads, grass, trails). */
  surfaceAt(x: number, z: number): number;
  obstacles: Footprint[];
  /** In the middle of town, on an avenue. */
  spawn: { x: number; z: number; heading: number };
  /** Drivable square: |x - cx| and |z - cz| up to `half`. */
  bounds: { cx: number; cz: number; half: number };
}

export function buildWorld(def: TrackDef, track: TrackPath, rng: () => number, detail = 1, grass: 0 | 1 | 2 = 1): World {
  const group = new THREE.Group();
  group.name = `world-${def.id}`;
  const gridSlots = Array.from({ length: 12 }, (_, i) => gridSlot(track, i));
  let rubber: THREE.Mesh | null = null;
  const addRacingLine = (line: RacingLine) => {
    if (rubber) return;
    rubber = buildRubberLine(track, line);
    group.add(rubber);
  };

  const scene = SCENES[def.id];
  if (scene.kind === 'city') {
    const lamps = placeLamps(track);
    const crossings = scene.crossings.map(([x, z]) => distanceNear(track, x, z));
    const trackVisual = buildTrackVisual(track, rng, { theme: 'city', banner: def.banner, gridSlots, lamps, crossings });
    // The JR line: a viaduct crossing the circuit north-south (no buildings underneath).
    const rail = scene.rail;
    const city = new City(track, lamps, rng, scene, (x, z, r) => Math.abs(x - rail.x) < r + 9 && z < rail.toZ + 10);
    const proj = { index: 0, lateral: 0, distance: 0, y: 0, heading: 0, slope: 0, tx: 0, tz: 0, rx: 0, rz: 0 };
    const sidewalkEdge = track.wallOffset + BARRIER_THICKNESS + SIDEWALK_WIDTH - 0.5;
    const features: Feature[] = [
      ...(scene.fujiAt ? [new MountFuji(...scene.fujiAt, () => SUN_DIRECTION)] : []),
      new Railway({
        from: [rail.x, -1800],
        to: [rail.x, rail.toZ],
        deckY: 21,
        ground: () => 0,
        kind: 'commuter',
        tunnels: false,
        // Keep piers off the circuit.
        clear: (x, z) => Math.abs(track.project(x, z, -1, proj).lateral) > sidewalkEdge + 2,
      }),
      powerLines(track, { lateral: sidewalkEdge, every: 32, sides: [-1, 1], style: 'concrete', ground: () => 0.14, skip: (i) => track.samples[i].y > 1.2 }),
      vendingMachines(cityVending(track, sidewalkEdge - 0.2), rng),
      trafficSignals(track, crossings, track.wallOffset + BARRIER_THICKNESS + 0.7),
    ];
    for (const f of features) group.add(f.group);
    const lampColor = new THREE.Color(1, 0.8, 0.55).multiplyScalar(0.6);
    const streaks = new ReflectionStreaks([
      ...lamps.map((l) => ({ x: l.x, y: track.samples[l.index].y, z: l.z, color: lampColor, width: 1.6, length: 26 })),
      ...city.streakLights,
    ]);
    group.add(trackVisual.group, city.group, streaks.mesh);
    return {
      def,
      group,
      trackVisual,
      setTimeOfDay(tod) {
        city.setTimeOfDay(tod);
        trackVisual.setTimeOfDay(tod);
        for (const f of features) f.setTimeOfDay?.(tod);
        // Tokyo at night has just had rain: glossy asphalt, puddles and neon reflections.
        roadWetness.value = tod === 'night' ? 1 : 0;
        streaks.mesh.visible = tod === 'night';
      },
      setDetail() {},
      addRacingLine,
      update(time) {
        city.update(time);
        streaks.update(time);
        for (const f of features) f.update?.(time);
      },
      dispose: () => disposeTree(group),
    };
  }

  // The free drive map's ring road is open (no guardrails or starting grid).
  const open = scene.kind === 'rural' && !!scene.cityRadius;
  const trackVisual = buildTrackVisual(track, rng, { theme: def.theme, banner: def.banner, gridSlots: open ? [] : gridSlots, lamps: [], crossings: [], open });
  // Free drive: a city with an organic street network in the middle of the map, its avenues
  // joined to the ring road by smooth slip roads (the ground is shaped to them).
  const streets = scene.kind === 'rural' && scene.cityRadius ? streetNetwork(scene.cityRadius, createRng(77)) : null;
  const connectors = streets ? connectorRoads(streets.spokes, track) : [];
  const nature = new NatureWorld({ ...scene, connectors }, track, rng, detail, grass);
  group.add(trackVisual.group, nature.group);
  if (connectors.length) group.add(connectorMesh(connectors));
  let city: City | null = null;
  let freeRoam: FreeRoamMap | undefined;
  if (streets && scene.city && scene.cityRadius) {
    const R = scene.cityRadius;
    city = new City(track, [], rng, scene.city, (x, z) => Math.hypot(x, z) > R - 20 || streets.near(x, z, 10));
    group.add(city.group, streets.mesh);
    // Start on the first avenue, a little way out from the centre, heading out of town.
    const avenue = streets.spokes[0].pts;
    const [sx, sz] = avenue[6];
    const [nx, nz] = avenue[7];
    freeRoam = {
      surfaceAt(x, z) {
        // Slip roads are laid a little above the ground shaped to them; streets sit on the flat basin.
        const c = nature.connectorAt(x, z);
        if (c && c.d < 7.5) return c.y + 0.06;
        return Math.max(nature.heightAt(x, z), Math.hypot(x, z) < R ? 0.06 : -Infinity);
      },
      obstacles: city.footprints,
      spawn: { x: sx, z: sz, heading: Math.atan2(nx - sx, nz - sz) },
      bounds: { ...nature.extent, half: nature.extent.half - 260 },
    };
  }
  return {
    freeRoam,
    def,
    group,
    trackVisual,
    setTimeOfDay(tod) {
      nature.setTimeOfDay(tod);
      city?.setTimeOfDay(tod);
      trackVisual.setTimeOfDay(tod);
      roadWetness.value = 0;
    },
    setDetail: (d, g) => nature.setDetail(d, g),
    addRacingLine,
    update(time, dt, camera) {
      windTime.value = time;
      nature.update(time, dt, camera);
      city?.update(time);
    },
    dispose: () => disposeTree(group),
  };
}

/** Free GPU memory for a world that's being replaced. */
function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      if (m instanceof THREE.ShaderMaterial) for (const u of Object.values(m.uniforms)) if (u.value instanceof THREE.Texture) textures.add(u.value);
      m.dispose();
    }
  });
  // Shared textures (detail noise, contact shadows) stay alive for the next world.
  for (const t of textures) if (!t.userData.shared) t.dispose();
  root.removeFromParent();
}

/** Lap distance of the centre-line point nearest (x, z). */
function distanceNear(track: TrackPath, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const s of track.samples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s.dist;
    }
  }
  return best;
}

/** Vending machines in pairs along the sidewalks, facing the road. */
function cityVending(track: TrackPath, lateral: number) {
  const spots = [];
  const S = track.samples;
  let side = 1;
  for (let i = 40; i < S.length; i += 70) {
    const s = S[i];
    if (s.y > 1.2) continue;
    for (const along of [0, 1.05]) {
      spots.push({
        x: s.x + s.rx * side * lateral + s.tx * along,
        y: 0.14,
        z: s.z + s.rz * side * lateral + s.tz * along,
        facing: Math.atan2(-side * s.rx, -side * s.rz),
      });
    }
    side = -side;
  }
  return spots;
}

/** Free drive: an organic city street network (curved avenues, wobbly rings, winding side streets). */
interface Street {
  pts: [number, number][];
  width: number;
  lines: boolean;
}

export function streetNetwork(R: number, rng: () => number) {
  const streets: Street[] = [];
  const CELL = 40;
  const grid = new Map<number, [number, number, number, number, number, number][]>();
  const key = (i: number, j: number) => i * 100003 + j;
  const addToGrid = (s: Street, id: number) => {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, az] = s.pts[i];
      const [bx, bz] = s.pts[i + 1];
      const k = key(Math.floor((ax + bx) / 2 / CELL), Math.floor((az + bz) / 2 / CELL));
      const list = grid.get(k) ?? [];
      list.push([ax, az, bx, bz, s.width, id]);
      grid.set(k, list);
    }
  };
  /** Is (x, z) within r of the edge of any street (other than `skip`)? */
  const near = (x: number, z: number, r: number, skip = -1) => {
    const reach = Math.ceil((r + 20) / CELL);
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const [ax, az, bx, bz, w, id] of grid.get(key(i, j)) ?? []) {
          if (id === skip) continue;
          const dx = bx - ax;
          const dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) - w / 2 < r) return true;
        }
    return false;
  };
  const add = (s: Street) => {
    streets.push(s);
    addToGrid(s, streets.length - 1);
  };

  // Curved avenues from the centre to the edge of town.
  const SPOKES = 7;
  for (let k = 0; k < SPOKES; k++) {
    const a0 = (k / SPOKES) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const bend = (rng() - 0.5) * 1.1;
    const pts: [number, number][] = [];
    for (let t = 0.03; t <= 1.001; t += 0.015) {
      const a = a0 + bend * Math.sin(t * Math.PI * 0.85);
      pts.push([Math.cos(a) * R * t, Math.sin(a) * R * t]);
    }
    add({ pts, width: 16, lines: true });
  }
  // Wobbly ring roads.
  for (const [r, w] of [
    [330, 14],
    [720, 14],
    [1050, 12],
  ]) {
    const ph = rng() * 6;
    const pts: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.015) {
      const rr = r * (1 + 0.08 * Math.sin(3 * a + ph) + 0.05 * Math.sin(5 * a + ph * 2));
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    add({ pts, width: w, lines: true });
  }
  // Winding side streets: they leave a bigger street at an angle, wander, and stop when they meet
  // another street or reach the edge of town.
  for (let n = 0; n < 120; n++) {
    const from = streets[Math.floor(rng() * streets.length)];
    const i = 1 + Math.floor(rng() * (from.pts.length - 2));
    const [px, pz] = from.pts[i];
    const tx = from.pts[i + 1][0] - from.pts[i - 1][0];
    const tz = from.pts[i + 1][1] - from.pts[i - 1][1];
    // Leave the bigger street in a smooth curve: start nearly along it, then swing away.
    const side = rng() < 0.5 ? 1 : -1;
    const along = Math.atan2(tz, tx) + (rng() < 0.5 ? 0 : Math.PI);
    const target = along + side * (Math.PI / 2 + (rng() - 0.5) * 0.8) * (rng() < 0.5 ? 1 : 0.6);
    let heading = along + side * 0.35;
    let x = px + Math.cos(along + (side * Math.PI) / 2) * (from.width / 2 - 1);
    let z = pz + Math.sin(along + (side * Math.PI) / 2) * (from.width / 2 - 1);
    const id = streets.length;
    const pts: [number, number][] = [[px, pz]];
    const length = 90 + rng() * 300;
    let turn = (rng() - 0.5) * 0.02;
    let ok = true;
    for (let s = 0; s < length; s += 6) {
      if (rng() < 0.04) turn = (rng() - 0.5) * 0.06;
      // Ease round onto the new heading over the first ~40 m.
      if (s < 48) heading += (target - heading) * 0.16;
      heading += turn + (rng() - 0.5) * 0.03;
      x += Math.cos(heading) * 6;
      z += Math.sin(heading) * 6;
      pts.push([x, z]);
      if (Math.hypot(x, z) > R - 12) break;
      // Joined another street: end here (a junction).
      if (s > 48 && near(x, z, 2, id)) break;
      // Too close alongside another street without meeting it: drop this one.
      if (s > 30 && s <= 48 && near(x, z, 9, id)) {
        ok = false;
        break;
      }
    }
    if (ok && pts.length > 6) add({ pts, width: 12, lines: true });
  }

  // Ribbons: asphalt, pavements (broken at junctions) and centre dashes.
  const asphalt = new GeometryBuilder();
  const walk = new GeometryBuilder();
  const paint = new GeometryBuilder();
  streets.forEach((s, id) => {
    const P = s.pts;
    const normalAt = (i: number): [number, number] => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    };
    const y = s.lines ? 0.06 : 0.05;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const [nax, naz] = normalAt(i);
      const [nbx, nbz] = normalAt(i + 1);
      const strip = (b: GeometryBuilder, o0: number, o1: number, yy: number) =>
        b.quad([ax + nax * o1, yy, az + naz * o1], [bx + nbx * o1, yy, bz + nbz * o1], [bx + nbx * o0, yy, bz + nbz * o0], [ax + nax * o0, yy, az + naz * o0]);
      const hw = s.width / 2;
      strip(asphalt, -hw, hw, y);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const junction = near(mx, mz, 2.5, id);
      if (!junction) {
        for (const side of [-1, 1]) {
          const sx = mx + ((nax + nbx) / 2) * side * (hw + 1.5);
          const sz = mz + ((naz + nbz) / 2) * side * (hw + 1.5);
          if (!near(sx, sz, 1, id)) strip(walk, side > 0 ? hw : -hw - 2.4, side > 0 ? hw + 2.4 : -hw, 0.12);
        }
        if (s.lines && i % 2 === 0) strip(paint, -0.12, 0.12, y + 0.02);
      }
    }
  });
  const mesh = new THREE.Group();
  mesh.add(new THREE.Mesh(asphalt.build(), new THREE.MeshStandardMaterial({ color: 0x45464b, roughness: 0.85 })));
  mesh.add(new THREE.Mesh(walk.build(), new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.95 })));
  mesh.add(new THREE.Mesh(paint.build(), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 })));
  return { mesh, near: (x: number, z: number, r: number) => near(x, z, r), streets, spokes: streets.slice(0, 7) };
}

/** Free drive: smooth slip roads from the ends of the avenues onto the ring road. */
function connectorRoads(spokes: Street[], track: TrackPath): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (const sp of spokes) {
    const [ex, ez] = sp.pts[sp.pts.length - 1];
    const [px, pz] = sp.pts[sp.pts.length - 4];
    const ol = Math.hypot(ex - px, ez - pz);
    const ox = (ex - px) / ol;
    const oz = (ez - pz) / ol;
    // Where it meets the ring road: the nearest point ahead.
    let best = track.samples[0];
    let bestScore = Infinity;
    for (const s of track.samples) {
      const dx = s.x - ex;
      const dz = s.z - ez;
      const d = Math.hypot(dx, dz);
      const ahead = (dx * ox + dz * oz) / (d || 1);
      const score = d * (2 - ahead);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    // Join the ring road in its direction of travel (whichever way is the gentler turn).
    const dir = best.tx * ox + best.tz * oz >= 0 ? 1 : -1;
    const tx = best.tx * dir;
    const tz = best.tz * dir;
    const L = Math.hypot(best.x - ex, best.z - ez) * 0.5;
    const pts: [number, number, number][] = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t * t;
      const d = t ** 3;
      const x = a * ex + b * (ex + ox * L) + c * (best.x - tx * L) + d * best.x;
      const z = a * ez + b * (ez + oz * L) + c * (best.z - tz * L) + d * best.z;
      // Climb smoothly to the ring road's height.
      const y = best.y * (t * t * (3 - 2 * t));
      pts.push([x, y, z]);
    }
    out.push(pts);
  }
  return out;
}

function connectorMesh(roads: [number, number, number][][]): THREE.Group {
  const asphalt = new GeometryBuilder();
  const paint = new GeometryBuilder();
  for (const P of roads) {
    for (let i = 0; i + 1 < P.length; i++) {
      const n = (k: number): [number, number] => {
        const a = P[Math.max(0, k - 1)];
        const b = P[Math.min(P.length - 1, k + 1)];
        const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
        return [-(b[2] - a[2]) / l, (b[0] - a[0]) / l];
      };
      const [ax, ay, az] = P[i];
      const [bx, by, bz] = P[i + 1];
      const [nax, naz] = n(i);
      const [nbx, nbz] = n(i + 1);
      const strip = (b: GeometryBuilder, o0: number, o1: number, lift: number) =>
        b.quad(
          [ax + nax * o1, ay + lift, az + naz * o1],
          [bx + nbx * o1, by + lift, bz + nbz * o1],
          [bx + nbx * o0, by + lift, bz + nbz * o0],
          [ax + nax * o0, ay + lift, az + naz * o0],
        );
      strip(asphalt, -7, 7, 0.06);
      if (i % 2 === 0) strip(paint, -0.12, 0.12, 0.08);
      for (const e of [-6.6, 6.4]) strip(paint, e, e + 0.2, 0.08);
    }
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(asphalt.build(), new THREE.MeshStandardMaterial({ color: 0x45464b, roughness: 0.85 })));
  g.add(new THREE.Mesh(paint.build(), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 })));
  return g;
}
