import * as THREE from 'three';
import { glowTexture } from '../world/textures';

const MAX = 400;

/** Bright sparks thrown off when a car scrapes along a barrier. One draw call. */
export class Sparks {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private next = 0;
  private alive = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.32,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.userData.noAO = true;
    this.clear();
  }

  clear(): void {
    this.life.fill(0);
    this.pos.fill(0);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1e4;
    this.alive = 0;
  }

  /** Spray `count` sparks from (x, y, z), flying mostly along the car's direction of travel. */
  emit(x: number, y: number, z: number, vx: number, vz: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const k = i * 3;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      const keep = 0.35 + Math.random() * 0.45;
      this.vel[k] = vx * keep + (Math.random() - 0.5) * 4;
      this.vel[k + 1] = 1 + Math.random() * 3.5;
      this.vel[k + 2] = vz * keep + (Math.random() - 0.5) * 4;
      this.life[i] = 0.25 + Math.random() * 0.35;
    }
    this.alive = MAX;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1e4;
        this.col.fill(0, k, k + 3);
        continue;
      }
      alive++;
      this.vel[k + 1] -= 14 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      // White-hot, cooling to orange.
      const t = Math.min(1, this.life[i] / 0.4);
      this.col[k] = 3;
      this.col[k + 1] = 1 + 1.6 * t;
      this.col[k + 2] = 0.25 + 1.2 * t * t;
    }
    this.alive = alive;
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
  }
}
