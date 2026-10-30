import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import { lerp, smoothstep } from '../core/math';
import type { TrackPath } from '../track/TrackPath';
import type { TrackTheme } from '../track/tracks';
import { bamboo, broadleaf, bush, cedar, contactShadowMaterial, maple, pine, sakura, sugi, swayMaterial, type TreeShape } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';
import { GrassField, type GrassStyle, type GroundField } from './Grass';
import {
  curveMirrors,
  type Feature,
  type HouseSpot,
  japaneseHouses,
  koinobori,
  latticeSlopes,
  MountFuji,
  type Paddy,
  powerLines,
  Railway,
  Ropeway,
  ricePaddies,
  type Spot,
  vendingMachines,
} from './japan';
import { SUN_DIRECTION } from './Lighting';
import { type PropId, propAspect, propModel, tokyoTowerMesh, woodenSign } from './sceneryModels';
import { concreteNormalMap, groundMaterial, waterNormalMap } from './surfaces';
import { glowTexture } from './textures';

/**
 * Procedural Japanese countryside and mountains around a circuit: terrain that the road sits
 * in, lakes, cedar forests with autumn maples or cherry-blossom avenues with pines and bamboo,
 * falling petals and landmarks. Vegetation sways in the wind and sits on soft contact shadows.
 */

export type RuralTheme = Exclude<TrackTheme, 'city'>;

/** Vegetation mixes: what grows along the road and on the hills. */
export type Vegetation = 'cedar' | 'autumn' | 'snow' | 'blossom' | 'bamboo' | 'coast';

/** Everything that makes one countryside or mountain map its own. */
export interface RuralScene {
  theme: RuralTheme;
  terrain: ThemeConfig;
  vegetation: Vegetation;
  /** Model files the map places (loaded before it is built). */
  props: PropId[];
  /** Roadside signs: Japanese name, English underneath. */
  signs: string[][];
  /** A giant tree on the first level verge after the start. */
  startTree?: { id: PropId; height: number };
  /** A landmark on the lowest, flattest dry spot of the lake shore (or sea shore). */
  shoreLandmark?: { id: PropId | 'lighthouse'; height: number };
  /** Sakura Valley's pagoda on the lake shore. */
  pagoda?: boolean;
  /** A torii gate standing in the lake. */
  torii?: boolean;
  /** A ryokan and its neighbours around this spot. */
  ryokan?: [number, number];
  /** Number of farming villages near the road. */
  villages?: number;
  koinobori?: boolean;
  paddies?: boolean;
  ropeway?: [[number, number], [number, number]];
  /** A railway viaduct crossing the map east-west at this z. */
  rail?: { z: number; kind: 'commuter' | 'shinkansen'; deckY: number };
  /** Lap distances of the roadside vending machines. */
  machines: number[];
  /** Stone lanterns along the start straight. */
  lanterns?: boolean;
  /** Red-and-white arrow poles marking the road edges for the snowploughs (Hokkaido). */
  snowPoles?: boolean;
  particles?: ParticleKind;
  /** Grass tufts (null: none, e.g. under snow). */
  grass: GrassStyle | null;
  /** Vegetation multiplier (big maps). */
  density?: number;
  /** Off-road dirt trails (x, z polylines): bare ground you can drive in free drive. */
  trails?: [number, number][][];
  /** Free drive: a city in the middle of the map (no trees or villages inside this radius). */
  cityRadius?: number;
  city?: import('./City').CityScene;
  /** Free drive: slip roads (x, y, z polylines) the ground is shaped to. */
  connectors?: [number, number, number][][];
}

// ---------------------------------------------------------------- noise// ---------------------------------------------------------------- noise

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = x - xi;
  const tz = z - zi;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz) * 2 - 1;
}

/** Fractal noise in roughly [-1, 1]. */
export function fbm(x: number, z: number, seed = 1, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, z * freq, seed + o * 17) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

// ---------------------------------------------------------------- polylines

/** x, z and a height. */
type Point3 = [number, number, number];

/**
 * Polylines (slip roads, dirt trails) cut into short pieces on a grid, for "how far is the
 * nearest one, and how high is it there" queries at terrain-building speed.
 */
class SegmentIndex {
  private readonly cell = 32;
  private readonly buckets = new Map<number, [number, number, number, number, number, number][]>();

  constructor(lines: Point3[][]) {
    for (const P of lines) {
      for (let i = 0; i + 1 < P.length; i++) {
        const [ax, az, ay] = P[i];
        const [bx, bz, by] = P[i + 1];
        const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 16));
        for (let k = 0; k < pieces; k++) {
          const t0 = k / pieces;
          const t1 = (k + 1) / pieces;
          const seg: [number, number, number, number, number, number] = [
            ax + (bx - ax) * t0,
            az + (bz - az) * t0,
            ay + (by - ay) * t0,
            ax + (bx - ax) * t1,
            az + (bz - az) * t1,
            ay + (by - ay) * t1,
          ];
          const key = this.key(Math.floor((seg[0] + seg[3]) / 2 / this.cell), Math.floor((seg[1] + seg[4]) / 2 / this.cell));
          const list = this.buckets.get(key);
          if (list) list.push(seg);
          else this.buckets.set(key, [seg]);
        }
      }
    }
  }

  private key(i: number, j: number): number {
    return i * 131072 + j;
  }

  /** Nearest piece within `reach` metres: its distance and height there. */
  nearest(x: number, z: number, reach: number): { d: number; y: number } | null {
    const r = Math.ceil((reach + 8) / this.cell);
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    let bestD = reach;
    let bestY = 0;
    let found = false;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (const [ax, az, ay, bx, bz, by] of this.buckets.get(this.key(i, j)) ?? []) {
          const dx = bx - ax;
          const dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < bestD) {
            bestD = d;
            bestY = ay + (by - ay) * t;
            found = true;
          }
        }
      }
    }
    return found ? { d: bestD, y: bestY } : null;
  }
}

// ---------------------------------------------------------------- road proximity field

interface FieldResult {
  /** Distance to the nearest road centre-line sample. */
  d: number;
  /** Road height there. */
  y: number;
  /** Smooth inverse-distance blend of nearby road heights (no cliffs between switchbacks). */
  field: number;
}

class RoadField {
  private readonly cell = 32;
  private readonly buckets = new Map<number, number[]>();
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  private readonly ys: Float64Array;
  private readonly out: FieldResult = { d: 0, y: 0, field: 0 };

  constructor(track: TrackPath) {
    const pts = track.samples.filter((_, i) => i % 2 === 0);
    this.xs = new Float64Array(pts.map((s) => s.x));
    this.zs = new Float64Array(pts.map((s) => s.z));
    // The ground under the road (a bridge's ground is down at the road it crosses).
    this.ys = new Float64Array(pts.map((s) => s.y - s.bridge));
    pts.forEach((s, i) => {
      const key = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
    });
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  query(x: number, z: number): FieldResult {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    let bestY = 0;
    let wSum = 0;
    let ySum = 0;
    const r = 5; // 160 m search radius
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const list = this.buckets.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const k of list) {
          const d2 = (this.xs[k] - x) ** 2 + (this.zs[k] - z) ** 2;
          if (d2 < best) {
            best = d2;
            bestY = this.ys[k];
          }
          const w = 1 / (d2 + 400);
          wSum += w;
          ySum += w * this.ys[k];
        }
      }
    }
    if (!Number.isFinite(best)) {
      // Nothing within the search radius: fall back to an exact (coarser) scan so the distance
      // stays continuous - a jump here would put a cliff in the terrain.
      for (let k = 0; k < this.xs.length; k += 2) {
        const d2 = (this.xs[k] - x) ** 2 + (this.zs[k] - z) ** 2;
        if (d2 < best) {
          best = d2;
          bestY = this.ys[k];
        }
      }
    }
    const o = this.out;
    o.d = Math.sqrt(best);
    o.y = bestY;
    o.field = wSum > 0 ? ySum / wSum : bestY;
    return o;
  }
}

