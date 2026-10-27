import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeOfDay } from '../../shared/api';
import { BARRIER_THICKNESS, SIDEWALK_WIDTH } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import { GeometryBuilder } from './GeometryBuilder';
import { type BuildingTemplate, cityKit, tokyoTowerMesh } from './sceneryModels';
import { applyContactShading, type StreakLight } from './surfaces';
import { billboardTexture, type FacadeTextures, facadeTexture, glowTexture, neonSignTexture, SIGN_COLORS, shopfrontTexture } from './textures';

/**
 * Procedural Tokyo: dense blocks of lit buildings, protruding neon signs, rooftop billboards,
 * street lamps along the circuit, Tokyo Tower, Skytree, Rainbow Bridge and the bay.
 *
 * Everything is merged per material so the whole city costs ~40 draw calls.
 */

export interface Lamp {
  x: number;
  z: number;
  y: number;
  index: number;
  side: number;
}

/** The waterfront: no buildings south of this line (the bay). */
const BAY_Z = 610;
const TOKYO_TOWER = { x: 720, z: -430 };
const SKYTREE = { x: 1150, z: -1500 };

export function placeLamps(track: TrackPath): Lamp[] {
  const lamps: Lamp[] = [];
  let side = 1;
  for (let i = 0; i < track.count; i += 16) {
    const s = track.samples[i];
    const lateral = side * (track.wallOffset - 1.8);
    lamps.push({ x: s.x + s.rx * lateral, z: s.z + s.rz * lateral, y: s.y + 8.6, index: i, side });
    side = -side;
  }
  return lamps;
}

type Style = 'office' | 'residential' | 'glass' | 'old';

/** Tiled and painted walls of a Tokyo street: beige, grey, cream, brick-ish and pale blue. */
const WALL_COLORS = [0xd9d2c3, 0xc9c3b8, 0xe6e1d6, 0xb8b4ad, 0xcdbba0, 0xa9b4bd, 0xd8c8b0, 0xbfb2a4, 0x9aa3a8, 0xe0d4c0, 0xc4a98e, 0xdedad0];
/** Kit buildings stand on the lots this close to the circuit (where you can see them). */
const KIT_RANGE = 150;
const STYLES: Style[] = ['office', 'residential', 'glass', 'old'];

export class City {
  readonly group = new THREE.Group();
  /** Neon signs close enough to the circuit to reflect in the wet road at night. */
  readonly streakLights: StreakLight[] = [];
  private readonly beacon: THREE.MeshBasicMaterial;
  private readonly flicker: THREE.MeshBasicMaterial[] = [];
  private readonly rng: () => number;
  // Things whose glow depends on the time of day.
  private readonly facadeMats: THREE.MeshLambertMaterial[] = [];
  private readonly lit: { mat: THREE.MeshBasicMaterial; colors: Record<TimeOfDay, THREE.Color> }[] = [];
  private readonly glows: { mat: THREE.PointsMaterial; opacity: Record<TimeOfDay, number> }[] = [];
  private signLevel = 1.9;
  private nightLights = true;
  private towerModel: ReturnType<typeof tokyoTowerMesh> = null;

  /** Register a self-lit material: full brightness at night, dimmer (or just painted) by day. */
  private glowing<T extends THREE.MeshBasicMaterial>(mat: T, night: THREE.Color, sunset: THREE.Color, day: THREE.Color): T {
    this.lit.push({ mat, colors: { night, sunset, day } });
    return mat;
  }

  /**
   * `keepOut` reserves corridors (e.g. under the railway viaduct) where no building may stand:
   * it gets a building's centre and radius.
   */
  constructor(track: TrackPath, lamps: Lamp[], rng: () => number, keepOut: (x: number, z: number, r: number) => boolean = () => false) {
    this.group.name = 'city';
    this.rng = rng;
    const coarse = track.samples.filter((_, i) => i % 3 === 0);
    const distToTrack = (x: number, z: number) => {
      let best = Infinity;
      let bx = 0;
      let bz = 0;
      let by = 0;
      for (const s of coarse) {
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < best) {
          best = d;
          bx = s.x;
          bz = s.z;
          by = s.y;
        }
      }
      return { d: Math.sqrt(best), nx: bx - x, nz: bz - z, bx, by, bz };
    };

