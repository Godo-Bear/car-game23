import * as THREE from 'three';
import { GeometryBuilder } from './GeometryBuilder';

/**
 * The city traffic's vehicles: low-poly but properly shaped (a bonnet, a raked windscreen, a
 * glasshouse with pillars, bumpers, plates, wheel arches) - kei cars, hatchbacks, saloons,
 * taxis, minivans, kei trucks, delivery trucks, city buses and the odd police car. Each is a
 * body (painted per car: instance colour times its vertex colours, so liveries can be painted
 * in) and a detail mesh (glass, trim and plates, fixed colours). Lamps and wheels are listed for
 * the traffic to draw (they light up and turn).
 */

type V3 = [number, number, number];
type P2 = [number, number];

export type LampKind = 'head' | 'tail' | 'indL' | 'indR' | 'sign' | 'vacant' | 'led' | 'beacon';

/** A lamp: its kind and a box (centre and size) in the vehicle's frame (+z forward, +x left). */
export interface Lamp {
  kind: LampKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface VehicleModel {
  name: string;
  len: number;
  wid: number;
  wheelR: number;
  tyreW: number;
  /** Axle positions (z) and the wheels' distance either side of the middle. */
  axles: number[];
  track: number;
  /** Paint colours to pick from (white for the ones with a livery painted in). */
  paints: number[];
  /** How common (relative). */
  weight: number;
  /** Cruising speed, relative to the road's. */
  pace: number;
  /** A bus: main roads only, stops at the bus stops. */
  bus?: boolean;
  body: THREE.BufferGeometry;
  detail: THREE.BufferGeometry;
  lamps: Lamp[];
}

const GLASS = new THREE.Color(0x1c2530);
const TRIM = new THREE.Color(0x26272b);
const GRILLE = new THREE.Color(0x141518);
const PLATE_WHITE = new THREE.Color(0xeeeee4);
const PLATE_YELLOW = new THREE.Color(0xf0cf35);
const WHITE = new THREE.Color(1, 1, 1);

/** A flat polygon (convex, any winding), turned to face `out`. */
function face(b: GeometryBuilder, pts: V3[], out: V3, color: THREE.Color): void {
  // Newell's method: the polygon's normal, robust to repeated or lined-up corners.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[(i + 1) % pts.length];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  let order = pts;
  if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
    order = [...pts].reverse();
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  const n: V3 = [nx / l, ny / l, nz / l];
  const idx = order.map((p) => b.vertex(p, n, p[2], p[1], color));
  for (let i = 1; i + 1 < idx.length; i++) b.triangle(idx[0], idx[i], idx[i + 1]);
}

/**
 * A prism: a side profile (z, y points, convex) between x = -hw and x = hw. `paint` says, for
 * each side ('side') and each edge of the profile (its index), which builder and colour it goes
 * in (or null to leave it out).
 */
function extrude(profile: P2[], hw: number, paint: (part: 'side' | number) => [GeometryBuilder, THREE.Color] | null): void {
  const cz = profile.reduce((s, p) => s + p[0], 0) / profile.length;
  const cy = profile.reduce((s, p) => s + p[1], 0) / profile.length;
  const side = paint('side');
  if (side) {
    for (const sx of [-1, 1]) {
      face(
        side[0],
        profile.map(([z, y]): V3 => [sx * hw, y, z]),
        [sx, 0, 0],
        side[1],
      );
    }
  }
  profile.forEach(([z0, y0], i) => {
    const [z1, y1] = profile[(i + 1) % profile.length];
    const part = paint(i);
    if (!part) return;
    face(
      part[0],
      [
        [-hw, y0, z0],
        [hw, y0, z0],
        [hw, y1, z1],
        [-hw, y1, z1],
      ],
      [0, (y0 + y1) / 2 - cy, (z0 + z1) / 2 - cz],
      part[1],
    );
  });
}

/** A wheel arch: a dark half-ring painted on the body side round each wheel. */
function arches(b: GeometryBuilder, axles: number[], r: number, hw: number, y: number): void {
  for (const z of axles) {
    for (const sx of [-1, 1]) {
      const N = 8;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI;
        const a1 = ((i + 1) / N) * Math.PI;
        const p = (a: number, rr: number): V3 => [sx * hw, y + Math.sin(a) * rr, z + Math.cos(a) * rr];
        face(b, [p(a0, r * 0.98), p(a1, r * 0.98), p(a1, r * 1.22), p(a0, r * 1.22)], [sx, 0, 0], TRIM);
      }
    }
  }
}

