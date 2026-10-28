import * as THREE from 'three';
import type { CarSetup, TimeOfDay } from '../../shared/api';
import { shopItem } from '../../shared/items';
import { damp, lerp, wrapAngle } from '../core/math';
import type { SimCar } from '../race/RaceSimulation';
import type { BodyDef, CarDef } from './cars';
import { type CarAsset, carAsset, liveryMaterial, type PartRole } from './importedCars';
import { flipWinding, mergeAll } from './meshUtils';

/**
 * Procedurally built cars (no external model files needed). Each body is extruded from a side
 * profile in `cars.ts`; liveries (stripes, two-tone, race numbers) are ribbons that follow the
 * body's top line, so every pattern fits every car.
 * Local frame: +z is forward, +y is up, -x is the car's right-hand side.
 */

interface BodyGeometry {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  /** Side window glass (one side; mirrored for the other). */
  sideGlass: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spoke: THREE.BufferGeometry;
  brake: THREE.BufferGeometry;
  stripes: THREE.BufferGeometry;
  side: THREE.BufferGeometry;
  sill: THREE.BufferGeometry;
  twotone: THREE.BufferGeometry;
  /** Key points measured from the profile. */
  front: number;
  rear: number;
  bottom: number;
  topAt: (z: number) => number;
  /** Rear-most and front-most z of the body at height y. */
  extentAt: (y: number) => [number, number];
  cabinFront: number;
}

const cache = new Map<string, BodyGeometry>();
let parts: Record<'headlight' | 'exhaust' | 'taillight' | 'box' | 'number' | 'plate' | 'shadow' | 'beam', THREE.BufferGeometry> | null = null;
let shadowTexture: THREE.Texture | null = null;
let beamTexture: THREE.Texture | null = null;
let glowTexture: THREE.Texture | null = null;
let flame: { geometry: THREE.BufferGeometry; material: THREE.Material } | null = null;

/** A blue nitro flame pointing backwards from the exhaust (bright enough to bloom). */
function getFlame() {
  if (!flame) {
    const geometry = new THREE.ConeGeometry(0.08, 0.62, 10, 1, true);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -0.31);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.18, 0.6, 2.4),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    flame = { geometry, material };
  }
  return flame;
}
let common: Record<'wheel' | 'glass' | 'carbon' | 'headlight' | 'trim' | 'chrome', THREE.Material> | null = null;

function extrudeProfile(points: [number, number][], width: number, bevel: number, segments = 3): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: 4,
  });
  // Profile X -> car forward (+z); extrusion axis -> car width (x).
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The body's side profile with wheel arches cut into its lower edge (the profile's first edge
 * runs along the bottom from the rear to the front).
 */
function archedProfile(b: BodyDef): [number, number][] {
  const [rearBottom, frontBottom, ...rest] = b.profile;
  const bottom = rearBottom[1];
  const cy = b.wheelRadius;
  const R = b.wheelRadius + 0.075;
  const out: [number, number][] = [rearBottom];
  for (const axle of [b.rearAxle, b.frontAxle]) {
    const d = Math.asin(Math.max(-0.9, Math.min(0.9, (cy - bottom) / R)));
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI + d - (k / 12) * (Math.PI + 2 * d);
      out.push([axle + Math.cos(a) * R, Math.max(bottom, cy + Math.sin(a) * R)]);
    }
  }
  return [...out, frontBottom, ...rest];
}

/** Chaikin corner cutting: rounds a closed polygon's corners a little more per iteration. */
function smooth(points: [number, number][], iterations: number): [number, number][] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const [az, ay] = pts[i];
      const [bz, by] = pts[(i + 1) % pts.length];
      out.push([az * 0.75 + bz * 0.25, ay * 0.75 + by * 0.25], [az * 0.25 + bz * 0.75, ay * 0.25 + by * 0.75]);
    }
    pts = out;
  }
  return pts;
}

/** Shrink a closed profile toward its centre (window glass inside a door frame). */
function insetProfile(points: [number, number][], amount: number, raiseBottom: number): [number, number][] {
  const cz = points.reduce((t, p) => t + p[0], 0) / points.length;
  const cy = points.reduce((t, p) => t + p[1], 0) / points.length;
  const minY = Math.min(...points.map((p) => p[1]));
  return points.map(([z, y]) => {
    const dz = z - cz;
    const dy = y - cy;
    const len = Math.hypot(dz, dy) || 1;
    const k = Math.min(amount, len * 0.5) / len;
    return [z - dz * k, Math.max(y - dy * k, minY + raiseBottom)];
  });
}

/** Rear-most and front-most z where a horizontal line at `y` crosses a closed profile. */
function profileExtent(points: [number, number][], y: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const [z0, y0] = points[i];
    const [z1, y1] = points[(i + 1) % points.length];
    if (y < Math.min(y0, y1) || y > Math.max(y0, y1) || y0 === y1) continue;
    const z = z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return [lo, hi];
}

/** Highest point of a closed profile at `z` (or -Infinity outside it). */
function profileTop(points: [number, number][], z: number): number {
  let top = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const [z0, y0] = points[i];
    const [z1, y1] = points[(i + 1) % points.length];
    if (z < Math.min(z0, z1) || z > Math.max(z0, z1) || z0 === z1) continue;
    top = Math.max(top, y0 + ((y1 - y0) * (z - z0)) / (z1 - z0));
  }
  return top;
}