// ---------------------------------------------------------------- theme config

interface Ellipse {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface ThemeConfig {
  seed: number;
  waterLevel: number;
  lake: Ellipse;
  /** Natural terrain offset (added to the road-following height field) at distance `d` from the road. */
  natural(x: number, z: number, d: number): number;
  color(h: number, slope: number, x: number, z: number, d: number, out: THREE.Color): void;
  waterColor: number;
  /** A frozen lake: pale, matt ice instead of water. */
  ice?: boolean;
  /** The big snow-capped volcano on the horizon (Fuji, or a local one), if any. */
  fujiAt: [number, number] | null;
  ground: 'rocky' | 'meadow';
  farColor: number;
  ridgeColor: number;
  ridgeHeight: number;
  /** Slope range over which grass gives way to rock. */
  rockSlope: [number, number];
  /** How much of the ground grows grass. */
  grassCover: number;
  /** Beaches (no grass) up to this height above the water. */
  sandLine: number;
}

const C = (hex: number) => new THREE.Color(hex);
const DIRT = new THREE.Color(0x6e5232);

interface TerrainOptions {
  seed: number;
  lake: Ellipse;
  fujiAt: [number, number] | null;
  waterLevel?: number;
  waterColor?: number;
}

/** Steep, forested mountains rising away from the pass (green, or the reds and golds of autumn). */
export function mountainTerrain(o: TerrainOptions & { autumn?: boolean }): ThemeConfig {
  const { seed } = o;
  const [low, high] = o.autumn ? [0x46421f, 0x7a6230] : [0x2f4a26, 0x56702f];
  return {
    seed,
    waterLevel: o.waterLevel ?? -2.5,
    lake: o.lake,
    natural(x, z, d) {
      const hills = fbm(x / 380, z / 380, seed) * 40 + fbm(x / 110, z / 110, seed + 12) * 10;
      // Mountains rise steeply away from the pass.
      const rise = smoothstep(60, 650, d) * (150 + fbm(x / 600, z / 600, seed - 6) * 110);
      return hills + rise;
    },
    color(h, slope, x, z, d, out) {
      const n = fbm(x / 60, z / 60, seed - 8) * 0.5 + 0.5;
      out.copy(C(low)).lerp(C(high), n);
      if (slope > 0.55) out.lerp(C(0x6c6a63), smoothstep(0.55, 0.95, slope));
      if (h > 170) out.lerp(C(0xe6edf3), smoothstep(170, 230, h));
      if (h < this.waterLevel + 1.2) out.copy(C(0x8a7d62));
      if (d < 9) out.lerp(C(0x6b6455), smoothstep(9, 6, d));
    },
    waterColor: o.waterColor ?? 0x1d3a3e,
    fujiAt: o.fujiAt,
    ground: 'rocky',
    farColor: low,
    ridgeColor: o.autumn ? 0x4f4a36 : 0x3b5242,
    ridgeHeight: 380,
    rockSlope: [0.42, 0.75],
    grassCover: 0.8,
    sandLine: 1.2,
  };
}

/** Mountains under deep snow: white slopes, grey rock faces, slush at the roadside, a frozen lake. */
export function snowTerrain(o: TerrainOptions): ThemeConfig {
  const base = mountainTerrain(o);
  const { seed } = o;
  return {
    ...base,
    color(h, slope, x, z, d, out) {
      const n = fbm(x / 70, z / 70, seed - 8) * 0.5 + 0.5;
      out.copy(C(0xd9e2ea)).lerp(C(0xf4f7fa), n);
      // Bare rock on the steep mountainsides (the lake shore stays under snow).
      if (slope > 0.6) out.lerp(C(0x5f6166), smoothstep(0.6, 1.05, slope) * 0.85 * smoothstep(this.waterLevel + 2, this.waterLevel + 14, h));
      if (h < this.waterLevel + 1.2) out.copy(C(0xe2eaf0));
      if (d < 9) out.lerp(C(0xa9afb6), smoothstep(9, 6.5, d));
    },
    waterColor: 0xc6dbe8,
    ice: true,
    ground: 'meadow',
    farColor: 0xe6edf3,
    ridgeColor: 0xc9d3dc,
    ridgeHeight: 420,
    grassCover: 0,
  };
}

/** Rolling farmland and hills (with a sandy shore and lower hills toward the sea on the coast). */
export function valleyTerrain(o: TerrainOptions & { coast?: boolean; hills?: number; moss?: boolean }): ThemeConfig {
  const { seed } = o;
  const hillsScale = o.hills ?? 1;
  const [low, high] = o.moss ? [0x4d7a2e, 0x7d9a3e] : [0x5d8f35, 0x9ab84a];
  const sand = o.coast ? 1.5 : 0.8;
  return {
    seed,
    waterLevel: o.waterLevel ?? -1.5,
    lake: o.lake,
    natural(x, z, d) {
      const hills = (fbm(x / 260, z / 260, seed) * 14 + fbm(x / 90, z / 90, seed + 12) * 3) * Math.sqrt(hillsScale);
      const far = smoothstep(220, 760, d) * (55 + fbm(x / 420, z / 420, seed - 22) * 50) * hillsScale;
      // On the coast the hills fall away toward the sea.
      const L = o.lake;
      const inland = o.coast ? smoothstep(2.4, 4.5, ((x - L.x) / L.rx) ** 2 + ((z - L.z) / L.rz) ** 2) : 1;
      return (hills + far) * inland;
    },
    color(h, slope, x, z, d, out) {
      const n = fbm(x / 120, z / 120, seed - 20) * 0.5 + 0.5;
      out.copy(C(low)).lerp(C(high), n);
      // Wildflower meadows.
      const f = fbm(x / 45, z / 45, seed + 48);
      if (f > 0.28) out.lerp(C(0xd9a3c4), smoothstep(0.28, 0.5, f) * (o.moss ? 0.15 : 0.45));
      else if (f < -0.32) out.lerp(C(0xe8d36a), smoothstep(-0.32, -0.5, f) * 0.4);
      if (slope > 0.6) out.lerp(C(0x7a7460), smoothstep(0.6, 1, slope));
      if (h < this.waterLevel + sand) out.copy(C(o.coast ? 0xd8c99a : 0xb9a77a));
      if (d < 9) out.lerp(C(0x7d8a52), smoothstep(9, 6, d) * 0.6);
    },
    waterColor: o.waterColor ?? 0x2d5c78,
    fujiAt: o.fujiAt,
    ground: 'meadow',
    farColor: low,
    ridgeColor: 0x4f6e52,
    ridgeHeight: 220,
    rockSlope: [0.5, 0.9],
    grassCover: 1,
    sandLine: sand,
  };
}

// ---------------------------------------------------------------- world

export class NatureWorld {
  readonly group = new THREE.Group();
  private readonly cfg: ThemeConfig;
  private readonly field: RoadField;
  private readonly corridor: number;
  /** Terrain extent; heights taper down to the far ground near its edge (no visible wall). */
  readonly extent: { cx: number; cz: number; half: number };
  /** Free drive map: slip roads and dirt trails, indexed for quick distance queries. */
  private slipIndex: SegmentIndex | null = null;
  private trailIndex: SegmentIndex | null = null;
  private readonly particles: FallingParticles | null;
  private readonly lanternMat: THREE.MeshBasicMaterial | null = null;
  private readonly lanternGlow: THREE.PointsMaterial | null = null;
  /** Japanese scenery (Fuji, power lines, houses, trains...). */
  private readonly features: Feature[] = [];
  /** Areas kept free of trees (houses, paddies, under the railway). */
  private readonly blocked: { x: number; z: number; r: number }[] = [];
  private railZ: number | null = null;
  /** Instanced vegetation and its full instance count, thinned by the graphics detail level. */
  private readonly detailMeshes: { mesh: THREE.InstancedMesh; count: number }[] = [];
  /** Trunks and crowns (they cast shadows on High). */
  private readonly treeMeshes: THREE.InstancedMesh[] = [];
  private ground!: GroundField;
  private grass!: GrassField;
  private readonly shadowMat = contactShadowMaterial();
  private readonly shadowGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

