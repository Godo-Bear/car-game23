import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { RacingLine } from '../ai/RacingLine';
import { mod } from '../core/math';
import { GeometryBuilder } from '../world/GeometryBuilder';
import { applyRoadDetail, asphaltNormalMap, concreteNormalMap } from '../world/surfaces';
import { asphaltTexture, bannerTexture, checkerTexture, fenceTexture, ROAD_TEXTURE_LENGTH, ruralAsphaltTexture, sidewalkTexture } from '../world/textures';
import type { TrackPath } from './TrackPath';
import type { TrackTheme } from './tracks';

type V3 = [number, number, number];

export interface TrackVisualOptions {
  theme: TrackTheme;
  /** Subtitle on the start/finish gantry. */
  banner: string;
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
  /** Street-light pools on the road only show after dark. */
  setTimeOfDay(tod: TimeOfDay): void;
}

const BARRIER_HEIGHT = 1.05;
export const BARRIER_THICKNESS = 0.5;
export const SIDEWALK_WIDTH = 4;
const FENCE_HEIGHT = 2.6;
/** Kerbs run from this far inside the road edge... */
export const KERB_INNER = 1.0;
/** ...to this far outside it. */
export const KERB_OUTER = 0.35;

/** Which side of the road has a kerb at sample `i`: -1 left, +1 right, 0 none (inside of corners). */
export function kerbSide(track: TrackPath, i: number): number {
  const c = track.samples[mod(i, track.count)].curvature;
  if (Math.abs(c) <= 1 / 90) return 0;
  return -(Math.sign(-c) || 1);
}

