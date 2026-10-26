import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import { lerp, smoothstep } from '../core/math';
import type { TrackPath } from '../track/TrackPath';
import type { TrackTheme } from '../track/tracks';
import { bamboo, broadleaf, bush, cedar, contactShadowMaterial, maple, pine, sakura, sugi, swayMaterial, type TreeShape } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';
import { groundMaterial } from './surfaces';
import { glowTexture } from './textures';

/**
 * Procedural Japanese countryside and mountains around a circuit: terrain that the road sits
 * in, lakes, cedar forests with autumn maples or cherry-blossom avenues with pines and bamboo,
 * falling petals and landmarks. Vegetation sways in the wind and sits on soft contact shadows.
 */

type RuralTheme = Exclude<TrackTheme, 'city'>;

// ---------------------------------------------------------------- noise

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
    this.ys = new Float64Array(pts.map((s) => s.y));
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

interface ThemeConfig {
  seed: number;
  waterLevel: number;
  lake: Ellipse;
  /** Natural terrain offset (added to the road-following height field) at distance `d` from the road. */
  natural(x: number, z: number, d: number): number;
  color(h: number, slope: number, x: number, z: number, d: number, out: THREE.Color): void;
  waterColor: number;
  fujiAt: [number, number];
}

const C = (hex: number) => new THREE.Color(hex);

const MOUNTAIN: ThemeConfig = {
  seed: 11,
  waterLevel: -2.5,
  lake: { x: 0, z: 290, rx: 390, rz: 165 },
  natural(x, z, d) {
    const hills = fbm(x / 380, z / 380, 11) * 40 + fbm(x / 110, z / 110, 23) * 10;
    // Mountains rise steeply away from the pass.
    const rise = smoothstep(60, 650, d) * (150 + fbm(x / 600, z / 600, 5) * 110);
    return hills + rise;
  },
  color(h, slope, x, z, d, out) {
    const n = fbm(x / 60, z / 60, 3) * 0.5 + 0.5;
    out.copy(C(0x2f4a26)).lerp(C(0x56702f), n);
    if (slope > 0.55) out.lerp(C(0x6c6a63), smoothstep(0.55, 0.95, slope));
    if (h > 170) out.lerp(C(0xe6edf3), smoothstep(170, 230, h));
    if (h < this.waterLevel + 1.2) out.copy(C(0x8a7d62));
    if (d < 9) out.lerp(C(0x6b6455), smoothstep(9, 6, d));
  },
  waterColor: 0x1d3a3e,
  fujiAt: [-3200, 3000],
};

const COUNTRYSIDE: ThemeConfig = {
  seed: 29,
  waterLevel: -1.5,
  lake: { x: -60, z: 200, rx: 205, rz: 100 },
  natural(x, z, d) {
    const hills = fbm(x / 260, z / 260, 29) * 14 + fbm(x / 90, z / 90, 41) * 3;
    const far = smoothstep(220, 760, d) * (55 + fbm(x / 420, z / 420, 7) * 50);
    return hills + far;
  },
  color(h, slope, x, z, d, out) {
    const n = fbm(x / 120, z / 120, 9) * 0.5 + 0.5;
    out.copy(C(0x5d8f35)).lerp(C(0x9ab84a), n);
    // Wildflower meadows.
    const f = fbm(x / 45, z / 45, 77);
    if (f > 0.28) out.lerp(C(0xd9a3c4), smoothstep(0.28, 0.5, f) * 0.45);
    else if (f < -0.32) out.lerp(C(0xe8d36a), smoothstep(-0.32, -0.5, f) * 0.4);
    if (slope > 0.6) out.lerp(C(0x7a7460), smoothstep(0.6, 1, slope));
    if (h < this.waterLevel + 0.8) out.copy(C(0xb9a77a));
    if (d < 9) out.lerp(C(0x7d8a52), smoothstep(9, 6, d) * 0.6);
  },
  waterColor: 0x2d5c78,
  fujiAt: [-3400, 2900],
};

// ---------------------------------------------------------------- world

