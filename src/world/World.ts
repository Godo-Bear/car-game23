import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { RacingLine } from '../ai/RacingLine';
import { createRng } from '../core/math';
import type { PickupKind } from '../race/Pickups';
import { gridSlot } from '../race/RaceSimulation';
import { BARRIER_THICKNESS, buildRubberLine, buildTrackVisual, SIDEWALK_WIDTH, type TrackVisual } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import type { TrackDef } from '../track/tracks';
import { City, type CityScene, type Footprint, placeLamps } from './City';
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
  /** Buildings, landmarks, houses and tree trunks. */
  obstacles: Footprint[];
  /** In the middle of town, on an avenue. */
  spawn: { x: number; z: number; heading: number };
  /** Drivable square: |x - cx| and |z - cz| up to `half`. */
  bounds: { cx: number; cz: number; half: number };
  /** Every road on the map (for the map picture and for teleporting onto a road). */
  roads: FreeRoad[];
  /** Nitro bottles along the town's avenues and ring streets and on the slip roads. */
  pickups: { x: number; y: number; z: number; kind: PickupKind }[];
  /** The nearest place on a road to (x, z), heading along it. */
  roadNear(x: number, z: number): { x: number; z: number; heading: number };
  /** `look` metres on along the road under (x, z), going in direction (dx, dz); null off the roads. */
  roadAhead(x: number, z: number, dx: number, dz: number, look: number): { x: number; z: number } | null;
}

export interface FreeRoad {
  kind: 'ring' | 'street' | 'slip' | 'trail';
  pts: [number, number][];
  width: number;
}

