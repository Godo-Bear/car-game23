import * as THREE from 'three';
import { mod } from '../core/math';
import { padTexture } from '../world/textures';
import type { CityCourseData } from './cityCourseData';
import type { TrackPath } from './TrackPath';

/**
 * Boost pads on a city course: on the straights, about every 450 m, alternately left and right
 * of the middle (clear of the grid and the start line).
 */
export function coursePads(track: TrackPath): { x: number; z: number; heading: number }[] {
  const S = track.samples;
  const out: { x: number; z: number; heading: number }[] = [];
  const reach = Math.round(60 / track.spacing);
  let last = -Infinity;
  for (let i = Math.round(120 / track.spacing); i < S.length - Math.round(90 / track.spacing); i++) {
    if (S[i].dist - last < 450) continue;
    let straight = true;
    for (let k = -reach; k <= reach && straight; k += 3) straight = Math.abs(S[mod(i + k, S.length)].curvature) < 1 / 150;
    if (!straight) continue;
    last = S[i].dist;
    const p = track.pointAt(S[i].dist, (out.length % 2 ? 1 : -1) * 2.6);
    out.push({ x: p.x, z: p.z, heading: S[i].heading });
  }
  return out;
}

/**
 * A city course laid over the free drive city's streets: a start/finish gantry with its start
 * lights and a chequered line, glowing arrows down the road so you can see where the course
 * goes at every junction, chevron boards on the outside of the turns, and yellow 近道 SHORTCUT
 * signs and arrows down each official shortcut.
 */
export class CourseDecor {
  readonly group = new THREE.Group();
  private readonly lights: THREE.MeshBasicMaterial[] = [];
  private readonly arrowMat: THREE.MeshBasicMaterial;
  private readonly shortcutMat: THREE.MeshBasicMaterial;

  constructor(track: TrackPath, data: CityCourseData, pads: { x: number; z: number; heading: number }[] = []) {
    this.group.name = 'course';
    const S = track.samples;
    const y = (i: number) => S[mod(i, S.length)].y;

    // Start/finish: a chequered line across the road and a gantry over it.
    const start = S[0];
    const hw = track.halfWidth + 1.2;
    const checks = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 1.6),
      new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    checks.rotation.set(-Math.PI / 2, 0, -start.heading);
    checks.position.set(start.x, start.y + 0.03, start.z);
    this.group.add(checks);
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2d36, metalness: 0.6, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
      post.position.set(side * hw, 3.5, 0);
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.5, 1.5, 0.6), steel);
    beam.position.y = 7.2;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 1, 1.2), new THREE.MeshBasicMaterial({ map: bannerTexture(), side: THREE.DoubleSide }));
    banner.position.set(0, 7.2, -0.32);
    gantry.add(beam, banner);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0, 0) });
      this.lights.push(m);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), m);
      lamp.position.set((k - 2) * 1.1, 8.35, -0.1);
      gantry.add(lamp);
    }
    gantry.position.set(start.x, start.y, start.z);
    gantry.rotation.y = start.heading;
    this.group.add(gantry);

    // Arrows down the middle of the road every 40 m (more on the way into a turn).
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.25, 1.1, 1.6),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const arrowGeo = arrowGeometry(2.4, 3.2);
    const step = Math.round(40 / track.spacing);
    for (let i = Math.round(30 / track.spacing); i < S.length - 10; i += step) {
      const turning = Math.abs(S[(i + Math.round(25 / track.spacing)) % S.length].curvature) > 1 / 40;
      for (const back of turning ? [0, 6, 12] : [0]) {
        const s = S[mod(i - Math.round(back / track.spacing), S.length)];
        const a = new THREE.Mesh(arrowGeo, this.arrowMat);
        a.position.set(s.x, s.y + 0.04, s.z);
        a.rotation.y = s.heading;
        this.group.add(a);
      }
    }

    // Chevron boards on the outside of the tight turns (the junctions).
    const chevron = new THREE.MeshBasicMaterial({ map: chevronTexture(), side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x777777 });
    let lastTurn = -999;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (Math.abs(s.curvature) < 1 / 25 || i - lastTurn < 20 / track.spacing) continue;
      lastTurn = i;
      const out = s.curvature > 0 ? 1 : -1;
      const lat = out * (track.halfWidth + 2.2);
      // Ahead of the turn's apex, facing the cars coming in.
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), chevron);
      board.position.set(s.x + s.rx * lat, y(i) + 1.6, s.z + s.rz * lat);
      board.rotation.y = s.heading;
      board.scale.x = -out;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), poleMat);
      pole.position.set(board.position.x, y(i) + 0.8, board.position.z);
      this.group.add(board, pole);
    }

    // Shortcuts: a sign at the way in, and yellow arrows all the way down the side street.
    this.shortcutMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 1.15, 0.15),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const sign = new THREE.MeshBasicMaterial({ map: shortcutTexture(), side: THREE.DoubleSide });
    for (const sc of data.shortcuts) {
      const P = sc.pts;
      let run = 0;
      for (let i = 1; i < P.length; i++) {
        run += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        if (run < 14) continue;
        run = 0;
        const a = new THREE.Mesh(arrowGeo, this.shortcutMat);
        a.position.set(P[i][0], 0.11, P[i][1]);
        a.rotation.y = Math.atan2(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        this.group.add(a);
      }
      // The sign stands at the corner where the shortcut leaves the course.
      const [x0, z0] = P[0];
      const [x1, z1] = P[Math.min(3, P.length - 1)];
      const dir = Math.atan2(x1 - x0, z1 - z0);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), sign);
      const side = 8.5;
      const bx = x0 + Math.sin(dir) * 6 + Math.cos(dir) * side;
      const bz = z0 + Math.cos(dir) * 6 - Math.sin(dir) * side;
      board.position.set(bx, 3.2, bz);
      board.rotation.y = dir + Math.PI;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), poleMat);
      pole.position.set(bx, 1.3, bz);
      this.group.add(board, pole);
    }
    // Boost pads.
    const padMat = new THREE.MeshBasicMaterial({ map: padTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    for (const p of pads) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.4), padMat);
      pad.rotation.set(-Math.PI / 2, 0, p.heading + Math.PI);
      pad.position.set(p.x, 0.12, p.z);
      this.group.add(pad);
    }
    this.group.traverse((o) => {
      o.userData.noAO = true;
    });
  }

  setStartLights(count: number): void {
    this.lights.forEach((m, k) => {
      if (count > k) m.color.setRGB(9, 0.25, 0.15);
      else m.color.setRGB(0.08, 0, 0);
    });
  }

  /** The arrows pulse gently so they read as guidance, not paint. */
  update(elapsed: number): void {
    this.arrowMat.opacity = 0.42 + Math.sin(elapsed * 3) * 0.12;
    this.shortcutMat.opacity = 0.6 + Math.sin(elapsed * 4) * 0.15;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
      mat?.map?.dispose();
      mat?.dispose?.();
    });
    this.group.removeFromParent();
  }
}

