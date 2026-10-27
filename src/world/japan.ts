import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeOfDay } from '../../shared/api';
import { lerp, smoothstep } from '../core/math';
import type { TrackPath } from '../track/TrackPath';
import { windTime } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';

/**
 * The things that make a scene read as Japan at a glance: Mt. Fuji, power poles with tangles
 * of sagging wires, vending machines, trains on viaducts, curve mirrors on mountain bends,
 * lattice-framed cut slopes, flooded rice paddies, tiled and thatched farmhouses, carp
 * streamers and a ropeway. Everything is merged per material to keep draw calls low.
 */

type V3 = [number, number, number];
export type Ground = (x: number, z: number) => number;

/** Something with optional per-frame and time-of-day behaviour. */
export interface Feature {
  readonly group: THREE.Object3D;
  setTimeOfDay?(tod: TimeOfDay): void;
  update?(time: number): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Map local (x along `heading`'s right, y up, z forward) to world around (cx, cy, cz). */
function placer(cx: number, cy: number, cz: number, heading: number) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // Right-hand side of the facing direction.
  const rx = -fz;
  const rz = fx;
  return (x: number, y: number, z: number): V3 => [cx + rx * x + fx * z, cy + y, cz + rz * x + fz * z];
}

/** Quad that faces `up`-ish or outward: flips automatically if its normal points the wrong way. */
function facingQuad(b: GeometryBuilder, a: V3, c1: V3, c2: V3, d: V3, want: V3, u0 = 0, v0 = 0, u1 = 1, v1 = 1, color?: THREE.Color): void {
  const ux = c1[0] - a[0];
  const uy = c1[1] - a[1];
  const uz = c1[2] - a[2];
  const vx = c2[0] - a[0];
  const vy = c2[1] - a[1];
  const vz = c2[2] - a[2];
  const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  b.quad(a, c1, c2, d, u0, v0, u1, v1, color, n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0);
}

// ---------------------------------------------------------------- Mt. Fuji

const FUJI_COLORS: Record<TimeOfDay, { rock: number; snow: number; haze: number; amount: number; light: number }> = {
  day: { rock: 0x51627f, snow: 0xf3f6fb, haze: 0xa8c3df, amount: 0.42, light: 1 },
  sunset: { rock: 0x4c3652, snow: 0xf3b9a6, haze: 0xd99a7e, amount: 0.38, light: 0.9 },
  night: { rock: 0x15162a, snow: 0x535a78, haze: 0x0e1426, amount: 0.3, light: 0.55 },
};

/** Mt. Fuji: a concave volcanic cone with snow running down its gullies, hazed by distance. */
export class MountFuji implements Feature {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;

  constructor(x: number, z: number, sunDir: () => THREE.Vector3) {
    const R = 1850;
    const H = 1000;
    const rings = 22;
    const segs = 96;
    const pos: number[] = [];
    const snow: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= rings; j++) {
      const r = 0.05 + (j / rings) * 0.95;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        // Radial gullies and ridges.
        const gully = Math.sin(a * 23) * 0.5 + Math.sin(a * 41 + 1.3) * 0.3 + Math.sin(a * 7 + 0.5) * 0.4;
        const k = 2.7;
        let h = (Math.exp(-k * r) - Math.exp(-k)) / (1 - Math.exp(-k));
        h *= 1 + gully * 0.018 * r;
        pos.push(x + Math.cos(a) * r * R, h * H - 40, z + Math.sin(a) * r * R);
        // Snow line dips down the gullies.
        const line = 0.5 + gully * 0.06 + Math.sin(a * 3) * 0.04;
        snow.push(smoothstep(line - 0.03, line + 0.03, h));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSnow', new THREE.Float32BufferAttribute(snow, 1));
    geo.setIndex(index);
    geo.computeVertexNormals();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uRock: { value: new THREE.Color() },
        uSnow: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uAmount: { value: 0.4 },
        uLight: { value: 1 },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        attribute float aSnow;
        varying float vSnow;
        varying vec3 vN;
        void main() {
          vSnow = aSnow;
          vN = normalize(normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uRock;
        uniform vec3 uSnow;
        uniform vec3 uHaze;
        uniform float uAmount;
        uniform float uLight;
        uniform vec3 uSun;
        varying float vSnow;
        varying vec3 vN;
        void main() {
          float lit = 0.55 + 0.6 * max(dot(vN, uSun), 0.0);
          vec3 c = mix(uRock, uSnow, vSnow) * lit * uLight;
          gl_FragColor = vec4(mix(c, uHaze, uAmount), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.group.add(new THREE.Mesh(geo, this.material));
    this.group.userData.noAO = true;
    this.group.name = 'fuji';
    this.sunDir = sunDir;
  }

  private readonly sunDir: () => THREE.Vector3;

  setTimeOfDay(tod: TimeOfDay): void {
    const c = FUJI_COLORS[tod];
    const u = this.material.uniforms;
    u.uRock.value.setHex(c.rock);
    u.uSnow.value.setHex(c.snow);
    u.uHaze.value.setHex(c.haze);
    u.uAmount.value = c.amount;
    u.uLight.value = c.light;
    u.uSun.value.copy(this.sunDir());
  }
}

// ---------------------------------------------------------------- power poles and wires

export interface PoleOptions {
  /** Distance of the poles from the centre line. */
  lateral: number;
  /** Metres between poles. */
  every: number;
  sides: number[];
  style: 'concrete' | 'wood';
  ground: Ground;
  /** Skip a pole at this sample (e.g. on an elevated section). */
  skip?: (i: number) => boolean;
}

/** Power poles along the road, with crossarms, transformers and sagging wires between them. */
export function powerLines(track: TrackPath, o: PoleOptions): Feature {
  const group = new THREE.Group();
  group.name = 'power-lines';
  const poles = new GeometryBuilder();
  const kit = new GeometryBuilder();
  const wires: number[] = [];
  const S = track.samples;
  const step = Math.max(1, Math.round(o.every / track.spacing));
  const height = o.style === 'concrete' ? 10.5 : 9;
  for (const side of o.sides) {
    let prev: { x: number; y: number; z: number; h: number } | null = null;
    let n = 0;
    for (let i = 0; i < S.length; i += step) {
      const s = S[i];
      const x = s.x + s.rx * side * o.lateral;
      const z = s.z + s.rz * side * o.lateral;
      const y = o.ground(x, z);
      if (o.skip?.(i) || Math.abs(y - s.y) > 4) {
        prev = null;
        continue;
      }
      n++;
      poles.cylinder(x, y - 0.5, z, 0.17, 0.12, height + 0.5, 7);
      const top = y + height;
      // Crossarms run across the road; wires run along it.
      kit.box(x, top - 0.9, z, 1.9, 0.12, 0.12, s.heading);
      kit.box(x, top - 1.8, z, 1.4, 0.12, 0.12, s.heading);
      if (n % 3 === 0) kit.cylinder(x - s.rx * side * 0.45, top - 4.2, z - s.rz * side * 0.45, 0.32, 0.32, 1.1, 8);
      if (prev) {
        const dx = x - prev.x;
        const dz = z - prev.z;
        const span = Math.hypot(dx, dz);
        if (span < o.every * 2.2) {
          const sag = 0.35 + span / 70;
          const add = (offset: number, dy: number, extraSag: number) => {
            const segs = 7;
            for (let k = 0; k < segs; k++) {
              for (const t of [k / segs, (k + 1) / segs]) {
                const px = lerp(prev!.x, x, t) + s.rx * offset;
                const pz = lerp(prev!.z, z, t) + s.rz * offset;
                const py = lerp(prev!.h, top, t) + dy - (sag + extraSag) * 4 * t * (1 - t);
                wires.push(px, py, pz);
              }
            }
          };
          for (const off of [-0.85, 0, 0.85]) add(off, -0.82, 0);
          for (const off of [-0.6, 0.6]) add(off, -1.72, 0.15);
          // Lower telephone/fibre cables sag the most.
          add(0, -4.6, 0.5);
          add(0.15, -5.1, 0.6);
        }
      }
      prev = { x, y, z, h: top };
    }
  }
  const poleColor = o.style === 'concrete' ? 0x9c9b95 : 0x5d4a38;
  group.add(new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({ color: poleColor, roughness: 0.85 })));
  group.add(new THREE.Mesh(kit.build(), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.6, metalness: 0.4 })));
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  const lines = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x15161a }));
  lines.userData.noAO = true;
  group.add(lines);
  return { group };
}