/**
 * Ribbons lying on the car's top line between `x0..x1` lateral bands. `height(z)` returns the
 * surface height, or null where the ribbon should break (over glass).
 */
function ribbon(bands: [number, number][], zFrom: number, zTo: number, height: (z: number) => number | null): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const step = 0.06;
  for (const [x0, x1] of bands) {
    let prev = -1;
    for (let z = zFrom; z <= zTo + 1e-6; z += step) {
      const y = height(z);
      if (y === null) {
        prev = -1;
        continue;
      }
      const base = pos.length / 3;
      pos.push(x0, y, z, x1, y, z);
      if (prev >= 0) index.push(prev, base, prev + 1, prev + 1, base, base + 1);
      prev = base;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** A strip on both flanks of the body following the shoulder line `drop` metres below the top. */
function flank(b: BodyDef, g: Pick<BodyGeometry, 'front' | 'rear' | 'topAt' | 'bottom'>, yOf: (z: number) => number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  for (const side of [-1, 1]) {
    const x = side * (b.width / 2 + 0.004);
    let prev = -1;
    for (let z = g.rear + 0.25; z <= g.front - 0.25; z += 0.06) {
      const y = yOf(z);
      const base = pos.length / 3;
      pos.push(x, y, z, x, y + h, z);
      if (prev >= 0) {
        if (side > 0) index.push(prev, base, prev + 1, prev + 1, base, base + 1);
        else index.push(prev, prev + 1, base, prev + 1, base + 1, base);
      }
      prev = base;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function bodyGeometry(def: CarDef): BodyGeometry {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const b = def.body;
  // Rounded silhouettes: the profiles in cars.ts are the control polygons.
  const profile = smooth(archedProfile(b), 2);
  const cabinProfile = smooth(b.cabin, 1);
  const front = Math.max(...profile.map((p) => p[0]));
  const rear = Math.min(...profile.map((p) => p[0]));
  const bottom = b.profile[0][1];
  const topAt = (z: number) => profileTop(profile, z);
  const extentAt = (y: number) => profileExtent(profile, y);
  const cabinFront = Math.max(...cabinProfile.map((p) => p[0]));
  const cabinRear = Math.min(...cabinProfile.map((p) => p[0]));
  const roofFront = b.roof.z + b.roof.length / 2;
  const roofRear = b.roof.z - b.roof.length / 2;
  const g0 = { front, rear, bottom, topAt, extentAt };

  // Painted surfaces only: bonnet, roof panel, boot lid (not the glass in between).
  const paintedTop = (z: number): number | null => {
    if (z > cabinFront - 0.05 || z < cabinRear + 0.05) return topAt(z) + 0.006;
    if (z <= roofFront && z >= roofRear) return b.roof.y + 0.026;
    return null;
  };
  const hoodAndBoot = (z: number): number | null => (z > cabinFront - 0.05 || z < cabinRear + 0.05 ? topAt(z) + 0.005 : null);

  const tireWidth = b.rally ? 0.3 : 0.27;
  const R = b.wheelRadius;
  const rimR = R * 0.68;
  // Tyre: rounded shoulders and sidewalls (lathe profile, revolved, then turned to the x axis).
  const hw = tireWidth / 2;
  const tire = new THREE.LatheGeometry(
    [
      [rimR, -hw + 0.01],
      [R - 0.045, -hw],
      [R - 0.01, -hw + 0.03],
      [R, -hw + 0.07],
      [R, hw - 0.07],
      [R - 0.01, hw - 0.03],
      [R - 0.045, hw],
      [rimR, hw - 0.01],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    26,
  );
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(rimR, rimR, tireWidth - 0.02, 20, 1, true);
  rim.rotateZ(Math.PI / 2);
  // Rim face: five twin spokes, a lip ring and a centre cap (on the outer face, x > 0).
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    for (const twin of [-0.11, 0.11]) {
      const s = new THREE.BoxGeometry(0.035, rimR * 0.92, 0.045);
      s.translate(0, rimR * 0.46, 0);
      s.rotateX((i / 5) * Math.PI * 2 + twin);
      spokes.push(s);
    }
  }
  const lip = new THREE.TorusGeometry(rimR - 0.012, 0.016, 6, 24);
  lip.rotateY(Math.PI / 2);
  spokes.push(lip);
  const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10);
  cap.rotateZ(Math.PI / 2);
  spokes.push(cap);
  // Brake disc and caliper (don't spin): built for the left side, mirrored per wheel.
  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 20);
  disc.rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.07, rimR * 0.55, rimR * 0.38);
  caliper.translate(0.035, rimR * 0.55, -rimR * 0.3);
  const brake = mergeAll([
    prep(disc, new THREE.Matrix4(), ['position', 'normal'], new THREE.Color(0x6a6d72)),
    prep(caliper, new THREE.Matrix4(), ['position', 'normal'], new THREE.Color(0xc41e28)),
  ]);
  const glassShape = new THREE.Shape(insetProfile(cabinProfile, 0.075, 0.06).map(([z, y]) => new THREE.Vector2(z, y)));
  const sideGlass = new THREE.ExtrudeGeometry(glassShape, { depth: 0.02, bevelEnabled: false });
  sideGlass.rotateY(-Math.PI / 2);
  const roof = new THREE.BoxGeometry(b.cabinWidth - 0.16, 0.04, b.roof.length);
  roof.translate(0, b.roof.y, b.roof.z);

  const geo: BodyGeometry = {
    ...g0,
    cabinFront,
    body: extrudeProfile(profile, b.width, 0.085),
    cabin: extrudeProfile(cabinProfile, b.cabinWidth, 0.07),
    sideGlass,
    roof,
    tire,
    rim,
    spoke: mergeAll(spokes.map((g) => prep(g, new THREE.Matrix4(), ['position', 'normal']))),
    brake,
    stripes: ribbon(
      [
        [-0.34, -0.06],
        [0.06, 0.34],
      ],
      rear + 0.05,
      front - 0.08,
      paintedTop,
    ),
    side: flank(b, g0, (z) => topAt(z) - 0.2, 0.09),
    sill: flank(b, g0, () => bottom + 0.1, 0.12),
    twotone: ribbon([[-b.width / 2 + 0.07, b.width / 2 - 0.07]], rear + 0.05, front - 0.1, hoodAndBoot),
  };
  cache.set(def.id, geo);
  return geo;
}

function radialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(num: number, ring: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = ring;
  g.stroke();
  g.fillStyle = '#111';
  g.font = 'bold italic 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A personalised plate: black characters on white, squeezed to fit like real plate lettering. */
function plateTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4ee';
  g.beginPath();
  g.roundRect(2, 2, 252, 124, 10);
  g.fill();
  g.strokeStyle = '#1b1d22';
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = '#b8b8b0';
  for (const x of [46, 210]) {
    g.beginPath();
    g.arc(x, 16, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#111317';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 78px "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
  g.fillText(text, 128, 72, 224);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function getParts() {
  if (parts) return parts;
  const shadow = new THREE.PlaneGeometry(1, 1);
  shadow.rotateX(-Math.PI / 2);
  const beam = new THREE.PlaneGeometry(9, 22);
  beam.rotateX(-Math.PI / 2);
  beam.translate(0, 0, 13);
  parts = {
    headlight: new THREE.BoxGeometry(0.42, 0.08, 0.06),
    exhaust: new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12, 1, true),
    taillight: new THREE.BoxGeometry(1, 0.06, 0.05),
    box: new THREE.BoxGeometry(1, 1, 1),
    number: new THREE.PlaneGeometry(0.58, 0.58),
    plate: new THREE.PlaneGeometry(0.33, 0.165),
    shadow,
    beam,
  };
  return parts;
}

function getCommon() {
  common ??= {
    // Tyre and rim share one material; their colours are baked into the vertices.
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.3 }),
    headlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5.5) }),
    // Black plastic and rubber: grille, skirts, diffuser, arch liners, seals.
    trim: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.75, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.12, metalness: 1 }),
  };
  return common;
}