interface CarShape {
  len: number;
  wid: number;
  /** Bottom of the body, the belt line (bottom of the windows), the roof. */
  sill: number;
  belt: number;
  roof: number;
  /** Lengths of the bonnet and the boot (0 for a hatch), the windscreen and rear window's rake. */
  bonnet: number;
  boot: number;
  rakeF: number;
  rakeR: number;
  /** How far the nose and tail drop below the belt line. */
  nose: number;
  tail: number;
  wheelR: number;
  axles: number[];
  plate: 'white' | 'yellow';
  /** Livery: the colour of the lower body and of the cabin roof (default white = paint). */
  lower?: THREE.Color;
  roofColor?: THREE.Color;
  /** White door panels on a darker body (the police car). */
  doors?: THREE.Color;
}

/** A car-shaped vehicle: body, glasshouse with pillars, bumpers, grille, plates, mirrors, arches, lamps. */
function carShape(o: CarShape): { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lamps: Lamp[] } {
  const body = new GeometryBuilder(true);
  const detail = new GeometryBuilder(true);
  const { len: L, wid: W, sill, belt, roof } = o;
  const hw = W / 2;
  const lower = o.lower ?? WHITE;
  // Lower body: from the front bumper over the bonnet to the windscreen, along to the boot, down the tail.
  extrude(
    [
      [-L / 2, sill],
      [L / 2, sill],
      [L / 2, belt - o.nose],
      [L / 2 - o.bonnet, belt],
      [-L / 2 + Math.min(o.boot, 0.3), belt],
      [-L / 2, belt - o.tail],
    ],
    hw,
    () => [body, lower],
  );
  // The glasshouse: glass sides, windscreen and rear window, a painted roof.
  const zf = L / 2 - o.bonnet;
  const zr = -L / 2 + o.boot;
  const hc = hw - 0.07;
  const roofColor = o.roofColor ?? WHITE;
  extrude(
    [
      [zr, belt],
      [zf, belt],
      [zf - o.rakeF, roof],
      [zr + o.rakeR, roof],
    ],
    hc,
    (part) => (part === 0 ? null : part === 2 ? [body, roofColor] : [detail, GLASS]),
  );
  // Pillars over the glass: A (along the windscreen), B (the middle), C (along the rear window).
  for (const sx of [-1, 1]) {
    const x = sx * (hc + 0.006);
    const strip = (a: P2, b: P2, w: number, toward: number) =>
      face(
        body,
        [
          [x, a[1], a[0]],
          [x, a[1], a[0] + toward * w],
          [x, b[1], b[0] + toward * w],
          [x, b[1], b[0]],
        ],
        [sx, 0, 0],
        roofColor,
      );
    strip([zf, belt], [zf - o.rakeF, roof], 0.12, -1);
    strip([zr, belt], [zr + o.rakeR, roof], o.boot > 0 ? 0.16 : 0.3, 1);
    const zm = (zr + o.rakeR * 0.5 + zf - o.rakeF * 0.5) / 2;
    if (zf - zr > 1.6) strip([zm - 0.06, belt], [zm - 0.06, roof], 0.12, 1);
    // A thin roof rail along the top of the windows.
    face(
      body,
      [
        [x, roof - 0.07, zr + o.rakeR],
        [x, roof - 0.07, zf - o.rakeF],
        [x, roof, zf - o.rakeF],
        [x, roof, zr + o.rakeR],
      ],
      [sx, 0, 0],
      roofColor,
    );
  }
  if (o.doors) {
    // Door panels in a second colour, just proud of the body side.
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.004);
      face(
        body,
        [
          [x, sill + 0.12, zr + 0.15],
          [x, sill + 0.12, zf - 0.05],
          [x, belt - 0.04, zf - 0.05],
          [x, belt - 0.04, zr + 0.15],
        ],
        [sx, 0, 0],
        o.doors,
      );
    }
  }
  // Door shut lines, mirrors.
  for (const sx of [-1, 1]) {
    for (const z of zf - zr > 1.6 ? [zf - 0.05, (zr + zf) / 2 - 0.06] : [zf - 0.05]) {
      detail.box(sx * (hw + 0.002), sill + 0.1, z, 0.012, belt - sill - 0.14, 0.025, 0, { color: TRIM, roof: null });
    }
    body.box(sx * (hw + 0.07), belt + 0.02, zf - 0.18, 0.14, 0.1, 0.18, 0, { color: roofColor });
  }
  // Bumpers, grille, plates, arches.
  detail.box(0, sill - 0.04, L / 2 - 0.1, W + 0.02, 0.22, 0.24, 0, { color: TRIM });
  detail.box(0, sill - 0.04, -L / 2 + 0.1, W + 0.02, 0.22, 0.24, 0, { color: TRIM });
  detail.box(0, belt - o.nose - 0.3, L / 2 + 0.004, W * 0.42, 0.18, 0.02, 0, { color: GRILLE });
  const plate = o.plate === 'yellow' ? PLATE_YELLOW : PLATE_WHITE;
  detail.box(0, sill + 0.03, L / 2 + 0.035, 0.34, 0.17, 0.02, 0, { color: plate });
  detail.box(0, belt - o.tail - 0.42, -L / 2 - 0.006, 0.34, 0.17, 0.02, 0, { color: plate });
  arches(detail, o.axles, o.wheelR, hw + 0.003, o.wheelR);
  const lamps: Lamp[] = [];
  for (const sx of [-1, 1]) {
    lamps.push({ kind: 'head', x: sx * (hw - 0.28), y: belt - o.nose - 0.1, z: L / 2 + 0.012, w: 0.32, h: 0.12, d: 0.03 });
    lamps.push({ kind: 'tail', x: sx * (hw - 0.2), y: belt - o.tail - 0.12, z: -L / 2 - 0.012, w: 0.26, h: 0.15, d: 0.03 });
    const ind: LampKind = sx > 0 ? 'indL' : 'indR';
    lamps.push({ kind: ind, x: sx * (hw - 0.06), y: belt - o.nose - 0.12, z: L / 2 + 0.01, w: 0.1, h: 0.08, d: 0.03 });
    lamps.push({ kind: ind, x: sx * (hw - 0.05), y: belt - o.tail - 0.32, z: -L / 2 - 0.01, w: 0.1, h: 0.07, d: 0.03 });
  }
  return { body: body.build(), detail: detail.build(), lamps };
}

