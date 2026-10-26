import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { SimCar } from '../race/RaceSimulation';
import { glowTexture } from '../world/textures';

/**
 * Rubber skid marks and tyre smoke for sliding cars.
 *
 * Marks are quads written into one ring-buffered mesh (oldest marks are recycled), smoke is a
 * pool of soft camera-facing particles. Both cost one draw call each regardless of car count.
 */

const MAX_SEGMENTS = 4000;
const MARK_WIDTH = 0.3;
const MIN_SEGMENT = 0.35;
const MAX_PARTICLES = 600;

/** Contact patches in car-local space (+x left, +z forward), matching CarModel's wheels. */
const WHEELS: { x: number; z: number; rear: boolean }[] = [
  { x: 0.8, z: -1.4, rear: true },
  { x: -0.8, z: -1.4, rear: true },
  { x: 0.8, z: 1.2, rear: false },
  { x: -0.8, z: 1.2, rear: false },
];

interface Trail {
  active: boolean;
  x: number;
  y: number;
  z: number;
}

export interface EffectsCar {
  car: SimCar;
  /** The interpolated visual transform (so marks line up with the rendered wheels). */
  root: THREE.Object3D;
}

export class TireEffects {
  readonly group = new THREE.Group();

  private readonly markPos: Float32Array;
  private readonly markColor: Float32Array;
  private readonly markGeo: THREE.BufferGeometry;
  private nextSegment = 0;
  // Segments written since the last rendered frame, so several updates between two renders all upload.
  private dirtyFrom = -1;
  private dirtyTo = 0;
  private dirtyWrapped = false;
  private readonly trails = new Map<SimCar, Trail[]>();

  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pAge = new Float32Array(MAX_PARTICLES).fill(1);
  private readonly pLife = new Float32Array(MAX_PARTICLES).fill(1);
  private readonly pStrength = new Float32Array(MAX_PARTICLES);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pAlpha = new Float32Array(MAX_PARTICLES);
  private readonly smokeGeo = new THREE.BufferGeometry();
  private readonly smokeMat: THREE.ShaderMaterial;
  private nextParticle = 0;
  private readonly emitDebt = new Map<SimCar, number>();