// ---------------------------------------------------------------- vending machines

export interface Spot {
  x: number;
  y: number;
  z: number;
  /** Direction the front faces (radians, 0 = +z). */
  facing: number;
}

let vendingTex: THREE.Texture | null = null;

function vendingTexture(): THREE.Texture {
  vendingTex ??= canvasTexture(128, 256, (g) => {
    g.fillStyle = '#e9edf2';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#1b5fb8';
    g.fillRect(0, 0, 128, 34);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.fillText('つめた〜い', 64, 24);
    const cans = ['#d7263d', '#f2a541', '#1b998b', '#2e86ab', '#5c4d7d', '#e2e2e2', '#3c6e47', '#f46036'];
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 6; k++) {
        const x = 8 + k * 19.5;
        const y = 44 + row * 38;
        g.fillStyle = cans[(row * 3 + k * 5) % cans.length];
        g.fillRect(x, y, 13, 24);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(x + 2, y + 3, 3, 18);
        g.fillStyle = '#c33';
        g.fillRect(x + 2, y + 28, 9, 4);
      }
    }
    g.fillStyle = '#222';
    g.fillRect(14, 210, 100, 30);
    g.fillStyle = '#9aa';
    g.fillRect(96, 196, 16, 8);
  });
  return vendingTex;
}

/** Glowing drink vending machines. */
export function vendingMachines(spots: Spot[], rng: () => number): Feature {
  const group = new THREE.Group();
  group.name = 'vending';
  const bodies = new GeometryBuilder(true);
  const fronts = new GeometryBuilder();
  const colors = [0xf2f2f2, 0xd7263d, 0x1b5fb8, 0xf2f2f2, 0x2b9348].map((c) => new THREE.Color(c));
  for (const p of spots) {
    const at = placer(p.x, p.y, p.z, p.facing);
    const center = at(0, 0, 0);
    bodies.box(center[0], p.y - 0.2, center[2], 1.0, 2.05, 0.8, p.facing, { color: colors[Math.floor(rng() * colors.length)] });
    // Corners run from the viewer's left to right, so the face points outward and reads correctly.
    fronts.quad(at(0.44, 0.35, 0.41), at(-0.44, 0.35, 0.41), at(-0.44, 1.75, 0.41), at(0.44, 1.75, 0.41), 0, 0, 1, 1);
  }
  group.add(new THREE.Mesh(bodies.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 })));
  const front = new THREE.MeshBasicMaterial({ map: vendingTexture() });
  group.add(new THREE.Mesh(fronts.build(), front));
  return {
    group,
    setTimeOfDay(tod) {
      const v = tod === 'night' ? 1.35 : tod === 'sunset' ? 1.05 : 0.88;
      front.color.setRGB(v, v, v);
    },
  };
}

// ---------------------------------------------------------------- railway viaduct + trains

export interface RailwayOptions {
  from: [number, number];
  to: [number, number];
  deckY: number;
  ground: Ground;
  kind: 'commuter' | 'shinkansen';
  /** End the viaduct in tunnel portals where it meets high ground. */
  tunnels: boolean;
  /** Whether a pier may stand here (e.g. not on a road). */
  clear?: (x: number, z: number) => boolean;
}

interface TrainSet {
  group: THREE.Group;
  length: number;
  speed: number;
  dir: 1 | -1;
  lane: number;
  offset: number;
}

