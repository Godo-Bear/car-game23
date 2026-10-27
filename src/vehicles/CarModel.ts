import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarSetup, TimeOfDay } from '../../shared/api';
import { damp, lerp, wrapAngle } from '../core/math';
import type { SimCar } from '../race/RaceSimulation';
import type { BodyDef, CarDef } from './cars';

/**
 * Procedurally built cars (no external model files needed). Each body is extruded from a side
 * profile in `cars.ts`; liveries (stripes, two-tone, race numbers) are ribbons that follow the
 * body's top line, so every pattern fits every car.
 * Local frame: +z is forward, +y is up, -x is the car's right-hand side.
 */

interface BodyGeometry {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spoke: THREE.BufferGeometry;
  stripes: THREE.BufferGeometry;
  side: THREE.BufferGeometry;
  sill: THREE.BufferGeometry;
  twotone: THREE.BufferGeometry;
  /** Key points measured from the profile. */
  front: number;
  rear: number;
  bottom: number;
  topAt: (z: number) => number;
  cabinFront: number;
}

const cache = new Map<string, BodyGeometry>();
let parts: Record<'headlight' | 'taillight' | 'box' | 'number' | 'shadow' | 'beam', THREE.BufferGeometry> | null = null;
let shadowTexture: THREE.Texture | null = null;
let beamTexture: THREE.Texture | null = null;
let common: Record<'wheel' | 'glass' | 'carbon' | 'headlight', THREE.Material> | null = null;

function extrudeProfile(points: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // Profile X -> car forward (+z); extrusion axis -> car width (x).
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
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
  const front = Math.max(...b.profile.map((p) => p[0]));
  const rear = Math.min(...b.profile.map((p) => p[0]));
  const bottom = Math.min(...b.profile.map((p) => p[1]));
  const topAt = (z: number) => profileTop(b.profile, z);
  const cabinFront = Math.max(...b.cabin.map((p) => p[0]));
  const cabinRear = Math.min(...b.cabin.map((p) => p[0]));
  const roofFront = b.roof.z + b.roof.length / 2;
  const roofRear = b.roof.z - b.roof.length / 2;
  const g0 = { front, rear, bottom, topAt };

  // Painted surfaces only: bonnet, roof panel, boot lid (not the glass in between).
  const paintedTop = (z: number): number | null => {
    if (z > cabinFront - 0.05 || z < cabinRear + 0.05) return topAt(z) + 0.006;
    if (z <= roofFront && z >= roofRear) return b.roof.y + 0.026;
    return null;
  };
  const hoodAndBoot = (z: number): number | null => (z > cabinFront - 0.05 || z < cabinRear + 0.05 ? topAt(z) + 0.005 : null);

  const tireWidth = b.rally ? 0.3 : 0.27;
  const tire = new THREE.CylinderGeometry(b.wheelRadius, b.wheelRadius, tireWidth, 22, 1);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(b.wheelRadius * 0.67, b.wheelRadius * 0.67, tireWidth + 0.01, 16, 1);
  rim.rotateZ(Math.PI / 2);
  // Five spokes so wheel rotation is clearly visible.
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(0.03, b.wheelRadius * 0.6, 0.055);
    s.translate(0, b.wheelRadius * 0.3, 0);
    s.rotateX((i / 5) * Math.PI * 2);
    spokes.push(s);
  }
  const roof = new THREE.BoxGeometry(b.cabinWidth - 0.16, 0.04, b.roof.length);
  roof.translate(0, b.roof.y, b.roof.z);

  const geo: BodyGeometry = {
    ...g0,
    cabinFront,
    body: extrudeProfile(b.profile, b.width, 0.06),
    cabin: extrudeProfile(b.cabin, b.cabinWidth, 0.05),
    roof,
    tire,
    rim,
    spoke: mergeSimple(spokes),
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

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  return out;
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

function getParts() {
  if (parts) return parts;
  const shadow = new THREE.PlaneGeometry(1, 1);
  shadow.rotateX(-Math.PI / 2);
  const beam = new THREE.PlaneGeometry(9, 22);
  beam.rotateX(-Math.PI / 2);
  beam.translate(0, 0, 13);
  parts = {
    headlight: new THREE.BoxGeometry(0.42, 0.08, 0.06),
    taillight: new THREE.BoxGeometry(1, 0.06, 0.05),
    box: new THREE.BoxGeometry(1, 1, 1),
    number: new THREE.PlaneGeometry(0.58, 0.58),
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
  };
  return common;
}

type Slot = 'paint' | 'accent' | 'glass' | 'carbon' | 'light' | 'brake' | 'reverse' | 'number';

interface WheelGeometry {
  tyre: THREE.BufferGeometry;
  spokes: THREE.BufferGeometry;
}

interface CarGeometry {
  /** Every static part of the body, merged per material slot. */
  body: Partial<Record<Slot, THREE.BufferGeometry>>;
  left: WheelGeometry;
  right: WheelGeometry;
  rear: WheelGeometry;
  frontZ: number;
  rearZ: number;
}

const carCache = new Map<string, CarGeometry>();

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

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  return out;
}

