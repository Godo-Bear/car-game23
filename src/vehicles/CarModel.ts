import * as THREE from 'three';
import { damp, lerp, wrapAngle } from '../core/math';
import type { SimCar } from '../race/RaceSimulation';

/**
 * Procedurally built low-poly GT car (no external model files needed).
 * Local frame: +z is forward, +y is up, -x is the car's right-hand side.
 * Swap `buildBody()` for a glTF loader later to drop in licensed vehicle models.
 */

const WHEEL_RADIUS = 0.33;
const TRACK_HALF = 0.8;
const FRONT_AXLE = 1.2;
const REAR_AXLE = -1.4;

interface SharedGeometry {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spoke: THREE.BufferGeometry;
  headlight: THREE.BufferGeometry;
  taillight: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  wingPost: THREE.BufferGeometry;
  splitter: THREE.BufferGeometry;
  mirror: THREE.BufferGeometry;
  number: THREE.BufferGeometry;
  stripe: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
  beam: THREE.BufferGeometry;
}

let shared: SharedGeometry | null = null;
let shadowTexture: THREE.Texture | null = null;
let beamTexture: THREE.Texture | null = null;
let darkMaterials: { tire: THREE.Material; rim: THREE.Material; spoke: THREE.Material; glass: THREE.Material; carbon: THREE.Material; headlight: THREE.Material } | null = null;

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

function getShared(): SharedGeometry {
  if (shared) return shared;
  const body = extrudeProfile(
    [
      [-2.24, 0.3],
      [2.08, 0.3],
      [2.2, 0.42],
      [2.16, 0.6],
      [1.05, 0.8],
      [-1.55, 0.86],
      [-2.18, 0.9],
      [-2.27, 0.72],
      [-2.27, 0.42],
    ],
    1.88,
    0.06,
  );
  const cabin = extrudeProfile(
    [
      [-1.5, 0.84],
      [1.0, 0.8],
      [0.2, 1.2],
      [-0.85, 1.23],
      [-1.52, 0.9],
    ],
    1.46,
    0.05,
  );
  const roof = new THREE.BoxGeometry(1.3, 0.04, 0.95);
  roof.translate(0, 1.245, -0.33);

  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.27, 22, 1);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.22, 0.22, 0.28, 16, 1);
  rim.rotateZ(Math.PI / 2);
  // Five-spoke design so wheel rotation is clearly visible.
  const spokeParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(0.03, 0.2, 0.055);
    s.translate(0, 0.1, 0);
    s.rotateX((i / 5) * Math.PI * 2);
    spokeParts.push(s);
  }
  const spoke = mergeSimple(spokeParts);

  const headlight = new THREE.BoxGeometry(0.42, 0.08, 0.06);
  const taillight = new THREE.BoxGeometry(1.5, 0.06, 0.05);
  const wing = new THREE.BoxGeometry(1.75, 0.04, 0.34);
  const wingPost = new THREE.BoxGeometry(0.05, 0.2, 0.14);
  const splitter = new THREE.BoxGeometry(1.86, 0.04, 0.3);
  const mirror = new THREE.BoxGeometry(0.18, 0.1, 0.12);
  const number = new THREE.PlaneGeometry(0.62, 0.62);
  const stripe = new THREE.BoxGeometry(0.34, 0.012, 1);
  const shadow = new THREE.PlaneGeometry(2.6, 5.4);
  shadow.rotateX(-Math.PI / 2);
  const beam = new THREE.PlaneGeometry(9, 22);
  beam.rotateX(-Math.PI / 2);
  beam.translate(0, 0, 13);
  shared = { body, cabin, roof, tire, rim, spoke, headlight, taillight, wing, wingPost, splitter, mirror, number, stripe, shadow, beam };
  return shared;
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of parts) {
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

function radialTexture(inner: string, outer: string, stretch = 1): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128 * stretch;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64 * stretch, 0, 64, 64 * stretch, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.setTransform(1, 0, 0, stretch, 0, 0);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(num: number, color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = '#111';
  g.font = 'bold italic 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getDarkMaterials() {
  if (darkMaterials) return darkMaterials;
  darkMaterials = {
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.6, roughness: 0.45 }),
    spoke: new THREE.MeshStandardMaterial({ color: 0xd6dae2, metalness: 0.9, roughness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.3 }),
    headlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5.5) }),
  };
  return darkMaterials;
}

export interface CarLivery {
  color: number;
  stripe: number | null;
  number: number;
}