  readonly theme: RuralTheme;

  constructor(
    private readonly scene: RuralScene,
    private readonly track: TrackPath,
    rng: () => number,
    detail = 1,
    grassLevel: 0 | 1 | 2 = 1,
  ) {
    const theme = scene.theme;
    this.theme = theme;
    this.group.name = `nature-${theme}`;
    this.cfg = scene.terrain;
    this.field = new RoadField(track);
    this.corridor = track.wallOffset + 3;
    const b = track.bounds;
    this.extent = {
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      half: (Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 1500) / 2,
    };

    this.buildTerrain();
    this.buildWater();
    if (this.cfg.fujiAt) {
      const fuji = new MountFuji(...this.cfg.fujiAt, () => SUN_DIRECTION);
      if (scene.cityRadius) fuji.group.scale.set(1.5, 1.9, 1.5);
      this.addFeature(fuji);
    }
    this.placeTokyoTower();
    this.placeModelLandmarks();
    this.buildDistantRidges(rng);
    const ground = (x: number, z: number) => this.heightAt(x, z);
    const wall = track.wallOffset;

    // Paddies, houses and the railway first, so the trees keep clear of them.
    if (scene.paddies) this.addFeature(ricePaddies(this.planPaddies(), waterNormalMap()));
    const houses: HouseSpot[] = [];
    // A ryokan and its neighbours (on the lake shore in the mountains).
    if (scene.ryokan) houses.push(...this.village(rng, scene.ryokan, 6, 46, 'ryokan'));
    for (const centre of this.villageCentres(rng, scene.villages ?? 0)) houses.push(...this.village(rng, centre, 7, 40));
    if (houses.length) this.addFeature(japaneseHouses(houses));
    if (scene.koinobori) this.addFeature(koinobori(houses.filter((_, k) => k % 3 === 0).map((h) => this.besideHouse(h))));
    if (scene.ropeway) this.addFeature(new Ropeway(...scene.ropeway, ground));
    if (scene.rail) {
      // A viaduct across the valley (and the lake), between two tunnels.
      this.railZ = scene.rail.z;
      this.addFeature(
        new Railway({
          from: [-1500, scene.rail.z],
          to: [1500, scene.rail.z],
          deckY: scene.rail.deckY,
          ground,
          kind: scene.rail.kind,
          tunnels: true,
          clear: (x, z) => this.field.query(x, z).d > wall + 4,
        }),
      );
    }

    if (theme === 'mountain') this.buildForest(rng, scene.vegetation);
    else this.buildBlossoms(rng, scene.vegetation);
    if (scene.cityRadius) this.buildForest(rng, 'cedar');
    if (scene.torii) this.buildLakeTorii();
    if (scene.pagoda) this.buildPagoda();
    if (theme === 'mountain') {
      this.buildChevrons();
      this.addFeature(curveMirrors(track, ground));
      this.addFeature(latticeSlopes(track, ground, concreteNormalMap()));
      this.addFeature(powerLines(track, { lateral: wall + 3.4, every: 36, sides: [-1], style: 'wood', ground }));
    } else {
      this.addFeature(powerLines(track, { lateral: wall + 4, every: 38, sides: [1], style: 'concrete', ground }));
    }
    if (scene.snowPoles) this.buildSnowPoles();
    this.addFeature(vendingMachines(this.roadsideMachines(scene.machines, wall + 2.6), rng));
    if (scene.lanterns) {
      const lanterns = this.buildLanterns();
      this.lanternMat = lanterns.light;
      this.lanternGlow = lanterns.glow;
    }
    this.particles = scene.particles ? new FallingParticles(rng, scene.particles) : null;
    if (this.particles) this.group.add(this.particles.points);
    this.grass = new GrassField(this.ground, scene.grass ?? { base: 0xffffff, tip: 0xffffff, flowers: [0xffffff], height: 0.01 });
    this.grass.mesh.visible = scene.grass !== null;
    this.group.add(this.grass.mesh);
    this.setDetail(detail, grassLevel);
  }

  /**
   * Tokyo Tower, once per map: a few hundred metres from the circuit on dry ground, so it stands
   * on the skyline from much of the lap. Placed before the trees, which then keep clear of it.
   */
  private placeTokyoTower(): void {
    const { cx, cz } = this.extent;
    const lake = this.cfg.lake;
    for (let k = 0; k < 60; k++) {
      // A golden-angle spiral of candidate spots around the circuit.
      const angle = k * 2.39996;
      const radius = 380 + (k % 7) * 70;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      const d = this.field.query(x, z).d;
      if (d < 200 || d > 560 || this.isBlocked(x, z)) continue;
      if (((x - lake.x) / (lake.rx + 60)) ** 2 + ((z - lake.z) / (lake.rz + 60)) ** 2 < 1) continue;
      const y = Math.min(...[-12, 0, 12].flatMap((dx) => [-12, 0, 12].map((dz) => this.heightAt(x + dx, z + dz))));
      if (y < this.cfg.waterLevel + 2) continue;
      const tower = tokyoTowerMesh(220, x, y - 1, z);
      if (!tower) return;
      const group = new THREE.Group();
      group.add(tower.mesh);
      this.addFeature({ group, setTimeOfDay: (tod) => tower.setTimeOfDay(tod === 'night', tod === 'sunset') });
      this.blocked.push({ x, z, r: 45 });
      return;
    }
  }

  /**
   * Model landmarks: a giant tree by the start (an autumn maple in Hakone, an ancient cherry in
   * Sakura Valley), a castle-style pagoda on Hakone's lake shore, and painted wooden signs along
   * the road. Placed before the trees, which then keep clear of them.
   */
  private placeModelLandmarks(): void {
    const track = this.track;
    const wall = track.wallOffset;
    const S = track.samples;
    const ok = (x: number, z: number, clear: number) =>
      !this.isBlocked(x, z) && this.field.query(x, z).d > clear && this.heightAt(x, z) > this.cfg.waterLevel + 1;
    /** Height range of the ground under a footprint of radius r (to keep things off slopes). */
    const footprint = (x: number, z: number, r: number) => {
      const hs = [-r, 0, r].flatMap((dx) => [-r, 0, r].map((dz) => this.heightAt(x + dx, z + dz)));
      return { low: Math.min(...hs), high: Math.max(...hs) };
    };

    const startTree = this.scene.startTree;
    const treeId = startTree?.id ?? 'bonsai';
    const treeHeight = startTree?.height ?? 0;
    const reach = (propAspect(treeId) * treeHeight) / 2;
    // The first level spot after the start (the mountain road is mostly cut into slopes).
    tree: for (let along = 70; startTree && along < 900; along += 25) {
      const s = S[track.indexAtDistance(along)];
      for (const side of [1, -1]) {
        const lateral = side * (wall + 5 + reach);
        const x = s.x + s.rx * lateral;
        const z = s.z + s.rz * lateral;
        // Level ground, near road height: not hanging over a drop or buried in a bank.
        const ground = footprint(x, z, 3);
        if (!ok(x, z, wall + 4 + reach * 0.8) || ground.high - ground.low > 2 || Math.abs(ground.low - s.y) > 2.5) continue;
        const model = propModel(treeId, treeHeight, x, ground.low - 0.3, z, along);
        if (!model) break tree;
        this.group.add(model);
        this.blocked.push({ x, z, r: reach + 3 });
        break tree;
      }
    }

    const shore = this.scene.shoreLandmark;
    if (shore) {
      // A landmark on the shore (a castle-style pagoda like Hakone's lakeside shrines, a
      // lighthouse on the coast): the lowest, flattest dry spot, looking out over the water.
      const L = this.cfg.lake;
      let best: { x: number; z: number; y: number; score: number } | null = null;
      const step = Math.min(0.15, 160 / Math.max(L.rx, L.rz));
      for (let a = 0; a < Math.PI * 2; a += step) {
        for (const out of [20, 35, 50, 70, 95, 125]) {
          const x = L.x + Math.cos(a) * (L.rx + out);
          const z = L.z + Math.sin(a) * (L.rz + out);
          // In sight of the road, with room around it.
          if (!ok(x, z, wall + 22) || this.field.query(x, z).d > 420) continue;
          if (this.blocked.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + shore.height) ** 2)) continue;
          const ground = footprint(x, z, 9);
          if (ground.low < this.cfg.waterLevel + 1.5) continue;
          const score = ground.low + (ground.high - ground.low) * 4;
          if (!best || score < best.score) best = { x, z, y: ground.low, score };
        }
      }
      const landmark =
        best &&
        (shore.id === 'lighthouse'
          ? this.lighthouse(shore.height, best.x, best.y - 0.5, best.z)
          : propModel(shore.id, shore.height, best.x, best.y - 0.5, best.z, Math.atan2(L.x - best.x, L.z - best.z)));
      if (best && landmark) {
        this.group.add(landmark);
        this.blocked.push({ x: best.x, z: best.z, r: shore.height * 0.9 });
      }
    }