/** A car's geometry for one body + livery pattern (shared by every car that looks like it). */
function carGeometry(def: CarDef, pattern: CarSetup['pattern']): CarGeometry {
  const key = `${def.id}|${pattern}`;
  const hit = carCache.get(key);
  if (hit) return hit;
  const b = def.body;
  const g = bodyGeometry(def);
  const p = getParts();
  const parts: Record<Slot, THREE.BufferGeometry[]> = { paint: [], accent: [], glass: [], carbon: [], light: [], brake: [], reverse: [], number: [] };
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const put = (geo: THREE.BufferGeometry, slot: Slot, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    matrix.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    parts[slot].push(prep(geo, matrix, slot === 'number' ? ['position', 'normal', 'uv'] : ['position', 'normal']));
  };
  const twotone = pattern === 'twotone';

  put(g.body, 'paint');
  put(g.cabin, 'glass');
  put(g.roof, twotone ? 'accent' : 'paint');
  const hw = b.width / 2;
  // Lights, splitter and mirrors are placed from the measured profile.
  const headY = g.topAt(g.front - 0.18) - 0.08;
  put(p.headlight, 'light', hw - 0.36, headY, g.front - 0.05);
  put(p.headlight, 'light', -(hw - 0.36), headY, g.front - 0.05);
  put(p.box, 'carbon', 0, g.bottom + 0.02, g.front - 0.12, b.width - 0.04, 0.04, 0.3);
  put(p.taillight, 'brake', 0, g.topAt(g.rear + 0.12) - 0.1, g.rear - 0.02, b.width - 0.38, 1, 1);
  put(p.headlight, 'reverse', 0, g.topAt(g.rear + 0.12) - 0.3, g.rear - 0.03, 0.4, 1, 1);
  const mirrorZ = g.cabinFront - 0.35;
  for (const side of [-1, 1]) put(p.box, twotone ? 'accent' : 'paint', side * (hw + 0.07), g.topAt(mirrorZ) + 0.1, mirrorZ, 0.18, 0.1, 0.12);

  if (b.wing === 'gt') {
    const z = g.rear + 0.25;
    const y = g.topAt(z) + 0.26;
    put(p.box, 'carbon', 0, y, z, b.width - 0.12, 0.04, 0.34);
    for (const side of [-1, 1]) put(p.box, 'carbon', side * 0.55, y - 0.13, z, 0.05, 0.22, 0.14);
  } else if (b.wing === 'roof') {
    const z = b.roof.z - b.roof.length / 2 - 0.12;
    put(p.box, b.rally ? 'carbon' : 'paint', 0, b.roof.y + 0.03, z, b.cabinWidth - 0.06, b.rally ? 0.06 : 0.04, b.rally ? 0.4 : 0.26);
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
    }
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

  // Wheels: tyre + rim in one geometry (vertex-coloured), spokes on the outer face.
  const tyreColor = new THREE.Color(0x151515);
  const rimColor = new THREE.Color(0x2a2d33);
  const wheelAt = (x: number, side: number): WheelGeometry => {
    matrix.makeTranslation(x, 0, 0);
    const tyre = mergeAll([prep(g.tire, matrix, ['position', 'normal'], tyreColor), prep(g.rim, matrix, ['position', 'normal'], rimColor)]);
    matrix.makeTranslation(x + side * (b.rally ? 0.16 : 0.145), 0, 0);
    return { tyre, spokes: prep(g.spoke, matrix, ['position', 'normal']) };
  };
  const rl = wheelAt(b.trackHalf, 1);
  const rr = wheelAt(-b.trackHalf, -1);
  const out: CarGeometry = {
    body,
    left: wheelAt(0, 1),
    right: wheelAt(0, -1),
    rear: { tyre: mergeAll([rl.tyre, rr.tyre]), spokes: mergeAll([rl.spokes, rr.spokes]) },
    frontZ: g.front,
    rearZ: g.rear,
  };
  carCache.set(key, out);
  return out;
}