/** Road between the nitro bottles in town (m), and every how many is a gold one. */
const TOWN_PICKUP_SPACING = 170;

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
  const streets = scene.kind === 'rural' && scene.cityRadius && scene.city ? streetNetwork(scene.cityRadius, createRng(77), landmarkGrounds(scene.city)) : null;
  const connectors = streets ? connectorRoads(streets.spokes, track) : [];
  const nature = new NatureWorld({ ...scene, connectors }, track, rng, detail, grass);
  group.add(trackVisual.group, nature.group);
  if (connectors.length) group.add(connectorMesh(connectors));
  let city: City | null = null;
  let freeRoam: FreeRoamMap | undefined;
  if (streets && scene.city && scene.cityRadius) {
    const R = scene.cityRadius;
    city = new City(track, [], rng, scene.city, (x, z, r) => Math.hypot(x, z) > R - 8 - r || streets.near(x, z, r + 3));
    group.add(city.group, streets.mesh);
    // Start on the first avenue, a little way out from the centre, heading out of town.
    const avenue = streets.spokes[0].pts;
    const [sx, sz] = avenue[6];
    const [nx, nz] = avenue[7];
    const roads: FreeRoad[] = [
      { kind: 'ring', pts: track.samples.map((p) => [p.x, p.z]), width: track.halfWidth * 2 },
      ...streets.streets.map((st): FreeRoad => ({ kind: 'street', pts: st.pts, width: st.width })),
      ...connectors.map((P): FreeRoad => ({ kind: 'slip', pts: P.map(([x, , z]) => [x, z]), width: 14 })),
      ...(scene.trails ?? []).map((P): FreeRoad => ({ kind: 'trail', pts: P, width: 8 })),
    ];
    const index = new RoadIndex(roads);
    freeRoam = {
      surfaceAt(x, z) {
        // Slip roads are laid a little above the ground shaped to them; streets sit on the flat
        // basin; everywhere else, the ground exactly as it's drawn.
        const c = nature.connectorAt(x, z);
        if (c && c.d < 7.5) return c.y + 0.06;
        return Math.max(nature.meshHeightAt(x, z), Math.hypot(x, z) < R ? 0.06 : -Infinity);
      },
      obstacles: [...city.footprints, ...nature.solids, ...nature.trees],
      spawn: { x: sx, z: sz, heading: Math.atan2(nx - sx, nz - sz) },
      bounds: { ...nature.extent, half: nature.extent.half - 260 },
      roads,
      pickups: townPickups(streets.streets, connectors),
      roadNear: (x, z) => roadNear(roads, x, z),
      roadAhead: (x, z, dx, dz, look) => index.ahead(x, z, dx, dz, look),
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

/** The ground the free drive city's landmarks stand on (streets go round them). */
function landmarkGrounds(c: CityScene): { x: number; z: number; r: number }[] {
  return [
    { ...c.tower, r: 52 },
    ...(c.castle ? [{ ...c.castle, r: 66 }] : []),
    ...(c.ferrisWheel ? [{ ...c.ferrisWheel, r: c.ferrisWheel.radius + 12 }] : []),
    ...(c.supertall ? [{ ...c.supertall, r: 56 }] : []),
    ...(c.skytree ? [{ ...c.skytree, r: 34 }] : []),
  ];
}

/** Nitro bottles every so often along the avenues and ring streets (weaving across the lanes) and on the slip roads. */
function townPickups(streets: Street[], connectors: [number, number, number][][]): FreeRoamMap['pickups'] {
  const out: FreeRoamMap['pickups'] = [];
  const lanes = [-3, 0, 3, 0];
  let k = 0;
  const along = (P: [number, number, number][], spacing: number, start: number) => {
    let next = start;
    let run = 0;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay, az] = P[i];
      const [bx, by, bz] = P[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      while (run + len >= next) {
        const t = (next - run) / (len || 1);
        const lat = lanes[k % lanes.length];
        out.push({
          x: ax + (bx - ax) * t - ((bz - az) / (len || 1)) * lat,
          y: ay + (by - ay) * t + 0.06,
          z: az + (bz - az) * t + ((bx - ax) / (len || 1)) * lat,
          kind: (k + 1) % 5 === 0 ? 'super' : 'nitro',
        });
        k++;
        next += spacing;
      }
      run += len;
    }
  };
  // The avenues and ring streets (the side streets are too twisty to weave along).
  for (const st of streets.filter((s) => s.width >= 14))
    along(
      st.pts.map(([x, z]) => [x, 0, z]),
      TOWN_PICKUP_SPACING,
      60,
    );
  for (const P of connectors) along(P, 1e9, 120);
  return out;
}

/** The nearest point on any road to (x, z), heading along the road. */
function roadNear(roads: FreeRoad[], x: number, z: number): { x: number; z: number; heading: number } {
  // A proper road, unless you picked a spot right on a dirt trail (they climb steep hillsides).
  const paved = nearestOn(
    roads.filter((r) => r.kind !== 'trail'),
    x,
    z,
  );
  const trail = nearestOn(
    roads.filter((r) => r.kind === 'trail'),
    x,
    z,
  );
  return trail.d < 40 && trail.d < paved.d ? trail : paved;
}

function nearestOn(roads: FreeRoad[], x: number, z: number): { x: number; z: number; heading: number; d: number } {
  let best = { x, z, heading: 0, d: Infinity };
  let bestD = Infinity;
  for (const road of roads) {
    const P = road.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz, heading: Math.atan2(dx, dz), d: Math.sqrt(d) };
      }
    }
  }
  return best;
}

/** The free drive roads' segments on a grid, for finding the road under a car quickly. */
class RoadIndex {
  private static readonly CELL = 40;
  private readonly grid = new Map<number, number[]>();

  constructor(private readonly roads: FreeRoad[]) {
    const C = RoadIndex.CELL;
    roads.forEach((road, r) => {
      const P = road.pts;
      for (let i = 0; i + 1 < P.length; i++) {
        const pad = road.width / 2;
        for (let gx = Math.floor((Math.min(P[i][0], P[i + 1][0]) - pad) / C); gx <= Math.floor((Math.max(P[i][0], P[i + 1][0]) + pad) / C); gx++) {
          for (let gz = Math.floor((Math.min(P[i][1], P[i + 1][1]) - pad) / C); gz <= Math.floor((Math.max(P[i][1], P[i + 1][1]) + pad) / C); gz++) {
            const key = gx * 65536 + gz;
            const list = this.grid.get(key);
            // Road and segment packed together.
            if (list) list.push(r * 1e6 + i);
            else this.grid.set(key, [r * 1e6 + i]);
          }
        }
      }
    });
  }

