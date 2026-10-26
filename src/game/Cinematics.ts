import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { TrackPath } from '../track/TrackPath';

/**
 * Scripted cameras: the fly-in over the grid before the start lights, the homescreen's
 * TV-style shots of the car out on the road, the garage turntable and the slow-motion
 * trackside shot as you cross the finish line.
 */

const INTRO_SECONDS = 6.5;
const SHOT_SECONDS = 6.5;

type AttractShot = 'chase' | 'trackside' | 'heli' | 'front' | 'wheel';
const SHOTS: AttractShot[] = ['trackside', 'chase', 'heli', 'front', 'trackside', 'wheel'];

export class Cinematics {
  private intro: { t: number; curve: THREE.CatmullRomCurve3; looks: THREE.Vector3[] } | null = null;
  private shot = 0;
  private shotTime = 0;
  private readonly fixed = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private turntable = 0;
  private finish: { t: number } | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  // ---------------------------------------------------------------- race intro

  /**
   * Sweep from high above the road ahead, down the side of the grid, into the chase camera
   * behind the player. `chase` is where the chase camera will start.
   */
  startIntro(track: TrackPath, gridMid: number, player: THREE.Object3D, chase: THREE.Vector3): void {
    const at = (d: number, lateral: number, up: number) => {
      const p = track.pointAt(d, lateral);
      return new THREE.Vector3(p.x, p.y + up, p.z);
    };
    const edge = track.wallOffset - 1.2;
    const playerLook = player.position.clone().add(new THREE.Vector3(0, 1, 0));
    this.intro = {
      t: 0,
      curve: new THREE.CatmullRomCurve3(
        [at(gridMid + 90, 0, 32), at(gridMid + 28, edge, 11), at(gridMid - 6, edge * 0.8, 3.2), chase.clone()],
        false,
        'centripetal',
      ),
      looks: [at(gridMid, 0, 0), at(gridMid, 0, 0.5), playerLook, player.localToWorld(new THREE.Vector3(0, 1.1, 3))],
    };
  }

  get introActive(): boolean {
    return this.intro !== null;
  }

  endIntro(): void {
    this.intro = null;
  }

  /** Returns true when the fly-in has finished. */
  updateIntro(dt: number): boolean {
    const intro = this.intro;
    if (!intro) return true;
    intro.t += dt / INTRO_SECONDS;
    const k = Math.min(1, intro.t);
    const eased = k * k * (3 - 2 * k);
    intro.curve.getPoint(eased, this.camera.position);
    // Look target moves through its keys in step with the path.
    const seg = eased * (intro.looks.length - 1);
    const i = Math.min(intro.looks.length - 2, Math.floor(seg));
    this.look.lerpVectors(intro.looks[i], intro.looks[i + 1], smoothstep(0, 1, seg - i));
    this.camera.lookAt(this.look);
    this.camera.fov = 55 + 7 * eased;
    this.camera.updateProjectionMatrix();
    if (k >= 1) this.intro = null;
    return k >= 1;
  }

  // ---------------------------------------------------------------- homescreen

  /** TV-style shots of the car driving (homescreen backdrop). */
  attract(track: TrackPath, car: THREE.Object3D, distance: number, dt: number): void {
    this.shotTime += dt;
    const shot = SHOTS[this.shot % SHOTS.length];
    const pos = car.position;
    const cam = this.camera;
    if (this.shotTime > SHOT_SECONDS || (shot === 'trackside' && this.shotTime > 1 && this.fixed.distanceTo(pos) > 60)) {
      this.nextShot(track, distance);
    }
    switch (SHOTS[this.shot % SHOTS.length]) {
      case 'trackside':
        cam.position.copy(this.fixed);
        cam.fov = 38;
        break;
      case 'chase':
        car.localToWorld(cam.position.set(1.8, 1.1, -5.5));
        cam.fov = 58;
        break;
      case 'heli': {
        const a = this.shotTime * 0.25;
        cam.position.set(pos.x + Math.sin(a) * 20, pos.y + 11, pos.z + Math.cos(a) * 20);
        cam.fov = 45;
        break;
      }
      case 'front':
        car.localToWorld(cam.position.set(-0.6, 1.0, 7.5));
        cam.fov = 50;
        break;
      case 'wheel':
        car.localToWorld(cam.position.set(2.3, 0.55, 2.6));
        cam.fov = 55;
        break;
    }
    car.localToWorld(this.tmp.set(0, 0.8, shot === 'wheel' ? 0.8 : 0.6));
    cam.lookAt(this.tmp);
    cam.updateProjectionMatrix();
  }

  private nextShot(track: TrackPath, distance: number): void {
    this.shot++;
    this.shotTime = 0;
    // Trackside: plant the camera by the road ahead of the car so it drives past.
    const side = this.shot % 2 ? 1 : -1;
    const p = track.pointAt(distance + 55, side * (track.wallOffset - 1));
    this.fixed.set(p.x, p.y + 1.3, p.z);
  }

  /** Restart the homescreen shot sequence. */
  resetAttract(track: TrackPath, distance: number): void {
    this.shot = -1;
    this.nextShot(track, distance);
  }

  /** Slow turntable around a parked car (garage), framed to the right of the menu panel. */
  garage(car: THREE.Object3D, dt: number): void {
    this.turntable += dt * 0.25;
    const c = car.position;
    const a = this.turntable;
    this.camera.position.set(c.x + Math.sin(a) * 8.2, c.y + 2.3, c.z + Math.cos(a) * 8.2);
    this.camera.lookAt(c.x, c.y + 0.5, c.z);
    this.camera.fov = 40;
    this.setFraming(window.innerWidth > 900 ? 0.2 : 0);
  }

  /** Shift the picture sideways by a fraction of the screen width (0 = centred). */
  setFraming(shift: number): void {
    const cam = this.camera;
    if (shift === 0) {
      if (cam.view?.enabled) cam.clearViewOffset();
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.setViewOffset(w, h, -w * shift, 0, w, h);
  }

  // ---------------------------------------------------------------- finish

  /** Trackside camera just past the line, watching the player cross it in slow motion. */
  startFinish(track: TrackPath, side: number): void {
    const p = track.pointAt(22, side * (track.wallOffset - 1.2));
    this.fixed.set(p.x, p.y + 1.2, p.z);
    this.finish = { t: 0 };
  }

  get finishActive(): boolean {
    return this.finish !== null;
  }

  /** Slow-motion factor for the simulation (1 when the shot is over). */
  updateFinish(car: THREE.Object3D, dt: number): number {
    const f = this.finish;
    if (!f) return 1;
    f.t += dt;
    this.camera.position.copy(this.fixed);
    car.localToWorld(this.tmp.set(0, 0.7, 1));
    this.camera.lookAt(this.tmp);
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
    if (f.t > 3) {
      this.finish = null;
      return 1;
    }
    // Ease out of slow motion over the last half second.
    return f.t < 2.5 ? 0.25 : 0.25 + 0.75 * smoothstep(2.5, 3, f.t);
  }
}