/** A flat chevron arrow lying on the road, pointing along +z. */
function arrowGeometry(width: number, length: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = width / 2;
  s.moveTo(0, length / 2);
  s.lineTo(w, -length / 2 + 0.9);
  s.lineTo(w * 0.55, -length / 2 + 0.9);
  s.lineTo(0, length / 2 - 1.2);
  s.lineTo(-w * 0.55, -length / 2 + 0.9);
  s.lineTo(-w, -length / 2 + 0.9);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // Lay it flat, face up, pointing down +z.
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  return g;
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function checkerTexture(): THREE.Texture {
  const t = canvas(256, 32, (g) => {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
  t.magFilter = THREE.NearestFilter;
  return t;
}

function bannerTexture(): THREE.Texture {
  return canvas(512, 64, (g) => {
    g.fillStyle = '#ff2d6f';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#fff';
    g.font = 'bold 40px "Hiragino Sans", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('市街地 CITY GRAND PRIX', 256, 34);
  });
}

function chevronTexture(): THREE.Texture {
  return canvas(128, 64, (g) => {
    g.fillStyle = '#f2c200';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#111';
    for (const x0 of [22, 62]) {
      g.beginPath();
      g.moveTo(x0, 8);
      g.lineTo(x0 + 24, 32);
      g.lineTo(x0, 56);
      g.lineTo(x0 + 14, 56);
      g.lineTo(x0 + 38, 32);
      g.lineTo(x0 + 14, 8);
      g.closePath();
      g.fill();
    }
  });
}

function shortcutTexture(): THREE.Texture {
  return canvas(256, 128, (g) => {
    g.fillStyle = '#ffd21f';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#111';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#111';
    g.font = 'bold 44px "Hiragino Sans", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.fillText('近道', 92, 58);
    g.font = 'bold 28px sans-serif';
    g.fillText('SHORTCUT', 112, 104);
    // An arrow pointing off to the side.
    g.beginPath();
    g.moveTo(178, 22);
    g.lineTo(236, 50);
    g.lineTo(178, 78);
    g.closePath();
    g.fill();
  });
}