  ahead(x: number, z: number, dx: number, dz: number, look: number): { x: number; z: number } | null {
    const C = RoadIndex.CELL;
    let best = -1;
    let bestT = 0;
    let bestD = Infinity;
    for (const id of this.grid.get(Math.floor(x / C) * 65536 + Math.floor(z / C)) ?? []) {
      const road = this.roads[Math.floor(id / 1e6)];
      const i = id % 1e6;
      const [ax, az] = road.pts[i];
      const [bx, bz] = road.pts[i + 1];
      const sx = bx - ax;
      const sz = bz - az;
      const t = clamp01(((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1));
      // Distance beyond the road's edge.
      const d = Math.hypot(x - ax - sx * t, z - az - sz * t) - road.width / 2;
      if (d < 3 && d < bestD) {
        bestD = d;
        best = id;
        bestT = t;
      }
    }
    if (best < 0) return null;
    const P = this.roads[Math.floor(best / 1e6)].pts;
    const loop = Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 30;
    let i = best % 1e6;
    // Walk along the road, whichever way the car is going.
    const step = (P[i + 1][0] - P[i][0]) * dx + (P[i + 1][1] - P[i][1]) * dz >= 0 ? 1 : -1;
    let px = P[i][0] + (P[i + 1][0] - P[i][0]) * bestT;
    let pz = P[i][1] + (P[i + 1][1] - P[i][1]) * bestT;
    let left = look;
    let next = step > 0 ? i + 1 : i;
    while (left > 0) {
      const [nx, nz] = P[next];
      const seg = Math.hypot(nx - px, nz - pz);
      if (seg >= left) {
        px += ((nx - px) / seg) * left;
        pz += ((nz - pz) / seg) * left;
        break;
      }
      left -= seg;
      px = nx;
      pz = nz;
      i = next + step;
      if (i < 0 || i >= P.length) {
        if (!loop) break;
        i = (i + P.length) % P.length;
      }
      next = i;
    }
    return { x: px, z: pz };
  }
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

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

export function streetNetwork(R: number, rng: () => number, reserved: { x: number; z: number; r: number }[] = []) {
  const streets: Street[] = [];
  /** Inside a landmark's ground (no street may cross it)? */
  const inLandmark = (x: number, z: number, margin = 0) => reserved.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + margin);
  /** Bend a street round the landmarks in its way. */
  const skirt = (pts: [number, number][]) => {
    for (const p of pts) {
      for (const l of reserved) {
        const dx = p[0] - l.x;
        const dz = p[1] - l.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < l.r) {
          p[0] = l.x + (dx / d) * l.r;
          p[1] = l.z + (dz / d) * l.r;
        }
      }
    }
    return pts;
  };
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
  const near = (x: number, z: number, r: number, skip = -1, only = -1) => {
    const reach = Math.ceil((r + 20) / CELL);
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const [ax, az, bx, bz, w, id] of grid.get(key(i, j)) ?? []) {
          if (id === skip || (only >= 0 && id !== only)) continue;
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
    add({ pts: skirt(pts), width: 16, lines: true });
  }
  // A roundabout where the avenues meet in the middle of town.
  add({
    pts: Array.from({ length: 64 }, (_, i): [number, number] => [Math.cos((i / 63) * Math.PI * 2) * 38, Math.sin((i / 63) * Math.PI * 2) * 38]),
    width: 14,
    lines: true,
  });
  // Wobbly ring roads (their radius at any angle is known, so the local streets can meet them).
  const RINGS: [number, number][] = [
    [330, 14],
    [720, 14],
    [1050, 12],
  ];
  const phases: number[] = [];
  const ringAt = (k: number, a: number) => RINGS[k][0] * (1 + 0.08 * Math.sin(3 * a + phases[k]) + 0.05 * Math.sin(5 * a + phases[k] * 2));
  RINGS.forEach(([, w], k) => {
    phases.push(rng() * 6);
    const pts: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.015) {
      const rr = ringAt(k, a);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    add({ pts: skirt(pts), width: w, lines: true });
  });
  const arterials = streets.length;
  /** Inside the band between ring k - 1 and ring k (the middle of town for k = 0)? */
  const inBand = (k: number, x: number, z: number) => {
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    return r < ringAt(k, a) && (k === 0 || r > ringAt(k - 1, a));
  };
  /** Near (within `r` of the edge of) one of the avenues or ring roads? */
  const nearArterial = (x: number, z: number, r: number) => {
    for (let id = 0; id < arterials; id++) if (near(x, z, r, -1, id)) return true;
    return false;
  };

