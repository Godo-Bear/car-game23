import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { Footprint } from './City';
import type { SignalJunction } from './CityTraffic';
import { type CityStreet, StreetField } from './cityPlan';
import { broadleaf, contactShadowMaterial, swayMaterial } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';
import type { StreakLight } from './surfaces';
import { glowTexture } from './textures';

/**
 * The free drive city's street furniture:
 * - street lamps along the avenues and ring roads (both sides), lit after dark, with pools of
 *   light on the road under them;
 * - trees lining the avenues;
 * - utility poles strung with sagging wires down the side streets (a lamp on every other one);
 * - Japanese traffic lights (blue-green, amber, red) at every big junction, cycling;
 * - blue overhead direction signs over the avenues;
 * - 止まれ ("stop") signs where a side street meets a main road.
 * Poles, posts and trunks are solid (they're on the pavements).
 */
export class StreetFurniture {
  readonly group = new THREE.Group();
  readonly footprints: Footprint[] = [];
  private readonly headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly glow: THREE.PointsMaterial;
  private readonly pools: THREE.MeshBasicMaterial;
  /** Signal discs per road at a junction (A / B) and colour, lit or dark by the cycle. */
  private readonly signals: { a: THREE.MeshBasicMaterial[]; b: THREE.MeshBasicMaterial[] };
  /** The junctions with traffic lights, and the two streets crossing at each (for the traffic). */
  readonly junctions: SignalJunction[];
  /** The lamps, for their reflections in the wet road at night. */
  readonly streakLights: StreakLight[] = [];

  constructor(streets: CityStreet[], rng: () => number) {
    this.group.name = 'street-furniture';
    const field = new StreetField(streets);
    const arterial = streets.map((s) => s.width >= 14);
    const junctions = findJunctions(streets, arterial).filter((j) => Math.hypot(j.x, j.z) > 60);
    this.junctions = junctions.map((j) => ({ x: j.x, z: j.z, a: j.ia, b: j.ib }));
    const nearJunction = (x: number, z: number, r: number) => junctions.some((j) => (j.x - x) ** 2 + (j.z - z) ** 2 < r * r);

    // ---- street lamps (avenues and ring roads) ----
    const lamps: { x: number; z: number; toward: number }[] = [];
    // ---- utility poles (side streets) ----
    const poles: { x: number; z: number; toward: number; lamp: boolean }[] = [];
    const wires: number[] = [];
    // ---- avenue trees ----
    const trees: [number, number][] = [];
    streets.forEach((s, k) => {
      const L = field.length(k);
      if (arterial[k]) {
        for (const side of [1, -1]) {
          for (let d = 10 + (side > 0 ? 0 : 17); d < L - 6; d += 34) {
            const p = field.at(k, d);
            const nx = -p.tz * side;
            const nz = p.tx * side;
            const off = s.width / 2 + 0.7;
            const x = p.x + nx * off;
            const z = p.z + nz * off;
            if (nearJunction(x, z, 18) || !field.clear(x, z, 1.5, k)) continue;
            lamps.push({ x, z, toward: Math.atan2(-nx, -nz) });
            this.solid(x, z, 0.3);
          }
          // Trees on the avenues, between the lamps.
          if (s.width >= 16) {
            for (let d = 18 + (side > 0 ? 0 : 8); d < L - 6; d += 17) {
              const p = field.at(k, d);
              const nx = -p.tz * side;
              const nz = p.tx * side;
              const off = s.width / 2 + 1.5;
              const x = p.x + nx * off;
              const z = p.z + nz * off;
              if (nearJunction(x, z, 22) || !field.clear(x, z, 3, k) || lamps.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < 25)) continue;
              trees.push([x, z]);
              this.solid(x, z, 0.45);
            }
          }
        }
      } else {
        // One side of a side street, poles every 30 m with wires between them.
        const side = k % 2 ? 1 : -1;
        let prev: { x: number; z: number } | null = null;
        let n = 0;
        for (let d = 8; d < L - 6; d += 30) {
          const p = field.at(k, d);
          const nx = -p.tz * side;
          const nz = p.tx * side;
          const off = s.width / 2 + 0.6;
          const x = p.x + nx * off;
          const z = p.z + nz * off;
          if (!field.clear(x, z, 2.5, k)) {
            prev = null;
            continue;
          }
          poles.push({ x, z, toward: Math.atan2(-nx, -nz), lamp: n++ % 2 === 0 });
          this.solid(x, z, 0.28);
          if (prev && Math.hypot(x - prev.x, z - prev.z) < 45) {
            for (const [dy, sag, across] of [
              [9.3, 0.5, -0.6],
              [9.3, 0.5, 0.6],
              [8.5, 0.7, 0],
              [6.2, 1.0, 0.15],
            ]) {
              const segs = 6;
              for (let i = 0; i < segs; i++) {
                for (const t of [i / segs, (i + 1) / segs]) {
                  wires.push(prev.x + (x - prev.x) * t - p.tz * across, dy - sag * 4 * t * (1 - t), prev.z + (z - prev.z) * t + p.tx * across);
                }
              }
            }
          }
          prev = { x, z };
        }
      }
    });