function model(
  base: Omit<VehicleModel, 'body' | 'detail' | 'lamps' | 'track' | 'tyreW'> & { tyreW?: number },
  parts: { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lamps: Lamp[] },
): VehicleModel {
  const tyreW = base.tyreW ?? 0.21;
  return { ...base, tyreW, track: base.wid / 2 - tyreW / 2 + 0.02, ...parts };
}

/** A kei truck: a tall little cab and a flatbed with drop sides. */
function keiTruck(): { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lamps: Lamp[] } {
  const L = 3.39;
  const W = 1.47;
  const cab = carShape({
    len: 1.5,
    wid: W,
    sill: 0.34,
    belt: 0.98,
    roof: 1.78,
    bonnet: 0.12,
    boot: 0.05,
    rakeF: 0.3,
    rakeR: 0.02,
    nose: 0.12,
    tail: 0,
    wheelR: 0.27,
    axles: [0.05],
    plate: 'yellow',
  });
  const body = new GeometryBuilder(true);
  const detail = new GeometryBuilder(true);
  const shift = new THREE.Matrix4().makeTranslation(0, 0, L / 2 - 0.75);
  const b = cab.body.clone().applyMatrix4(shift);
  const d = cab.detail.clone().applyMatrix4(shift);
  // The bed: a floor and low drop sides.
  const bedLen = L - 1.55;
  const bz = -L / 2 + bedLen / 2;
  body.box(0, 0.62, bz, W, 0.1, bedLen, 0, { color: WHITE });
  for (const sx of [-1, 1]) body.box(sx * (W / 2 - 0.03), 0.72, bz, 0.06, 0.3, bedLen, 0, { color: WHITE });
  body.box(0, 0.72, -L / 2 + 0.03, W, 0.3, 0.06, 0, { color: WHITE });
  body.box(0, 0.72, bz + bedLen / 2 - 0.03, W, 0.62, 0.06, 0, { color: TRIM });
  detail.box(0, 0.3, -L / 2 + 0.1, W, 0.18, 0.2, 0, { color: TRIM });
  detail.box(0, 0.42, -L / 2 - 0.004, 0.34, 0.17, 0.02, 0, { color: PLATE_YELLOW });
  arches(detail, [-L / 2 + 0.75], 0.27, W / 2 + 0.003, 0.27);
  const lamps = cab.lamps.filter((l) => l.kind === 'head' || (l.kind !== 'tail' && l.z > 0)).map((l) => ({ ...l, z: l.z + L / 2 - 0.75 }));
  for (const sx of [-1, 1]) {
    lamps.push({ kind: 'tail', x: sx * (W / 2 - 0.2), y: 0.52, z: -L / 2 - 0.012, w: 0.22, h: 0.12, d: 0.03 });
    lamps.push({ kind: sx > 0 ? 'indL' : 'indR', x: sx * (W / 2 - 0.05), y: 0.52, z: -L / 2 - 0.012, w: 0.09, h: 0.1, d: 0.03 });
  }
  return { body: merge([b, body.build()]), detail: merge([d, detail.build()]), lamps };
}