  // Local streets: in each band between the ring roads, a gently curving grid (each band at its
  // own angle, like the districts of a real city). Every street runs from ring road to ring road,
  // crossing the avenues on the way, so they all join up: no dead ends.
  RINGS.forEach((_, k) => {
    const spacing = k === 0 ? 120 : 165;
    const angle = rng() * Math.PI;
    const outer = RINGS[k][0] * 1.15;
    for (const turn of [0, Math.PI / 2]) {
      const dx = Math.cos(angle + turn);
      const dz = Math.sin(angle + turn);
      const shift = rng() * spacing;
      for (let c = -outer + shift; c < outer; c += spacing) {
        // A long, slow curve along the line (different on each).
        const bend = 10 + rng() * 14;
        const wave = 260 + rng() * 260;
        const ph = rng() * 6;
        const at = (t: number): [number, number] => {
          const off = c + Math.sin(t / wave + ph) * bend;
          return [-dz * off + dx * t, dx * off + dz * t];
        };
        let run: [number, number][] = [];
        let prev: [number, number] | null = null;
        let prevIn = false;
        let close = 0;
        const finish = () => {
          if (run.length > 1) addLocal(run);
          run = [];
        };
        for (let t = -outer; t <= outer; t += 6) {
          const p = at(t);
          const inside = inBand(k, p[0], p[1]);
          if (inside && !prevIn && prev) run.push(edgePoint(k, prev, p, true));
          if (inside) {
            // Running alongside an avenue for a while (not just crossing it): no street there.
            close = nearArterial(p[0], p[1], 4) ? close + 1 : 0;
            if (close > 10) finish();
            else run.push(p);
          }
          if (!inside && prevIn && prev) {
            run.push(edgePoint(k, prev, p, false));
            finish();
          }
          prev = p;
          prevIn = inside;
        }
        finish();
      }
    }
  });