  constructor() {
    this.group.name = 'tyre-effects';

    // ---- Skid marks ----
    this.markPos = new Float32Array(MAX_SEGMENTS * 4 * 3);
    this.markColor = new Float32Array(MAX_SEGMENTS * 4 * 4);
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4;
      // Wound to face up (see TrackMesh: forward x right points down in three.js).
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.markGeo = new THREE.BufferGeometry();
    this.markGeo.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.markGeo.setAttribute('color', new THREE.BufferAttribute(this.markColor, 4).setUsage(THREE.DynamicDrawUsage));
    this.markGeo.setIndex(new THREE.BufferAttribute(index, 1));
    const marks = new THREE.Mesh(
      this.markGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    marks.frustumCulled = false;
    marks.renderOrder = 1;
    this.group.add(marks);

    // ---- Smoke ----
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        uniform float scale;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(0.78, 0.78, 0.82), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const smoke = new THREE.Points(this.smokeGeo, this.smokeMat);
    smoke.frustumCulled = false;
    smoke.renderOrder = 3;
    this.group.add(smoke);
  }

  /** Call after each rendered frame: pending mark uploads have been sent to the GPU. */
  onRendered(): void {
    this.dirtyFrom = -1;
    this.dirtyWrapped = false;
  }

  /** Remove all marks and smoke (new race). */
  clear(): void {
    this.markColor.fill(0);
    const col = this.markGeo.getAttribute('color') as THREE.BufferAttribute;
    col.clearUpdateRanges();
    col.needsUpdate = true;
    this.dirtyFrom = -1;
    this.dirtyWrapped = true;
    this.nextSegment = 0;
    this.trails.clear();
    this.pAge.fill(1);
    this.pLife.fill(1);
    this.pAlpha.fill(0);
    (this.smokeGeo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(cars: EffectsCar[], dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    if (dt <= 0) return;
    const firstSegment = this.nextSegment;
    let written = 0;

    for (const { car, root } of cars) {
      if (!root.visible) continue;
      const p = car.physics;
      const speed = p.speed;
      const heading = root.rotation.y;
      const sinH = Math.sin(heading);
      const cosH = Math.cos(heading);
      const drift = p.drifting ? smoothstep(0.1, 0.3, Math.abs(p.driftAngle)) : 0;
      const rearMark = Math.max(smoothstep(0.45, 0.9, p.rearSlide), drift * 0.85) * smoothstep(3, 6, speed);
      const frontMark = smoothstep(0.65, 1, p.frontSlide) * 0.6 * smoothstep(3, 6, speed);
      const smokeAmount = Math.max(drift, smoothstep(0.75, 1, p.rearSlide)) * smoothstep(5, 10, speed);

      let trails = this.trails.get(car);
      if (!trails) {
        trails = WHEELS.map(() => ({ active: false, x: 0, y: 0, z: 0 }));
        this.trails.set(car, trails);
      }

      for (let k = 0; k < WHEELS.length; k++) {
        const wheel = WHEELS[k];
        const intensity = wheel.rear ? rearMark : frontMark;
        const trail = trails[k];
        const x = root.position.x + wheel.z * sinH + wheel.x * cosH;
        const z = root.position.z + wheel.z * cosH - wheel.x * sinH;
        const y = root.position.y + 0.03;
        if (intensity < 0.05) {
          trail.active = false;
          continue;
        }
        if (!trail.active) {
          Object.assign(trail, { active: true, x, y, z });
          continue;
        }
        const dx = x - trail.x;
        const dz = z - trail.z;
        const len = Math.hypot(dx, dz);
        if (len > 4) {
          // Teleported (respawn) - restart the trail rather than drawing a long streak.
          Object.assign(trail, { x, y, z });
        } else if (len >= MIN_SEGMENT) {
          // Dark rubber that stays readable on night-time asphalt even for light slides.
          this.writeSegment(trail.x, trail.y, trail.z, x, y, z, dx / len, dz / len, 0.55 + intensity * 0.4);
          written++;
          Object.assign(trail, { x, y, z });
        }
      }

      // Smoke from the rear tyres.
      if (smokeAmount > 0.05) {
        let debt = (this.emitDebt.get(car) ?? 0) + smokeAmount * 30 * dt;
        while (debt >= 1) {
          debt -= 1;
          const wheel = WHEELS[Math.random() < 0.5 ? 0 : 1];
          this.emit(
            root.position.x + wheel.z * sinH + wheel.x * cosH,
            root.position.y + 0.2,
            root.position.z + wheel.z * cosH - wheel.x * sinH,
            p.vx * 0.25,
            p.vz * 0.25,
            smokeAmount,
          );
        }
        this.emitDebt.set(car, debt);
      }
    }

    if (written > 0) {
      const pos = this.markGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = this.markGeo.getAttribute('color') as THREE.BufferAttribute;
      if (this.dirtyFrom < 0) this.dirtyFrom = firstSegment;
      this.dirtyTo = firstSegment + written;
      if (this.dirtyTo > MAX_SEGMENTS || this.dirtyTo < this.dirtyFrom) this.dirtyWrapped = true;
      pos.clearUpdateRanges();
      col.clearUpdateRanges();
      // Upload just the new marks; if the ring wrapped round, upload everything (no ranges).
      if (!this.dirtyWrapped) {
        pos.addUpdateRange(this.dirtyFrom * 12, (this.dirtyTo - this.dirtyFrom) * 12);
        col.addUpdateRange(this.dirtyFrom * 16, (this.dirtyTo - this.dirtyFrom) * 16);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    this.updateSmoke(dt);
    this.smokeMat.uniforms.scale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  private writeSegment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dx: number, dz: number, alpha: number): void {
    const i = this.nextSegment;
    this.nextSegment = (this.nextSegment + 1) % MAX_SEGMENTS;
    // Right-hand perpendicular of the direction of travel: (-dz, dx).
    const px = -dz * (MARK_WIDTH / 2);
    const pz = dx * (MARK_WIDTH / 2);
    // left0, right0, left1, right1 (same layout as the road ribbon).
    this.markPos.set([x0 - px, y0, z0 - pz, x0 + px, y0, z0 + pz, x1 - px, y1, z1 - pz, x1 + px, y1, z1 + pz], i * 12);
    for (let v = 0; v < 4; v++) this.markColor.set([0.008, 0.008, 0.01, alpha], i * 16 + v * 4);
  }

  private emit(x: number, y: number, z: number, vx: number, vz: number, strength: number): void {
    const i = this.nextParticle;
    this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
    this.pPos.set([x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3], i * 3);
    this.pVel.set([vx + (Math.random() - 0.5) * 1, 0.4 + Math.random() * 0.5, vz + (Math.random() - 0.5) * 1], i * 3);
    this.pAge[i] = 0;
    this.pLife[i] = 1.0 + Math.random() * 0.6;
    this.pStrength[i] = strength;
  }

  private updateSmoke(dt: number): void {
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pAge[i] >= this.pLife[i]) {
        this.pAlpha[i] = 0;
        continue;
      }
      this.pAge[i] += dt;
      const t = Math.min(1, this.pAge[i] / this.pLife[i]);
      const o = i * 3;
      this.pVel[o] *= drag;
      this.pVel[o + 2] *= drag;
      this.pPos[o] += this.pVel[o] * dt;
      this.pPos[o + 1] += this.pVel[o + 1] * dt;
      this.pPos[o + 2] += this.pVel[o + 2] * dt;
      this.pSize[i] = 0.6 + t * 2.2;
      this.pAlpha[i] = this.pStrength[i] * 0.28 * smoothstep(0, 0.08, t) * (1 - t) ** 1.5;
    }
    (this.smokeGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