/** A 2-tonne delivery truck: a cab and a tall box, with a stripe down the box. */
function boxTruck(): { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lamps: Lamp[] } {
  const L = 6.4;
  const W = 1.98;
  const cabLen = 1.75;
  const cab = carShape({
    len: cabLen,
    wid: W,
    sill: 0.48,
    belt: 1.32,
    roof: 2.35,
    bonnet: 0.15,
    boot: 0.05,
    rakeF: 0.22,
    rakeR: 0.02,
    nose: 0.1,
    tail: 0,
    wheelR: 0.42,
    axles: [0.15],
    plate: 'white',
  });
  const shift = new THREE.Matrix4().makeTranslation(0, 0, L / 2 - cabLen / 2);
  const body = new GeometryBuilder(true);
  const detail = new GeometryBuilder(true);
  const boxLen = L - cabLen - 0.1;
  const bz = -L / 2 + boxLen / 2;
  body.box(0, 0.75, bz, W + 0.08, 2.45, boxLen, 0, { color: WHITE });
  // The stripe and the chassis under the box.
  for (const sx of [-1, 1]) detail.box(sx * (W / 2 + 0.045), 1.25, bz, 0.01, 0.32, boxLen - 0.2, 0, { color: new THREE.Color(0x2c6db0), roof: null });
  detail.box(0, 0.42, bz, W - 0.3, 0.34, boxLen, 0, { color: TRIM });
  detail.box(0, 0.48, -L / 2 + 0.06, W, 0.16, 0.14, 0, { color: TRIM });
  detail.box(0, 0.58, -L / 2 - 0.02, 0.34, 0.17, 0.02, 0, { color: PLATE_WHITE });
  // Rear doors.
  detail.box(0, 0.85, -L / 2 - 0.004, 0.02, 2.2, 0.01, 0, { color: TRIM });
  arches(detail, [-L / 2 + 1.5], 0.42, W / 2 + 0.003, 0.42);
  const lamps = cab.lamps.filter((l) => l.z > 0).map((l) => ({ ...l, z: l.z + L / 2 - cabLen / 2 }));
  for (const sx of [-1, 1]) {
    lamps.push({ kind: 'tail', x: sx * (W / 2 - 0.25), y: 0.62, z: -L / 2 - 0.02, w: 0.3, h: 0.14, d: 0.03 });
    lamps.push({ kind: sx > 0 ? 'indL' : 'indR', x: sx * (W / 2 - 0.06), y: 0.62, z: -L / 2 - 0.02, w: 0.1, h: 0.14, d: 0.03 });
  }
  return { body: merge([cab.body.clone().applyMatrix4(shift), body.build()]), detail: merge([cab.detail.clone().applyMatrix4(shift), detail.build()]), lamps };
}