    const facades: Record<Style, FacadeTextures> = {
      office: facadeTexture(rng, 'office'),
      residential: facadeTexture(rng, 'residential'),
      glass: facadeTexture(rng, 'glass'),
      old: facadeTexture(rng, 'old'),
    };
    const builders: Record<Style, GeometryBuilder> = {
      office: new GeometryBuilder(),
      residential: new GeometryBuilder(),
      glass: new GeometryBuilder(),
      old: new GeometryBuilder(),
    };
    const roofs = new GeometryBuilder();
    const beacons = new GeometryBuilder();
    const shops = new GeometryBuilder();
    const lanterns = new GeometryBuilder();
    const SIGN_TEXTURES = 16;
    const signs = Array.from({ length: SIGN_TEXTURES }, () => new GeometryBuilder());
    const BILLBOARDS = 5;
    const boards = Array.from({ length: BILLBOARDS }, () => new GeometryBuilder());

    const kit = cityKit();
    const kitSolid: THREE.BufferGeometry[] = [];
    const kitWindows: THREE.BufferGeometry[] = [];
    const clearance = track.wallOffset + BARRIER_THICKNESS + SIDEWALK_WIDTH + 2.5;
    const b = track.bounds;
    const cell = 32;
    let signIndex = 0;
    for (let gx = b.minX - 420; gx <= b.maxX + 420; gx += cell) {
      for (let gz = b.minZ - 420; gz <= BAY_Z - 20; gz += cell) {
        const cx = gx + (rng() - 0.5) * 6;
        const cz = gz + (rng() - 0.5) * 6;
        if (Math.hypot(cx - TOKYO_TOWER.x, cz - TOKYO_TOWER.z) < 70) continue;
        if (keepOut(cx, cz, 14)) continue;
        let w = 13 + rng() * 15;
        let d = 13 + rng() * 15;
        const { d: dist, nx, nz, bx, by, bz } = distToTrack(cx, cz);
        const r = Math.hypot(w, d) / 2;
        if (dist - r < clearance) {
          const maxR = dist - clearance;
          if (maxR < 6) continue;
          w *= maxR / r;
          d *= maxR / r;
        }

        // Height by district: Shinjuku towers north of the main straight, Shiodome towers by the hairpin.
        let h = 9 + rng() ** 2 * 45;
        if (cz < -40 && cx > -520 && cx < 320) h = 55 + rng() ** 1.4 * 170;
        else if (cx < -260 && cz > 280) h = 35 + rng() * 95;
        else if (rng() < 0.05) h = 90 + rng() * 80;
        if (dist > 320) h *= 0.75;
        if (kit && dist - r < KIT_RANGE && h < 140) {
          // A City Kit building on the lot, its front to the circuit.
          h = placeKitBuilding(kit, rng, cx, cz, w, d, h, nx, nz, kitSolid, kitWindows);
        } else {
          const style: Style = h > 110 ? (rng() < 0.6 ? 'glass' : 'office') : h < 22 ? (rng() < 0.6 ? 'old' : 'residential') : STYLES[Math.floor(rng() * 3)];
          builders[style].box(cx, 0, cz, w, h, d, 0, {
            tileU: 12,
            tileV: 14,
            roof: roofs,
            uOffset: Math.floor(rng() * 4) / 4,
            vOffset: Math.floor(rng() * 4) / 4,
          });
          if (rng() < 0.5) roofs.box(cx + (rng() - 0.5) * w * 0.4, h, cz + (rng() - 0.5) * d * 0.4, w * 0.3, 2 + rng() * 3, d * 0.3);
        }
        if (h > 70) beacons.box(cx, h, cz, 0.8, 0.8, 0.8);

        // Street-facing details only where drivers can see them.
        if (dist - r > 60) continue;
        // Face of the box that looks at the track.
        const towardX = Math.abs(nx) > Math.abs(nz);
        const sgn = towardX ? Math.sign(nx) : Math.sign(nz);
        const faceLen = towardX ? d : w;
        const half = (towardX ? w : d) / 2;
        const facePoint = (along: number, out: number): [number, number] =>
          towardX ? [cx + sgn * (half + out), cz + along] : [cx + along, cz + sgn * (half + out)];

        if (dist - r < 45) {
          // Glowing ground-floor shop fronts.
          const a = facePoint(-faceLen / 2 + 0.5, 0.06);
          const c = facePoint(faceLen / 2 - 0.5, 0.06);
          const quadFacing = (p0: [number, number], p1: [number, number], y0: number, y1: number, target: GeometryBuilder, u1: number) => {
            const v0: [number, number, number] = [p0[0], y0, p0[1]];
            const v1: [number, number, number] = [p1[0], y0, p1[1]];
            const v2: [number, number, number] = [p1[0], y1, p1[1]];
            const v3: [number, number, number] = [p0[0], y1, p0[1]];
            // Normal must point out of the facade (toward the track).
            const ex = p1[0] - p0[0];
            const ez = p1[1] - p0[1];
            const outX = towardX ? sgn : 0;
            const outZ = towardX ? 0 : sgn;
            // Unflipped, this quad's normal is (-ez, ex); flip it if that points into the building.
            const flip = -ez * outX + ex * outZ < 0;
            target.quad(v0, v1, v2, v3, 0, 0, u1, 1, undefined, flip);
          };
          quadFacing(a, c, 0.2, Math.min(3.6, h - 1), shops, faceLen / 16);
          // Red paper lanterns (chochin) hanging either side of the izakaya door.
          if (rng() < 0.55) {
            for (const along of [-faceLen / 6, faceLen / 6]) {
              const [lx, lz] = facePoint(along, 0.45);
              lanterns.cylinder(lx, 2.05, lz, 0.2, 0.2, 0.55, 10);
            }
          }
        }

        if (rng() < 0.65 && h > 10) {
          // Vertical "tategaki" sign sticking out from the facade so it reads from the street.
          const along = (rng() < 0.5 ? -1 : 1) * (faceLen / 2 - 1.5);
          const signH = Math.min(9, h * 0.55);
          const y0 = Math.min(5 + rng() * 6, h - signH - 0.5);
          const tex = signIndex++ % SIGN_TEXTURES;
          const p0 = facePoint(along, 0.2);
          const p1 = facePoint(along, 2.4);
          // Two back-to-back planes so the text is readable from both directions.
          const q = (a: [number, number], c: [number, number], flip: boolean) =>
            signs[tex].quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y0 + signH, c[1]], [a[0], y0 + signH, a[1]], 0, 0, 1, 1, undefined, flip);
          q(p0, p1, false);
          q(p1, p0, false);
          if (dist - r < 30) {
            // Its reflection starts at the near road edge, between the sign and the centre line.
            const len = Math.hypot(nx, nz) || 1;
            const edge = track.wallOffset - 0.8;
            this.streakLights.push({
              x: bx - (nx / len) * edge,
              y: by,
              z: bz - (nz / len) * edge,
              color: new THREE.Color(SIGN_COLORS[(tex * 3) % SIGN_COLORS.length]).multiplyScalar(0.55),
              width: 1.2,
              length: 18,
            });
          }
        }

