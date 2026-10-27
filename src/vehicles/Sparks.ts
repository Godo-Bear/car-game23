import * as THREE from 'three';
import { glowTexture } from '../world/textures';

const MAX = 400;
/** Seconds of motion each streak shows behind its spark. */
const TRAIL = 0.05;

/**
 * Bright sparks thrown off when a car scrapes along a barrier: a hot point with a motion streak
 * behind it, bouncing off the road. Two draw calls in total.
 */
export class Sparks {
  readonly points: THREE.Points;
  private readonly trails: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly ground = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly trailPos = new Float32Array(MAX * 6);
  private readonly trailCol = new Float32Array(MAX * 6);
  private next = 0;
  private alive = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const additive = { vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.2, map: glowTexture(), ...additive }));
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trails = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial(additive));
    for (const o of [this.points, this.trails]) {
      o.frustumCulled = false;
      o.userData.noAO = true;
    }
    this.points.add(this.trails);
    this.clear();
  }

  clear(): void {
    this.life.fill(0);
    this.col.fill(0);
    this.trailCol.fill(0);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1e4;
    this.trailPos.fill(-1e4);
    this.alive = 0;
    this.upload();
  }

  /** Spray `count` sparks from (x, y, z), thrown out behind a car moving at (vx, vz). */
  emit(x: number, y: number, z: number, vx: number, vz: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const k = i * 3;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      // They lose most of the car's speed at once, so they stream out behind it and fan upward.
      const keep = 0.1 + Math.random() * 0.45;
      this.vel[k] = vx * keep + (Math.random() - 0.5) * 5;
      this.vel[k + 1] = 1.5 + Math.random() * 4.5;
      this.vel[k + 2] = vz * keep + (Math.random() - 0.5) * 5;
      this.ground[i] = y - 0.33;
      this.life[i] = 0.3 + Math.random() * 0.4;
    }
    this.alive = MAX;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      const t6 = i * 6;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1e4;
        this.col.fill(0, k, k + 3);
        this.trailPos.fill(-1e4, t6, t6 + 6);
        this.trailCol.fill(0, t6, t6 + 6);
        continue;
      }
      alive++;
      const v = this.vel;
      v[k + 1] -= 14 * dt;
      this.pos[k] += v[k] * dt;
      this.pos[k + 1] += v[k + 1] * dt;
      this.pos[k + 2] += v[k + 2] * dt;
      // Skip off the tarmac rather than falling through it.
      if (this.pos[k + 1] < this.ground[i]) {
        this.pos[k + 1] = this.ground[i];
        v[k + 1] *= -0.35;
        v[k] *= 0.6;
        v[k + 2] *= 0.6;
      }
      // White-hot, cooling to orange.
      const heat = Math.min(1, this.life[i] / 0.4);
      const r = 3;
      const g = 1 + 1.6 * heat;
      const b = 0.25 + 1.2 * heat * heat;
      this.col[k] = r;
      this.col[k + 1] = g;
      this.col[k + 2] = b;
      // Streak from the spark back along its motion, fading at the tail.
      for (let a = 0; a < 3; a++) {
        this.trailPos[t6 + a] = this.pos[k + a];
        this.trailPos[t6 + 3 + a] = this.pos[k + a] - v[k + a] * TRAIL;
      }
      this.trailCol.set([r, g, b, r * 0.15, g * 0.1, b * 0.05], t6);
    }
    this.alive = alive;
    this.upload();
  }

  private upload(): void {
    for (const geo of [this.points.geometry, this.trails.geometry]) {
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('color').needsUpdate = true;
    }
  }
}