export function buildTrackVisual(track: TrackPath, rng: () => number, opts: TrackVisualOptions): TrackVisual {
  const group = new THREE.Group();
  group.name = 'track';
  const n = track.count;
  const S = track.samples;
  const hw = track.halfWidth;
  const wall = track.wallOffset;
  const city = opts.theme === 'city';

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
    if (!city) return lampColor.setRGB(1, 1, 1).clone();
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
  const asphalt = city ? asphaltTexture(rng) : ruralAsphaltTexture(rng, opts.theme === 'mountain' ? 'yellow' : 'dashed');
  asphalt.wrapS = THREE.ClampToEdgeWrapping;
  // Relief from the aggregate catches low sun and headlights (tiles every ~1.5 m).
  const roadNormals = asphaltNormalMap().clone();
  roadNormals.repeat.set(track.width / 1.5, texLen / 1.5);
  roadNormals.userData.shared = false;
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: asphalt,
    vertexColors: city,
    roughness: 0.82,
    metalness: 0.05,
    normalMap: roadNormals,
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  applyRoadDetail(roadMaterial);
  const roadMesh = new THREE.Mesh(road.build(), roadMaterial);
  roadMesh.name = 'road';
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // ---------- Barriers, catch fence, sidewalks, curbs ----------
  const concreteRelief = concreteNormalMap();
  const barrier = new GeometryBuilder(true);
  const fence = new GeometryBuilder();
  const sidewalk = new GeometryBuilder();
  const curbs = new GeometryBuilder(true);
  const deck = new GeometryBuilder();
  const rail = new GeometryBuilder();
  const posts = new GeometryBuilder();
  const concrete = new THREE.Color(0.42, 0.42, 0.45);
  const red = new THREE.Color(0.75, 0.05, 0.05);
  const white = new THREE.Color(0.92, 0.92, 0.92);

  for (let i = 0; i < n; i++) {
    const s0 = S[i];
    const s1 = S[(i + 1) % n];
    const corner = Math.abs(s0.curvature) > 1 / 90;
    const outside = corner ? Math.sign(-s0.curvature) || 1 : 0; // right (+1) for left-handers
    const elevated = s0.y > 1.5 || s1.y > 1.5;

    if (!city) {
      for (const side of [-1, 1]) {
        // Guardrail (W-beam) on posts; the physics barrier is its inner face.
        const r = side * wall;
        const inward: V3 = [-side * s0.rx, 0, -side * s0.rz];
        facing(rail, at(i, r, 0.45), at(i + 1, r, 0.45), at(i + 1, r, 0.85), at(i, r, 0.85), inward);
        facing(rail, at(i, r, 0.45), at(i + 1, r, 0.45), at(i + 1, r, 0.85), at(i, r, 0.85), [-inward[0], 0, -inward[2]]);
        if (i % 2 === 0) {
          const pp = at(i, side * (wall + 0.15));
          posts.box(pp[0], pp[1] - 0.4, pp[2], 0.12, 1.25, 0.12, s0.heading);
        }
        // Road edge skirt so the terrain never shows a gap under the asphalt (a bridge's fascia).
        facing(deck, at(i, side * wall, -1.6), at(i + 1, side * wall, -1.6), at(i + 1, side * wall, 0), at(i, side * wall, 0), [side * s0.rx, 0, side * s0.rz]);
      }
      // A bridge over another part of the course: the underside of the deck.
      if (s0.bridge > 0.5 || s1.bridge > 0.5) {
        facing(deck, at(i, -wall, -1.6), at(i + 1, -wall, -1.6), at(i + 1, wall, -1.6), at(i, wall, -1.6), [0, -1, 0]);
      }
    }

    for (const side of city ? [-1, 1] : []) {
      const stripe = corner && side === outside ? (Math.floor(i / 2) % 2 ? red : white) : concrete;
      const inner = side * wall;
      const outer = side * (wall + BARRIER_THICKNESS);
      // Inner face (toward the road), top, outer face.
      facing(
        barrier,
        at(i, inner),
        at(i + 1, inner),
        at(i + 1, inner, BARRIER_HEIGHT),
        at(i, inner, BARRIER_HEIGHT),
        [-side * s0.rx, 0, -side * s0.rz],
        stripe,
      );
      facing(
        barrier,
        at(i, inner, BARRIER_HEIGHT),
        at(i + 1, inner, BARRIER_HEIGHT),
        at(i + 1, outer, BARRIER_HEIGHT),
        at(i, outer, BARRIER_HEIGHT),
        [0, 1, 0],
        stripe,
      );
      facing(
        barrier,
        at(i, outer, -1.1),
        at(i + 1, outer, -1.1),
        at(i + 1, outer, BARRIER_HEIGHT),
        at(i, outer, BARRIER_HEIGHT),
        [side * s0.rx, 0, side * s0.rz],
        concrete,
      );

      if (!elevated) {
        const f = side * (wall + BARRIER_THICKNESS / 2);
        facing(
          fence,
          at(i, f, BARRIER_HEIGHT),
          at(i + 1, f, BARRIER_HEIGHT),
          at(i + 1, f, BARRIER_HEIGHT + FENCE_HEIGHT),
          at(i, f, BARRIER_HEIGHT + FENCE_HEIGHT),
          [-side * s0.rx, 0, -side * s0.rz],
          undefined,
          s0.dist / 0.8,
          0,
          (s0.dist + track.spacing) / 0.8,
          FENCE_HEIGHT / 0.8,
        );
      }

      const w0 = side * (wall + BARRIER_THICKNESS);
      const w1 = side * (wall + BARRIER_THICKNESS + SIDEWALK_WIDTH);
      facing(
        sidewalk,
        at(i, w0, 0.14),
        at(i + 1, w0, 0.14),
        at(i + 1, w1, 0.14),
        at(i, w1, 0.14),
        [0, 1, 0],
        undefined,
        w0 / 2,
        s0.dist / 2,
        w1 / 2,
        (s0.dist + track.spacing) / 2,
      );
      // Kerb face / expressway deck edge.
      facing(deck, at(i, w1, -1.1), at(i + 1, w1, -1.1), at(i + 1, w1, 0.14), at(i, w1, 0.14), [side * s0.rx, 0, side * s0.rz]);
    }
    if (elevated) {
      const L = -(wall + BARRIER_THICKNESS + SIDEWALK_WIDTH);
      facing(deck, at(i, L, -1.1), at(i + 1, L, -1.1), at(i + 1, -L, -1.1), at(i, -L, -1.1), [0, -1, 0]);
    }

    // Red/white kerbs on the inside of corners.
    if (corner) {
      const inside = kerbSide(track, i);
      const color = i % 2 ? red : white;
      const a = inside * (hw - KERB_INNER);
      const b = inside * (hw + KERB_OUTER);
      facing(curbs, at(i, a, 0.035), at(i + 1, a, 0.035), at(i + 1, b, 0.035), at(i, b, 0.035), [0, 1, 0], color);
    }
  }

  if (city) {
    group.add(new THREE.Mesh(barrier.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, normalMap: concreteRelief })));
    const fenceTex = fenceTexture();
    group.add(
      new THREE.Mesh(
        fence.build(),
        new THREE.MeshBasicMaterial({ map: fenceTex, color: 0x9aa0ad, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      ),
    );
    const walk = new THREE.Mesh(sidewalk.build(), new THREE.MeshStandardMaterial({ map: sidewalkTexture(rng), roughness: 0.9, normalMap: concreteRelief }));
    walk.receiveShadow = true;
    group.add(walk);
  } else {
    const railColor = opts.theme === 'mountain' ? 0xb7bcc4 : 0xf0f0ea;
    group.add(new THREE.Mesh(rail.build(), new THREE.MeshStandardMaterial({ color: railColor, metalness: 0.55, roughness: 0.35 })));
    group.add(new THREE.Mesh(posts.build(), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.5, roughness: 0.5 })));
  }
  const kerbs = new THREE.Mesh(curbs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, normalMap: concreteRelief }));
  kerbs.receiveShadow = true;
  group.add(kerbs);

  // ---------- Pillars: under city expressways, and under bridges where the course crosses itself ----------
  // (Never on the road underneath: a pillar there is left out and the deck spans over it.)
  const clearOfRoads = (i: number, reach: number): boolean => {
    const s = S[i];
    const apart = Math.ceil(60 / track.spacing);
    for (let j = 0; j < n; j += 2) {
      const dj = Math.abs(j - i);
      if (Math.min(dj, n - dj) < apart) continue;
      const o = S[j];
      if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < (wall + reach) ** 2) return false;
    }
    return true;
  };
  const cap = city ? (wall + BARRIER_THICKNESS + SIDEWALK_WIDTH) * 2 : wall * 2;
  for (let i = 0; i < n; i += city ? 12 : 10) {
    const s = S[i];
    const high = city ? s.y >= 2.5 : s.bridge >= 2.5;
    if (!high || !clearOfRoads(i, 4)) continue;
    const top = s.y - (city ? 1.1 : 1.6);
    // City pillars stand on the street; mountain ones go down into the valley floor.
    const base = city ? 0 : s.y - s.bridge - 2;
    deck.box(s.x, base, s.z, city ? 3.2 : 2.6, top - base, 1.8, s.heading);
    deck.box(s.x, top - 1.2, s.z, cap, 1.2, 1.6, s.heading);
  }
  group.add(new THREE.Mesh(deck.build(), new THREE.MeshStandardMaterial({ color: city ? 0x5f6168 : 0x4a4740, roughness: 0.9, normalMap: concreteRelief })));

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

  // ---------- Start gantry with five start lights (a torii gate in the countryside) ----------
  const gantry = new THREE.Group();
  gantry.position.set(start.x, start.y, start.z);
  gantry.rotation.y = start.heading;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: 0.6, roughness: 0.4 });
  const span = wall + 1.4;
  let bannerY = 7.15;
  if (opts.theme === 'countryside') {
    const vermilion = new THREE.MeshStandardMaterial({ color: 0xd8341f, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 9, 16), vermilion);
      pillar.position.set(side * span, 4.5, 0);
      gantry.add(pillar);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.7, 16), black);
      foot.position.set(side * span, 0.35, 0);
      gantry.add(foot);
    }
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.6, 0.7, 0.55), vermilion);
    nuki.position.set(0, 6.9, 0);
    gantry.add(nuki);
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 4.2, 0.8, 1.0), vermilion);
    kasagi.position.set(0, 8.9, 0);
    gantry.add(kasagi);
    const top = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 4.8, 0.45, 1.2), black);
    top.position.set(0, 9.5, 0);
    gantry.add(top);
    // Upswept tips of the top beam.
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.2), black);
      tip.position.set(side * (span + 2.6), 9.75, 0);
      tip.rotation.z = side * 0.28;
      gantry.add(tip);
    }
    bannerY = 7.95;
  } else {
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
      pillar.position.set(side * span, 4, 0);
      gantry.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.9, 0.7), steel);
    beam.position.set(0, 7.1, 0);
    gantry.add(beam);
  }
  const bannerWidth = Math.min(span * 1.6, 15);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(bannerWidth, bannerWidth * (160 / 1024)),
    new THREE.MeshBasicMaterial({ map: bannerTexture(opts.banner) }),
  );
  banner.rotation.y = Math.PI;
  banner.position.set(0, bannerY, -0.37);
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
    if (opts.theme === 'countryside') box.position.y = 5.9;
    gantry.add(box);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.0, 0.0) });
    const lamp = new THREE.Mesh(lightGeo, mat);
    lamp.rotation.y = Math.PI;
    lamp.position.set(x, box.position.y, -0.16);
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
    setTimeOfDay(tod: TimeOfDay) {
      if (!city) return;
      // Wet at night: keep the neon reflections as a sheen, with lamps and signs streaking on top.
      roadMaterial.envMapIntensity = tod === 'night' ? 0.55 : 1;
      roadMaterial.vertexColors = tod !== 'day';
      roadMaterial.needsUpdate = true;
    },
  };
}

