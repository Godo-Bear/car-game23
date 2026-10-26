import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import type { CarModel } from '../vehicles/CarModel';

export type CameraMode = 'chase' | 'far' | 'hood';
const MODES: CameraMode[] = ['chase', 'far', 'hood'];
const CHASE = { chase: { dist: 6.2, height: 2.0 }, far: { dist: 9.5, height: 3.2 } };

/**
 * Forza-style follow camera: lags slightly behind the car's yaw so slides and drifts read on
 * screen, widens the FOV with speed and shakes on impacts. Also has a bonnet camera and an
 * orbit mode for the homescreen.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  private orbitAngle = 0;
  private readonly tmp = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 6000);
  }

  cycle(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  snap(): void {
    this.initialised = false;
  }

  follow(car: CarModel, speed: number, dt: number): void {
    const root = car.root;
    const heading = root.rotation.y;
    if (!this.initialised) {
      this.yaw = heading;
      this.initialised = true;
      this.pos.set(Infinity, 0, 0);
    }
    const cam = this.camera;
    const fovTarget = 60 + clamp(speed, 0, 80) * 0.2;
    cam.fov = damp(cam.fov, this.mode === 'hood' ? fovTarget + 6 : fovTarget, 3, dt);

    if (this.mode === 'hood') {
      root.localToWorld(this.tmp.set(0, 1.18, 0.15));
      cam.position.copy(this.tmp);
      root.localToWorld(this.tmp.set(0, 1.0, 30));
      cam.lookAt(this.tmp);
      this.pos.copy(cam.position);
      this.yaw = heading;
    } else {
      const cfg = CHASE[this.mode];
      this.yaw = dampAngle(this.yaw, heading, 7, dt);
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const p = root.position;
      const target = this.tmp.set(p.x - fx * cfg.dist, p.y + cfg.height, p.z - fz * cfg.dist);
      if (!isFinite(this.pos.x)) this.pos.copy(target);
      // Stiff horizontally so the car stays framed, softer vertically over crests.
      this.pos.x = target.x;
      this.pos.z = target.z;
      this.pos.y = damp(this.pos.y, target.y, 8, dt);
      cam.position.copy(this.pos);
      this.look.set(p.x + fx * 3, p.y + 1.1, p.z + fz * 3);
      cam.lookAt(this.look);
    }

    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.1;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    cam.updateProjectionMatrix();
  }

  /** Slow cinematic orbit around a point (homescreen / results backdrop). */
  orbit(center: THREE.Vector3, dt: number, radius = 16, height = 4.5): void {
    this.orbitAngle += dt * 0.12;
    const cam = this.camera;
    cam.position.set(center.x + Math.cos(this.orbitAngle) * radius, center.y + height, center.z + Math.sin(this.orbitAngle) * radius);
    cam.lookAt(center.x, center.y + 1, center.z);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    this.initialised = false;
  }
}