export const LIVERIES: CarLivery[] = [
  { color: 0x1e88ff, stripe: 0xffffff, number: 23 }, // player
  { color: 0xe8202a, stripe: 0xffffff, number: 1 },
  { color: 0xf5f5f5, stripe: 0xd01020, number: 7 },
  { color: 0xffb000, stripe: 0x111111, number: 11 },
  { color: 0x13c27a, stripe: null, number: 44 },
  { color: 0x9b3cff, stripe: 0xffffff, number: 86 },
  { color: 0x202326, stripe: 0xff6a00, number: 3 },
  { color: 0xff4fa3, stripe: 0x1a1a1a, number: 32 },
  { color: 0x00c8e0, stripe: 0x101010, number: 55 },
  { color: 0xc0c4cc, stripe: 0x1e88ff, number: 17 },
  { color: 0x6b8e23, stripe: null, number: 9 },
  { color: 0xff7a1a, stripe: 0x0a2a6a, number: 77 },
];

interface Wheel {
  steer: THREE.Group;
  spin: THREE.Group;
  front: boolean;
}

export class CarModel {
  readonly root = new THREE.Group();
  /** Sprung mass: rolls and pitches with load transfer. */
  readonly body = new THREE.Group();
  private readonly wheels: Wheel[] = [];
  private readonly brakeMat: THREE.MeshBasicMaterial;
  private readonly reverseMat: THREE.MeshBasicMaterial;
  private readonly beam: THREE.Mesh;
  private roll = 0;
  private pitch = 0;
  private visualSteer = 0;

  constructor(livery: CarLivery) {
    const g = getShared();
    const m = getDarkMaterials();
    this.root.rotation.order = 'YXZ';

    const paint = new THREE.MeshPhysicalMaterial({
      color: livery.color,
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.body);
    add(g.body, paint, this.body);
    add(g.cabin, m.glass, this.body);
    add(g.roof, paint, this.body);
    add(g.splitter, m.carbon, this.body, 0, 0.3, 2.08);
    add(g.wing, m.carbon, this.body, 0, 1.12, -1.98);
    add(g.wingPost, m.carbon, this.body, 0.55, 0.98, -1.98);
    add(g.wingPost, m.carbon, this.body, -0.55, 0.98, -1.98);
    add(g.mirror, paint, this.body, 0.98, 0.9, 0.75);
    add(g.mirror, paint, this.body, -0.98, 0.9, 0.75);
    add(g.headlight, m.headlight, this.body, 0.6, 0.6, 2.17);
    add(g.headlight, m.headlight, this.body, -0.6, 0.6, 2.17);

    this.brakeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.04, 0.05) });
    add(g.taillight, this.brakeMat, this.body, 0, 0.8, -2.29);
    this.reverseMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const rev = add(g.headlight, this.reverseMat, this.body, 0, 0.5, -2.3);
    rev.scale.set(0.4, 1, 1);

    if (livery.stripe !== null) {
      const stripeMat = new THREE.MeshStandardMaterial({ color: livery.stripe, roughness: 0.4 });
      // Racing stripe over the bonnet and roof.
      const hood = add(g.stripe, stripeMat, this.body, 0, 0.715, 1.6);
      hood.scale.z = 1.1;
      hood.rotation.x = 0.17;
      const roofStripe = add(g.stripe, stripeMat, this.body, 0, 1.27, -0.33);
      roofStripe.scale.z = 0.95;
    }
    const numberMat = new THREE.MeshStandardMaterial({
      map: numberTexture(livery.number, '#' + livery.color.toString(16).padStart(6, '0')),
      roughness: 0.5,
      transparent: true,
    });
    const left = add(g.number, numberMat, this.body, 0.952, 0.58, -0.15);
    left.rotation.y = Math.PI / 2;
    const right = add(g.number, numberMat, this.body, -0.952, 0.58, -0.15);
    right.rotation.y = -Math.PI / 2;

    for (const [x, z, front] of [
      [TRACK_HALF, FRONT_AXLE, true],
      [-TRACK_HALF, FRONT_AXLE, true],
      [TRACK_HALF, REAR_AXLE, false],
      [-TRACK_HALF, REAR_AXLE, false],
    ] as const) {
      const steer = new THREE.Group();
      steer.position.set(x, WHEEL_RADIUS, z);
      const spin = new THREE.Group();
      steer.add(spin);
      add(g.tire, m.tire, spin);
      add(g.rim, m.rim, spin);
      // Bright spokes on a dark rim face so the rotation reads clearly.
      add(g.spoke, m.spoke, spin, Math.sign(x) * 0.145);
      this.root.add(steer);
      this.wheels.push({ steer, spin, front });
    }

    shadowTexture ??= radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
    const shadow = new THREE.Mesh(
      g.shadow,
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
    );
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    this.root.add(shadow);

    beamTexture ??= radialTexture('rgba(255,244,220,0.9)', 'rgba(255,244,220,0)', 1);
    this.beam = new THREE.Mesh(
      g.beam,
      new THREE.MeshBasicMaterial({
        map: beamTexture,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.beam.position.y = 0.05;
    this.beam.renderOrder = 2;
    this.root.add(this.beam);
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

  setBeamVisible(v: boolean): void {
    this.beam.visible = v;
  }
}