type Slot = 'paint' | 'accent' | 'glass' | 'carbon' | 'light' | 'brake' | 'reverse' | 'number' | 'plate' | 'trim' | 'chrome';

interface WheelGeometry {
  tyre: THREE.BufferGeometry;
  spokes: THREE.BufferGeometry;
  /** Disc and caliper: steer with the wheel but don't spin. */
  brake: THREE.BufferGeometry;
}

interface WheelSet {
  /** Front wheels, centred on their hubs. */
  left: WheelGeometry;
  right: WheelGeometry;
  /** Both rear wheels (they spin together as one axle). */
  rear: WheelGeometry;
}

interface CarGeometry extends WheelSet {
  /** Every static part of the body, merged per material slot. */
  body: Partial<Record<Slot, THREE.BufferGeometry>>;
  frontZ: number;
  rearZ: number;
}

const carCache = new Map<string, CarGeometry>();
const wheelCache = new Map<string, WheelSet>();

/** Bake a transform into a copy of `geo`, keeping only the attributes a merge needs. */
function prep(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, keep: string[], color?: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  g.clearGroups();
  if (color) {
    const c = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([color.r, color.g, color.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

/** A car's geometry for one body + livery pattern (shared by every car that looks like it). */
function carGeometry(def: CarDef, pattern: CarSetup['pattern']): CarGeometry {
  const key = `${def.id}|${pattern}`;
  const hit = carCache.get(key);
  if (hit) return hit;
  const b = def.body;
  const g = bodyGeometry(def);
  const p = getParts();
  const parts: Record<Slot, THREE.BufferGeometry[]> = {
    paint: [],
    accent: [],
    glass: [],
    carbon: [],
    light: [],
    brake: [],
    reverse: [],
    number: [],
    plate: [],
    trim: [],
    chrome: [],
  };
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const put = (geo: THREE.BufferGeometry, slot: Slot, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    matrix.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    parts[slot].push(prep(geo, matrix, slot === 'number' || slot === 'plate' ? ['position', 'normal', 'uv'] : ['position', 'normal']));
  };
  const twotone = pattern === 'twotone';

  put(g.body, 'paint');
  // Painted roof and pillars, with glass set into them.
  put(g.cabin, 'paint');
  if (twotone) put(g.roof, 'accent');
  const cw = b.cabinWidth / 2;
  // The glass slab spans x in [-0.02, 0]: shift it so it sits just proud of each side.
  for (const side of [-1, 1]) put(g.sideGlass, 'glass', side > 0 ? cw + 0.012 : -cw + 0.008, 0, 0);
  const c = b.cabin;
  const pane = (a: [number, number], z: [number, number], width: number) => {
    const dz = z[0] - a[0];
    const dy = z[1] - a[1];
    const len = Math.hypot(dz, dy);
    // Outward normal of the slope (the one pointing up).
    let ny = dz / len;
    let nz = -dy / len;
    if (ny < 0) {
      ny = -ny;
      nz = -nz;
    }
    put(p.box, 'glass', 0, (a[1] + z[1]) / 2 + ny * 0.016, (a[0] + z[0]) / 2 + nz * 0.016, width, 0.012, len * 0.84, Math.atan2(-dy, dz), 0, 0);
  };
  pane(c[1], c[2], b.cabinWidth - 0.2);
  pane(c[3], c[4], b.cabinWidth - 0.28);
  // B pillar between the side windows.
  const cabinRearZ = Math.min(...c.map((q) => q[0]));
  const pillarZ = cabinRearZ + (g.cabinFront - cabinRearZ) * 0.47;
  put(p.box, 'paint', 0, (g.topAt(pillarZ) + b.roof.y) / 2, pillarZ, b.cabinWidth + 0.035, b.roof.y - g.topAt(pillarZ) - 0.02, 0.1);

  const hw = b.width / 2;
  const frontY = g.topAt(g.front - 0.2);
  const rearY = g.topAt(g.rear + 0.15);
  // Swept headlights with a daytime-running-light strip, grille and intakes.
  for (const side of [-1, 1]) {
    put(p.headlight, 'light', side * (hw - 0.33), frontY - 0.07, g.front - 0.04, 1.05, 1, 1, 0, 0, side * 0.1);
    put(p.box, 'light', side * (hw - 0.34), frontY - 0.14, g.front - 0.02, 0.4, 0.018, 0.03);
    put(p.box, 'trim', side * (hw - 0.3), g.bottom + 0.13, g.front - 0.01, 0.34, 0.12, 0.04);
  }
  put(p.box, 'trim', 0, g.bottom + 0.2, g.front - 0.01, b.width * 0.38, 0.15, 0.05);
  put(p.box, 'carbon', 0, g.bottom + 0.02, g.front - 0.12, b.width - 0.04, 0.04, 0.3);
  // Rear: corner tail lights joined by a thin light bar, reverse light, diffuser, exhausts.
  for (const side of [-1, 1]) put(p.taillight, 'brake', side * (hw - 0.24), rearY - 0.1, g.rear - 0.02, 0.36, 1.6, 1);
  put(p.taillight, 'brake', 0, rearY - 0.1, g.rear - 0.015, b.width - 0.5, 0.35, 1);
  put(p.headlight, 'reverse', 0, rearY - 0.22, g.rear - 0.03, 0.4, 1, 1);
  // Number plates on the bumpers, flush with the bodywork.
  const frontPlateY = g.bottom + 0.1;
  put(p.plate, 'plate', 0, frontPlateY, g.extentAt(frontPlateY)[1] + 0.012);
  const rearPlateY = g.bottom + 0.24;
  put(p.plate, 'plate', 0, rearPlateY, g.extentAt(rearPlateY)[0] - 0.012, 1, 1, 1, 0, Math.PI, 0);
  put(p.box, 'trim', 0, g.bottom + 0.07, g.rear + 0.06, b.width * 0.62, 0.13, 0.16);
  for (const x of [-0.24, 0, 0.24]) put(p.box, 'carbon', x, g.bottom + 0.07, g.rear + 0.02, 0.02, 0.14, 0.2);
  for (const side of [-1, 1]) put(p.exhaust, 'chrome', side * 0.42, g.bottom + 0.1, g.rear - 0.02, 1, 1, 1, Math.PI / 2, 0, 0);
  // Sides: skirts between the arches, arch liners, door shut lines and handles, mirrors on stalks.
  const archR = b.wheelRadius + 0.075;
  const skirtLen = b.frontAxle - b.rearAxle - 2 * archR;
  for (const side of [-1, 1]) {
    put(p.box, 'trim', side * (hw - 0.01), g.bottom + 0.035, (b.frontAxle + b.rearAxle) / 2, 0.05, 0.08, skirtLen);
    for (const z of [g.cabinFront - 0.05, pillarZ - 0.02])
      put(p.box, 'trim', side * (hw + 0.002), g.bottom + 0.32, z, 0.01, Math.max(0.2, g.topAt(z) - g.bottom - 0.4), 0.012);
    put(p.box, 'chrome', side * (hw + 0.006), g.topAt(pillarZ - 0.25) - 0.15, pillarZ - 0.25, 0.02, 0.03, 0.14);
  }
  // Dark wheel-well liners so you can't see through the arches (kept under the bonnet line).
  for (const axle of [b.frontAxle, b.rearAxle]) {
    const y0 = g.bottom - 0.04;
    const y1 = Math.min(b.wheelRadius + archR * 0.95, g.topAt(axle) - 0.05);
    put(p.box, 'trim', 0, (y0 + y1) / 2, axle, 2 * (b.trackHalf - 0.16), y1 - y0, archR * 1.9);
  }
  const mirrorZ = g.cabinFront - 0.3;
  for (const side of [-1, 1]) {
    put(p.box, 'trim', side * (cw + 0.08), g.topAt(mirrorZ) + 0.06, mirrorZ, 0.16, 0.035, 0.05);
    put(p.box, twotone ? 'accent' : 'paint', side * (cw + 0.2), g.topAt(mirrorZ) + 0.11, mirrorZ - 0.02, 0.17, 0.11, 0.13);
  }
  // Signature details per car.
  if (b.flares) {
    // Bolt-on arch flares, painted, with a dark lip.
    const flare = new THREE.TorusGeometry(archR + 0.02, 0.06, 6, 14, Math.PI);
    flare.scale(1, 1, 0.9);
    for (const axle of [b.frontAxle, b.rearAxle]) {
      for (const side of [-1, 1]) put(flare, 'paint', side * (hw + 0.015), b.wheelRadius, axle, 1, 1, 1, 0, Math.PI / 2, 0);
    }
  }
  if (b.sideIntakes) {
    // Scoops ahead of the rear wheels and louvres over the engine.
    for (const side of [-1, 1]) {
      put(p.box, 'trim', side * (hw + 0.004), g.bottom + 0.34, b.rearAxle + archR + 0.32, 0.02, 0.24, 0.5);
      put(p.box, 'carbon', side * (hw - 0.03), g.bottom + 0.48, b.rearAxle + archR + 0.32, 0.08, 0.04, 0.55);
    }
    for (let k = 0; k < 5; k++) {
      const z = b.rearAxle - 0.1 + k * 0.16;
      put(p.box, 'trim', 0, g.topAt(z) + 0.005, z, 0.9, 0.02, 0.07);
    }
  }
  if (b.hoodVents) {
    for (const side of [-1, 1]) {
      const z = g.front - 0.85;
      put(p.box, 'trim', side * 0.32, g.topAt(z) + 0.005, z, 0.28, 0.02, 0.32, 0, 0, 0);
    }
  }
  if (b.rally) put(p.box, 'chrome', 0, g.bottom - 0.02, g.front - 0.45, b.width * 0.6, 0.03, 0.7);
  // Shark-fin antenna.
  put(p.box, 'trim', 0, b.roof.y + 0.04, b.roof.z - b.roof.length * 0.42, 0.05, 0.06, 0.16);

  if (b.wing === 'gt') {
    const z = g.rear + 0.25;
    const y = g.topAt(z) + 0.26;
    put(p.box, 'carbon', 0, y, z, b.width - 0.12, 0.04, 0.34);
    for (const side of [-1, 1]) put(p.box, 'carbon', side * 0.55, y - 0.13, z, 0.05, 0.22, 0.14);
  } else if (b.wing === 'roof') {
    const z = b.roof.z - b.roof.length / 2 - 0.12;
    put(p.box, b.rally ? 'carbon' : 'paint', 0, b.roof.y + 0.03, z, b.cabinWidth - 0.06, b.rally ? 0.06 : 0.04, b.rally ? 0.4 : 0.26);
  } else if (b.wing === 'rally') {
    // WRC wing: a deep blade off the back of the roof, big endplates, a second element under it.
    const z = b.roof.z - b.roof.length / 2 - 0.22;
    const y = b.roof.y - 0.06;
    put(p.box, 'carbon', 0, y, z, b.cabinWidth + 0.1, 0.05, 0.5);
    put(p.box, 'carbon', 0, y - 0.16, z - 0.08, b.cabinWidth - 0.1, 0.04, 0.3);
    for (const side of [-1, 1]) put(p.box, 'paint', side * ((b.cabinWidth + 0.1) / 2), y - 0.08, z, 0.03, 0.3, 0.56);
  } else if (b.wing === 'lip') {
    put(p.box, 'paint', 0, g.topAt(g.rear + 0.15) + 0.03, g.rear + 0.12, b.width - 0.2, 0.05, 0.16);
  }
  if (b.hoodScoop) put(p.box, 'carbon', 0, g.topAt(g.front - 0.9) + 0.04, g.front - 0.9, 0.55, 0.08, 0.5);
  if (b.rally) {
    put(p.box, 'carbon', 0, b.roof.y + 0.07, b.roof.z + 0.2, 0.36, 0.1, 0.4);
    // Light pod on the bonnet with four lamps.
    const podZ = g.front - 0.35;
    const podY = g.topAt(podZ) + 0.1;
    put(p.box, 'carbon', 0, podY, podZ, 1.2, 0.2, 0.08);
    for (let k = 0; k < 4; k++) put(p.box, 'light', (k - 1.5) * 0.28, podY, podZ + 0.045, 0.2, 0.14, 0.02);
    for (const side of [-1, 1]) {
      for (const z of [b.frontAxle - b.wheelRadius - 0.12, b.rearAxle - b.wheelRadius - 0.12]) {
        put(p.box, 'carbon', side * (b.trackHalf + 0.02), g.bottom - 0.12, z, 0.32, 0.3, 0.02);
      }
      // Louvres behind the front wheels let the hot air out of the arches.
      for (let k = 0; k < 4; k++) put(p.box, 'trim', side * (hw + 0.006), g.bottom + 0.3 + k * 0.07, b.frontAxle - archR - 0.16, 0.012, 0.03, 0.28);
      // Red tow hooks front and rear.
      put(p.box, 'brake', side * 0.55, g.bottom + 0.06, g.front + 0.02, 0.05, 0.08, 0.08);
    }
    put(p.box, 'brake', 0, g.bottom + 0.08, g.rear - 0.03, 0.06, 0.08, 0.08);
    // Front splitter and a rear diffuser with strakes.
    put(p.box, 'carbon', 0, g.bottom - 0.05, g.front - 0.02, b.width - 0.1, 0.03, 0.22);
    put(p.box, 'carbon', 0, g.bottom - 0.02, g.rear + 0.12, b.width * 0.7, 0.04, 0.3);
    for (const x of [-0.45, -0.15, 0.15, 0.45]) put(p.box, 'carbon', x, g.bottom + 0.03, g.rear + 0.1, 0.02, 0.1, 0.26);
    // Twin roof antennae for the stage radio.
    for (const side of [-1, 1]) put(p.box, 'trim', side * 0.25, b.roof.y + 0.12, b.roof.z - 0.45, 0.015, 0.24, 0.015);
  }

  // Livery.
  if (pattern === 'stripes') put(g.stripes, 'accent');
  if (pattern === 'side') put(g.side, 'accent');
  if (twotone) put(g.twotone, 'accent');
  if (pattern === 'race') put(g.sill, 'accent');
  const doorZ = (g.cabinFront + Math.min(...b.cabin.map((c) => c[0]))) / 2;
  const doorY = Math.max(g.bottom + 0.3, g.topAt(doorZ) - 0.32);
  for (const side of [-1, 1]) put(p.number, 'number', side * (hw + 0.008), doorY, doorZ, 1, 1, 1, 0, (side * Math.PI) / 2, 0);
  if (pattern === 'race') {
    const z = g.front - 0.7;
    const slope = Math.atan2(g.topAt(z - 0.1) - g.topAt(z + 0.1), 0.2);
    put(p.number, 'number', 0, g.topAt(z) + 0.012, z, 1.1, 1.1, 1, -Math.PI / 2 + slope, 0, 0);
  }

  const body: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  for (const [slot, list] of Object.entries(parts) as [Slot, THREE.BufferGeometry[]][]) if (list.length) body[slot] = mergeAll(list);

  const out: CarGeometry = { body, ...wheelGeometry(def), frontZ: g.front, rearZ: g.rear };
  carCache.set(key, out);
  return out;
}

/** A car's wheels: tyre + rim in one geometry (vertex-coloured), spokes on the outer face. */
function wheelGeometry(def: CarDef): WheelSet {
  const hit = wheelCache.get(def.id);
  if (hit) return hit;
  const b = def.body;
  const g = bodyGeometry(def);
  const matrix = new THREE.Matrix4();
  const tyreColor = new THREE.Color(0x151515);
  const rimColor = new THREE.Color(0x2a2d33);
  const wheelAt = (x: number, side: number): WheelGeometry => {
    matrix.makeTranslation(x, 0, 0);
    const tyre = mergeAll([prep(g.tire, matrix, ['position', 'normal'], tyreColor), prep(g.rim, matrix, ['position', 'normal'], rimColor)]);
    // Spokes sit just inside the outer face; mirrored on the right-hand wheels.
    const face = (b.rally ? 0.15 : 0.125) * side;
    matrix.makeScale(side, 1, 1).setPosition(x + face, 0, 0);
    const spokes = prep(g.spoke, matrix, ['position', 'normal']);
    matrix.makeScale(side, 1, 1).setPosition(x + side * 0.02, 0, 0);
    const brake = prep(g.brake, matrix, ['position', 'normal', 'color']);
    if (side < 0) for (const geo of [spokes, brake]) flipWinding(geo);
    return { tyre, spokes, brake };
  };
  const rl = wheelAt(b.trackHalf, 1);
  const rr = wheelAt(-b.trackHalf, -1);
  const out: WheelSet = {
    left: wheelAt(0, 1),
    right: wheelAt(0, -1),
    rear: { tyre: mergeAll([rl.tyre, rr.tyre]), spokes: mergeAll([rl.spokes, rr.spokes]), brake: mergeAll([rl.brake, rr.brake]) },
  };
  wheelCache.set(def.id, out);
  return out;
}

const FINISHES: Record<CarSetup['finish'], THREE.MeshPhysicalMaterialParameters> = {
  gloss: { metalness: 0.12, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 },
  metallic: { metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 },
  matte: { metalness: 0.08, roughness: 0.72, clearcoat: 0 },
  pearl: { metalness: 0.35, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7, iridescenceIOR: 1.6 },
  satin: { metalness: 0.45, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.45 },
  candy: { metalness: 0.75, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.02, sheen: 0.6, sheenRoughness: 0.3 },
  chrome: { metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 },
};

interface Wheel {
  steer: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

export class CarModel {
  readonly root = new THREE.Group();
  /** Sprung mass: rolls and pitches with load transfer. */
  readonly body = new THREE.Group();
  /** Front bumper position (for the headlight). */
  frontZ = 2.2;
  private wheels: Wheel[] = [];
  private readonly wheelGroup = new THREE.Group();
  private brakeMat!: THREE.MeshBasicMaterial;
  private reverseMat!: THREE.MeshBasicMaterial;
  private readonly beam: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  /** Nitro flames, one per exhaust. */
  private readonly flames: THREE.Mesh[] = [];
  /** Neon light on the road under the car (a shop item). */
  private readonly underglow: THREE.Mesh;
  /** Tyre smoke colour fitted from the shop (null: plain white smoke). */
  smokeColor: THREE.Color | null = null;
  /** Keep the nitro flames lit (the shop showing off a flame colour). */
  showFlames = false;
  private owned: (THREE.Material | THREE.Texture)[] = [];
  /** What the car was last built as (rebuilt when its model file arrives). */
  private def: CarDef | null = null;
  private setup: CarSetup | null = null;
  private roll = 0;
  private pitch = 0;
  private visualSteer = 0;

  constructor(def: CarDef, setup: CarSetup) {
    this.root.rotation.order = 'YXZ';
    this.root.add(this.body, this.wheelGroup);
    const p = getParts();
    shadowTexture ??= radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
    this.shadow = new THREE.Mesh(p.shadow, new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.shadow.userData.noAO = true;
    beamTexture ??= radialTexture('rgba(255,244,220,0.9)', 'rgba(255,244,220,0)');
    this.beam = new THREE.Mesh(
      p.beam,
      new THREE.MeshBasicMaterial({ map: beamTexture, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.beam.position.y = 0.05;
    this.beam.renderOrder = 2;
    this.beam.userData.noAO = true;
    glowTexture ??= radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.underglow = new THREE.Mesh(
      p.shadow,
      new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.underglow.position.y = 0.04;
    this.underglow.renderOrder = 2;
    this.underglow.userData.noAO = true;
    this.root.add(this.shadow, this.beam, this.underglow);
    const f = getFlame();
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(f.geometry, f.material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.userData.noAO = true;
      this.flames.push(mesh);
      this.root.add(mesh);
    }
    this.build(def, setup);
  }

  /** Put the nitro flames at the exhausts: `spread` either side of centre, at the rear bumper. */
  private placeFlames(spread: number, y: number, z: number): void {
    this.flames.forEach((f, i) => f.position.set(i === 0 ? spread : -spread, y, z));
  }

  /** (Re)build the body for a car and paint job; used live by the garage. */
  build(def: CarDef, setup: CarSetup): void {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.body.clear();
    this.wheelGroup.clear();
    this.wheels = [];
    this.def = def;
    this.setup = setup;
    this.showFlames = false;

    const own = <T extends THREE.Material | THREE.Texture>(x: T): T => {
      this.owned.push(x);
      return x;
    };
    this.brakeMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.04, 0.05) }));
    this.fitItems(setup, own);
    this.reverseMat = own(new THREE.MeshBasicMaterial({ color: 0x333333 }));
    const asset = carAsset(def.id);
    if (asset) {
      this.buildImported(def, setup, asset, own);
      return;
    }

    const b = def.body;
    const geo = carGeometry(def, setup.pattern);
    const m = getCommon();
    const materials: Record<Slot, THREE.Material> = {
      paint: own(new THREE.MeshPhysicalMaterial({ color: setup.paint, ...FINISHES[setup.finish] })),
      accent: own(new THREE.MeshPhysicalMaterial({ color: setup.accent, ...FINISHES[setup.finish === 'matte' ? 'matte' : 'gloss'] })),
      glass: m.glass,
      carbon: m.carbon,
      light: m.headlight,
      brake: this.brakeMat,
      reverse: this.reverseMat,
      number: own(new THREE.MeshStandardMaterial({ map: own(numberTexture(setup.number, setup.accent)), roughness: 0.5, transparent: true })),
      plate: own(new THREE.MeshStandardMaterial({ map: own(plateTexture(setup.plate)), roughness: 0.45, metalness: 0.15 })),
      trim: m.trim,
      chrome: m.chrome,
    };
    // One mesh per material: a car is ~16 draw calls instead of ~30.
    for (const [slot, g] of Object.entries(geo.body) as [Slot, THREE.BufferGeometry][]) this.addMesh(g, materials[slot], this.body);
    this.frontZ = geo.frontZ;

    const spokeMat = own(new THREE.MeshStandardMaterial({ color: setup.rims, metalness: 0.85, roughness: 0.25 }));
    const wheel = (x: number, z: number, front: boolean, parts: WheelGeometry) => {
      const steer = new THREE.Group();
      steer.position.set(x, b.wheelRadius, z);
      const spin = new THREE.Group();
      steer.add(spin);
      this.addMesh(parts.tyre, m.wheel, spin);
      this.addMesh(parts.spokes, spokeMat, spin);
      this.addMesh(parts.brake, m.wheel, steer);
      this.wheelGroup.add(steer);
      this.wheels.push({ steer, spin, front });
    };
    wheel(b.trackHalf, b.frontAxle, true, geo.left);
    wheel(-b.trackHalf, b.frontAxle, true, geo.right);
    // The rear wheels never steer and spin together, so they are one axle.
    wheel(0, b.rearAxle, false, geo.rear);
    this.shadow.scale.set(b.width + 0.75, 1, geo.frontZ - geo.rearZ + 1);
    this.underglow.scale.set(b.width + 2.4, 1, geo.frontZ - geo.rearZ + 2.2);
    this.underglow.position.z = (geo.frontZ + geo.rearZ) / 2;
    this.placeFlames(0.42, b.wheelRadius + 0.08, geo.rearZ);
  }

  /** Shop items: underglow, nitro flame colour and tyre smoke colour. */
  private fitItems(setup: CarSetup, own: <T extends THREE.Material | THREE.Texture>(x: T) => T): void {
    const glow = shopItem(setup.glow);
    this.underglow.visible = !!glow;
    if (glow) (this.underglow.material as THREE.MeshBasicMaterial).color.set(glow.color).multiplyScalar(1.6);
    const flameItem = shopItem(setup.flame);
    const shared = getFlame().material;
    const material = flameItem ? own((shared as THREE.MeshBasicMaterial).clone()) : shared;
    if (flameItem) (material as THREE.MeshBasicMaterial).color.set(flameItem.color).multiplyScalar(2.4);
    for (const f of this.flames) f.material = material;
    const smoke = shopItem(setup.smoke);
    this.smokeColor = smoke ? new THREE.Color(smoke.color) : null;
  }

  /** Rebuild if this car's model file has just arrived. */
  refresh(id: CarDef['id']): void {
    if (this.def?.id === id && this.setup) this.build(this.def, this.setup);
  }

  private addMesh(g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): void {
    const out = new THREE.Mesh(g, mat);
    out.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
    parent.add(out);
  }

  /** A body loaded from a model file, painted and fitted with plates like the built-in ones. */
  private buildImported(def: CarDef, setup: CarSetup, asset: CarAsset, own: <T extends THREE.Material | THREE.Texture>(x: T) => T): void {
    const m = getCommon();
    const rims = own(new THREE.MeshStandardMaterial({ color: setup.rims, metalness: 0.85, roughness: 0.25 }));
    const materials: Record<Exclude<PartRole, 'other'>, THREE.Material> = {
      paint: own(liveryMaterial(asset, FINISHES[setup.finish], setup, own(numberTexture(setup.number, setup.accent)))),
      glass: m.glass,
      light: m.headlight,
      brake: this.brakeMat,
      trim: m.trim,
      chrome: m.chrome,
      rims,
    };
    for (const part of asset.body) this.addMesh(part.geometry, part.material ?? materials[part.role as Exclude<PartRole, 'other'>], this.body);

    const plate = own(new THREE.MeshStandardMaterial({ map: own(plateTexture(setup.plate)), roughness: 0.45, metalness: 0.15 }));
    asset.plates.forEach((at, i) => {
      const mesh = new THREE.Mesh(getParts().plate, plate);
      mesh.position.copy(at);
      mesh.rotation.y = i === 0 ? 0 : Math.PI;
      this.body.add(mesh);
    });

    // The model's own wheels, or the game's (scaled to fit the arches) when it has none to spin.
    const builtIn = wheelGeometry(def);
    for (const w of asset.wheels) {
      const steer = new THREE.Group();
      steer.position.copy(w.centre);
      const spin = new THREE.Group();
      steer.add(spin);
      if (w.parts.length) {
        for (const part of w.parts) this.addMesh(part.geometry, part.material ?? materials[part.role as Exclude<PartRole, 'other'>], spin);
      } else {
        const g = w.centre.x > 0 ? builtIn.left : builtIn.right;
        steer.scale.setScalar(w.radius / def.body.wheelRadius);
        this.addMesh(g.tyre, m.wheel, spin);
        this.addMesh(g.spokes, rims, spin);
        this.addMesh(g.brake, m.wheel, steer);
      }
      this.wheelGroup.add(steer);
      this.wheels.push({ steer, spin, front: w.front });
    }
    this.frontZ = asset.front;
    this.shadow.scale.set(asset.width + 0.75, 1, asset.front - asset.rear + 1);
    this.underglow.scale.set(asset.width + 2.4, 1, asset.front - asset.rear + 2.2);
    this.underglow.position.z = (asset.front + asset.rear) / 2;
    this.placeFlames(asset.width * 0.2, def.body.wheelRadius + 0.05, asset.rear);
  }

  /**
   * Sync the visual with the simulation. `alpha` (0..1) interpolates between the previous and
   * current physics step so motion is smooth at any display refresh rate.
   */
  update(car: SimCar, alpha: number, dt: number): void {
    const p = car.physics;
    this.root.position.set(lerp(car.prevX, p.x, alpha), lerp(car.prevY, p.y, alpha), lerp(car.prevZ, p.z, alpha));
    this.root.rotation.y = car.prevHeading + wrapAngle(p.heading - car.prevHeading) * alpha;
    const slopeAlongCar = car.proj.slope * Math.cos(p.heading - car.proj.heading);
    this.root.rotation.x = -Math.atan(slopeAlongCar);

    // Body roll leans out of corners; pitch dives under braking and squats on throttle.
    this.roll = damp(this.roll, -p.latAccel * 0.0045, 8, dt);
    this.pitch = damp(this.pitch, -p.longAccel * 0.0045, 8, dt);
    this.body.rotation.z = this.roll;
    this.body.rotation.x = this.pitch;
    this.body.position.y = Math.abs(this.roll) * 0.4;

    // Front wheels steer (exaggerated slightly at speed so it reads on screen); all wheels spin.
    this.visualSteer = damp(this.visualSteer, p.steerAngle * 1.6, 20, dt);
    for (const w of this.wheels) {
      if (w.front) w.steer.rotation.y = -this.visualSteer;
      w.spin.rotation.x = p.wheelSpin;
    }

    // Nitro flames flicker in length while they burn.
    for (const f of this.flames) {
      f.visible = p.nitroActive || this.showFlames;
      if (f.visible) f.scale.set(1, 1, 0.65 + Math.random() * 0.7);
    }

    const braking = p.braking && p.forwardSpeed > 0.5;
    this.brakeMat.color.setRGB(braking ? 7 : 1.4, braking ? 0.15 : 0.04, braking ? 0.12 : 0.05);
    this.reverseMat.color.setRGB(p.gear < 0 ? 4 : 0.2, p.gear < 0 ? 4 : 0.2, p.gear < 0 ? 4 : 0.2);
  }

  /** Headlight pools on the road from dusk; brighter on unlit country roads. */
  setLighting(tod: TimeOfDay, unlitRoads: boolean): void {
    const material = this.beam.material as THREE.MeshBasicMaterial;
    this.beam.visible = tod !== 'day';
    material.opacity = tod === 'sunset' ? 0.07 : unlitRoads ? 0.22 : 0.13;
  }
}