/** A train-side profile (x along the car, y up) extruded to the train's width. */
function carBody(length: number, height: number, width: number, nose: number, front: boolean, back: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const r = 0.45;
  const x0 = 0;
  const x1 = length;
  shape.moveTo(x0 + (back ? nose : 0), 0);
  shape.lineTo(x1 - (front ? nose : 0), 0);
  if (front) shape.bezierCurveTo(x1 - nose * 0.35, 0, x1, height * 0.12, x1, height * 0.3);
  if (front) shape.bezierCurveTo(x1 - nose * 0.25, height * 0.62, x1 - nose * 0.55, height, x1 - nose, height);
  else {
    shape.lineTo(x1, 0);
    shape.lineTo(x1, height - r);
    shape.quadraticCurveTo(x1, height, x1 - r, height);
  }
  if (back) {
    shape.lineTo(x0 + nose, height);
    shape.bezierCurveTo(x0 + nose * 0.55, height, x0 + nose * 0.25, height * 0.62, x0, height * 0.3);
    shape.bezierCurveTo(x0, height * 0.12, x0 + nose * 0.35, 0, x0 + nose, 0);
  } else {
    shape.lineTo(x0 + r, height);
    shape.quadraticCurveTo(x0, height, x0, height - r);
    shape.lineTo(x0, 0);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 6 });
  geo.translate(0, 0, -width / 2);
  return geo;
}

function buildTrain(kind: 'commuter' | 'shinkansen'): { group: THREE.Group; length: number; windows: THREE.MeshStandardMaterial } {
  const shinkansen = kind === 'shinkansen';
  const cars = shinkansen ? 8 : 6;
  const carLen = shinkansen ? 25 : 20;
  const gap = 0.8;
  const h = shinkansen ? 3.6 : 3.7;
  const w = shinkansen ? 3.4 : 2.95;
  const nose = shinkansen ? 9 : 1.2;
  const bodies: THREE.BufferGeometry[] = [];
  const stripes: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  for (let k = 0; k < cars; k++) {
    const x = k * (carLen + gap);
    const front = k === cars - 1;
    const back = k === 0;
    const body = carBody(carLen, h, w, nose, front, back);
    body.translate(x, 0.4, 0);
    bodies.push(body);
    // Livery stripe and window band (slightly proud of the body sides).
    const s0 = back ? nose * 0.8 : 0.3;
    const s1 = carLen - (front ? nose * 0.8 : 0.3);
    const stripe = new THREE.BoxGeometry(s1 - s0, shinkansen ? 0.32 : 0.42, w + 0.04);
    stripe.translate(x + (s0 + s1) / 2, 0.4 + (shinkansen ? 1.15 : 1.25), 0);
    stripes.push(stripe);
    const win = new THREE.BoxGeometry(s1 - s0 - 1, 0.8, w + 0.03);
    win.translate(x + (s0 + s1) / 2, 0.4 + 2.05, 0);
    windows.push(win);
    if (front || back) {
      // Cab windscreen.
      const cab = new THREE.BoxGeometry(1.2, 0.7, w * 0.7);
      cab.translate(front ? x + carLen - nose * 0.75 : x + nose * 0.75, 0.4 + h * 0.72, 0);
      windows.push(cab);
    }
  }
  const prep = (list: THREE.BufferGeometry[]) =>
    mergeGeometries(
      list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
        n.clearGroups();
        return n;
      }),
    )!;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: shinkansen ? 0xf4f6f8 : 0xc4c9d1, roughness: 0.3, metalness: shinkansen ? 0.1 : 0.55 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: shinkansen ? 0x1b3f9e : 0x2fa84f, roughness: 0.4 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.15, metalness: 0.4, emissive: 0xffe2b0, emissiveIntensity: 0 });
  for (const [geo, mat] of [
    [prep(bodies), bodyMat],
    [prep(stripes), stripeMat],
    [prep(windows), windowMat],
  ] as const) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    group.add(m);
  }
  return { group, length: cars * (carLen + gap), windows: windowMat };
}

/** An elevated railway with trains running both ways (ending in tunnels in the hills). */
export class Railway implements Feature {
  readonly group = new THREE.Group();
  private readonly trains: TrainSet[] = [];
  private readonly windowMats: THREE.MeshStandardMaterial[] = [];
  private readonly ax: number;
  private readonly az: number;
  private readonly dx: number;
  private readonly dz: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly s0: number;
  private readonly s1: number;