/** A city bus: green below, cream above, a long window band, doors on the left, a lit destination board. */
function bus(): { body: THREE.BufferGeometry; detail: THREE.BufferGeometry; lamps: Lamp[] } {
  const L = 10.5;
  const W = 2.49;
  const body = new GeometryBuilder(true);
  const detail = new GeometryBuilder(true);
  const green = new THREE.Color(0x2f8a58);
  const cream = new THREE.Color(0xf1ead6);
  const roof = new THREE.Color(0xd9d9d4);
  body.box(0, 0.32, 0, W, 0.86, L, 0, { color: green, roof: null, bottom: true });
  body.box(0, 1.18, 0, W, 1.3, L, 0, { color: cream, roof: null });
  body.box(0, 2.48, 0, W, 0.6, L, 0, { color: cream, roof: null });
  body.box(0, 3.08, 0, W - 0.1, 0.06, L - 0.2, 0, { color: roof });
  body.box(0, 3.08, -1.2, 1.6, 0.25, 2.6, 0, { color: roof });
  // The window band down both sides, the windscreen, the rear window.
  for (const sx of [-1, 1]) {
    detail.box(sx * (W / 2 + 0.006), 1.28, 0.2, 0.012, 1.12, L - 1.4, 0, { color: GLASS, roof: null });
  }
  detail.box(0, 0.95, L / 2 + 0.006, W - 0.18, 1.5, 0.012, 0, { color: GLASS, roof: null });
  detail.box(0, 1.65, -L / 2 - 0.006, W - 0.5, 0.75, 0.012, 0, { color: GLASS, roof: null });
  // Doors (on the left, the kerb side): front and middle.
  for (const z of [L / 2 - 1.3, -0.4]) detail.box(W / 2 + 0.012, 0.42, z, 0.012, 2.0, 1.05, 0, { color: new THREE.Color(0x2a3440), roof: null });
  detail.box(0, 0.2, L / 2 - 0.05, W + 0.02, 0.3, 0.14, 0, { color: TRIM });
  detail.box(0, 0.2, -L / 2 + 0.05, W + 0.02, 0.3, 0.14, 0, { color: TRIM });
  detail.box(0, 0.42, L / 2 + 0.02, 0.34, 0.17, 0.02, 0, { color: PLATE_WHITE });
  detail.box(0, 0.62, -L / 2 - 0.02, 0.34, 0.17, 0.02, 0, { color: PLATE_WHITE });
  arches(detail, [L / 2 - 2.4, -L / 2 + 2.8], 0.5, W / 2 + 0.003, 0.5);
  const lamps: Lamp[] = [{ kind: 'led', x: 0, y: 2.66, z: L / 2 + 0.012, w: 1.7, h: 0.3, d: 0.03 }];
  for (const sx of [-1, 1]) {
    lamps.push({ kind: 'head', x: sx * (W / 2 - 0.32), y: 0.52, z: L / 2 + 0.012, w: 0.36, h: 0.14, d: 0.03 });
    lamps.push({ kind: 'tail', x: sx * (W / 2 - 0.15), y: 0.95, z: -L / 2 - 0.012, w: 0.2, h: 0.42, d: 0.03 });
    const ind: LampKind = sx > 0 ? 'indL' : 'indR';
    lamps.push({ kind: ind, x: sx * (W / 2 - 0.08), y: 0.68, z: L / 2 + 0.012, w: 0.12, h: 0.1, d: 0.03 });
    lamps.push({ kind: ind, x: sx * (W / 2 - 0.15), y: 1.3, z: -L / 2 - 0.012, w: 0.2, h: 0.14, d: 0.03 });
  }
  return { body: body.build(), detail: detail.build(), lamps };
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/** Every kind of vehicle in town. */
export function vehicleModels(): VehicleModel[] {
  const kei = carShape({
    len: 3.39,
    wid: 1.47,
    sill: 0.32,
    belt: 0.96,
    roof: 1.78,
    bonnet: 0.55,
    boot: 0,
    rakeF: 0.72,
    rakeR: 0.08,
    nose: 0.12,
    tail: 0,
    wheelR: 0.28,
    axles: [3.39 / 2 - 0.62, -3.39 / 2 + 0.55],
    plate: 'yellow',
  });
  const hatch = carShape({
    len: 3.99,
    wid: 1.7,
    sill: 0.33,
    belt: 0.92,
    roof: 1.5,
    bonnet: 0.95,
    boot: 0,
    rakeF: 0.78,
    rakeR: 0.38,
    nose: 0.15,
    tail: 0.04,
    wheelR: 0.31,
    axles: [3.99 / 2 - 0.8, -3.99 / 2 + 0.72],
    plate: 'white',
  });
  const saloon = carShape({
    len: 4.75,
    wid: 1.8,
    sill: 0.33,
    belt: 0.9,
    roof: 1.43,
    bonnet: 1.35,
    boot: 0.95,
    rakeF: 0.85,
    rakeR: 0.7,
    nose: 0.18,
    tail: 0.08,
    wheelR: 0.32,
    axles: [4.75 / 2 - 0.95, -4.75 / 2 + 1.0],
    plate: 'white',
  });
  const taxiShape = carShape({
    len: 4.6,
    wid: 1.7,
    sill: 0.33,
    belt: 0.9,
    roof: 1.5,
    bonnet: 1.25,
    boot: 0.9,
    rakeF: 0.6,
    rakeR: 0.45,
    nose: 0.1,
    tail: 0.05,
    wheelR: 0.31,
    axles: [4.6 / 2 - 0.92, -4.6 / 2 + 0.98],
    plate: 'white',
  });
  // (The middle of the roof: between the tops of the rear window and the windscreen.)
  const taxiRoof = (-4.6 / 2 + 0.9 + 0.45 + (4.6 / 2 - 1.25 - 0.6)) / 2;
  taxiShape.lamps.push({ kind: 'sign', x: 0, y: 1.62, z: taxiRoof, w: 0.5, h: 0.24, d: 0.2 });
  taxiShape.lamps.push({ kind: 'vacant', x: 0.42, y: 1.02, z: 4.6 / 2 - 1.25 - 0.12, w: 0.24, h: 0.1, d: 0.02 });
  const minivan = carShape({
    len: 4.9,
    wid: 1.85,
    sill: 0.34,
    belt: 1.02,
    roof: 1.92,
    bonnet: 0.9,
    boot: 0,
    rakeF: 0.95,
    rakeR: 0.12,
    nose: 0.12,
    tail: 0,
    wheelR: 0.33,
    axles: [4.9 / 2 - 0.92, -4.9 / 2 + 0.88],
    plate: 'white',
  });
  const police = carShape({
    len: 4.85,
    wid: 1.8,
    sill: 0.33,
    belt: 0.9,
    roof: 1.45,
    bonnet: 1.4,
    boot: 0.95,
    rakeF: 0.85,
    rakeR: 0.68,
    nose: 0.18,
    tail: 0.08,
    wheelR: 0.32,
    axles: [4.85 / 2 - 0.97, -4.85 / 2 + 1.02],
    plate: 'white',
    lower: new THREE.Color(0x111216),
    roofColor: WHITE,
    doors: WHITE,
  });
  police.lamps.push({ kind: 'beacon', x: 0, y: 1.52, z: (-4.85 / 2 + 0.95 + 0.68 + (4.85 / 2 - 1.4 - 0.85)) / 2, w: 1.15, h: 0.13, d: 0.28 });
  return [
    model(
      {
        name: 'kei',
        len: 3.39,
        wid: 1.47,
        wheelR: 0.28,
        axles: [3.39 / 2 - 0.62, -3.39 / 2 + 0.55],
        paints: [0xf4f1e8, 0xe9dcae, 0x9fd3e8, 0xf4b6c2, 0xc9d6b8, 0x2b2b30, 0xb5b8bd, 0xe86a3a],
        weight: 3,
        pace: 0.92,
      },
      kei,
    ),
    model(
      {
        name: 'hatch',
        len: 3.99,
        wid: 1.7,
        wheelR: 0.31,
        axles: [3.99 / 2 - 0.8, -3.99 / 2 + 0.72],
        paints: [0xb0122b, 0xf2f2f2, 0x1d1d22, 0x6d7a88, 0x2f63b0, 0xd8d0c0, 0x3f7f5a],
        weight: 2.5,
        pace: 1,
      },
      hatch,
    ),
    model(
      {
        name: 'saloon',
        len: 4.75,
        wid: 1.8,
        wheelR: 0.32,
        axles: [4.75 / 2 - 0.95, -4.75 / 2 + 1.0],
        paints: [0x15151a, 0xf0f0f0, 0x8e939b, 0x2a3550, 0x6b1d22, 0xbfc3c9],
        weight: 2.4,
        pace: 1.06,
      },
      saloon,
    ),
    model(
      {
        name: 'taxi',
        len: 4.6,
        wid: 1.7,
        wheelR: 0.31,
        axles: [4.6 / 2 - 0.92, -4.6 / 2 + 0.98],
        paints: [0xf2c200, 0x1d2a4d, 0x111111, 0x2e7d4f, 0xe8e2d0, 0xd9502e],
        weight: 1.6,
        pace: 1.04,
      },
      taxiShape,
    ),
    model(
      {
        name: 'minivan',
        len: 4.9,
        wid: 1.85,
        wheelR: 0.33,
        axles: [4.9 / 2 - 0.92, -4.9 / 2 + 0.88],
        paints: [0xf4f4f0, 0x1a1a1e, 0x9aa0a8, 0x3a3f4a, 0x7e8a6c],
        weight: 1.6,
        pace: 0.98,
      },
      minivan,
    ),
    model(
      {
        name: 'kei truck',
        len: 3.39,
        wid: 1.47,
        wheelR: 0.27,
        axles: [3.39 / 2 - 0.7, -3.39 / 2 + 0.75],
        paints: [0xf4f4f0, 0xf4f4f0, 0xd5dade, 0x8fb0c8],
        weight: 1,
        pace: 0.85,
      },
      keiTruck(),
    ),
    model(
      {
        name: 'truck',
        len: 6.4,
        wid: 1.98,
        wheelR: 0.42,
        tyreW: 0.26,
        axles: [6.4 / 2 - 0.73, -6.4 / 2 + 1.5],
        paints: [0xffffff, 0xeef3f7, 0xf6f1e3],
        weight: 0.8,
        pace: 0.85,
      },
      boxTruck(),
    ),
    model(
      {
        name: 'bus',
        len: 10.5,
        wid: 2.49,
        wheelR: 0.5,
        tyreW: 0.3,
        axles: [10.5 / 2 - 2.4, -10.5 / 2 + 2.8],
        paints: [0xffffff],
        weight: 0.6,
        pace: 0.8,
        bus: true,
      },
      bus(),
    ),
    model(
      { name: 'police', len: 4.85, wid: 1.8, wheelR: 0.32, axles: [4.85 / 2 - 0.97, -4.85 / 2 + 1.02], paints: [0xffffff], weight: 0.25, pace: 1.05 },
      police,
    ),
  ];
}

/** A wheel of radius 1 and width 1 (scaled per vehicle), its axle along x: tread, sidewalls, rims. */
export function wheelGeometry(): THREE.BufferGeometry {
  const b = new GeometryBuilder(true);
  const tyre = new THREE.Color(0x1a1a1c);
  const rim = new THREE.Color(0xa7acb3);
  const hub = new THREE.Color(0x5d6168);
  const N = 14;
  const at = (a: number, r: number, x: number): V3 => [x, Math.sin(a) * r, Math.cos(a) * r];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    face(b, [at(a0, 1, -0.5), at(a1, 1, -0.5), at(a1, 1, 0.5), at(a0, 1, 0.5)], [0, Math.sin(am), Math.cos(am)], tyre);
    for (const x of [-0.5, 0.5]) {
      face(b, [at(a0, 1, x), at(a1, 1, x), at(a1, 0.66, x), at(a0, 0.66, x)], [x, 0, 0], tyre);
      face(b, [at(a0, 0.66, x), at(a1, 0.66, x), at(a1, 0.2, x), at(a0, 0.2, x)], [x, 0, 0], i % 2 ? rim : hub);
      face(b, [at(a0, 0.2, x), at(a1, 0.2, x), [x, 0, 0]], [x, 0, 0], rim);
    }
  }
  return b.build();
}

/** The pool of a car's headlights on the road: bright near the car, fading ahead and to the sides. */
export function beamTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      // v: 0 at the car (bottom row), 1 far ahead.
      const v = 1 - y / 127;
      const u = (x / 63) * 2 - 1;
      const spread = 0.35 + v * 0.65;
      const across = Math.max(0, 1 - (u / spread) ** 2);
      const along = Math.min(1, v * 6) * (1 - v) ** 1.6;
      const a = across * along;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