        if (rng() < 0.22 && h < 45 && h > 12) {
          const bb = boards[Math.floor(rng() * BILLBOARDS)];
          const bw = Math.min(14, faceLen * 0.9);
          const a = facePoint(-bw / 2, -half * 0.5);
          const c = facePoint(bw / 2, -half * 0.5);
          const outX = towardX ? sgn : 0;
          const outZ = towardX ? 0 : sgn;
          const flip = -(c[1] - a[1]) * outX + (c[0] - a[0]) * outZ < 0;
          bb.quad([a[0], h + 1, a[1]], [c[0], h + 1, c[1]], [c[0], h + 1 + bw * 0.375, c[1]], [a[0], h + 1 + bw * 0.375, a[1]], 0, 0, 1, 1, undefined, flip);
          roofs.box((a[0] + c[0]) / 2, h, (a[1] + c[1]) / 2, 0.4, 1.2, 0.4);
        }
      }
    }

    // Distant skyline ring (just lights in the haze).
    for (let k = 0; k < 260; k++) {
      const ang = rng() * Math.PI * 2;
      const rad = 1500 + rng() * 1300;
      const x = 150 + Math.cos(ang) * rad;
      const z = -100 + Math.sin(ang) * rad;
      if (z > BAY_Z + 300 && Math.abs(x) < 2500) continue;
      const h = 30 + rng() ** 2 * 200;
      builders[rng() < 0.5 ? 'glass' : 'office'].box(x, 0, z, 30 + rng() * 30, h, 30 + rng() * 30, rng() * Math.PI, { tileU: 12, tileV: 14, roof: roofs });
    }

    for (const style of STYLES) {
      const f = facades[style];
      const mat = new THREE.MeshLambertMaterial({
        map: f.map,
        emissiveMap: f.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.7,
      });
      applyContactShading(mat);
      this.facadeMats.push(mat);
      this.group.add(new THREE.Mesh(builders[style].build(), mat));
    }
    this.group.add(new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ color: 0x24252b })));
    if (kitSolid.length) {
      const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
      applyContactShading(solid);
      this.group.add(new THREE.Mesh(mergeGeometries(kitSolid)!, solid));
      // Windows: the glass by day, lit rooms after dark.
      const glass = this.glowing(
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        new THREE.Color(2.6, 2.05, 1.25),
        new THREE.Color(1.35, 1.15, 0.95),
        new THREE.Color(1, 1, 1),
      );
      this.group.add(new THREE.Mesh(mergeGeometries(kitWindows)!, glass));
      for (const g of [...kitSolid, ...kitWindows]) g.dispose();
    }
    this.beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.1, 0.1) });
    this.group.add(new THREE.Mesh(beacons.build(), this.beacon));
    const shopTex = shopfrontTexture(rng);
    const grey = (v: number) => new THREE.Color(v, v, v);
    const shopMat = this.glowing(new THREE.MeshBasicMaterial({ map: shopTex }), grey(1.3), grey(1.15), grey(0.95));
    const lanternMat = this.glowing(
      new THREE.MeshBasicMaterial({ map: lanternTexture() }),
      new THREE.Color(2.2, 1.6, 1.4),
      new THREE.Color(1.4, 1.1, 1),
      grey(0.9),
    );
    this.group.add(new THREE.Mesh(lanterns.build(), lanternMat));
    this.group.add(new THREE.Mesh(shops.build(), shopMat));
    signs.forEach((g, i) => {
      if (g.isEmpty) return;
      const mat = this.glowing(new THREE.MeshBasicMaterial({ map: neonSignTexture(i) }), grey(1.9), grey(1.45), grey(1.05));
      if (i % 5 === 2) this.flicker.push(mat);
      this.group.add(new THREE.Mesh(g.build(), mat));
    });
    boards.forEach((g, i) => {
      if (g.isEmpty) return;
      const mat = this.glowing(new THREE.MeshBasicMaterial({ map: billboardTexture(i) }), grey(1.35), grey(1.15), grey(0.95));
      this.group.add(new THREE.Mesh(g.build(), mat));
    });

    this.buildLamps(track, lamps);
    this.buildGround();
    this.buildTokyoTower();
    this.buildSkytree();
    this.buildBay();
  }

  private buildLamps(track: TrackPath, lamps: Lamp[]): void {
    const poles = new GeometryBuilder();
    const heads = new GeometryBuilder();
    const glowPositions: number[] = [];
    for (const lamp of lamps) {
      const s = track.samples[lamp.index];
      const poleLat = lamp.side * (track.wallOffset + BARRIER_THICKNESS + 0.8);
      const px = s.x + s.rx * poleLat;
      const pz = s.z + s.rz * poleLat;
      poles.cylinder(px, s.y, pz, 0.14, 0.1, 8.9, 6);
      const armLat = (poleLat + lamp.side * (track.wallOffset - 1.8)) / 2;
      const armLen = Math.abs(poleLat - lamp.side * (track.wallOffset - 1.8));
      poles.box(s.x + s.rx * armLat, s.y + 8.75, s.z + s.rz * armLat, armLen, 0.14, 0.14, s.heading);
      heads.box(lamp.x, lamp.y - 0.15, lamp.z, 1.0, 0.18, 0.45, s.heading, { bottom: true });
      glowPositions.push(lamp.x, lamp.y - 0.4, lamp.z);
    }
    this.group.add(new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.5 })));
    const headMat = this.glowing(new THREE.MeshBasicMaterial(), new THREE.Color(4, 3.4, 2.4), new THREE.Color(3, 2.5, 1.8), new THREE.Color(0.55, 0.55, 0.52));
    this.group.add(new THREE.Mesh(heads.build(), headMat));
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPositions, 3));
    const glowMat = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xffd9a8,
      size: 7,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glows.push({ mat: glowMat, opacity: { night: 0.55, sunset: 0.35, day: 0 } });
    const glow = new THREE.Points(glowGeo, glowMat);
    this.group.add(glow);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x17181d }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.06, 0);
    this.group.add(ground);
  }

  /** Lattice texture for the steel towers. */
  private latticeTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.strokeRect(0, 0, 64, 64);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(64, 64);
    g.moveTo(64, 0);
    g.lineTo(0, 64);
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private buildTokyoTower(): void {
    this.towerModel = tokyoTowerMesh(333, TOKYO_TOWER.x, 0, TOKYO_TOWER.z);
    if (this.towerModel) {
      this.group.add(this.towerModel.mesh);
      return;
    }
    const tower = new THREE.Group();
    tower.position.set(TOKYO_TOWER.x, 0, TOKYO_TOWER.z);
    const lattice = this.latticeTexture();
    // Lit orange at night ("Landmark Light"), international-orange and white paint by day.
    const orange = this.glowing(
      new THREE.MeshBasicMaterial({ map: lattice, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, fog: false }),
      new THREE.Color(2.6, 0.75, 0.15),
      new THREE.Color(1.6, 0.5, 0.16),
      new THREE.Color(0.95, 0.3, 0.1),
    );
    const white = this.glowing(orange.clone(), new THREE.Color(2.2, 2.0, 1.8), new THREE.Color(1.3, 1.1, 1.0), new THREE.Color(0.9, 0.9, 0.88));
    const solid = this.glowing(
      new THREE.MeshBasicMaterial({ fog: false }),
      new THREE.Color(2.4, 1.3, 0.5),
      new THREE.Color(1.4, 0.8, 0.4),
      new THREE.Color(0.75, 0.72, 0.68),
    );
    const sections: [number, number, number, number, THREE.Material][] = [
      // y0, height, bottom radius, top radius
      [0, 70, 42, 20, orange],
      [70, 25, 20, 15, white],
      [95, 55, 15, 9, orange],
      [160, 55, 8, 4.5, orange],
      [215, 10, 4.5, 3.6, white],
      [230, 50, 3, 1.6, orange],
    ];
    for (const [y0, h, r0, r1, mat] of sections) {
      const geo = new THREE.CylinderGeometry(r1, r0, h, 4, 1, true);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * (h / 8));
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = Math.PI / 4;
      m.position.y = y0 + h / 2;
      tower.add(m);
    }
    const deck1 = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 22), solid);
    deck1.position.y = 155;
    tower.add(deck1);
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), solid);
    deck2.position.y = 227;
    tower.add(deck2);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 45, 6), solid);
    antenna.position.y = 302;
    tower.add(antenna);
    this.group.add(tower);
  }

  private buildSkytree(): void {
    const tree = new THREE.Group();
    tree.position.set(SKYTREE.x, 0, SKYTREE.z);
    const lattice = this.latticeTexture();
    const mat = this.glowing(
      new THREE.MeshBasicMaterial({ map: lattice, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, fog: false }),
      new THREE.Color(0.7, 1.1, 2.4),
      new THREE.Color(0.9, 0.85, 1.2),
      new THREE.Color(0.82, 0.86, 0.9),
    );
    const body = new THREE.CylinderGeometry(9, 34, 340, 12, 1, true);
    const uv = body.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 40);
    const m = new THREE.Mesh(body, mat);
    m.position.y = 170;
    tree.add(m);
    const ringMat = this.glowing(
      new THREE.MeshBasicMaterial({ fog: false }),
      new THREE.Color(1.6, 1.3, 2.6),
      new THREE.Color(1.1, 1.0, 1.4),
      new THREE.Color(0.78, 0.8, 0.84),
    );
    for (const [y, r, h] of [
      [345, 19, 14],
      [430, 12, 8],
    ]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, h, 16), ringMat);
      ring.position.y = y;
      tree.add(ring);
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 7, 140, 8), mat);
    spire.position.y = 410;
    tree.add(spire);
    this.group.add(tree);
  }

  private buildBay(): void {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 4000), new THREE.MeshStandardMaterial({ color: 0x07101e, roughness: 0.08, metalness: 0.7 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.2, BAY_Z + 2000);
    this.group.add(water);
    const seawall = new THREE.Mesh(new THREE.BoxGeometry(9000, 2.5, 3), new THREE.MeshLambertMaterial({ color: 0x3c3e45 }));
    seawall.position.set(0, -0.2, BAY_Z);
    this.group.add(seawall);

    // Rainbow Bridge: towers, deck and "pearl necklace" cable lights.
    const bridge = new THREE.Group();
    bridge.position.set(700, 0, BAY_Z + 650);
    const white = this.glowing(
      new THREE.MeshBasicMaterial({ fog: false }),
      new THREE.Color(1.6, 1.6, 1.7),
      new THREE.Color(1.2, 1.1, 1.1),
      new THREE.Color(0.85, 0.87, 0.9),
    );
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1100, 4, 22), new THREE.MeshLambertMaterial({ color: 0x8a8d96 }));
    deck.position.y = 50;
    bridge.add(deck);
    const towerX = [-290, 290];
    for (const x of towerX) {
      for (const z of [-9, 9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(5, 126, 5), white);
        leg.position.set(x, 63, z);
        bridge.add(leg);
      }
      for (const y of [80, 120]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 22), white);
        bar.position.set(x, y, 0);
        bridge.add(bar);
      }
    }
    const pts: number[] = [];
    const cable = (x0: number, y0: number, x1: number, y1: number, sag: number) => {
      for (let t = 0; t <= 1.0001; t += 1 / 40) {
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
        pts.push(x, y, -11, x, y, 11);
      }
    };
    cable(-550, 52, towerX[0], 126, 10);
    cable(towerX[0], 126, towerX[1], 126, 70);
    cable(towerX[1], 126, 550, 52, 10);
    for (let x = -550; x <= 550; x += 18) pts.push(x, 53, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const pearls = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xeaf4ff,
      size: 9,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.glows.push({ mat: pearls, opacity: { night: 1, sunset: 0.6, day: 0 } });
    bridge.add(new THREE.Points(geo, pearls));
    this.group.add(bridge);
  }

  setTimeOfDay(tod: TimeOfDay): void {
    const windows = { night: 0.7, sunset: 0.4, day: 0.04 }[tod];
    for (const m of this.facadeMats) m.emissiveIntensity = windows;
    for (const { mat, colors } of this.lit) mat.color.copy(colors[tod]);
    for (const { mat, opacity } of this.glows) mat.opacity = opacity[tod];
    this.signLevel = { night: 1.9, sunset: 1.45, day: 1.05 }[tod];
    this.towerModel?.setTimeOfDay(tod === 'night', tod === 'sunset');
    this.nightLights = tod !== 'day';
  }

  update(time: number): void {
    const on = this.nightLights && Math.sin(time * 2.4) > 0.55;
    this.beacon.color.setRGB(on ? 6 : 0.3, on ? 0.15 : 0.01, on ? 0.15 : 0.01);
    for (const m of this.flicker) {
      // Neon tubes only visibly flicker once they're the brightest thing around.
      const v = this.nightLights && this.rng() < 0.04 ? this.signLevel * 0.3 : this.signLevel;
      m.color.setRGB(v, v, v);
    }
  }
}