  constructor(private readonly o: RailwayOptions) {
    this.group.name = `railway-${o.kind}`;
    const [ax, az] = o.from;
    const [bx, bz] = o.to;
    const len = Math.hypot(bx - ax, bz - az);
    this.ax = ax;
    this.az = az;
    this.dx = (bx - ax) / len;
    this.dz = (bz - az) / len;
    this.nx = -this.dz;
    this.nz = this.dx;
    const at = (s: number): [number, number] => [ax + this.dx * s, az + this.dz * s];
    const shin = o.kind === 'shinkansen';
    const width = shin ? 12 : 8;

    // Usable stretch: around the middle, until the ground rises up to the deck.
    let s0 = 0;
    let s1 = len;
    if (o.tunnels) {
      const mid = len / 2;
      const clear = (s: number) => o.ground(...at(s)) < o.deckY - 5;
      s0 = mid;
      while (s0 > 0 && clear(s0 - 10)) s0 -= 10;
      s1 = mid;
      while (s1 < len && clear(s1 + 10)) s1 += 10;
    }
    this.s0 = s0;
    this.s1 = s1;

    const concrete = new GeometryBuilder();
    const rails = new GeometryBuilder();
    const heading = Math.atan2(this.dx, this.dz);
    const y = o.deckY;
    for (let s = s0; s < s1; s += 20) {
      const e = Math.min(s1, s + 20);
      const [cx, cz] = at((s + e) / 2);
      // Deck, with parapet walls.
      concrete.box(cx, y - 1.6, cz, width, 1.6, e - s, heading);
      for (const side of [-1, 1]) concrete.box(cx + this.nx * side * (width / 2 - 0.15), y, cz + this.nz * side * (width / 2 - 0.15), 0.3, 1.1, e - s, heading);
      for (const lane of [-1, 1]) {
        for (const r of [-0.72, 0.72]) {
          const off = lane * (shin ? 2.5 : 2) + r;
          rails.box(cx + this.nx * off, y, cz + this.nz * off, 0.12, 0.18, e - s, heading);
        }
      }
    }
    for (let s = s0 + 15; s < s1 - 5; s += 32) {
      const [cx, cz] = at(s);
      const g = o.ground(cx, cz);
      if (g < y - 3 && (o.clear?.(cx, cz) ?? true)) concrete.box(cx, g - 1, cz, shin ? 4 : 2.6, y - 1.6 - g + 1, 2.4, heading);
      // Overhead line masts.
      if (Math.round(s / 32) % 2 === 0) {
        for (const side of [-1, 1]) rails.box(cx + this.nx * side * (width / 2 - 0.5), y, cz + this.nz * side * (width / 2 - 0.5), 0.25, 6.2, 0.25, heading);
        rails.box(cx, y + 6, cz, 0.22, 0.3, width - 0.6, heading + Math.PI / 2);
      }
    }
    if (o.tunnels) {
      // Portals: a concrete face with a dark mouth, set into the hillside.
      for (const [s, dir] of [
        [s0, -1],
        [s1, 1],
      ] as const) {
        const [cx, cz] = at(s + dir * 2);
        concrete.box(cx, y - 2, cz, width + 6, 10, 3, heading);
        const [mx, mz] = at(s - dir * 0.2);
        const mouth = placer(mx, y, mz, heading + (dir > 0 ? Math.PI : 0));
        facingQuad(
          rails,
          mouth(-width / 2 + 0.6, 0, 0),
          mouth(width / 2 - 0.6, 0, 0),
          mouth(width / 2 - 0.6, 6.5, 0),
          mouth(-width / 2 + 0.6, 6.5, 0),
          dirOf(mouth, 0, 1),
        );
      }
    }
    this.group.add(new THREE.Mesh(concrete.build(), new THREE.MeshStandardMaterial({ color: 0xa8a59c, roughness: 0.9 })));
    this.group.add(new THREE.Mesh(rails.build(), new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.6, metalness: 0.5 })));

    // Two trains, one each way; they pass at different times.
    for (const [dir, lane, offset] of [
      [1, -1, 0],
      [-1, 1, 0.45],
    ] as const) {
      const t = buildTrain(o.kind);
      this.windowMats.push(t.windows);
      this.trains.push({ group: t.group, length: t.length, speed: shin ? 62 : 21, dir, lane, offset });
      this.group.add(t.group);
    }
  }

  setTimeOfDay(tod: TimeOfDay): void {
    for (const m of this.windowMats) m.emissiveIntensity = tod === 'night' ? 1.6 : tod === 'sunset' ? 0.5 : 0;
  }

  update(time: number): void {
    const span = this.s1 - this.s0;
    for (const t of this.trains) {
      // Each run: in from one end, across, out the other, then a pause before the next one.
      const cycle = span + t.length + (this.o.kind === 'shinkansen' ? 2600 : 900);
      const p = ((time * t.speed + t.offset * cycle) % cycle) - t.length;
      const along = t.dir > 0 ? this.s0 + p : this.s1 - p;
      const visible = p > -t.length && p < span + t.length;
      t.group.visible = visible;
      if (!visible) continue;
      const lane = t.lane * (this.o.kind === 'shinkansen' ? 2.5 : 2);
      // The train's geometry runs along +x from its tail.
      t.group.position.set(this.ax + this.dx * along + this.nx * lane, this.o.deckY, this.az + this.dz * along + this.nz * lane);
      t.group.rotation.y = Math.atan2(this.dx, this.dz) - Math.PI / 2 + (t.dir > 0 ? 0 : Math.PI);
    }
  }
}

// ---------------------------------------------------------------- curve mirrors

/** Orange convex mirrors on the outside of hairpins, so drivers can see round the bend. */
export function curveMirrors(track: TrackPath, ground: Ground, minCurvature = 1 / 32): Feature {
  const group = new THREE.Group();
  group.name = 'curve-mirrors';
  const S = track.samples;
  const posts = new GeometryBuilder();
  const backs: THREE.BufferGeometry[] = [];
  const faces: THREE.BufferGeometry[] = [];
  let last = -1e9;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (Math.abs(s.curvature) < minCurvature || s.dist - last < 60) continue;
    // Apex of this corner: the sharpest sample nearby.
    let apex = i;
    for (let k = i; k < Math.min(S.length, i + 30); k++) if (Math.abs(S[k].curvature) > Math.abs(S[apex].curvature)) apex = k;
    const a = S[apex];
    last = a.dist;
    const out = a.curvature > 0 ? 1 : -1;
    const lat = out * (track.wallOffset + 1.1);
    const x = a.x + a.rx * lat;
    const z = a.z + a.rz * lat;
    const y = Math.max(ground(x, z), a.y - 0.5);
    posts.cylinder(x, y - 0.3, z, 0.06, 0.06, 3.3, 6);
    // Face back toward the corner entry.
    const facing = a.heading + Math.PI + out * 0.6;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 3.05, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, facing, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const back = new THREE.CylinderGeometry(0.47, 0.47, 0.08, 20)
      .rotateX(Math.PI / 2)
      .toNonIndexed()
      .applyMatrix4(m);
    const face = new THREE.CircleGeometry(0.4, 20).translate(0, 0, 0.045).toNonIndexed().applyMatrix4(m);
    for (const g of [back, face]) g.deleteAttribute('uv');
    backs.push(back);
    faces.push(face);
  }
  if (faces.length === 0) return { group };
  const orange = new THREE.MeshStandardMaterial({ color: 0xf26b1d, roughness: 0.5 });
  group.add(new THREE.Mesh(posts.build(), orange));
  group.add(new THREE.Mesh(mergeGeometries(backs)!, orange));
  group.add(new THREE.Mesh(mergeGeometries(faces)!, new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.04 })));
  return { group };
}

// ---------------------------------------------------------------- lattice-framed cut slopes

let latticeTex: THREE.Texture | null = null;

/**
 * Concrete lattice frames (法枠) holding up the cut slopes beside mountain roads, with grass
 * growing in each cell.
 */