    // Lamp posts: pole, arm out over the road, a head with its light underneath.
    const lampGeo = new GeometryBuilder();
    lampGeo.cylinder(0, 0, 0, 0.16, 0.11, 9.2, 8);
    lampGeo.box(0, 8.95, 1.4, 0.12, 0.12, 2.9, 0);
    lampGeo.box(0, 8.7, 2.9, 0.5, 0.28, 1.1, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b4f57, metalness: 0.6, roughness: 0.45 });
    const lampHeads = new THREE.BoxGeometry(0.38, 0.06, 0.9).translate(0, 8.55, 2.9);
    this.instanced(lampGeo.build(), poleMat, lamps, 0);
    this.instanced(lampHeads, this.headMat, lamps, 0);
    // Utility poles: concrete, crossarms, a transformer now and then, a small lamp on every other.
    const poleGeo = new GeometryBuilder();
    poleGeo.cylinder(0, 0, 0, 0.19, 0.13, 10, 7);
    // Crossarms across the street (local z), the wires along it.
    poleGeo.box(0, 9.2, 0, 0.12, 0.12, 1.6, 0);
    poleGeo.box(0, 8.4, 0, 0.12, 0.12, 1.2, 0);
    poleGeo.cylinder(0.35, 6.4, 0, 0.3, 0.3, 1.1, 8);
    this.instanced(poleGeo.build(), new THREE.MeshStandardMaterial({ color: 0x9c9b95, roughness: 0.85 }), poles, 0);
    const smallLamp = new GeometryBuilder();
    smallLamp.box(0, 6.6, 0.7, 0.08, 0.08, 1.4, 0);
    this.instanced(
      smallLamp.build(),
      poleMat,
      poles.filter((p) => p.lamp),
      0,
    );
    this.instanced(
      new THREE.BoxGeometry(0.3, 0.12, 0.5).translate(0, 6.5, 1.4),
      this.headMat,
      poles.filter((p) => p.lamp),
      0,
    );
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    this.group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x18191d })));

    // The lights after dark: a glow at each head and a pool of light on the road under it.
    const heads: number[] = [];
    const poolAt: { x: number; z: number; toward: number }[] = [];
    for (const l of lamps) {
      const hx = l.x + Math.sin(l.toward) * 2.9;
      const hz = l.z + Math.cos(l.toward) * 2.9;
      heads.push(hx, 8.45, hz);
      poolAt.push({ x: hx, z: hz, toward: l.toward });
    }
    for (const p of poles.filter((q) => q.lamp)) heads.push(p.x + Math.sin(p.toward) * 1.4, 6.4, p.z + Math.cos(p.toward) * 1.4);
    const warm = new THREE.Color(1, 0.8, 0.55).multiplyScalar(0.55);
    for (let i = 0; i < heads.length; i += 3) {
      const big = heads[i + 1] > 8;
      this.streakLights.push({ x: heads[i], y: 0.07, z: heads[i + 2], color: warm, width: big ? 1.7 : 1.1, length: big ? 26 : 16 });
    }
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3));
    this.glow = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xffdcae,
      size: 6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Points(glowGeo, this.glow));
    this.pools = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: 0xffc98a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.instanced(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.1, 0), this.pools, poolAt, 0);

    // Avenue trees.
    if (trees.length) {
      const shape = broadleaf();
      const crowns = new THREE.InstancedMesh(shape.crown, swayMaterial({ color: 0xffffff }, shape.sway, 0.04), trees.length);
      const trunks = new THREE.InstancedMesh(shape.trunk!, swayMaterial({ color: shape.trunkColor }, shape.sway, 0), trees.length);
      const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), contactShadowMaterial(0.45), trees.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      const c = new THREE.Color();
      const greens = [0x4d7f33, 0x5c8a3a, 0x3f6e2c, 0x6a9a40];
      trees.forEach(([x, z], i) => {
        const s = 0.62 + rng() * 0.18;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        m.compose(v.set(x, 0.14, z), q, sc.set(s, s, s));
        crowns.setMatrixAt(i, m);
        trunks.setMatrixAt(i, m);
        crowns.setColorAt(i, c.setHex(greens[Math.floor(rng() * greens.length)]));
        m.compose(v.set(x, 0.16, z), q, sc.set(2.2, 1, 2.2));
        shadows.setMatrixAt(i, m);
      });
      crowns.castShadow = true;
      for (const mesh of [crowns, trunks, shadows]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
    }

    // Traffic lights at the big junctions: on each corner, for the traffic coming in on the left
    // (they drive on the left), an arm out over the lanes with the three lights facing it.
    const steel = new GeometryBuilder();
    const housings = new GeometryBuilder();
    const discs = {
      a: [new GeometryBuilder(), new GeometryBuilder(), new GeometryBuilder()],
      b: [new GeometryBuilder(), new GeometryBuilder(), new GeometryBuilder()],
    };
    for (const j of junctions) {
      for (const [road, dir, wOwn, wOther] of [
        ['a', j.a, j.wa, j.wb],
        ['a', j.a + Math.PI, j.wa, j.wb],
        ['b', j.b, j.wb, j.wa],
        ['b', j.b + Math.PI, j.wb, j.wa],
      ] as const) {
        // Coming in heading `dir`: the stop line is before the other road; the pole on the left kerb.
        const fx = Math.sin(dir);
        const fz = Math.cos(dir);
        const lx = fz;
        const lz = -fx;
        const back = wOther / 2 + 3;
        const px = j.x - fx * back + lx * (wOwn / 2 + 1.1);
        const pz = j.z - fz * back + lz * (wOwn / 2 + 1.1);
        steel.cylinder(px, 0, pz, 0.15, 0.12, 6, 8);
        // Arm reaching right, across the lanes.
        const reach = Math.min(5.5, wOwn / 2);
        steel.box(px - lx * (reach / 2), 5.7, pz - lz * (reach / 2), reach, 0.14, 0.14, Math.atan2(lx, lz) + Math.PI / 2);
        const hx = px - lx * reach;
        const hz = pz - lz * reach;
        // (Long side across the road.)
        housings.box(hx, 5.25, hz, 1.4, 0.45, 0.32, dir);
        // Facing the cars coming in (toward -dir), left to right: blue-green, amber, red.
        for (let c = 0; c < 3; c++) {
          const along = (c - 1) * 0.44;
          const cx = hx - lx * along - fx * 0.17;
          const cz = hz - lz * along - fz * 0.17;
          const r = 0.16;
          const g = discs[road][c];
          // Wound to face back down the road (-f).
          g.quad([cx + lx * r, 5.32, cz + lz * r], [cx - lx * r, 5.32, cz - lz * r], [cx - lx * r, 5.64, cz - lz * r], [cx + lx * r, 5.64, cz + lz * r]);
        }
        this.solid(px, pz, 0.3);
      }
    }
    this.group.add(new THREE.Mesh(steel.build(), new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.5, metalness: 0.6 })));
    this.group.add(new THREE.Mesh(housings.build(), new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.6 })));
    const disc = () => new THREE.MeshBasicMaterial({ color: 0x241c14, side: THREE.DoubleSide });
    this.signals = { a: [disc(), disc(), disc()], b: [disc(), disc(), disc()] };
    for (const road of ['a', 'b'] as const) {
      discs[road].forEach((g, c) => {
        if (!g.isEmpty) this.group.add(new THREE.Mesh(g.build(), this.signals[road][c]));
      });
    }

    // Blue direction signs over the avenues: out of town, and back in.
    const out = signTexture('環状線', 'RING ROAD', '↑');
    const inn = signTexture('都心', 'CITY CENTRE', '↑');
    const gantry = new GeometryBuilder();
    const outBoards = new GeometryBuilder();
    const inBoards = new GeometryBuilder();
    streets.forEach((s, k) => {
      if (s.width < 16) return;
      for (const radius of [560, 930]) {
        // Where the avenue is this far out.
        let best = 0;
        for (let d = 0; d < field.length(k); d += 5) {
          const p = field.at(k, d);
          if (Math.abs(Math.hypot(p.x, p.z) - radius) < Math.abs(Math.hypot(field.at(k, best).x, field.at(k, best).z) - radius)) best = d;
        }
        const p = field.at(k, best);
        if (nearJunction(p.x, p.z, 40)) continue;
        const half = s.width / 2 + 1;
        const rx = -p.tz;
        const rz = p.tx;
        const heading = Math.atan2(p.tx, p.tz);
        for (const side of [-1, 1]) {
          gantry.box(p.x + rx * half * side, 0, p.z + rz * half * side, 0.4, 7.6, 0.4, heading);
          this.solid(p.x + rx * half * side, p.z + rz * half * side, 0.35);
        }
        gantry.box(p.x, 7.2, p.z, s.width + 2.4, 0.5, 0.4, heading);
        // One board each way, over the lanes going that way (on the left).
        for (const [b, dir] of [
          [outBoards, 1],
          [inBoards, -1],
        ] as const) {
          // Outward (+t): the board faces -t (the cars coming), over the left lanes.
          const fx = p.tx * dir;
          const fz = p.tz * dir;
          const lx = fz;
          const lz = -fx;
          const cx = p.x + lx * (s.width / 4) - fx * 0.25;
          const cz = p.z + lz * (s.width / 4) - fz * 0.25;
          const w = 3.4;
          b.quad([cx + lx * w, 5.4, cz + lz * w], [cx - lx * w, 5.4, cz - lz * w], [cx - lx * w, 7.0, cz - lz * w], [cx + lx * w, 7.0, cz + lz * w]);
        }
      }
    });
    this.group.add(new THREE.Mesh(gantry.build(), poleMat));
    this.group.add(new THREE.Mesh(outBoards.build(), new THREE.MeshBasicMaterial({ map: out })));
    this.group.add(new THREE.Mesh(inBoards.build(), new THREE.MeshBasicMaterial({ map: inn })));

    // 止まれ (stop) signs where side streets come out onto a main road.
    const stops = new GeometryBuilder();
    const stopPoles = new GeometryBuilder();
    streets.forEach((s, k) => {
      if (arterial[k] || s.pts.length < 4) return;
      for (const end of [0, s.pts.length - 1]) {
        const [ex, ez] = s.pts[end];
        if (field.clear(ex, ez, 4, k)) continue;
        const inner = s.pts[end === 0 ? 2 : s.pts.length - 3];
        const len = Math.hypot(ex - inner[0], ez - inner[1]) || 1;
        // Heading out toward the main road; the sign on the left, 9 m back.
        const fx = (ex - inner[0]) / len;
        const fz = (ez - inner[1]) / len;
        const lx = fz;
        const lz = -fx;
        const x = ex - fx * 9 + lx * (s.width / 2 + 0.5);
        const z = ez - fz * 9 + lz * (s.width / 2 + 0.5);
        if (!field.clear(x, z, 0.8, k)) continue;
        stopPoles.cylinder(x, 0, z, 0.05, 0.05, 2.4, 6);
        // A downward red triangle facing the driver.
        const t = 0.45;
        const i = stops.vertex([x + lx * t - fx * 0.06, 2.65, z + lz * t - fz * 0.06], [-fx, 0, -fz], 0, 1);
        stops.vertex([x - lx * t - fx * 0.06, 2.65, z - lz * t - fz * 0.06], [-fx, 0, -fz], 1, 1);
        stops.vertex([x - fx * 0.06, 1.9, z - fz * 0.06], [-fx, 0, -fz], 0.5, 0);
        stops.triangle(i, i + 1, i + 2);
        stops.triangle(i, i + 2, i + 1);
        this.solid(x, z, 0.15);
      }
    });
    this.group.add(new THREE.Mesh(stopPoles.build(), new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.5, roughness: 0.4 })));
    this.group.add(new THREE.Mesh(stops.build(), new THREE.MeshBasicMaterial({ map: stopTexture(), side: THREE.DoubleSide })));
    this.group.traverse((o) => {
      o.userData.noAO = true;
    });
  }

  private solid(x: number, z: number, r: number): void {
    this.footprints.push({ x, z, hw: r, hd: r });
  }

  /** One instanced mesh of `geo` at each spot, turned so local +z points `toward`. */
  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, at: { x: number; z: number; toward: number }[], y: number): void {
    if (!at.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, at.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const v = new THREE.Vector3();
    at.forEach((p, i) => {
      q.setFromAxisAngle(up, p.toward);
      m.compose(v.set(p.x, y, p.z), q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const v = tod === 'night' ? 3.2 : tod === 'sunset' ? 2 : 0.7;
    this.headMat.color.setRGB(v, v * 0.9, v * 0.75);
    this.glow.opacity = tod === 'night' ? 0.9 : tod === 'sunset' ? 0.4 : 0;
    this.pools.opacity = tod === 'night' ? 0.6 : tod === 'sunset' ? 0.2 : 0;
  }

  /** The traffic lights' cycle: one road green while the other's red, an amber between. */
  update(time: number): void {
    const t = time % 24;
    const phase = (green: boolean, amber: boolean) => [green, amber, !green && !amber];
    const a = phase(t < 10, t >= 10 && t < 12);
    const b = phase(t >= 12 && t < 22, t >= 22);
    const on = [new THREE.Color(0.2, 2.6, 1.9), new THREE.Color(2.8, 1.7, 0.1), new THREE.Color(2.8, 0.15, 0.1)];
    const off = new THREE.Color(0x241c14);
    this.signals.a.forEach((m, c) => m.color.copy(a[c] ? on[c] : off));
    this.signals.b.forEach((m, c) => m.color.copy(b[c] ? on[c] : off));
  }
}

/** Where two main roads cross: the point and each road's heading there. */
interface Junction {
  x: number;
  z: number;
  a: number;
  b: number;
  wa: number;
  wb: number;
  /** The streets: road a, road b. */
  ia: number;
  ib: number;
}

function findJunctions(streets: CityStreet[], arterial: boolean[]): Junction[] {
  const out: Junction[] = [];
  for (let i = 0; i < streets.length; i++) {
    if (!arterial[i]) continue;
    for (let j = i + 1; j < streets.length; j++) {
      if (!arterial[j]) continue;
      const A = streets[i].pts;
      const B = streets[j].pts;
      for (let p = 0; p + 1 < A.length; p++) {
        for (let q = 0; q + 1 < B.length; q++) {
          const hit = cross(A[p], A[p + 1], B[q], B[q + 1]);
          if (!hit) continue;
          const [x, z] = hit;
          if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 20)) continue;
          out.push({
            x,
            z,
            a: Math.atan2(A[p + 1][0] - A[p][0], A[p + 1][1] - A[p][1]),
            b: Math.atan2(B[q + 1][0] - B[q][0], B[q + 1][1] - B[q][1]),
            wa: streets[i].width,
            wb: streets[j].width,
            ia: i,
            ib: j,
          });
        }
      }
    }
  }
  return out;
}

function cross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + rz * t] : null;
}

function signTexture(kanji: string, english: string, arrow: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d4fa8';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 54px "Hiragino Sans", "Yu Gothic", sans-serif';
  g.fillText(kanji, 230, 50);
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillText(english, 230, 100);
  g.font = 'bold 84px system-ui, sans-serif';
  g.fillText(arrow, 440, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 止まれ: white on a red downward triangle (the texture's top edge is the triangle's top). */
function stopTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d6261c';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 30px "Hiragino Sans", "Yu Gothic", sans-serif';
  g.fillText('止まれ', 64, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