const FINISHES: Record<CarSetup['finish'], THREE.MeshPhysicalMaterialParameters> = {
  gloss: { metalness: 0.12, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 },
  metallic: { metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 },
  matte: { metalness: 0.08, roughness: 0.72, clearcoat: 0 },
  pearl: { metalness: 0.35, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7, iridescenceIOR: 1.6 },
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
  private owned: (THREE.Material | THREE.Texture)[] = [];
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
    this.root.add(this.shadow, this.beam);
    this.build(def, setup);
  }

  /** (Re)build the body for a car and paint job; used live by the garage. */
  build(def: CarDef, setup: CarSetup): void {
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.body.clear();
    this.wheelGroup.clear();
    this.wheels = [];

    const b = def.body;
    const geo = carGeometry(def, setup.pattern);
    const m = getCommon();
    const own = <T extends THREE.Material | THREE.Texture>(x: T): T => {
      this.owned.push(x);
      return x;
    };
    this.brakeMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.04, 0.05) }));
    this.reverseMat = own(new THREE.MeshBasicMaterial({ color: 0x333333 }));
    const materials: Record<Slot, THREE.Material> = {
      paint: own(new THREE.MeshPhysicalMaterial({ color: setup.paint, ...FINISHES[setup.finish] })),
      accent: own(new THREE.MeshPhysicalMaterial({ color: setup.accent, ...FINISHES[setup.finish === 'matte' ? 'matte' : 'gloss'] })),
      glass: m.glass,
      carbon: m.carbon,
      light: m.headlight,
      brake: this.brakeMat,
      reverse: this.reverseMat,
      number: own(new THREE.MeshStandardMaterial({ map: own(numberTexture(setup.number, setup.accent)), roughness: 0.5, transparent: true })),
    };
    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
      const out = new THREE.Mesh(g, mat);
      out.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
      parent.add(out);
    };
    // One mesh per material: a car is ~16 draw calls instead of ~30.
    for (const [slot, g] of Object.entries(geo.body) as [Slot, THREE.BufferGeometry][]) mesh(g, materials[slot], this.body);
    this.frontZ = geo.frontZ;

    const spokeMat = own(new THREE.MeshStandardMaterial({ color: setup.rims, metalness: 0.85, roughness: 0.25 }));
    const wheel = (x: number, z: number, front: boolean, parts: WheelGeometry) => {
      const steer = new THREE.Group();
      steer.position.set(x, b.wheelRadius, z);
      const spin = new THREE.Group();
      steer.add(spin);
      mesh(parts.tyre, m.wheel, spin);
      mesh(parts.spokes, spokeMat, spin);
      this.wheelGroup.add(steer);
      this.wheels.push({ steer, spin, front });
    };
    wheel(b.trackHalf, b.frontAxle, true, geo.left);
    wheel(-b.trackHalf, b.frontAxle, true, geo.right);
    // The rear wheels never steer and spin together, so they are one axle.
    wheel(0, b.rearAxle, false, geo.rear);
    this.shadow.scale.set(b.width + 0.75, 1, geo.frontZ - geo.rearZ + 1);
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