  /** Where the line from `a` to `b` crosses the edge of band k (the ring road's centre line). */
  function edgePoint(k: number, a: [number, number], b: [number, number], entering: boolean): [number, number] {
    let lo = a;
    let hi = b;
    for (let i = 0; i < 12; i++) {
      const m: [number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (inBand(k, m[0], m[1]) === entering) hi = m;
      else lo = m;
    }
    return hi;
  }

  /** Add a local street, unless it's a sliver hugging a ring road or too short to matter. */
  function addLocal(run: [number, number][]): void {
    const length = run.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]) : 0), 0);
    if (length < 60) return;
    // Every point within 30 m of a ring road: it's squeezed between the ring and the band edge.
    if (run.every(([x, z]) => nearArterial(x, z, 30))) return;
    if (run.some(([x, z]) => inLandmark(x, z, 6))) {
      // Round the landmark, smoothly.
      skirt(run);
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i + 1 < run.length; i++) {
          run[i] = [(run[i - 1][0] + run[i][0] * 2 + run[i + 1][0]) / 4, (run[i - 1][1] + run[i][1] * 2 + run[i + 1][1]) / 4];
        }
        skirt(run);
      }
    }
    add({ pts: run, width: 12, lines: true });
  }

  // Ribbons, marked like Japanese roads:
  // - avenues and ring roads (14 m and up): a yellow double centre line (no overtaking), dashed
  //   lane lines on the avenues, solid white edge lines;
  // - local streets: a dashed white centre line and edge lines;
  // - at every junction the paint stops, with a zebra crossing on each road into it;
  // - pavements with kerbs, broken at the junctions.
  // The bigger roads sit a few millimetres higher, so where two cross the bigger one is drawn
  // cleanly on top instead of flickering.
  const asphalt = new GeometryBuilder();
  const walk = new GeometryBuilder();
  const paint = new GeometryBuilder();
  const yellow = new GeometryBuilder();
  streets.forEach((s, id) => {
    const P = s.pts;
    const major = s.width >= 14;
    const avenue = s.width >= 16;
    const normalAt = (i: number): [number, number] => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    };
    const y = avenue ? 0.08 : major ? 0.07 : 0.06;
    const hw = s.width / 2;
    // Which segments are in a junction (inside another street).
    const junction = P.slice(1).map((b, i) => near((P[i][0] + b[0]) / 2, (P[i][1] + b[1]) / 2, 3, id));
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const [nax, naz] = normalAt(i);
      const [nbx, nbz] = normalAt(i + 1);
      const strip = (b: GeometryBuilder, o0: number, o1: number, yy: number) =>
        b.quad([ax + nax * o1, yy, az + naz * o1], [bx + nbx * o1, yy, bz + nbz * o1], [bx + nbx * o0, yy, bz + nbz * o0], [ax + nax * o0, yy, az + naz * o0]);
      strip(asphalt, -hw, hw, y);
      if (junction[i]) continue;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      // Pavements and the kerb's face, where they don't run into another street.
      for (const side of [-1, 1]) {
        const sx = mx + ((nax + nbx) / 2) * side * (hw + 1.5);
        const sz = mz + ((naz + nbz) / 2) * side * (hw + 1.5);
        if (near(sx, sz, 1, id)) continue;
        strip(walk, side > 0 ? hw : -hw - 2.4, side > 0 ? hw + 2.4 : -hw, 0.14);
        const e = side * hw;
        // (The pavement material is two-sided, so the kerb shows from the road either side.)
        walk.quad([ax + nax * e, y, az + naz * e], [bx + nbx * e, y, bz + nbz * e], [bx + nbx * e, 0.14, bz + nbz * e], [ax + nax * e, 0.14, az + naz * e]);
      }
      const py = y + 0.015;
      // Edge lines.
      for (const side of [-1, 1]) strip(paint, side * (hw - 0.55), side * (hw - 0.4), py);
      if (major) {
        strip(yellow, -0.3, -0.15, py);
        strip(yellow, 0.15, 0.3, py);
        if (avenue && i % 2 === 0) for (const side of [-1, 1]) strip(paint, side * 3.9 - 0.075, side * 3.9 + 0.075, py);
      } else if (i % 2 === 0) {
        strip(paint, -0.075, 0.075, py);
      }
      // Into or out of a junction: a zebra crossing across the road at this end.
      const into = junction[i + 1] === true;
      const outOf = i > 0 && junction[i - 1] === true;
      if (into || outOf) {
        const [cx, cz] = into ? [bx, bz] : [ax, az];
        const tl = Math.hypot(bx - ax, bz - az) || 1;
        const tx = ((bx - ax) / tl) * (into ? -1 : 1);
        const tz = ((bz - az) / tl) * (into ? -1 : 1);
        const [nx, nz] = into ? [nbx, nbz] : [nax, naz];
        // Stripes along the road, 0.45 m wide, from 1 to 4 m back from the junction.
        for (let o = -hw + 1; o + 0.45 <= hw - 1; o += 0.9) {
          const p = (along: number, off: number): [number, number, number] => [cx + tx * along + nx * off, py + 0.003, cz + tz * along + nz * off];
          paint.quad(p(1, o), p(1, o + 0.45), p(4, o + 0.45), p(4, o));
        }
      }
    }
  });
  const mesh = new THREE.Group();
  mesh.add(new THREE.Mesh(asphalt.build(), new THREE.MeshStandardMaterial({ color: 0x45464b, roughness: 0.85 })));
  mesh.add(new THREE.Mesh(walk.build(), new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.95, side: THREE.DoubleSide })));
  mesh.add(new THREE.Mesh(paint.build(), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 })));
  mesh.add(new THREE.Mesh(yellow.build(), new THREE.MeshStandardMaterial({ color: 0xe8b828, roughness: 0.6 })));
  return { mesh, near: (x: number, z: number, r: number) => near(x, z, r), streets, spokes: streets.slice(0, SPOKES) };
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