export class NatureWorld {
  readonly group = new THREE.Group();
  private readonly cfg: ThemeConfig;
  private readonly field: RoadField;
  private readonly corridor: number;
  /** Terrain extent; heights taper down to the far ground near its edge (no visible wall). */
  private readonly extent: { cx: number; cz: number; half: number };
  private readonly petals: FallingPetals | null;
  private readonly lanternMat: THREE.MeshBasicMaterial | null = null;
  private readonly lanternGlow: THREE.PointsMaterial | null = null;
  private readonly fujiMat: THREE.MeshBasicMaterial;
  private readonly fujiSnow: THREE.MeshBasicMaterial;
  /** Instanced vegetation and its full instance count, thinned by the graphics detail level. */
  private readonly detailMeshes: { mesh: THREE.InstancedMesh; count: number }[] = [];
  private readonly shadowMat = contactShadowMaterial();
  private readonly shadowGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

  constructor(
    readonly theme: RuralTheme,
    private readonly track: TrackPath,
    rng: () => number,
    detail = 1,
  ) {
    this.group.name = `nature-${theme}`;
    this.cfg = theme === 'mountain' ? MOUNTAIN : COUNTRYSIDE;
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
    const fuji = this.buildFuji();
    this.fujiMat = fuji.body;
    this.fujiSnow = fuji.snow;
    this.buildDistantRidges(rng);

    if (theme === 'mountain') {
      this.buildForest(rng);
      this.buildLakeTorii();
      this.buildChevrons();
      this.petals = null;
    } else {
      this.buildBlossoms(rng);
      this.buildPagoda();
      this.buildFarmhouses(rng);
      const lanterns = this.buildLanterns();
      this.lanternMat = lanterns.light;
      this.lanternGlow = lanterns.glow;
      this.petals = new FallingPetals(rng);
      this.group.add(this.petals.points);
    }
    this.setDetail(detail);
  }

  /** 0..1: fraction of the vegetation to draw (instances are shuffled, so thinning is even). */
  setDetail(detail: number): void {
    for (const { mesh, count } of this.detailMeshes) mesh.count = Math.max(1, Math.floor(count * detail));
    if (this.petals) this.petals.points.visible = detail > 0.6;
  }

  /** Terrain height at a world position (road-conforming). */
  heightAt(x: number, z: number): number {
    const { d, y, field } = this.field.query(x, z);
    const corridor = this.corridor;
    // Exactly under the road near it, blending into a smooth field between road sections...
    const roadish = lerp(y - 0.3, field, smoothstep(corridor, corridor + 28, d));
    // ...then natural hills/mountains (and lakes) further out.
    const out = smoothstep(corridor + 4, corridor + 120, d);
    let h = roadish + this.cfg.natural(x, z, d) * out;
    const L = this.cfg.lake;
    const e = ((x - L.x) / L.rx) ** 2 + ((z - L.z) / L.rz) ** 2;
    if (e < 1.6) h = lerp(h, this.cfg.waterLevel - 9, smoothstep(1.6, 0.75, e) * out);
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
        col.set([color.r, color.g, color.b], k * 3);
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
    const mesh = new THREE.Mesh(geo, groundMaterial({ vertexColors: true }, this.theme === 'mountain' ? 'rocky' : 'meadow'));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);