    // Signs at the roadside, turned toward the cars coming up to them, on a level verge.
    this.scene.signs.forEach((lines, k) => {
      for (let step = 0; step < 12; step++) {
        const s = S[track.indexAtDistance(track.length * (0.06 + k * 0.24) + step * 18)];
        const side = (k + step) % 2 ? 1 : -1;
        const lateral = side * (wall + 3.2);
        const x = s.x + s.rx * lateral;
        const z = s.z + s.rz * lateral;
        const ground = footprint(x, z, 1.2);
        if (this.isBlocked(x, z) || ground.high - ground.low > 0.8 || Math.abs(ground.low - s.y) > 1) continue;
        const fx = -s.tx * 0.8 - s.rx * side * 0.6;
        const fz = -s.tz * 0.8 - s.rz * side * 0.6;
        const sign = woodenSign(lines, 3.4, x, ground.low - 0.05, z, Math.atan2(fx, fz));
        if (!sign) return;
        this.group.add(sign);
        this.blocked.push({ x, z, r: 4 });
        return;
      }
    });
  }

  private addFeature(f: Feature): void {
    this.features.push(f);
    this.group.add(f.group);
  }

  private isBlocked(x: number, z: number): boolean {
    if (this.scene.trails && this.trailDistance(x, z) < 7) return true;
    if (this.scene.cityRadius && Math.hypot(x, z) < this.scene.cityRadius + 40) return true;
    if (this.scene.connectors) {
      const c = this.connectorAt(x, z);
      if (c && c.d < 14) return true;
    }
    if (this.railZ !== null && Math.abs(z - this.railZ) < 14) return true;
    return this.blocked.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < b.r * b.r);
  }

  /** Stop grass growing within `r` of (x, z) (houses, paddies). */
  private clearGround(x: number, z: number, r: number): void {
    const g = this.ground;
    const i0 = Math.max(0, Math.floor((x - r - g.originX) / g.res));
    const i1 = Math.min(g.verts - 1, Math.ceil((x + r - g.originX) / g.res));
    const j0 = Math.max(0, Math.floor((z - r - g.originZ) / g.res));
    const j1 = Math.min(g.verts - 1, Math.ceil((z + r - g.originZ) / g.res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.data[(j * g.verts + i) * 4 + 2] = 0;
  }

  /** Flat ground: no more than `tolerance` metres of rise across a `radius` around (x, z). */
  private isFlat(x: number, z: number, radius: number, tolerance: number): number | null {
    const hs = [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ].map(([dx, dz]) => this.heightAt(x + dx, z + dz));
    const lo = Math.min(...hs);
    if (Math.max(...hs) - lo > tolerance || lo < this.cfg.waterLevel + 1) return null;
    return lo;
  }

  /** Houses around a centre (the first can be a ryokan). */
  private village(
    rng: () => number,
    centre: [number, number] | [number, number, number],
    count: number,
    radius: number,
    first?: HouseSpot['kind'],
  ): HouseSpot[] {
    const [cx, cz] = centre.length === 3 ? [centre[0], centre[2]] : centre;
    const out: HouseSpot[] = [];
    for (let tries = 0; tries < count * 12 && out.length < count; tries++) {
      // The ryokan goes first (near the centre); give up on it after a while and build houses.
      const big = out.length === 0 && first === 'ryokan' && tries < count * 8;
      const a = rng() * Math.PI * 2;
      const r = big ? rng() * radius : 14 + rng() * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (this.field.query(x, z).d < this.track.wallOffset + (big ? 14 : 10) || this.isBlocked(x, z)) continue;
      if (out.some((h) => Math.hypot(h.x - x, h.z - z) < 17)) continue;
      const y = this.isFlat(x, z, big ? 10 : 6, big ? 4 : 2.6);
      if (y === null) continue;
      // Face the road, squared up to it.
      const toRoad = Math.atan2(cx - x, cz - z);
      const facing = big ? Math.PI : Math.round(toRoad / (Math.PI / 2)) * (Math.PI / 2) + (rng() - 0.5) * 0.2;
      const kind: HouseSpot['kind'] = big ? 'ryokan' : this.theme === 'countryside' && rng() < 0.3 ? 'gassho' : 'minka';
      out.push({ x, y: y + 0.1, z, facing, kind });
      this.blocked.push({ x, z, r: big ? 20 : 11 });
      this.clearGround(x, z, big ? 18 : 9);
    }
    return out;
  }

  /** Flat spots near the road for farming villages. */
  private villageCentres(rng: () => number, count: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let tries = 0; tries < 400 && out.length < count; tries++) {
      const p = this.randomSpot(rng, 45, 160);
      if (!p || this.isFlat(p[0], p[2], 20, 3) === null) continue;
      if (out.some((c) => Math.hypot(c[0] - p[0], c[2] - p[2]) < 220)) continue;
      out.push(p);
    }
    return out;
  }

  private besideHouse(h: HouseSpot): Spot {
    const x = h.x + Math.cos(h.facing) * 7.5;
    const z = h.z - Math.sin(h.facing) * 7.5;
    return { x, y: this.heightAt(x, z), z, facing: 0 };
  }

  /** Pairs of vending machines just off the road at these lap distances, facing it. */
  private roadsideMachines(distances: number[], lateral: number): Spot[] {
    const out: Spot[] = [];
    for (const d of distances) {
      const s = this.track.samples[this.track.indexAtDistance(d)];
      for (const along of [0, 1.05]) {
        const x = s.x + s.rx * lateral + s.tx * along;
        const z = s.z + s.rz * lateral + s.tz * along;
        out.push({ x, y: Math.max(this.heightAt(x, z), s.y - 0.3), z, facing: Math.atan2(-s.rx, -s.rz) });
      }
    }
    return out;
  }

  /** Paddies on flat farmland: a grid of terraced, flooded fields in "paddy districts". */
  private planPaddies(): Paddy[] {
    const out: Paddy[] = [];
    const cell = 24;
    const b = this.track.bounds;
    const L = this.cfg.lake;
    const wall = this.track.wallOffset;
    for (let x = b.minX - 320; x <= b.maxX + 320; x += cell) {
      for (let z = b.minZ - 320; z <= b.maxZ + 320; z += cell) {
        if (fbm(x / 240, z / 240, 91) < 0.08) continue;
        if (((x - L.x) / L.rx) ** 2 + ((z - L.z) / L.rz) ** 2 < 1.6) continue;
        const half = cell / 2;
        const corners = [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
          [0, 0],
        ];
        if (corners.some(([dx, dz]) => this.field.query(x + dx, z + dz).d < wall + 14)) continue;
        if (this.field.query(x, z).d > 320) continue;
        const hs = corners.map(([dx, dz]) => this.heightAt(x + dx, z + dz));
        const lo = Math.min(...hs);
        const hi = Math.max(...hs);
        if (hi - lo > 1.8 || lo < this.cfg.waterLevel + 1) continue;
        out.push({ x, z, size: cell - 1.2, level: hi + 0.05, low: lo });
        this.blocked.push({ x, z, r: cell * 0.72 });
        this.clearGround(x, z, cell * 0.6);
      }
    }
    return out;
  }

  /**
   * Graphics detail: `detail` 0..1 is the fraction of the vegetation drawn (instances are
   * shuffled, so thinning is even); `grass` 0 none / 1 normal / 2 dense, which also makes the
   * trees cast shadows.
   */
  setDetail(detail: number, grass: 0 | 1 | 2): void {
    for (const { mesh, count } of this.detailMeshes) mesh.count = Math.max(1, Math.floor(count * detail));
    if (this.particles) this.particles.points.visible = detail > 0.6;
    this.grass.setDensity(grass);
    for (const m of this.treeMeshes) m.castShadow = grass === 2;
  }

  /** Nearest slip road within 64 m (distance and its height there), or null. */
  connectorAt(x: number, z: number): { d: number; y: number } | null {
    this.slipIndex ??= new SegmentIndex((this.scene.connectors ?? []).map((P) => P.map(([px, py, pz]) => [px, pz, py] as Point3)));
    const hit = this.slipIndex.nearest(x, z, 64);
    return hit ? { d: hit.d, y: hit.y } : null;
  }

  /** Distance to the nearest dirt trail (Infinity beyond 32 m). */
  trailDistance(x: number, z: number): number {
    this.trailIndex ??= new SegmentIndex((this.scene.trails ?? []).map((P) => P.map(([px, pz]) => [px, pz, 0] as Point3)));
    return this.trailIndex.nearest(x, z, 32)?.d ?? Infinity;
  }

  /** Terrain height at a world position (road-conforming). */
  heightAt(x: number, z: number): number {
    const { d, y, field } = this.field.query(x, z);
    const corridor = this.corridor;
    // Exactly under the road near it, blending into a smooth field between road sections...
    // (Mountain roads are cut into the hillside: the banks beside them rise much more steeply.)
    const roadish = lerp(y - 0.3, field, smoothstep(corridor, corridor + (this.theme === 'mountain' ? 13 : 28), d));
    // ...then natural hills/mountains (and lakes) further out.
    const out = smoothstep(corridor + 4, corridor + 120, d);
    let h = roadish + this.cfg.natural(x, z, d) * out;
    const L = this.cfg.lake;
    const e = ((x - L.x) / L.rx) ** 2 + ((z - L.z) / L.rz) ** 2;
    if (e < 1.6) h = lerp(h, this.cfg.waterLevel - 9, smoothstep(1.6, 0.75, e) * out);
    if (this.scene.cityRadius) {
      // Free drive: the city basin is flat (but the ring road keeps its own height).
      const R = this.scene.cityRadius;
      const flat = smoothstep(R + 260, R + 20, Math.hypot(x, z)) * smoothstep(corridor + 6, corridor + 60, d);
      h = lerp(h, -0.02, flat);
      // ...and the ground follows the slip roads, with gentle banks either side.
      const c = this.connectorAt(x, z);
      if (c) h = lerp(h, c.y - 0.25, smoothstep(40, 9, c.d));
    }
    const { cx, cz, half } = this.extent;
    const edge = Math.max(Math.abs(x - cx), Math.abs(z - cz));
    return lerp(h, this.cfg.waterLevel - 6, smoothstep(half - 380, half, edge));
  }

  private buildTerrain(): void {
    const { cx, cz, half } = this.extent;
    const size = half * 2;
    const res = 12;
    const n = Math.ceil(size / res);
    const verts = n + 1;
    const pos = new Float32Array(verts * verts * 3);
    const col = new Float32Array(verts * verts * 3);
    const heights = new Float32Array(verts * verts);
    const dists = new Float32Array(verts * verts);
    const field = new Float32Array(verts * verts * 4);
    this.ground = { originX: cx - size / 2, originZ: cz - size / 2, res, verts, data: field, roadClear: this.track.wallOffset + 0.6 };
    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const x = cx - size / 2 + i * res;
        const z = cz - size / 2 + j * res;
        const k = j * verts + i;
        heights[k] = this.heightAt(x, z);
        dists[k] = this.field.query(x, z).d;
        pos.set([x, heights[k], z], k * 3);
      }
    }
    const color = new THREE.Color();
    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const k = j * verts + i;
        const hx = heights[j * verts + Math.min(i + 1, n)] - heights[j * verts + Math.max(i - 1, 0)];
        const hz = heights[Math.min(j + 1, n) * verts + i] - heights[Math.max(j - 1, 0) * verts + i];
        const slope = Math.hypot(hx, hz) / (2 * res);
        this.cfg.color(heights[k], slope, pos[k * 3], pos[k * 3 + 2], dists[k], color);
        const trail = this.trailDistance(pos[k * 3], pos[k * 3 + 2]);
        if (trail < 9) color.lerp(DIRT, smoothstep(9, 4, trail));
        col.set([color.r, color.g, color.b], k * 3);
        // Where grass grows: not on rock, beaches, under water or high snow.
        const wet = smoothstep(this.cfg.waterLevel + this.cfg.sandLine - 0.4, this.cfg.waterLevel + this.cfg.sandLine + 0.6, heights[k]);
        const rock = 1 - smoothstep(...this.cfg.rockSlope, slope);
        const snow = 1 - smoothstep(140, 175, heights[k]);
        let town = this.scene.cityRadius ? smoothstep(this.scene.cityRadius + 10, this.scene.cityRadius + 60, Math.hypot(pos[k * 3], pos[k * 3 + 2])) : 1;
        const slip = this.scene.connectors ? this.connectorAt(pos[k * 3], pos[k * 3 + 2]) : null;
        if (slip) town *= smoothstep(9, 13, slip.d);
        field.set([heights[k], dists[k], wet * rock * snow * this.cfg.grassCover * smoothstep(4, 8, trail) * town, 0], k * 4);
      }
    }
    const index = new Uint32Array(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * verts + i;
        // Wound to face up.
        index.set([a, a + verts, a + 1, a + 1, a + verts, a + verts + 1], p);
        p += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, groundMaterial({ vertexColors: true }, this.cfg.ground));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);

    // Far ground so the horizon never shows the edge of the terrain.
    const far = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMaterial({ color: this.cfg.farColor }, 'meadow'));
    far.rotation.x = -Math.PI / 2;
    far.position.set(cx, this.cfg.waterLevel - 6, cz);
    this.group.add(far);
  }

  private buildWater(): void {
    const L = this.cfg.lake;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      this.cfg.ice
        ? new THREE.MeshStandardMaterial({ color: this.cfg.waterColor, roughness: 0.35, metalness: 0.1 })
        : new THREE.MeshStandardMaterial({ color: this.cfg.waterColor, roughness: 0.06, metalness: 0.6 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.scale.set(L.rx * 1.3, L.rz * 1.3, 1);
    water.position.set(L.x, this.cfg.waterLevel, L.z);
    water.name = 'lake';
    this.group.add(water);
  }

  private buildDistantRidges(rng: () => number): void {
    const b = this.track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const builder = new GeometryBuilder(true);
    const color = new THREE.Color();
    const base = this.cfg.ridgeColor;
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * Math.PI * 2 + rng() * 0.1;
      const r = Math.max(2100, this.extent.half + 400) + rng() * 900;
      const h = this.cfg.ridgeHeight + rng() * 300;
      color.setHex(base).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      builder.cylinder(cx + Math.cos(a) * r, -20, cz + Math.sin(a) * r, 520 + rng() * 380, 30, h, 7, color);
    }
    this.group.add(new THREE.Mesh(builder.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // ---------- vegetation ----------

  /**
   * Plant `count` copies of a tree shape at spots from `pick` (null = rejected spot): instanced
   * trunks and crowns with per-tree colour, scale and rotation, plus a contact shadow aligned to
   * the slope underneath each one.
   */
  private scatter(count: number, pick: () => [number, number, number] | null, shape: TreeShape, rng: () => number): void {
    const placed: [number, number, number][] = [];
    count = Math.round(count * (this.scene.density ?? 1));
    for (let tries = 0; tries < count * 4 && placed.length < count; tries++) {
      const p = pick();
      if (p) placed.push(p);
    }
    if (placed.length === 0) return;
    // Shuffle so that lowering the detail level thins every kind of placement evenly.
    for (let i = placed.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [placed[i], placed[j]] = [placed[j], placed[i]];
    }
    const n = placed.length;
    const trunks = shape.trunk ? new THREE.InstancedMesh(shape.trunk, swayMaterial({ color: shape.trunkColor }, shape.sway, 0), n) : null;
    const crowns = new THREE.InstancedMesh(shape.crown, swayMaterial({ color: 0xffffff }, shape.sway, 0.04), n);
    // Foliage stays out of the ambient-occlusion pass (its contact shadows do that job, and it
    // would triple the cost of the forests). Trees cast sun shadows on High; bushes are too low.
    crowns.userData.noAO = true;
    if (trunks) trunks.userData.noAO = true;
    if (trunks) this.treeMeshes.push(crowns, trunks);
    const shadows = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, n);
    shadows.userData.noAO = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tilt = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const c = new THREE.Color();
    placed.forEach(([x, y, z], i) => {
      const scale = 0.75 + rng() * 0.6;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m.compose(v.set(x, y - 0.3, z), q, s.set(scale, scale * (0.85 + rng() * 0.3), scale));
      trunks?.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, c.setHex(shape.palette[Math.floor(rng() * shape.palette.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.06));
      // Contact shadow: follow the ground's slope so the disc doesn't cut into hillsides.
      normal.set(this.heightAt(x - 1, z) - this.heightAt(x + 1, z), 2, this.heightAt(x, z - 1) - this.heightAt(x, z + 1)).normalize();
      tilt.setFromUnitVectors(up, normal);
      const r = shape.shadow * scale;
      m.compose(v.set(x, y + 0.06, z), tilt.multiply(q), s.set(r, 1, r));
      shadows.setMatrixAt(i, m);
    });
    for (const mesh of [trunks, crowns, shadows]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.detailMeshes.push({ mesh, count: n });
    }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  }

  private randomSpot(rng: () => number, minRoad: number, maxRoad: number): [number, number, number] | null {
    const b = this.track.bounds;
    const x = lerp(b.minX - 650, b.maxX + 650, rng());
    const z = lerp(b.minZ - 650, b.maxZ + 650, rng());
    const { d } = this.field.query(x, z);
    if (d < minRoad || d > maxRoad || this.isBlocked(x, z)) return null;
    const y = this.heightAt(x, z);
    if (y < this.cfg.waterLevel + 0.6) return null;
    return [x, y, z];
  }

  /** A spot within `radius` of one of `centres`, at least `minRoad` from the road. */
  private clusterSpot(rng: () => number, centres: [number, number, number][], radius: number, minRoad: number): [number, number, number] | null {
    if (centres.length === 0) return null;
    const centre = centres[Math.floor(rng() * centres.length)];
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = centre[0] + Math.cos(a) * r;
    const z = centre[2] + Math.sin(a) * r;
    if (this.field.query(x, z).d < minRoad || this.isBlocked(x, z)) return null;
    const y = this.heightAt(x, z);
    return y > this.cfg.waterLevel + 0.6 ? [x, y, z] : null;
  }

  /** A spot just behind the barrier, `near`..`far` metres beyond it. */
  private roadsideSpot(rng: () => number, near: number, far: number): [number, number, number] | null {
    const S = this.track.samples;
    const s = S[Math.floor(rng() * S.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const lat = side * (this.track.wallOffset + near + rng() * (far - near));
    const x = s.x + s.rx * lat;
    const z = s.z + s.rz * lat;
    if (this.field.query(x, z).d < this.track.wallOffset + near - 0.5 || this.isBlocked(x, z)) return null;
    const y = this.heightAt(x, z);
    return y > this.cfg.waterLevel + 0.6 ? [x, y, z] : null;
  }

  private groves(rng: () => number, count: number, minRoad: number, maxRoad: number): [number, number, number][] {
    return Array.from({ length: count }, () => this.randomSpot(rng, minRoad, maxRoad)).filter((p): p is [number, number, number] => !!p);
  }

  private buildForest(rng: () => number, kind: Vegetation): void {
    const minRoad = this.track.wallOffset + 4;
    const snow = kind === 'snow';
    const autumn = kind === 'autumn';
    // Under snow the firs are frosted white-green and the bushes are drifts.
    const snowy = (shape: TreeShape, palette: number[]): TreeShape => (snow ? { ...shape, palette } : shape);
    // Cedar forest everywhere, thicker in the valleys and thinning out on high bare slopes.
    this.scatter(
      autumn ? 2300 : 3200,
      () => {
        const p = this.randomSpot(rng, minRoad, 750);
        if (!p) return null;
        const density = 0.55 + fbm(p[0] / 140, p[2] / 140, 51) * 0.6 - smoothstep(140, 210, p[1]);
        return rng() < density ? p : null;
      },
      snowy(cedar(), [0x9fb5ae, 0xb9cbc6, 0x88a198, 0xd2ddda]),
      rng,
    );
    // Giant sugi lining the road like an old mountain highway.
    this.scatter(autumn ? 450 : 700, () => this.roadsideSpot(rng, 5, 24), snowy(sugi(), [0x7f9a8f, 0x96ada5, 0x6c887c]), rng);
    if (!snow) {
      // Autumn maples in clusters by the road and on the lake shore (everywhere at Irohazaka).
      const maples = [...this.groves(rng, autumn ? 60 : 22, 12, 160), ...this.groves(rng, autumn ? 20 : 6, 20, 400)];
      this.scatter(autumn ? 1300 : 420, () => this.clusterSpot(rng, maples, autumn ? 34 : 26, minRoad), maple(), rng);
      // Broadleaf trees in the low valleys (turned gold in autumn).
      this.scatter(
        autumn ? 900 : 600,
        () => {
          const p = this.randomSpot(rng, minRoad, 500);
          return p && p[1] < 60 ? p : null;
        },
        autumn ? { ...broadleaf(), palette: [0xd9a02f, 0xc77a26, 0xe3b94a, 0x9c7a2c, 0x5c7a30] } : broadleaf(),
        rng,
      );
    }
    this.scatter(
      snow ? 500 : 900,
      () => this.roadsideSpot(rng, 1.5, 12),
      snow ? { ...bush(), palette: [0xe9eef2, 0xdde5eb, 0xf3f6f8] } : autumn ? { ...bush(), palette: [0x8a5a24, 0x9c3a1e, 0x6f6a2a] } : bush(),
      rng,
    );
  }

  private buildBlossoms(rng: () => number, kind: Vegetation): void {
    const wall = this.track.wallOffset;
    const S = this.track.samples;
    const bamboos = kind === 'bamboo';
    const coast = kind === 'coast';
    // Cherry-blossom avenues lining much of the road (Kawazu cherries here and there on the
    // coast); at Arashiyama, the bamboo grove walls in a third of the lap and maples the rest.
    const avenue: [number, number, number][] = [];
    const grove: [number, number, number][] = [];
    for (let i = 0; i < S.length; i += 6) {
      const s = S[i];
      const inGrove = bamboos && s.dist > this.track.length * 0.3 && s.dist < this.track.length * 0.62;
      for (const side of [-1, 1]) {
        if (rng() > (inGrove ? 1 : coast ? 0.3 : 0.72)) continue;
        for (let k = 0; k < (inGrove ? 3 : 1); k++) {
          const lat = side * (wall + (inGrove ? 3.2 + k * 2.6 : 5) + rng() * (inGrove ? 1.5 : 4));
          const x = s.x + s.rx * lat + s.tx * (rng() - 0.5) * 6;
          const z = s.z + s.rz * lat + s.tz * (rng() - 0.5) * 6;
          const y = this.heightAt(x, z);
          if (y > this.cfg.waterLevel + 0.6 && this.field.query(x, z).d > wall + 2.5 && !this.isBlocked(x, z)) (inGrove ? grove : avenue).push([x, y, z]);
        }
      }
    }
    // ...and groves scattered over the hills.
    const groves = this.groves(rng, bamboos ? 10 : coast ? 12 : 26, 30, 650);
    let a = 0;
    this.scatter(
      avenue.length + groves.length * 14,
      () => (a < avenue.length ? avenue[a++] : this.clusterSpot(rng, groves, 30, wall + 5)),
      bamboos ? maple() : sakura(),
      rng,
    );
    if (grove.length) {
      let g = 0;
      this.scatter(grove.length, () => grove[g++] ?? null, bamboo(), rng);
    }
    // Ordinary green trees in between.
    this.scatter(
      900,
      () => {
        const p = this.randomSpot(rng, wall + 10, 800);
        return p && fbm(p[0] / 160, p[2] / 160, 63) > -0.05 ? p : null;
      },
      broadleaf(),
      rng,
    );
    // Black pines on the hills and around the lake (lining the shore on the coast).
    const L = this.cfg.lake;
    const points = coast ? 40 : 10;
    const shore = Array.from({ length: points }, (_, k): [number, number, number] => {
      const ang = (k / points) * Math.PI * 2;
      const x = L.x + Math.cos(ang) * L.rx * 1.15;
      const z = L.z + Math.sin(ang) * L.rz * 1.15;
      return [x, this.heightAt(x, z), z];
    }).filter((p) => !coast || this.field.query(p[0], p[2]).d < 700);
    this.scatter(coast ? 900 : 260, () => this.clusterSpot(rng, shore, coast ? 70 : 30, wall + 6), pine(), rng);
    this.scatter(coast ? 700 : 260, () => this.randomSpot(rng, 60, 700), pine(), rng);
    // Bamboo groves.
    const thickets = this.groves(rng, bamboos ? 40 : 14, 18, 300);
    this.scatter(bamboos ? 900 : 220, () => this.clusterSpot(rng, thickets, 14, wall + 6), bamboo(), rng);
    this.scatter(800, () => this.roadsideSpot(rng, 1.5, 14), bush(), rng);
  }

  // ---------- landmarks ----------

  /** The "Heiwa no Torii" standing in the lake, Hakone's most famous sight. */
  private buildLakeTorii(): void {
    const L = this.cfg.lake;
    const torii = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xd8341f, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1414 });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 12, 12), red);
      pillar.position.set(side * 4, 6, 0);
      torii.add(pillar);
    }
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.8, 0.7), red);
    nuki.position.y = 9.3;
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(13, 1, 1.2), red);
    kasagi.position.y = 11.6;
    const top = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 1.4), black);
    top.position.y = 12.3;
    torii.add(nuki, kasagi, top);
    torii.position.set(L.x - 60, this.cfg.waterLevel - 0.5, L.z - L.rz + 45);
    torii.lookAt(L.x - 60, torii.position.y, L.z - L.rz - 500);
    this.group.add(torii);
  }

  /** Yellow chevron boards on the outside of the hairpins. */
  private buildChevrons(): void {
    const tex = (dir: 1 | -1) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 96;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f2c200';
      g.fillRect(0, 0, 128, 96);
      g.fillStyle = '#111';
      for (const off of [-30, 10]) {
        g.beginPath();
        const x0 = 64 + off * dir;
        g.moveTo(x0, 12);
        g.lineTo(x0 + 24 * dir, 48);
        g.lineTo(x0, 84);
        g.lineTo(x0 + 14 * dir, 84);
        g.lineTo(x0 + 38 * dir, 48);
        g.lineTo(x0 + 14 * dir, 12);
        g.closePath();
        g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const right = new GeometryBuilder();
    const left = new GeometryBuilder();
    const poles = new GeometryBuilder();
    const S = this.track.samples;
    for (let i = 0; i < S.length; i += 7) {
      const s = S[i];
      if (Math.abs(s.curvature) < 1 / 32) continue;
      // Outside of the corner, facing the cars that are about to turn.
      const out = s.curvature > 0 ? 1 : -1;
      const lat = out * (this.track.wallOffset + 1.2);
      const x = s.x + s.rx * lat;
      const z = s.z + s.rz * lat;
      const y = s.y;
      const hw = 0.6;
      const b = s.curvature > 0 ? left : right;
      // Board perpendicular to the direction of travel, facing back toward approaching cars
      // (u runs from the driver's left to right so the arrows read correctly).
      b.quad(
        [x - s.rx * hw, y + 1.0, z - s.rz * hw],
        [x + s.rx * hw, y + 1.0, z + s.rz * hw],
        [x + s.rx * hw, y + 1.9, z + s.rz * hw],
        [x - s.rx * hw, y + 1.9, z - s.rz * hw],
      );
      poles.box(x + s.tx * 0.05, y - 0.3, z + s.tz * 0.05, 0.08, 1.4, 0.08, s.heading);
    }
    // A left-hander's chevrons point left (towards -right).
    if (!left.isEmpty) this.group.add(new THREE.Mesh(left.build(), new THREE.MeshBasicMaterial({ map: tex(-1) })));
    if (!right.isEmpty) this.group.add(new THREE.Mesh(right.build(), new THREE.MeshBasicMaterial({ map: tex(1) })));
    this.group.add(new THREE.Mesh(poles.build(), new THREE.MeshLambertMaterial({ color: 0x777777 })));
  }

  /** A five-storey pagoda on the lake shore, visible from most of the lap. */
  private buildPagoda(): void {
    const L = this.cfg.lake;
    const x = L.x + 40;
    const z = L.z - L.rz - 18;
    const y = this.heightAt(x, z);
    // The five-storey pagoda model, facing the lake; the built-in one if it didn't load.
    const model = propModel('pagoda', 30, x, y - 0.4, z, Math.atan2(L.x - x, L.z - z));
    if (model) {
      this.group.add(model);
      return;
    }
    const pagoda = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xa8321f, roughness: 0.7 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.8 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.35 });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(12, 1.5, 12), stone);
    plinth.position.y = 0.75;
    pagoda.add(plinth);
    let level = 1.5;
    for (let k = 0; k < 5; k++) {
      const w = 7.2 - k * 0.75;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3.6, w), wood);
      body.position.y = level + 1.8;
      const eave = new THREE.Mesh(new THREE.ConeGeometry(w * 1.05, 1.6, 4, 1, true), roof);
      eave.rotation.y = Math.PI / 4;
      eave.position.y = level + 4.1;
      const eaveBase = new THREE.Mesh(new THREE.BoxGeometry(w * 1.45, 0.25, w * 1.45), roof);
      eaveBase.position.y = level + 3.35;
      pagoda.add(body, eave, eaveBase);
      level += 4.2;
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 7, 8), gold);
    spire.position.y = level + 3;
    pagoda.add(spire);
    pagoda.position.set(x, y - 0.4, z);
    this.group.add(pagoda);
  }

  /** Stone lanterns (toro) along the start straight; they glow after dark. */
  private buildLanterns(): { light: THREE.MeshBasicMaterial; glow: THREE.PointsMaterial } {
    const stone = new GeometryBuilder();
    const lights = new GeometryBuilder();
    const glowPos: number[] = [];
    const S = this.track.samples;
    for (let i = S.length - 90; i < S.length + 90; i += 9) {
      const s = S[(i + S.length) % S.length];
      for (const side of [-1, 1]) {
        const lat = side * (this.track.wallOffset + 3);
        const x = s.x + s.rx * lat;
        const z = s.z + s.rz * lat;
        const y = s.y;
        stone.box(x, y - 0.3, z, 0.7, 0.9, 0.7, s.heading);
        stone.box(x, y + 0.6, z, 0.35, 0.6, 0.35, s.heading);
        stone.box(x, y + 1.6, z, 1.1, 0.25, 1.1, s.heading);
        lights.box(x, y + 1.2, z, 0.62, 0.4, 0.62, s.heading);
        glowPos.push(x, y + 1.4, z);
      }
    }
    this.group.add(new THREE.Mesh(stone.build(), new THREE.MeshLambertMaterial({ color: 0x8e8a80 })));
    const light = new THREE.MeshBasicMaterial({ color: 0x555044 });
    this.group.add(new THREE.Mesh(lights.build(), light));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    const glow = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xffc070,
      size: 4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Points(geo, glow));
    return { light, glow };
  }

  /** A white lighthouse with a red cap; its lamp glows from sunset. */
  private lighthouse(height: number, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.name = 'lighthouse';
    g.position.set(x, y, z);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.2, 3, 16), new THREE.MeshLambertMaterial({ color: 0x9a968c }));
    base.position.y = 1.5;
    const towerH = height * 0.78;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.6, towerH, 20), white);
    tower.position.y = 3 + towerH / 2;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 20), red);
    gallery.position.y = 3 + towerH;
    const lamp = new THREE.MeshBasicMaterial({ color: 0x8a8670 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 12), lamp);
    lantern.position.y = 3 + towerH + 1.55;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.4, 12), red);
    cap.position.y = 3 + towerH + 4;
    g.add(base, tower, gallery, lantern, cap);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    glow.scale.setScalar(26);
    glow.position.y = lantern.position.y;
    g.add(glow);
    this.features.push({
      group: g,
      setTimeOfDay: (tod) => {
        lamp.color.set(tod === 'day' ? new THREE.Color(0x8a8670) : new THREE.Color(3, 2.6, 1.6));
        glow.material.opacity = tod === 'night' ? 0.9 : tod === 'sunset' ? 0.45 : 0;
      },
    });
    return g;
  }

  /** Hokkaido road-edge markers: tall red-and-white poles with a downward arrow, for the snowploughs. */
  private buildSnowPoles(): void {
    const b = new GeometryBuilder(true);
    const red = new THREE.Color(0xd42a22);
    const white = new THREE.Color(0xf4f4f0);
    const S = this.track.samples;
    const step = Math.round(30 / this.track.spacing);
    for (let i = 0; i < S.length; i += step) {
      const s = S[i];
      for (const side of [-1, 1]) {
        const lat = side * (this.track.wallOffset + 1.4);
        const x = s.x + s.rx * lat;
        const z = s.z + s.rz * lat;
        const y = Math.max(s.y, this.heightAt(x, z)) - 0.2;
        for (let k = 0; k < 10; k++) b.box(x, y + k * 0.5, z, 0.12, 0.5, 0.12, s.heading, { color: k % 2 ? white : red });
        // An arm out over the road edge with an arrow pointing down at it.
        const ox = -s.rx * side;
        const oz = -s.rz * side;
        b.box(x + ox * 0.45, y + 4.85, z + oz * 0.45, 0.9, 0.12, 0.12, s.heading + Math.PI / 2, { color: red });
        const tip = [x + ox * 0.9, y + 3.75, z + oz * 0.9] as const;
        const l = [tip[0] - s.tx * 0.45, y + 4.8, tip[2] - s.tz * 0.45] as const;
        const r = [tip[0] + s.tx * 0.45, y + 4.8, tip[2] + s.tz * 0.45] as const;
        for (const [p0, p1] of [
          [l, r],
          [r, l],
        ]) {
          const n: [number, number, number] = [s.tx, 0, s.tz];
          const i0 = b.vertex([...p0], n, 0, 0, red);
          const i1 = b.vertex([...p1], n, 1, 0, red);
          const i2 = b.vertex([...tip], n, 0.5, 1, white);
          b.triangle(i0, i1, i2);
        }
      }
    }
    this.group.add(new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // ---------- per frame / time of day ----------

  setTimeOfDay(tod: TimeOfDay): void {
    for (const f of this.features) f.setTimeOfDay?.(tod);
    const lit = tod !== 'day';
    if (this.lanternMat) this.lanternMat.color.set(lit ? new THREE.Color(1.9, 1.05, 0.35) : new THREE.Color(0x555044));
    if (this.lanternGlow) this.lanternGlow.opacity = tod === 'night' ? 0.45 : tod === 'sunset' ? 0.18 : 0;
    this.particles?.setTimeOfDay(tod);
  }

  update(time: number, dt: number, camera: THREE.Camera): void {
    this.particles?.update(dt, camera);
    this.grass.update(camera);
    for (const f of this.features) f.update?.(time);
  }
}

// ---------------------------------------------------------------- petals

export type ParticleKind = 'petals' | 'leaves' | 'snow';

const PARTICLE_STYLE: Record<ParticleKind, { colors: number[]; fall: [number, number]; drift: number; shape: number; size: number }> = {
  petals: { colors: [0xffc7dc, 0xffb3cf, 0xffe3ee, 0xf8a8c4], fall: [0.5, 0.7], drift: 0.8, shape: 1.6, size: 90 },
  leaves: { colors: [0xd9481f, 0xe0702a, 0xc8321e, 0xe8a23a, 0xb8862a], fall: [0.9, 0.8], drift: 0.9, shape: 1.9, size: 110 },
  snow: { colors: [0xffffff, 0xf2f6fa, 0xe8eef6], fall: [0.8, 0.6], drift: 0.35, shape: 1, size: 70 },
};

/** Cherry petals, autumn leaves or snowflakes drifting down around the camera. */
class FallingParticles {
  readonly points: THREE.Points;
  private readonly count: number = 700;
  private readonly pos: Float32Array;
  private readonly phase: Float32Array;
  private readonly speed: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private time = 0;
  private readonly box = { x: 70, y: 26, z: 70 };

  private readonly drift: number;

  constructor(rng: () => number, kind: ParticleKind) {
    const style = PARTICLE_STYLE[kind];
    this.drift = style.drift;
    if (kind === 'snow') this.count = 1600;
    this.pos = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    this.speed = new Float32Array(this.count);
    const tint = new Float32Array(this.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      this.pos.set([(rng() - 0.5) * this.box.x, rng() * this.box.y, (rng() - 0.5) * this.box.z], i * 3);
      this.phase[i] = rng() * Math.PI * 2;
      this.speed[i] = style.fall[0] + rng() * style.fall[1];
      c.setHex(style.colors[Math.floor(rng() * style.colors.length)]);
      tint.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { brightness: { value: 1 }, shape: { value: style.shape }, size: { value: style.size } },
      vertexShader: /* glsl */ `
        attribute vec3 tint;
        uniform float size;
        varying vec3 vTint;
        void main() {
          vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size / -mv.z, 1.5, 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float brightness;
        uniform float shape;
        varying vec3 vTint;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          // A petal or leaf: an ellipse (a round snowflake when shape is 1).
          float d = length(p * vec2(1.0, shape));
          if (d > 0.5) discard;
          gl_FragColor = vec4(vTint * brightness, 0.9);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.material.uniforms.brightness.value = tod === 'day' ? 1 : tod === 'sunset' ? 0.85 : 0.35;
  }

  /** Petals live in a box that travels with the camera and wraps around it. */
  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const cp = camera.position;
    const { x: bx, y: by, z: bz } = this.box;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const ph = this.phase[i];
      let x = this.pos[o] + Math.sin(this.time * 1.3 + ph) * 0.6 * dt + this.drift * dt;
      let y = this.pos[o + 1] - this.speed[i] * dt;
      let z = this.pos[o + 2] + Math.cos(this.time * 1.1 + ph) * 0.5 * dt;
      // Wrap relative to the camera.
      const rx = x - cp.x;
      const rz = z - cp.z;
      if (rx > bx / 2) x -= bx;
      else if (rx < -bx / 2) x += bx;
      if (rz > bz / 2) z -= bz;
      else if (rz < -bz / 2) z += bz;
      if (y < cp.y - 6) y += by;
      else if (y > cp.y - 6 + by) y -= by;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