export function latticeSlopes(track: TrackPath, ground: Ground, normalMap: THREE.Texture): Feature {
  latticeTex ??= canvasTexture(128, 128, (g) => {
    g.fillStyle = '#5d6b3b';
    g.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 400; k++) {
      g.fillStyle = `rgba(${40 + Math.random() * 60},${70 + Math.random() * 60},${30 + Math.random() * 30},0.6)`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
    g.fillStyle = '#8e8b82';
    g.fillRect(0, 0, 128, 11);
    g.fillRect(0, 0, 11, 128);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(11, 11, 117, 4);
    g.fillRect(11, 11, 4, 117);
  });
  const group = new THREE.Group();
  group.name = 'lattice-slopes';
  const b = new GeometryBuilder();
  const base = new GeometryBuilder();
  const S = track.samples;
  const n = track.count;
  const wall = track.wallOffset;
  const rows = [1.2, 3.2, 5.2, 7.2, 9.2, 11.2, 13.2];
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const s0 = S[i];
      const s1 = S[(i + 1) % n];
      // Only tall cut banks that keep rising away from the road get frames.
      const steep = (s: typeof s0) => {
        const at = (o: number) => ground(s.x + s.rx * side * (wall + o), s.z + s.rz * side * (wall + o)) - s.y;
        return at(10) > 5.5 && at(16) > at(10) + 1;
      };
      if (!steep(s0) || !steep(s1)) continue;
      const pt = (s: typeof s0, off: number): V3 => {
        const x = s.x + s.rx * side * (wall + off);
        const z = s.z + s.rz * side * (wall + off);
        return [x, Math.max(ground(x, z) + 0.2, s.y + 1.1), z];
      };
      const out: V3 = [-s0.rx * side, 1, -s0.rz * side];
      for (let k = 0; k < rows.length - 1; k++) {
        facingQuad(
          b,
          pt(s0, rows[k]),
          pt(s1, rows[k]),
          pt(s1, rows[k + 1]),
          pt(s0, rows[k + 1]),
          out,
          s0.dist / 1.5,
          rows[k] / 1.5,
          (s0.dist + track.spacing) / 1.5,
          rows[k + 1] / 1.5,
        );
      }
      // Low retaining wall and gutter at the foot of the slope.
      const f0 = pt(s0, rows[0]);
      const f1 = pt(s1, rows[0]);
      const g0: V3 = [s0.x + s0.rx * side * (wall + 0.9), s0.y - 0.2, s0.z + s0.rz * side * (wall + 0.9)];
      const g1: V3 = [s1.x + s1.rx * side * (wall + 0.9), s1.y - 0.2, s1.z + s1.rz * side * (wall + 0.9)];
      facingQuad(base, g0, g1, f1, f0, [-s0.rx * side, 0.2, -s0.rz * side], s0.dist / 2, 0, (s0.dist + track.spacing) / 2, 1);
    }
  }
  if (!b.isEmpty) {
    const mat = new THREE.MeshStandardMaterial({ map: latticeTex, roughness: 0.95, normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    group.add(new THREE.Mesh(base.build(), new THREE.MeshStandardMaterial({ color: 0x9f9c93, roughness: 0.9, normalMap })));
  }
  return { group };
}

// ---------------------------------------------------------------- houses

let kawaraTex: THREE.Texture | null = null;
let plasterTex: THREE.Texture | null = null;
let thatchTex: THREE.Texture | null = null;

function houseTextures() {
  kawaraTex ??= canvasTexture(64, 64, (g) => {
    g.fillStyle = '#4a5462';
    g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 4; row++) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, row * 16 + 13, 64, 3);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, row * 16, 64, 3);
      for (let k = 0; k < 8; k++) {
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(k * 8 + (row % 2) * 4, row * 16, 2, 16);
      }
    }
  });
  plasterTex ??= canvasTexture(128, 128, (g) => {
    g.fillStyle = '#ece6d6';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#3b2a1e';
    // Timber posts and beams, dark wooden lower panels.
    for (const x of [0, 62, 124]) g.fillRect(x, 0, 6, 128);
    g.fillRect(0, 0, 128, 6);
    g.fillRect(0, 74, 128, 5);
    g.fillStyle = '#2c2119';
    g.fillRect(0, 79, 128, 49);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x < 128; x += 8) g.fillRect(x, 79, 1, 49);
  });
  thatchTex ??= canvasTexture(64, 64, (g) => {
    g.fillStyle = '#7c6643';
    g.fillRect(0, 0, 64, 64);
    for (let k = 0; k < 300; k++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(60,45,25,0.5)' : 'rgba(160,135,90,0.45)';
      g.fillRect(Math.random() * 64, Math.random() * 64, 1, 6 + Math.random() * 8);
    }
  });
  return { kawara: kawaraTex, plaster: plasterTex, thatch: thatchTex };
}

export interface HouseSpot extends Spot {
  kind: 'minka' | 'gassho' | 'ryokan';
}

/** World direction of local (x, z) for a placer (horizontal). */
function dirOf(at: (x: number, y: number, z: number) => V3, x: number, z: number): V3 {
  const o = at(0, 0, 0);
  const p = at(x, 0, z);
  return [p[0] - o[0], 0, p[2] - o[2]];
}

/** Gable roof over a w x d footprint: ridge along local x. */
function gable(
  roof: GeometryBuilder,
  walls: GeometryBuilder,
  at: (x: number, y: number, z: number) => V3,
  w: number,
  d: number,
  eave: number,
  rise: number,
  overhang: number,
  tile: [number, number],
): void {
  const L = w / 2 + overhang;
  const D = d / 2 + overhang;
  const drop = (overhang / (d / 2)) * rise;
  const ridge = eave + rise;
  for (const side of [-1, 1]) {
    const len = Math.hypot(D, rise + drop);
    facingQuad(
      roof,
      at(-L, eave - drop, side * D),
      at(L, eave - drop, side * D),
      at(L, ridge, 0),
      at(-L, ridge, 0),
      [0, 1, 0],
      0,
      0,
      (2 * L) / tile[0],
      len / tile[1],
    );
    // Underside so the eaves aren't see-through from below.
    facingQuad(
      roof,
      at(-L, eave - drop - 0.05, side * D),
      at(L, eave - drop - 0.05, side * D),
      at(L, ridge - 0.05, 0),
      at(-L, ridge - 0.05, 0),
      [0, -1, 0],
      0,
      0,
      0.01,
      0.01,
    );
  }
  // Gable ends (normals along the ridge axis, in world space).
  const o = at(0, 0, 0);
  const r = at(1, 0, 0);
  const axis: V3 = [r[0] - o[0], 0, r[2] - o[2]];
  for (const side of [-1, 1]) {
    const n: V3 = [axis[0] * side, 0, axis[2] * side];
    const a = walls.vertex(at(side * (w / 2), eave, -d / 2), n, 0, 0);
    const c = walls.vertex(at(side * (w / 2), eave, d / 2), n, 1, 0);
    const t = walls.vertex(at(side * (w / 2), ridge, 0), n, 0.5, 0.5);
    // Both windings: the gable is visible from inside the eaves too.
    walls.triangle(a, t, c);
    walls.triangle(a, c, t);
  }
}