/**
 * Rubber laid down on the racing line: two dark wheel tracks that get heavier in braking zones
 * and through corners, where tyres work hardest.
 */
export function buildRubberLine(track: TrackPath, line: RacingLine): THREE.Mesh {
  const n = track.count;
  const S = track.samples;
  const v = line.speedProfile(1.2, 9, 75);
  const ahead = Math.max(1, Math.round(18 / track.spacing));
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const s = S[k];
    const braking = Math.min(1, Math.max(0, (v[k] - v[(k + ahead) % n]) / 10));
    const corner = Math.min(1, Math.abs(line.curvature[k]) * 40);
    const alpha = 0.1 + 0.32 * braking + 0.1 * corner;
    for (const wheel of [-0.8, 0.8]) {
      for (const [dl, a] of [
        [-0.42, 0],
        [0, alpha],
        [0.42, 0],
      ] as const) {
        const lat = line.offsets[k] + wheel + dl;
        pos.push(s.x + s.rx * lat, s.y + 0.012, s.z + s.rz * lat);
        col.push(0.02, 0.02, 0.02, a);
      }
    }
  }
  // 6 vertices per row (2 strips x 3); 2 quads per strip.
  for (let i = 0; i < n; i++) {
    for (const strip of [0, 3]) {
      for (const q of [0, 1]) {
        const a = i * 6 + strip + q;
        const b = a + 6;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.name = 'rubber';
  mesh.userData.noAO = true;
  return mesh;
}

/** Add a quad, flipping its winding if needed so its normal faces `want`. */
function facing(b: GeometryBuilder, p0: V3, p1: V3, p2: V3, p3: V3, want: V3, color?: THREE.Color, u0 = 0, v0 = 0, u1 = 1, v1 = 1): void {
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