    // Far ground so the horizon never shows the edge of the terrain.
    const far = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMaterial({ color: this.theme === 'mountain' ? 0x2f4a26 : 0x5d8f35 }, 'meadow'));
    far.rotation.x = -Math.PI / 2;
    far.position.set(cx, this.cfg.waterLevel - 6, cz);
    this.group.add(far);
  }

  private buildWater(): void {
    const L = this.cfg.lake;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: this.cfg.waterColor, roughness: 0.06, metalness: 0.6 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.scale.set(L.rx * 1.3, L.rz * 1.3, 1);
    water.position.set(L.x, this.cfg.waterLevel, L.z);
    water.name = 'lake';
    this.group.add(water);
  }

  private buildFuji(): { body: THREE.MeshBasicMaterial; snow: THREE.MeshBasicMaterial } {
    const [fx, fz] = this.cfg.fujiAt;
    const body = new THREE.MeshBasicMaterial({ color: 0x7f93b4, fog: false });
    const snow = new THREE.MeshBasicMaterial({ color: 0xf6f8fc, fog: false });
    const height = 950;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(110, 1750, height, 48, 1, true), body);
    cone.position.set(fx, height / 2 - 40, fz);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(110, 430, 290, 48, 1, false), snow);
    cap.position.set(fx, height - 40 - 145, fz);
    this.group.add(cone, cap);
    return { body, snow };
  }

  private buildDistantRidges(rng: () => number): void {
    const b = this.track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const builder = new GeometryBuilder(true);
    const color = new THREE.Color();
    const base = this.theme === 'mountain' ? 0x3b5242 : 0x4f6e52;
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * Math.PI * 2 + rng() * 0.1;
      const r = 2100 + rng() * 900;
      const h = (this.theme === 'mountain' ? 380 : 220) + rng() * 300;
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
    if (d < minRoad || d > maxRoad) return null;
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
    if (this.field.query(x, z).d < minRoad) return null;
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
    if (this.field.query(x, z).d < this.track.wallOffset + near - 0.5) return null;
    const y = this.heightAt(x, z);
    return y > this.cfg.waterLevel + 0.6 ? [x, y, z] : null;
  }

  private groves(rng: () => number, count: number, minRoad: number, maxRoad: number): [number, number, number][] {
    return Array.from({ length: count }, () => this.randomSpot(rng, minRoad, maxRoad)).filter((p): p is [number, number, number] => !!p);
  }

  private buildForest(rng: () => number): void {
    const minRoad = this.track.wallOffset + 4;
    // Cedar forest everywhere, thicker in the valleys and thinning out on high bare slopes.
    this.scatter(
      3200,
      () => {
        const p = this.randomSpot(rng, minRoad, 750);
        if (!p) return null;
        const density = 0.55 + fbm(p[0] / 140, p[2] / 140, 51) * 0.6 - smoothstep(140, 210, p[1]);
        return rng() < density ? p : null;
      },
      cedar(),
      rng,
    );
    // Giant sugi lining the road like an old mountain highway.
    this.scatter(700, () => this.roadsideSpot(rng, 5, 24), sugi(), rng);
    // Autumn maples in clusters by the road and on the lake shore.
    const maples = [...this.groves(rng, 22, 12, 160), ...this.groves(rng, 6, 20, 400)];
    this.scatter(420, () => this.clusterSpot(rng, maples, 26, minRoad), maple(), rng);
    // Broadleaf trees in the low valleys.
    this.scatter(
      600,
      () => {
        const p = this.randomSpot(rng, minRoad, 500);
        return p && p[1] < 60 ? p : null;
      },
      broadleaf(),
      rng,
    );
    this.scatter(900, () => this.roadsideSpot(rng, 1.5, 12), bush(), rng);
  }

  private buildBlossoms(rng: () => number): void {
    const avenue: [number, number, number][] = [];
    const S = this.track.samples;
    // Cherry-blossom avenues lining much of the road.
    for (let i = 0; i < S.length; i += 6) {
      const s = S[i];
      for (const side of [-1, 1]) {
        if (rng() > 0.72) continue;
        const lat = side * (this.track.wallOffset + 5 + rng() * 4);
        const x = s.x + s.rx * lat;
        const z = s.z + s.rz * lat;
        const y = this.heightAt(x, z);
        if (y > this.cfg.waterLevel + 0.6 && this.field.query(x, z).d > this.track.wallOffset + 3.5) avenue.push([x, y, z]);
      }
    }
    // ...and groves scattered over the hills.
    const groves = this.groves(rng, 26, 30, 650);
    let a = 0;
    this.scatter(
      avenue.length + groves.length * 14,
      () => (a < avenue.length ? avenue[a++] : this.clusterSpot(rng, groves, 30, this.track.wallOffset + 5)),
      sakura(),
      rng,
    );
    // Ordinary green trees in between.
    this.scatter(
      900,
      () => {
        const p = this.randomSpot(rng, this.track.wallOffset + 10, 800);
        return p && fbm(p[0] / 160, p[2] / 160, 63) > -0.05 ? p : null;
      },
      broadleaf(),
      rng,
    );
    // Black pines on the hills and around the lake.
    const L = this.cfg.lake;
    const shore: [number, number, number][] = Array.from({ length: 10 }, (_, k) => {
      const ang = (k / 10) * Math.PI * 2;
      const x = L.x + Math.cos(ang) * L.rx * 1.15;
      const z = L.z + Math.sin(ang) * L.rz * 1.15;
      return [x, this.heightAt(x, z), z];
    });
    this.scatter(260, () => this.clusterSpot(rng, shore, 30, this.track.wallOffset + 6), pine(), rng);
    this.scatter(260, () => this.randomSpot(rng, 60, 700), pine(), rng);
    // Bamboo groves.
    const thickets = this.groves(rng, 14, 18, 300);
    this.scatter(220, () => this.clusterSpot(rng, thickets, 14, this.track.wallOffset + 6), bamboo(), rng);
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

  private buildFarmhouses(rng: () => number): void {
    const walls = new GeometryBuilder();
    const roofs = new THREE.Group();
    const thatch = new THREE.MeshLambertMaterial({ color: 0x6e5a3c });
    for (let k = 0; k < 9; k++) {
      const p = this.randomSpot(rng, 40, 420);
      if (!p) continue;
      const [x, y, z] = p;
      const w = 8 + rng() * 4;
      const d = 6 + rng() * 3;
      const rot = rng() * Math.PI;
      walls.box(x, y - 0.5, z, w, 3.8, d, rot);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.62, 5, 4), thatch);
      roof.position.set(x, y + 5.6, z);
      roof.rotation.y = rot + Math.PI / 4;
      roof.scale.set(1, 1, d / w);
      roofs.add(roof);
    }
    this.group.add(new THREE.Mesh(walls.build(), new THREE.MeshLambertMaterial({ color: 0xd9cdb4 })));
    this.group.add(roofs);
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

  // ---------- per frame / time of day ----------

  setTimeOfDay(tod: TimeOfDay): void {
    const fuji = { day: [0x8fa2c2, 0xf6f8fc], sunset: [0x5b3f5e, 0xf2b8a8], night: [0x1d1a33, 0x5a5f7a] }[tod];
    this.fujiMat.color.setHex(fuji[0]);
    this.fujiSnow.color.setHex(fuji[1]);
    const lit = tod !== 'day';
    if (this.lanternMat) this.lanternMat.color.set(lit ? new THREE.Color(1.9, 1.05, 0.35) : new THREE.Color(0x555044));
    if (this.lanternGlow) this.lanternGlow.opacity = tod === 'night' ? 0.45 : tod === 'sunset' ? 0.18 : 0;
    this.petals?.setTimeOfDay(tod);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.petals?.update(dt, camera);
  }
}