/** Traditional houses: kawara-tiled minka, steep thatched gassho farmhouses and a ryokan inn. */
export function japaneseHouses(spots: HouseSpot[]): Feature {
  const tex = houseTextures();
  const group = new THREE.Group();
  group.name = 'houses';
  const walls = new GeometryBuilder();
  const tiles = new GeometryBuilder();
  const thatch = new GeometryBuilder();
  const wood = new GeometryBuilder();
  const windows = new GeometryBuilder();
  for (const p of spots) {
    const at = placer(p.x, p.y, p.z, p.facing);
    const c = at(0, 0, 0);
    if (p.kind === 'gassho') {
      const w = 12;
      const d = 9;
      walls.box(c[0], p.y - 0.6, c[2], w, 3.2, d, p.facing, { tileU: 4, tileV: 3.2 });
      gable(thatch, wood, at, w, d, 2.6, 7.5, 0.9, [3, 3]);
    } else if (p.kind === 'ryokan') {
      const w = 26;
      const d = 11;
      for (let f = 0; f < 3; f++) {
        const fw = w - f * 2;
        const fd = d - f * 1.2;
        walls.box(c[0], p.y - 0.5 + f * 3.4, c[2], fw, 3.4, fd, p.facing, { tileU: 4, tileV: 3.4 });
        // Eave skirt around each floor, glowing paper windows at night.
        for (const side of [-1, 1]) {
          const ey = 2.4 + f * 3.4;
          facingQuad(
            tiles,
            at(-fw / 2 - 0.8, ey - 0.5, side * (fd / 2 + 1.1)),
            at(fw / 2 + 0.8, ey - 0.5, side * (fd / 2 + 1.1)),
            at(fw / 2 + 0.8, ey, side * (fd / 2)),
            at(-fw / 2 - 0.8, ey, side * (fd / 2)),
            [0, 1, 0],
            0,
            0,
            fw / 0.6,
            2,
          );
          for (let k = -3; k <= 3; k++) {
            const wy = 0.1 + f * 3.4;
            const z = side * (fd / 2 + 0.03);
            facingQuad(windows, at(k * 3 - 0.9, wy, z), at(k * 3 + 0.9, wy, z), at(k * 3 + 0.9, wy + 1.3, z), at(k * 3 - 0.9, wy + 1.3, z), dirOf(at, 0, side));
          }
        }
      }
      gable(tiles, walls, (x, y, z) => at(x, y + 9.7, z), w - 4, d - 2.4, 0, 2.6, 1.2, [0.6, 0.45]);
    } else {
      const w = 9 + ((p.x * 7) % 3);
      const d = 7;
      const two = Math.abs(p.z * 13) % 10 > 6;
      const h = two ? 5.6 : 3.1;
      walls.box(c[0], p.y - 0.5, c[2], w, h + 0.5, d, p.facing, { tileU: 4, tileV: 3 });
      gable(tiles, walls, (x, y, z) => at(x, y + h, z), w, d, 0, 2.3, 0.9, [0.6, 0.45]);
      // Ridge cap.
      const ridge = at(0, h + 2.3, 0);
      wood.box(ridge[0], ridge[1] - 0.05, ridge[2], w + 1.9, 0.28, 0.4, p.facing);
      // Engawa veranda along the front.
      const front = at(0, 0, d / 2 + 0.6);
      wood.box(front[0], p.y - 0.4, front[2], w - 1, 0.85, 1.2, p.facing);
      // Shoji screens behind the veranda.
      facingQuad(
        windows,
        at(-w / 4 - 1.2, 0.6, d / 2 + 0.02),
        at(-w / 4 + 1.2, 0.6, d / 2 + 0.02),
        at(-w / 4 + 1.2, 2.2, d / 2 + 0.02),
        at(-w / 4 - 1.2, 2.2, d / 2 + 0.02),
        dirOf(at, 0, 1),
      );
    }
  }
  const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshStandardMaterial({ map: tex.plaster, roughness: 0.9 }));
  const tileMesh = new THREE.Mesh(tiles.build(), new THREE.MeshStandardMaterial({ map: tex.kawara, roughness: 0.55, metalness: 0.15 }));
  const thatchMesh = new THREE.Mesh(thatch.build(), new THREE.MeshStandardMaterial({ map: tex.thatch, roughness: 1 }));
  const woodMesh = new THREE.Mesh(wood.build(), new THREE.MeshStandardMaterial({ color: 0x3b2b20, roughness: 0.85 }));
  const glow = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.9, emissive: 0xffc77a, emissiveIntensity: 0 });
  const windowMesh = new THREE.Mesh(windows.build(), glow);
  for (const m of [wallMesh, tileMesh, thatchMesh, woodMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(wallMesh, tileMesh, woodMesh, windowMesh);
  if (!thatch.isEmpty) group.add(thatchMesh);
  return {
    group,
    setTimeOfDay(tod) {
      glow.emissiveIntensity = tod === 'night' ? 1.2 : tod === 'sunset' ? 0.35 : 0;
    },
  };
}

// ---------------------------------------------------------------- koinobori

let carpTex: THREE.Texture | null = null;

/** Carp streamers (koinobori) flying from poles beside the farms. */
export function koinobori(spots: Spot[]): Feature {
  carpTex ??= canvasTexture(256, 192, (g) => {
    const bodies = ['#1d1d22', '#d8322a', '#2552b8'];
    bodies.forEach((col, row) => {
      const y0 = row * 64;
      g.fillStyle = col;
      g.fillRect(0, y0, 256, 64);
      // Scales.
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      for (let x = 40; x < 230; x += 14) {
        for (let y = y0 + 8; y < y0 + 60; y += 12) {
          g.beginPath();
          g.arc(x + ((y / 12) % 2) * 7, y, 6, 0.3 * Math.PI, 0.7 * Math.PI);
          g.stroke();
        }
      }
      // Gold belly band, eye and white mouth ring.
      g.fillStyle = '#e9c34a';
      g.fillRect(0, y0 + 28, 256, 8);
      g.fillStyle = '#fff';
      g.fillRect(0, y0, 10, 64);
      g.beginPath();
      g.arc(26, y0 + 18, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(26, y0 + 18, 4, 0, Math.PI * 2);
      g.fill();
    });
  });
  const group = new THREE.Group();
  group.name = 'koinobori';
  const poles = new GeometryBuilder();
  const carp: THREE.BufferGeometry[] = [];
  for (const p of spots) {
    poles.cylinder(p.x, p.y - 0.3, p.z, 0.09, 0.06, 10.5, 6);
    // Black father, red mother, blue child: flying downwind (+x).
    [
      [4.6, 9.2, 0.55],
      [3.9, 7.9, 0.48],
      [3.2, 6.7, 0.4],
    ].forEach(([len, y, r], row) => {
      // Narrow tail at the top of the cylinder, which rotates to point downwind (+x).
      const tube = new THREE.CylinderGeometry(r * 0.45, r, len, 12, 6, true);
      tube.rotateZ(-Math.PI / 2);
      tube.translate(len / 2 + 0.1, 0, 0);
      const uv = tube.getAttribute('uv');
      const along = new Float32Array(uv.count);
      const pos = tube.getAttribute('position');
      for (let k = 0; k < uv.count; k++) {
        along[k] = (pos.getX(k) - 0.1) / len;
        // Texture rows: this carp's colour; u along the body.
        uv.setXY(k, along[k], (2 - row) / 3 + uv.getX(k) / 3);
      }
      tube.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      tube.translate(p.x, p.y + y, p.z);
      carp.push(tube.toNonIndexed());
    });
  }
  const mat = new THREE.MeshLambertMaterial({ map: carpTex, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;\nattribute float aAlong;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
        float ph = uWindTime * 4.0 - aAlong * 6.0 + position.z * 0.3;
        transformed.z += sin(ph) * 0.35 * aAlong;
        transformed.y += cos(ph * 0.8) * 0.18 * aAlong - aAlong * aAlong * 0.6;`,
    );
  };
  mat.customProgramCacheKey = () => 'koinobori';
  const fish = new THREE.Mesh(mergeGeometries(carp)!, mat);
  fish.frustumCulled = false;
  group.add(new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.6 })), fish);
  return { group };
}

// ---------------------------------------------------------------- rice paddies

export interface Paddy {
  x: number;
  z: number;
  size: number;
  level: number;
  low: number;
}

let paddyTex: THREE.Texture | null = null;

/** Flooded rice paddies: mirror-flat water in earth banks, reflecting the sky. */
export function ricePaddies(paddies: Paddy[], ripple: THREE.Texture): Feature {
  const group = new THREE.Group();
  group.name = 'paddies';
  const water = new GeometryBuilder();
  const banks = new GeometryBuilder();
  for (const p of paddies) {
    const h = p.size / 2;
    water.quad(
      [p.x - h, p.level, p.z + h],
      [p.x + h, p.level, p.z + h],
      [p.x + h, p.level, p.z - h],
      [p.x - h, p.level, p.z - h],
      p.x / 6,
      p.z / 6,
      (p.x + p.size) / 6,
      (p.z + p.size) / 6,
    );
    const top = p.level + 0.22;
    const base = p.low - 0.4;
    for (const [cx, cz, w, d] of [
      [p.x, p.z - h, p.size + 0.7, 0.7],
      [p.x, p.z + h, p.size + 0.7, 0.7],
      [p.x - h, p.z, 0.7, p.size],
      [p.x + h, p.z, 0.7, p.size],
    ] as const) {
      banks.box(cx, base, cz, w, top - base, d);
    }
  }
  // Muddy water with rows of young rice shoots; the sky reflects in between.
  paddyTex ??= canvasTexture(64, 64, (g) => {
    g.fillStyle = '#7d8676';
    g.fillRect(0, 0, 64, 64);
    for (let y = 2; y < 64; y += 8) {
      for (let x = 1; x < 64; x += 5) {
        g.fillStyle = (x * 7 + y) % 3 ? '#6f9a3c' : '#86ad48';
        g.fillRect(x, y, 2, 3);
      }
    }
  });
  const waterMat = new THREE.MeshStandardMaterial({
    map: paddyTex,
    roughness: 0.12,
    metalness: 0.2,
    normalMap: ripple,
    normalScale: new THREE.Vector2(0.1, 0.1),
  });
  const w = new THREE.Mesh(water.build(), waterMat);
  w.receiveShadow = true;
  const b = new THREE.Mesh(banks.build(), new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 }));
  b.receiveShadow = true;
  group.add(w, b);
  return { group };
}

// ---------------------------------------------------------------- ropeway

/** An aerial ropeway: towers, two cables and gondolas gliding up one side and down the other. */
export class Ropeway implements Feature {
  readonly group = new THREE.Group();
  private readonly gondolas: THREE.InstancedMesh;
  private readonly lines: [THREE.Vector3[], THREE.Vector3[]];
  private readonly lengths: [number[], number[]];
  private readonly matrix = new THREE.Matrix4();
  private readonly count = 14;

  constructor(from: [number, number], to: [number, number], ground: Ground) {
    this.group.name = 'ropeway';
    const [ax, az] = from;
    const [bx, bz] = to;
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const nx = -dz;
    const nz = dx;
    const towers = new GeometryBuilder();
    const spans = Math.max(2, Math.round(len / 170));
    const tops: THREE.Vector3[] = [];
    for (let k = 0; k <= spans; k++) {
      const x = ax + (dx * (len * k)) / spans;
      const z = az + (dz * (len * k)) / spans;
      const g = ground(x, z);
      const end = k === 0 || k === spans;
      const h = end ? 9 : 26;
      if (end) towers.box(x, g - 1, z, 14, h + 1, 10, Math.atan2(dx, dz));
      else {
        towers.box(x, g - 1, z, 1.6, h + 1, 1.6, Math.atan2(dx, dz));
        towers.box(x, g + h - 0.6, z, 11, 0.8, 1.2, Math.atan2(dx, dz) + Math.PI / 2);
      }
      tops.push(new THREE.Vector3(x, g + h, z));
    }
    const cables: number[] = [];
    const sides: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    [-1, 1].forEach((side, si) => {
      for (let k = 0; k < tops.length - 1; k++) {
        const a = tops[k];
        const b = tops[k + 1];
        for (let t = 0; t <= 10; t++) {
          const f = t / 10;
          const p = new THREE.Vector3(lerp(a.x, b.x, f) + nx * side * 4.5, lerp(a.y, b.y, f) - 6 * f * (1 - f) * 4 * 0.6, lerp(a.z, b.z, f) + nz * side * 4.5);
          if (k > 0 && t === 0) continue;
          sides[si].push(p);
        }
      }
      for (let k = 0; k < sides[si].length - 1; k++) cables.push(...sides[si][k].toArray(), ...sides[si][k + 1].toArray());
    });
    this.lines = sides;
    this.lengths = [cumulative(sides[0]), cumulative(sides[1])];
    this.group.add(new THREE.Mesh(towers.build(), new THREE.MeshStandardMaterial({ color: 0x7c8088, roughness: 0.6, metalness: 0.5 })));
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    this.group.add(new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: 0x222222 })));
    const cabin = new THREE.BoxGeometry(2.4, 2.3, 2.2);
    cabin.translate(0, -3.3, 0);
    const hanger = new THREE.BoxGeometry(0.12, 2.2, 0.12);
    hanger.translate(0, -1.1, 0);
    const geo = mergeGeometries([cabin.toNonIndexed(), hanger.toNonIndexed()])!;
    this.gondolas = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 }), this.count);
    const palette = [0xd8322a, 0xf2c200, 0x2e7dd1, 0xf2f2f2];
    for (let i = 0; i < this.count; i++) this.gondolas.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    this.gondolas.frustumCulled = false;
    this.group.add(this.gondolas);
    this.update(0);
  }

  update(time: number): void {
    const per = this.count / 2;
    for (let i = 0; i < this.count; i++) {
      const side = i < per ? 0 : 1;
      const pts = this.lines[side];
      const cum = this.lengths[side];
      const total = cum[cum.length - 1];
      let d = (((time * 5 + ((i % per) / per) * total) % total) + total) % total;
      if (side === 1) d = total - d;
      let k = 1;
      while (k < cum.length - 1 && cum[k] < d) k++;
      const f = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      const p = pts[k - 1].clone().lerp(pts[k], f);
      this.matrix.makeTranslation(p.x, p.y, p.z);
      this.gondolas.setMatrixAt(i, this.matrix);
    }
    this.gondolas.instanceMatrix.needsUpdate = true;
  }
}

function cumulative(pts: THREE.Vector3[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return out;
}

// ---------------------------------------------------------------- traffic signals

/** Japanese traffic lights (horizontal, blue-green "go") on arms over the road at crossings. */
export function trafficSignals(track: TrackPath, distances: number[], poleLateral: number): Feature {
  const group = new THREE.Group();
  group.name = 'signals';
  const steel = new GeometryBuilder();
  const heads = new GeometryBuilder();
  const lit = new GeometryBuilder();
  const dark = new GeometryBuilder();
  for (const d of distances) {
    const s = track.samples[track.indexAtDistance(d)];
    for (const side of [-1, 1]) {
      // Signals face the oncoming field (local +x then points away from the track's right side).
      const facing = s.heading + Math.PI;
      const base = placer(s.x + s.rx * side * poleLateral, s.y, s.z + s.rz * side * poleLateral, facing);
      const p = base(0, 0, 0);
      steel.cylinder(p[0], s.y, p[2], 0.13, 0.11, 5.8, 8);
      // Arm reaching out over the road.
      const inward = side;
      const arm = base(inward * 2.6, 5.4, 0);
      steel.box(arm[0], arm[1], arm[2], 5.2, 0.14, 0.14, facing);
      const head = base(inward * 4.4, 5.15, 0.1);
      heads.box(head[0], head[1], head[2], 1.3, 0.42, 0.3, facing);
      [-0.42, 0, 0.42].forEach((x, k) => {
        const c = base(inward * 4.4 + x, 5.36, 0.27);
        const disc = k === 0 ? lit : dark;
        const r = 0.15;
        facingQuad(
          disc,
          [c[0] - r * Math.cos(facing), c[1] - r, c[2] + r * Math.sin(facing)],
          [c[0] + r * Math.cos(facing), c[1] - r, c[2] - r * Math.sin(facing)],
          [c[0] + r * Math.cos(facing), c[1] + r, c[2] - r * Math.sin(facing)],
          [c[0] - r * Math.cos(facing), c[1] + r, c[2] + r * Math.sin(facing)],
          dirOf(base, 0, 1),
        );
      });
    }
  }
  group.add(new THREE.Mesh(steel.build(), new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.5, metalness: 0.6 })));
  group.add(new THREE.Mesh(heads.build(), new THREE.MeshStandardMaterial({ color: 0x5d6466, roughness: 0.6 })));
  const go = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.6, 1.9) });
  group.add(new THREE.Mesh(lit.build(), go));
  group.add(new THREE.Mesh(dark.build(), new THREE.MeshBasicMaterial({ color: 0x241c14 })));
  return { group };
}
