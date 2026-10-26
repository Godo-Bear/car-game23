import * as THREE from 'three';
import { mod } from '../core/math';
import { GeometryBuilder } from '../world/GeometryBuilder';
import {
  asphaltTexture,
  bannerTexture,
  checkerTexture,
  fenceTexture,
  ROAD_TEXTURE_LENGTH,
  sidewalkTexture,
} from '../world/textures';
import type { TrackPath } from './TrackPath';

type V3 = [number, number, number];

export interface TrackVisualOptions {
  gridSlots: { distance: number; lateral: number }[];
  /** World positions of street lamps (used to bake light pools into the road). */
  lamps: { x: number; z: number; index: number }[];
  /** Zebra crossings at these lap distances. */
  crossings: number[];
}

export interface TrackVisual {
  group: THREE.Group;
  /** 0 = all off, 1..5 = that many red lights lit, -1 = go (off). */
  setStartLights(count: number): void;
}

const BARRIER_HEIGHT = 1.05;
export const BARRIER_THICKNESS = 0.5;
export const SIDEWALK_WIDTH = 4;
const FENCE_HEIGHT = 2.6;

export function buildTrackVisual(track: TrackPath, rng: () => number, opts: TrackVisualOptions): TrackVisual {
  const group = new THREE.Group();
  group.name = 'track';
  const n = track.count;
  const S = track.samples;
  const hw = track.halfWidth;
  const wall = track.wallOffset;

  const at = (i: number, lateral: number, dy = 0): V3 => {
    const s = S[mod(i, n)];
    return [s.x + s.rx * lateral, s.y + dy, s.z + s.rz * lateral];
  };

  // ---------- Road surface with baked street-light pools ----------
  const repeats = Math.max(1, Math.round(track.length / ROAD_TEXTURE_LENGTH));
  const texLen = track.length / repeats;
  const road = new GeometryBuilder(true);
  const lampColor = new THREE.Color();
  const lightAt = (x: number, z: number, i: number): THREE.Color => {
    let b = 0.42;
    for (const lamp of opts.lamps) {
      let di = Math.abs(lamp.index - i);
      di = Math.min(di, n - di);
      if (di > 20) continue;
      const d2 = (lamp.x - x) ** 2 + (lamp.z - z) ** 2;
      b += 1.25 * Math.exp(-d2 / (2 * 11 * 11));
    }
    b = Math.min(b, 1.7);
    return lampColor.setRGB(b, b * 0.93, b * 0.82).clone();
  };
  for (let i = 0; i <= n; i++) {
    const s = S[i % n];
    const v = (i === n ? track.length : s.dist) / texLen;
    const left = at(i, -wall);
    const right = at(i, wall);
    road.vertex(left, [0, 1, 0], -(wall - hw) / track.width, v, lightAt(left[0], left[2], i % n));
    road.vertex(right, [0, 1, 0], 1 + (wall - hw) / track.width, v, lightAt(right[0], right[2], i % n));
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    // In three.js (y up) forward x right points down, so wind left -> right -> next-left to face up.
    road.triangle(a, a + 1, a + 2);
    road.triangle(a + 1, a + 3, a + 2);
  }
  const asphalt = asphaltTexture(rng);
  asphalt.wrapS = THREE.ClampToEdgeWrapping;
  const roadMesh = new THREE.Mesh(
    road.build(),
    new THREE.MeshStandardMaterial({ map: asphalt, vertexColors: true, roughness: 0.82, metalness: 0.05 }),
  );
  roadMesh.name = 'road';
  group.add(roadMesh);

  // ---------- Barriers, catch fence, sidewalks, curbs ----------
  const barrier = new GeometryBuilder(true);
  const fence = new GeometryBuilder();
  const sidewalk = new GeometryBuilder();
  const curbs = new GeometryBuilder(true);
  const deck = new GeometryBuilder();
  const concrete = new THREE.Color(0.42, 0.42, 0.45);
  const red = new THREE.Color(0.75, 0.05, 0.05);
  const white = new THREE.Color(0.92, 0.92, 0.92);

  for (let i = 0; i < n; i++) {
    const s0 = S[i];
    const s1 = S[(i + 1) % n];
    const corner = Math.abs(s0.curvature) > 1 / 90;
    const outside = corner ? Math.sign(-s0.curvature) || 1 : 0; // right (+1) for left-handers
    const elevated = s0.y > 1.5 || s1.y > 1.5;

    for (const side of [-1, 1]) {
      const stripe = corner && side === outside ? (Math.floor(i / 2) % 2 ? red : white) : concrete;
      const inner = side * wall;
      const outer = side * (wall + BARRIER_THICKNESS);
      // Inner face (toward the road), top, outer face.
      facing(barrier, at(i, inner), at(i + 1, inner), at(i + 1, inner, BARRIER_HEIGHT), at(i, inner, BARRIER_HEIGHT), [-side * s0.rx, 0, -side * s0.rz], stripe);
      facing(barrier, at(i, inner, BARRIER_HEIGHT), at(i + 1, inner, BARRIER_HEIGHT), at(i + 1, outer, BARRIER_HEIGHT), at(i, outer, BARRIER_HEIGHT), [0, 1, 0], stripe);
      facing(barrier, at(i, outer, -1.1), at(i + 1, outer, -1.1), at(i + 1, outer, BARRIER_HEIGHT), at(i, outer, BARRIER_HEIGHT), [side * s0.rx, 0, side * s0.rz], concrete);

      if (!elevated) {
        const f = side * (wall + BARRIER_THICKNESS / 2);
        facing(fence, at(i, f, BARRIER_HEIGHT), at(i + 1, f, BARRIER_HEIGHT), at(i + 1, f, BARRIER_HEIGHT + FENCE_HEIGHT), at(i, f, BARRIER_HEIGHT + FENCE_HEIGHT), [-side * s0.rx, 0, -side * s0.rz], undefined, s0.dist / 0.8, 0, (s0.dist + track.spacing) / 0.8, FENCE_HEIGHT / 0.8);
      }

      const w0 = side * (wall + BARRIER_THICKNESS);
      const w1 = side * (wall + BARRIER_THICKNESS + SIDEWALK_WIDTH);
      facing(sidewalk, at(i, w0, 0.14), at(i + 1, w0, 0.14), at(i + 1, w1, 0.14), at(i, w1, 0.14), [0, 1, 0], undefined, w0 / 2, s0.dist / 2, w1 / 2, (s0.dist + track.spacing) / 2);
      // Kerb face / expressway deck edge.
      facing(deck, at(i, w1, -1.1), at(i + 1, w1, -1.1), at(i + 1, w1, 0.14), at(i, w1, 0.14), [side * s0.rx, 0, side * s0.rz]);
    }
    if (elevated) {
      const L = -(wall + BARRIER_THICKNESS + SIDEWALK_WIDTH);
      facing(deck, at(i, L, -1.1), at(i + 1, L, -1.1), at(i + 1, -L, -1.1), at(i, -L, -1.1), [0, -1, 0]);
    }

    // Red/white kerbs on the inside of corners.
    if (corner) {
      const inside = -outside;
      const color = i % 2 ? red : white;
      const a = inside * (hw - 1.0);
      const b = inside * (hw + 0.35);
      facing(curbs, at(i, a, 0.035), at(i + 1, a, 0.035), at(i + 1, b, 0.035), at(i, b, 0.035), [0, 1, 0], color);
    }
  }

  group.add(new THREE.Mesh(barrier.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));
  const fenceTex = fenceTexture();
  group.add(
    new THREE.Mesh(
      fence.build(),
      new THREE.MeshBasicMaterial({ map: fenceTex, color: 0x9aa0ad, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    ),
  );
  group.add(new THREE.Mesh(sidewalk.build(), new THREE.MeshStandardMaterial({ map: sidewalkTexture(rng), roughness: 0.9 })));
  group.add(new THREE.Mesh(curbs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));

  // ---------- Expressway pillars ----------
  for (let i = 0; i < n; i += 12) {
    const s = S[i];
    if (s.y < 2.5) continue;
    const h = s.y - 1.1;
    deck.box(s.x, 0, s.z, 3.2, h, 1.8, s.heading);
    deck.box(s.x, h - 1.2, s.z, (wall + BARRIER_THICKNESS + SIDEWALK_WIDTH) * 2, 1.2, 1.6, s.heading);
  }
  group.add(new THREE.Mesh(deck.build(), new THREE.MeshStandardMaterial({ color: 0x5f6168, roughness: 0.9 })));

  // ---------- Start / finish line and grid boxes ----------
  const paint = new GeometryBuilder();
  for (const slot of opts.gridSlots) {
    const d = slot.distance;
    const p = (dd: number, lat: number): V3 => {
      const q = track.pointAt(d + dd, slot.lateral + lat);
      return [q.x, q.y + 0.03, q.z];
    };
    facing(paint, p(2.6, -1.3), p(2.6, 1.3), p(2.85, 1.3), p(2.85, -1.3), [0, 1, 0]);
    facing(paint, p(0.6, -1.3), p(2.6, -1.3), p(2.6, -1.1), p(0.6, -1.1), [0, 1, 0]);
    facing(paint, p(0.6, 1.1), p(2.6, 1.1), p(2.6, 1.3), p(0.6, 1.3), [0, 1, 0]);
  }
  for (const d0 of opts.crossings) {
    // Zebra crossing: bars run along the road, spaced across it.
    for (let lat = -hw + 0.6; lat < hw - 0.3; lat += 1.0) {
      const q = (dd: number, l: number): V3 => {
        const r = track.pointAt(d0 + dd, l);
        return [r.x, r.y + 0.028, r.z];
      };
      facing(paint, q(-2, lat), q(2, lat), q(2, lat + 0.5), q(-2, lat + 0.5), [0, 1, 0]);
    }
  }
  group.add(new THREE.Mesh(paint.build(), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.6 })));

  const start = S[0];
  const checker = new GeometryBuilder();
  facing(checker, at(0, -hw, 0.032), at(0, hw, 0.032), at(1, hw, 0.032), at(1, -hw, 0.032), [0, 1, 0], undefined, 0, 0, 1, 1);
  group.add(new THREE.Mesh(checker.build(), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 })));

  // ---------- Start gantry with five start lights ----------
  const gantry = new THREE.Group();
  gantry.position.set(start.x, start.y, start.z);
  gantry.rotation.y = start.heading;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: 0.6, roughness: 0.4 });
  const span = wall + 1.4;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
    pillar.position.set(side * span, 4, 0);
    gantry.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.9, 0.7), steel);
  beam.position.set(0, 7.1, 0);
  gantry.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.6, span * 1.6 * (160 / 1024)), new THREE.MeshBasicMaterial({ map: bannerTexture() }));
  banner.rotation.y = Math.PI;
  banner.position.set(0, 7.15, -0.37);
  gantry.add(banner);
  const backBanner = banner.clone();
  backBanner.rotation.y = 0;
  backBanner.position.z = 0.37;
  gantry.add(backBanner);
  const lightMats: THREE.MeshBasicMaterial[] = [];
  const lightGeo = new THREE.CircleGeometry(0.32, 20);
  const housing = new THREE.BoxGeometry(1.0, 1.0, 0.3);
  for (let k = 0; k < 5; k++) {
    const x = (k - 2) * 1.25;
    const box = new THREE.Mesh(housing, steel);
    box.position.set(x, 5.6, 0);
    gantry.add(box);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.0, 0.0) });
    const lamp = new THREE.Mesh(lightGeo, mat);
    lamp.rotation.y = Math.PI;
    lamp.position.set(x, 5.6, -0.16);
    gantry.add(lamp);
    lightMats.push(mat);
  }
  group.add(gantry);

  return {
    group,
    setStartLights(count: number) {
      lightMats.forEach((m, k) => {
        if (count > k) m.color.setRGB(9, 0.25, 0.15);
        else m.color.setRGB(0.08, 0, 0);
      });
    },
  };
}

/** Add a quad, flipping its winding if needed so its normal faces `want`. */
function facing(
  b: GeometryBuilder,
  p0: V3,
  p1: V3,
  p2: V3,
  p3: V3,
  want: V3,
  color?: THREE.Color,
  u0 = 0,
  v0 = 0,
  u1 = 1,
  v1 = 1,
): void {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  b.quad(p0, p1, p2, p3, u0, v0, u1, v1, color, nx * want[0] + ny * want[1] + nz * want[2] < 0);
}