// ---------------------------------------------------------------- petals

class FallingPetals {
  readonly points: THREE.Points;
  private readonly count = 700;
  private readonly pos: Float32Array;
  private readonly phase: Float32Array;
  private readonly speed: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private time = 0;
  private readonly box = { x: 70, y: 26, z: 70 };

  constructor(rng: () => number) {
    this.pos = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    this.speed = new Float32Array(this.count);
    const tint = new Float32Array(this.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      this.pos.set([(rng() - 0.5) * this.box.x, rng() * this.box.y, (rng() - 0.5) * this.box.z], i * 3);
      this.phase[i] = rng() * Math.PI * 2;
      this.speed[i] = 0.5 + rng() * 0.7;
      c.setHex([0xffc7dc, 0xffb3cf, 0xffe3ee, 0xf8a8c4][Math.floor(rng() * 4)]);
      tint.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { brightness: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 tint;
        varying vec3 vTint;
        void main() {
          vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(90.0 / -mv.z, 1.5, 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float brightness;
        varying vec3 vTint;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          // A petal: an ellipse, slightly notched at the top.
          float d = length(p * vec2(1.0, 1.6));
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
      let x = this.pos[o] + Math.sin(this.time * 1.3 + ph) * 0.6 * dt + 0.8 * dt;
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