/** Red paper lantern: black bands top and bottom, a kanji in the middle. */
function lanternTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d42a1e';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 10; y < 56; y += 6) g.fillRect(0, y, 64, 1);
  g.fillStyle = '#111';
  g.fillRect(0, 0, 64, 9);
  g.fillRect(0, 55, 64, 9);
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('酒', 16, 33);
  g.fillText('酒', 48, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Put a City Kit building on a lot: the kit model whose proportions best match the lot (a little
 * randomness among the closest), stretched to fill it and turned to face the track. Its walls get
 * a Tokyo colour. Returns its height.
 */
function placeKitBuilding(
  kit: BuildingTemplate[],
  rng: () => number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  nx: number,
  nz: number,
  solid: THREE.BufferGeometry[],
  windows: THREE.BufferGeometry[],
): number {
  const want = h / Math.max(w, d);
  const ranked = [...kit].sort(
    (a, b) => Math.abs(Math.log(a.size.y / Math.max(a.size.x, a.size.z) / want)) - Math.abs(Math.log(b.size.y / Math.max(b.size.x, b.size.z) / want)),
  );
  const t = ranked[Math.floor(rng() * Math.min(3, ranked.length))];
  // Front (+z in the kit) toward the track, in quarter turns so the lot stays axis-aligned.
  const towardX = Math.abs(nx) > Math.abs(nz);
  const turn = towardX ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : nz > 0 ? 0 : Math.PI;
  const sx = (towardX ? d : w) / t.size.x;
  const sz = (towardX ? w : d) / t.size.z;
  const sy = (sx + sz) / 2;
  const matrix = new THREE.Matrix4()
    .makeTranslation(cx, 0, cz)
    .multiply(new THREE.Matrix4().makeRotationY(turn))
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
  const wall = new THREE.Color(WALL_COLORS[Math.floor(rng() * WALL_COLORS.length)]);
  for (const part of t.parts) {
    const g = part.geometry.clone().applyMatrix4(matrix);
    const c = part.name === '_defaultMat' ? wall : part.color;
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (part.name === 'window' ? windows : solid).push(g);
  }
  return t.size.y * sy;
}
