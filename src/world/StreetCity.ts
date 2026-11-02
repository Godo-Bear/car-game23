import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeOfDay } from '../../shared/api';
import type { Footprint } from './City';
import { type CityStreet, type Lot, type Park, planCity } from './cityPlan';
import { type CityFacade, cityFacade, FACADE_STYLES, type FacadeStyle, grassTexture, helipadTexture, paverTexture, roofTexture } from './cityTextures';
import { broadleaf, contactShadowMaterial, pine, sakura, swayMaterial, type TreeShape } from './foliage';
import { GeometryBuilder } from './GeometryBuilder';
import { type Feature, type HouseSpot, japaneseHouses, type Spot, vendingMachines } from './japan';
import { type BuildingTemplate, cityKit } from './sceneryModels';
import { applyContactShading, type StreakLight } from './surfaces';
import { billboardTexture, glowTexture, neonSignTexture, shopfrontTexture } from './textures';

/**
 * The free drive city's buildings and parks, built from its plan (cityPlan.ts): every lot gets
 * a building facing its street, in the style of its district -
 * - downtown: glass and white office towers on podiums, crowned with lit bands at night,
 *   helipads and red aircraft beacons on the tallest;
 * - the shopping districts: narrow shop buildings with glowing shopfronts, vertical neon signs
 *   and the odd rooftop billboard;
 * - further out: apartment blocks with balconies and traditional houses, vending machines
 *   outside;
 * - the edge of town: warehouses.
 * Rooftops get air-conditioners, water tanks and stair housings. Parks get lawns, paths,
 * trees (cherry blossom in some), ponds, benches, stone lanterns and a shrine gate. Under it
 * all, light concrete paving. Collisions use each building's footprint (turned to its street).
 */
/** Reflections: shop windows (warm white) and the neon signs (one colour per sign texture). */
const SHOP_GLOW = new THREE.Color(1, 0.9, 0.75).multiplyScalar(0.4);
const NEON = [0xff3d8b, 0x36d6ff, 0xffb02e, 0x7dff6a, 0xff4a3d, 0xb46bff].map((c) => new THREE.Color(c).multiplyScalar(0.9));

export class StreetCity {
  readonly group = new THREE.Group();
  readonly footprints: Footprint[] = [];
  /** Neon signs and shop windows, for their reflections in the wet road at night. */
  readonly streakLights: StreakLight[] = [];
  readonly parks: Park[];
  readonly lots: Lot[];
  private readonly features: Feature[] = [];
  private readonly facadeMats: THREE.MeshLambertMaterial[] = [];
  private readonly lit: { mat: THREE.MeshBasicMaterial; colors: Record<TimeOfDay, THREE.Color> }[] = [];
  private readonly beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.15, 0.1) });
  private readonly flicker: THREE.MeshBasicMaterial[] = [];
  /** Giant video screens downtown: a few channels, redrawn a dozen times a second. */
  private readonly channels: VideoChannel[] = [];
  private nextFrame = 0;
  private readonly fountain: THREE.Mesh[] = [];

  constructor(streets: CityStreet[], radius: number, reserved: { x: number; z: number; r: number }[], rng: () => number) {
    this.group.name = 'street-city';
    const plan = planCity(streets, radius, reserved, rng);
    this.lots = plan.lots;
    this.parks = plan.parks;
    this.buildGround(radius, rng);
    this.buildBuildings(plan.lots, rng);
    this.buildParks(plan.parks, rng);
    this.buildPlaza(rng);
    this.group.traverse((o) => {
      // The city's own contact shading does the ambient occlusion's job here.
      if ((o as THREE.Mesh).isMesh && o.name !== 'buildings') o.userData.noAO = true;
    });
  }

  private glowing<T extends THREE.MeshBasicMaterial>(mat: T, night: THREE.Color, sunset: THREE.Color, day: THREE.Color): T {
    this.lit.push({ mat, colors: { night, sunset, day } });
    return mat;
  }

  setTimeOfDay(tod: TimeOfDay): void {
    for (const m of this.facadeMats) m.emissiveIntensity = tod === 'night' ? 1 : tod === 'sunset' ? 0.3 : 0;
    for (const { mat, colors } of this.lit) mat.color.copy(colors[tod]);
    for (const f of this.features) f.setTimeOfDay?.(tod);
  }

  update(time: number): void {
    if (time >= this.nextFrame) {
      this.nextFrame = time + 1 / 12;
      for (const ch of this.channels) ch.draw(time);
    }
    // The fountain's jets rise and fall.
    this.fountain.forEach((jet, i) => {
      jet.scale.y = 0.75 + 0.25 * Math.sin(time * 2.2 + i * 0.9);
    });
    // Aircraft beacons blink; a few neon signs stutter.
    const on = Math.floor(time * 1.2) % 2 === 0;
    this.beacon.color.setRGB(on ? 5 : 0.4, on ? 0.15 : 0.02, on ? 0.1 : 0.02);
    const k = Math.sin(time * 37) > 0.93 ? 0.35 : 1;
    for (const m of this.flicker) m.opacity = k;
    for (const f of this.features) f.update?.(time);
  }

  // ---------------------------------------------------------------- ground

  /** Light concrete paving over the whole town (the streets, pavements and parks sit on it). */
  private buildGround(radius: number, rng: () => number): void {
    const tex = paverTexture(rng);
    tex.repeat.set((radius * 2) / 5, (radius * 2) / 5);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 1 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius + 6, 160).rotateX(-Math.PI / 2), mat);
    disc.position.y = 0.012;
    disc.receiveShadow = true;
    disc.name = 'city-ground';
    this.group.add(disc);
  }

  // ---------------------------------------------------------------- buildings

  private buildBuildings(lots: Lot[], rng: () => number): void {
    const facades = Object.fromEntries(FACADE_STYLES.map((s) => [s, cityFacade(s, rng)])) as Record<FacadeStyle, CityFacade>;
    const walls = Object.fromEntries(FACADE_STYLES.map((s) => [s, new GeometryBuilder(true)])) as Record<FacadeStyle, GeometryBuilder>;
    const roofs = new GeometryBuilder(true);
    const props = new GeometryBuilder(true);
    const crowns = new GeometryBuilder(true);
    const beacons = new GeometryBuilder();
    const helipads = new GeometryBuilder();
    const shops = new GeometryBuilder();
    const SIGNS = 16;
    const signs = Array.from({ length: SIGNS }, () => new GeometryBuilder());
    const BOARDS = 5;
    const boards = Array.from({ length: BOARDS }, () => new GeometryBuilder());
    const houses: HouseSpot[] = [];
    const vending: Spot[] = [];
    const kit = cityKit();
    const kitSolid: THREE.BufferGeometry[] = [];
    const kitWindows: THREE.BufferGeometry[] = [];
    let kitLeft = 80;
    const SCREENS = 3;
    const screenGeo = Array.from({ length: SCREENS }, () => new GeometryBuilder());
    let screens = 0;
    let sign = 0;
    let board = 0;
    const tint = new THREE.Color();
    const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];

    for (const l of lots) {
      this.footprints.push({ x: l.x, z: l.z, hw: l.w / 2, hd: l.d / 2, angle: l.angle });
      const front = this.frontOf(l);
      if (l.house) {
        houses.push({ x: l.x, y: 0.06, z: l.z, facing: Math.atan2(l.fx, l.fz), kind: 'minka' });
        if (rng() < 0.18) vending.push(front.spot(l.w / 2 - 1.2, 0.6));
        continue;
      }
      // A City Kit building now and then (detailed models: rationed).
      if (kit && kitLeft > 0 && l.layer === 0 && l.district !== 'downtown' && l.h < 40 && rng() < 0.08) {
        kitLeft--;
        kitBuilding(kit, rng, l, kitSolid, kitWindows);
        continue;
      }
      const style = styleFor(l, rng);
      const opts = (s: FacadeStyle) => ({
        tileU: 12,
        tileV: 14,
        roof: roofs,
        color: tint
          .setHex(pick(TINTS[s]))
          .offsetHSL(0, 0, (rng() - 0.5) * 0.06)
          .clone(),
        uOffset: Math.floor(rng() * 4) / 4,
        vOffset: 0,
      });
      let top = l.h;
      let tw = l.w;
      let td = l.d;
      if (l.district === 'downtown' && l.h > 60) {
        // A podium of shops and offices, the tower set back on top of it.
        const podium = 10 + Math.round(rng() * 2) * 3.5;
        const podiumStyle: FacadeStyle = rng() < 0.5 ? 'tile' : 'office';
        walls[podiumStyle].box(l.x, 0, l.z, l.w, podium, l.d, l.angle, opts(podiumStyle));
        tw = l.w * (0.6 + rng() * 0.22);
        td = l.d * (0.6 + rng() * 0.22);
        walls[style].box(l.x, podium, l.z, tw, l.h - podium, td, l.angle, opts(style));
        // A giant video screen on the towers round the middle of town, facing the street.
        if (l.layer === 0 && screens < 9 && Math.hypot(l.x, l.z) < 280 && l.h > podium + 30) {
          const sw = Math.min(tw * 0.85, 24);
          const sh = sw * 0.5625;
          front.quad(screenGeo[screens % SCREENS], -sw / 2, sw / 2, podium + 4, podium + 4 + sh, (td - l.d) / 2 + 0.15);
          screens++;
        }
        // A lit crown band (cool white, cyan, pink or warm) - the skyline at night.
        crowns.box(l.x, l.h - 2.6, l.z, tw + 0.35, 1.6, td + 0.35, l.angle, { roof: null, color: new THREE.Color(pick(CROWNS)) });
        if (l.h > 150 && rng() < 0.7) {
          const at = [l.x, l.h + 0.08, l.z] as const;
          const r = Math.min(tw, td) * 0.42;
          const c = Math.cos(l.angle);
          const s = Math.sin(l.angle);
          const p = (a: number, b: number): [number, number, number] => [at[0] + a * c + b * s, at[1], at[2] - a * s + b * c];
          helipads.quad(p(-r, -r), p(-r, r), p(r, r), p(r, -r));
        } else {
          const ax = l.x + Math.cos(l.angle) * tw * 0.25;
          const az = l.z - Math.sin(l.angle) * tw * 0.25;
          const mast = 14 + rng() * 14;
          props.cylinder(ax, l.h, az, 0.35, 0.12, mast, 6, GREY);
          beacons.box(ax, l.h + mast, az, 0.9, 0.9, 0.9);
        }
      } else {
        walls[style].box(l.x, 0, l.z, l.w, l.h, l.d, l.angle, opts(style));
        // A smaller top floor set back on some of the taller blocks.
        if (l.h > 20 && rng() < 0.28) {
          walls[style].box(l.x, l.h, l.z, l.w * 0.7, 3.5 + Math.round(rng()) * 3.5, l.d * 0.7, l.angle, opts(style));
          top += 3.5;
        }
        if (l.h > 70) beacons.box(l.x, top + 0.5, l.z, 0.8, 0.8, 0.8);
      }

      // Rooftop clutter on the lower blocks.
      if (top < 70 && style !== 'warehouse') {
        const roof = (a: number, b: number) => this.local(l, a * tw, b * td);
        for (let k = Math.floor(rng() * 4); k > 0; k--) {
          const [x, z] = roof((rng() - 0.5) * 0.7, (rng() - 0.5) * 0.7);
          props.box(x, top, z, 1.4, 1.1, 0.9, l.angle, { color: AC });
        }
        if (rng() < 0.4) {
          const [x, z] = roof((rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
          props.box(x, top, z, 2.2, 1.6, 2.2, l.angle, { color: STEEL });
          props.cylinder(x, top + 1.6, z, 1.3, 1.3, 2.4, 10, TANK);
        }
        if (rng() < 0.55 && l.h > 12) {
          const [x, z] = roof((rng() - 0.5) * 0.4, 0.25);
          props.box(x, top, z, 3.2, 2.8, 3.2, l.angle, { color: tint.setHex(0xd6d3cc).clone(), roof: null });
        }
      }

      // The street front: shops at ground level, neon signs, billboards, vending machines.
      if (l.layer !== 0) continue;
      const shop = l.district === 'commercial' || l.district === 'downtown' || (l.district === 'residential' && rng() < 0.3);
      if (shop) {
        front.quad(shops, -l.w / 2 + 0.5, l.w / 2 - 0.5, 0.25, Math.min(3.8, l.h - 0.5), 0.07);
        if (rng() < 0.45) {
          const at = front.spot(0, 1.2);
          this.streakLights.push({ x: at.x, y: 0.12, z: at.z, color: SHOP_GLOW, width: Math.min(4, l.w * 0.5), length: 10 });
        }
      }
      if ((l.district === 'commercial' && rng() < 0.62) || (l.district === 'downtown' && rng() < 0.2)) {
        const along = (rng() < 0.5 ? -1 : 1) * (l.w / 2 - 1.2);
        const height = Math.min(9, l.h * 0.55);
        const y0 = Math.min(4.5 + rng() * 5, Math.max(4.2, l.h - height - 0.5));
        const b = signs[sign++ % SIGNS];
        // Two back-to-back boards sticking out over the pavement, readable from both ways.
        front.blade(b, along, 0.2, 2.4, y0, y0 + height);
        const at = front.spot(along, 1.3);
        this.streakLights.push({ x: at.x, y: 0.12, z: at.z, color: NEON[(sign - 1) % NEON.length], width: 1.3, length: 22 });
      }
      if (l.district === 'commercial' && l.h < 40 && l.h > 10 && rng() < 0.12) {
        const bw = Math.min(14, l.w * 0.9);
        front.quad(boards[board++ % BOARDS], -bw / 2, bw / 2, l.h + 1, l.h + 1 + bw * 0.375, -l.d * 0.25);
        const post = front.spot(0, -l.d * 0.25 - 0.3);
        props.box(post.x, l.h, post.z, 0.3, 1.1, 0.3, l.angle, { color: STEEL });
      }
      if (l.district !== 'downtown' && rng() < 0.1) vending.push(front.spot(-l.w / 2 + 1, 0.6));
    }

    // Walls: tiled facades, tinted per building, lit windows at night, darker where they meet the ground.
    for (const s of FACADE_STYLES) {
      if (walls[s].isEmpty) continue;
      const mat = new THREE.MeshLambertMaterial({
        map: facades[s].map,
        emissiveMap: facades[s].emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        vertexColors: true,
      });
      applyContactShading(mat, 0, 3.5, 0.35);
      this.facadeMats.push(mat);
      const mesh = new THREE.Mesh(walls[s].build(), mat);
      mesh.name = 'buildings';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const roofMat = new THREE.MeshLambertMaterial({ map: roofTexture(rng), vertexColors: true });
    this.group.add(new THREE.Mesh(roofs.build(), roofMat));
    this.group.add(new THREE.Mesh(props.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })));
    if (!crowns.isEmpty) {
      const crownMat = this.glowing(
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        new THREE.Color(2.4, 2.4, 2.4),
        new THREE.Color(1.3, 1.3, 1.3),
        new THREE.Color(0.75, 0.78, 0.82),
      );
      this.group.add(new THREE.Mesh(crowns.build(), crownMat));
    }
    if (!beacons.isEmpty) this.group.add(new THREE.Mesh(beacons.build(), this.beacon));
    if (!helipads.isEmpty) this.group.add(new THREE.Mesh(helipads.build(), new THREE.MeshLambertMaterial({ map: helipadTexture() })));
    const grey = (v: number) => new THREE.Color(v, v, v);
    if (!shops.isEmpty) {
      const shopMat = this.glowing(new THREE.MeshBasicMaterial({ map: shopfrontTexture(rng) }), grey(1.35), grey(1.15), grey(0.95));
      this.group.add(new THREE.Mesh(shops.build(), shopMat));
    }
    signs.forEach((g, i) => {
      if (g.isEmpty) return;
      const mat = this.glowing(new THREE.MeshBasicMaterial({ map: neonSignTexture(i), transparent: true }), grey(2), grey(1.45), grey(1.05));
      if (i % 5 === 2) this.flicker.push(mat);
      this.group.add(new THREE.Mesh(g.build(), mat));
    });
    boards.forEach((g, i) => {
      if (g.isEmpty) return;
      const mat = this.glowing(new THREE.MeshBasicMaterial({ map: billboardTexture(i), side: THREE.DoubleSide }), grey(1.4), grey(1.15), grey(0.95));
      this.group.add(new THREE.Mesh(g.build(), mat));
    });
    if (kitSolid.length) {
      const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
      applyContactShading(solid);
      const mesh = new THREE.Mesh(mergeGeometries(kitSolid)!, solid);
      mesh.castShadow = true;
      this.group.add(mesh);
      const glass = this.glowing(
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        new THREE.Color(2.6, 2.05, 1.25),
        new THREE.Color(1.35, 1.15, 0.95),
        new THREE.Color(1, 1, 1),
      );
      this.group.add(new THREE.Mesh(mergeGeometries(kitWindows)!, glass));
      for (const g of [...kitSolid, ...kitWindows]) g.dispose();
    }
    screenGeo.forEach((g, i) => {
      if (g.isEmpty) return;
      const ch = new VideoChannel(i);
      this.channels.push(ch);
      const mat = this.glowing(new THREE.MeshBasicMaterial({ map: ch.texture }), grey(1.6), grey(1.25), grey(1.0));
      this.group.add(new THREE.Mesh(g.build(), mat));
    });
    if (houses.length) this.addFeature(japaneseHouses(houses));
    if (vending.length) this.addFeature(vendingMachines(vending, rng));
  }

  private addFeature(f: Feature): void {
    this.features.push(f);
    this.group.add(f.group);
  }

  /** World (x, z) of a point in a lot's own frame (a along the street, b across). */
  private local(l: Lot, a: number, b: number): [number, number] {
    const c = Math.cos(l.angle);
    const s = Math.sin(l.angle);
    return [l.x + a * c + b * s, l.z - a * s + b * c];
  }

  /** Helpers for building things on a lot's street front. */
  private frontOf(l: Lot) {
    // Along the front face (left to right as seen from the street), and out from it.
    const tx = Math.cos(l.angle);
    const tz = -Math.sin(l.angle);
    const p = (along: number, y: number, out: number): [number, number, number] => [
      l.x + l.fx * (l.d / 2 + out) + tx * along,
      y,
      l.z + l.fz * (l.d / 2 + out) + tz * along,
    ];
    // Facing the street: wind the quad so its normal points along (fx, fz) (and reads left to right).
    const keep = -tz * l.fx + tx * l.fz > 0;
    return {
      quad(b: GeometryBuilder, a0: number, a1: number, y0: number, y1: number, out: number): void {
        const [l0, l1] = keep ? [a0, a1] : [a1, a0];
        b.quad(p(l0, y0, out), p(l1, y0, out), p(l1, y1, out), p(l0, y1, out));
      },
      blade(b: GeometryBuilder, along: number, out0: number, out1: number, y0: number, y1: number): void {
        const a = p(along, 0, out0);
        const c = p(along, 0, out1);
        const q = (u: [number, number, number], v: [number, number, number]) => b.quad([u[0], y0, u[2]], [v[0], y0, v[2]], [v[0], y1, v[2]], [u[0], y1, u[2]]);
        q(a, c);
        q(c, a);
      },
      spot(along: number, out: number): Spot {
        const [x, , z] = p(along, 0, out);
        return { x, y: 0.12, z, facing: Math.atan2(l.fx, l.fz) };
      },
    };
  }

  // ---------------------------------------------------------------- the middle of town

  /**
   * The island in the roundabout where the avenues meet: a granite plaza with a fountain (jets
   * of water round a lit spire), cherry trees and benches.
   */
  private buildPlaza(rng: () => number): void {
    const R = 30;
    const stone = new THREE.MeshLambertMaterial({ map: paverTexture(rng), color: 0xd8d2c4 });
    (stone.map as THREE.Texture).repeat.set(6, 6);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.08, 64), stone);
    deck.position.y = 0.04;
    this.group.add(deck);
    // Basin, water and jets.
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 9.8, 0.9, 48, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x8e8a82, side: THREE.DoubleSide }),
    );
    rim.position.y = 0.45;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(9.5, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2b6a8a, roughness: 0.05, metalness: 0.4 }),
    );
    water.position.y = 0.7;
    this.group.add(rim, water);
    const jetMat = this.glowing(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
      new THREE.Color(0.8, 1.4, 2.2),
      new THREE.Color(1.1, 1.0, 1.2),
      new THREE.Color(0.9, 0.95, 1),
    );
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.35, 5, 8).translate(0, 2.5, 0), jetMat);
      jet.position.set(Math.cos(a) * 5.5, 0.7, Math.sin(a) * 5.5);
      this.fountain.push(jet);
      this.group.add(jet);
    }
    // A slender lit spire in the middle.
    const spireMat = this.glowing(
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      new THREE.Color(1.8, 1.2, 2.6),
      new THREE.Color(1.4, 1.1, 1.3),
      new THREE.Color(0.85, 0.85, 0.9),
    );
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.1, 22, 6), spireMat);
    spire.position.y = 11.7;
    this.group.add(spire);
    this.footprints.push({ x: 0, z: 0, hw: 9.8, hd: 9.8, angle: Math.PI / 4 });
    // Cherry trees and benches round it.
    const shape = sakura();
    const n = 12;
    const crowns = new THREE.InstancedMesh(shape.crown, swayMaterial({ color: 0xffffff }, shape.sway, 0.04), n);
    const trunks = new THREE.InstancedMesh(shape.trunk!, swayMaterial({ color: shape.trunkColor }, shape.sway, 0), n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const benches = new GeometryBuilder();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.26;
      const x = Math.cos(a) * 21;
      const z = Math.sin(a) * 21;
      m.makeRotationY(rng() * 6).setPosition(x, 0.22, z);
      crowns.setMatrixAt(k, m);
      trunks.setMatrixAt(k, m);
      crowns.setColorAt(k, c.setHex(shape.palette[k % shape.palette.length]));
      this.footprints.push({ x, z, hw: 0.5, hd: 0.5 });
      const b = a + Math.PI / n;
      benches.box(Math.cos(b) * 15, 0.62, Math.sin(b) * 15, 2, 0.1, 0.55, -b + Math.PI / 2);
      benches.box(Math.cos(b) * 15, 0.22, Math.sin(b) * 15, 1.8, 0.4, 0.3, -b + Math.PI / 2);
    }
    for (const mesh of [crowns, trunks]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    crowns.castShadow = true;
    this.group.add(new THREE.Mesh(benches.build(), new THREE.MeshLambertMaterial({ color: 0x6b4a32 })));
  }

  // ---------------------------------------------------------------- parks

  private buildParks(parks: Park[], rng: () => number): void {
    if (!parks.length) return;
    const lawn = new THREE.MeshLambertMaterial({ map: grassTexture(rng), polygonOffset: true, polygonOffsetFactor: -1 });
    (lawn.map as THREE.Texture).repeat.set(1, 1);
    const path = new THREE.MeshLambertMaterial({ color: 0xcdbf9f, polygonOffset: true, polygonOffsetFactor: -2 });
    const water = new THREE.MeshStandardMaterial({ color: 0x1d4a5e, roughness: 0.08, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -3 });
    const stone = new GeometryBuilder();
    const wood = new GeometryBuilder();
    const torii = new GeometryBuilder();
    const trees: { shape: TreeShape; at: [number, number][] }[] = [
      { shape: broadleaf(), at: [] },
      { shape: sakura(), at: [] },
      { shape: pine(), at: [] },
    ];
    const lanternLights: number[] = [];
    parks.forEach((park, n) => {
      const { x, z, r } = park;
      // An irregular lawn.
      const shape = new THREE.Shape();
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const rr = r * (0.9 + 0.08 * Math.sin(a * 3 + n) + 0.04 * Math.sin(a * 7 + n * 2));
        const px = Math.cos(a) * rr;
        const pz = Math.sin(a) * rr;
        if (i === 0) shape.moveTo(px, pz);
        else shape.lineTo(px, pz);
      }
      const g = new THREE.ShapeGeometry(shape, 1);
      // Lawn UVs in metres / 8.
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 8, pos.getY(i) / 8);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, lawn);
      mesh.position.set(x, 0.035, z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      // A ring path and two paths across it.
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.55, r * 0.55 + 3, 48).rotateX(-Math.PI / 2), path);
      ring.position.set(x, 0.045, z);
      this.group.add(ring);
      const a0 = rng() * Math.PI;
      for (const a of [a0, a0 + Math.PI / 2]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(3, r * 1.8).rotateX(-Math.PI / 2), path);
        p.rotation.y = a;
        p.position.set(x, 0.045, z);
        this.group.add(p);
      }
      // A pond in the bigger parks (off-centre), with a stone edge.
      const pond = r > 45;
      const px = x + Math.cos(a0 + 0.8) * r * 0.32;
      const pz = z + Math.sin(a0 + 0.8) * r * 0.32;
      if (pond) {
        const w = new THREE.Mesh(new THREE.CircleGeometry(r * 0.2, 32).rotateX(-Math.PI / 2), water);
        w.position.set(px, 0.055, pz);
        this.group.add(w);
        for (let k = 0; k < 28; k++) {
          const a = (k / 28) * Math.PI * 2;
          stone.box(px + Math.cos(a) * r * 0.2, 0, pz + Math.sin(a) * r * 0.2, 1.4, 0.35, 0.9, -a);
        }
      }
      // Trees round the edge and in clumps, clear of the paths and the pond.
      const blossom = rng() < 0.45;
      const kinds = blossom ? [1, 1, 0] : [0, 0, 2];
      for (let k = 0; k < Math.round(r * 0.9); k++) {
        const a = rng() * Math.PI * 2;
        const d = r * (0.25 + rng() * 0.62);
        const tx = x + Math.cos(a) * d;
        const tz = z + Math.sin(a) * d;
        if (Math.abs(d - r * 0.55 - 1.5) < 3.5) continue;
        if (pond && Math.hypot(tx - px, tz - pz) < r * 0.2 + 3) continue;
        if (Math.abs(Math.sin(a - a0) * d) < 3.5 || Math.abs(Math.cos(a - a0) * d) < 3.5) continue;
        trees[kinds[k % 3]].at.push([tx, tz]);
        this.footprints.push({ x: tx, z: tz, hw: 0.6, hd: 0.6 });
      }
      // Benches round the ring path and stone lanterns at the entrances.
      for (let k = 0; k < 6; k++) {
        const a = a0 + Math.PI / 4 + (k / 6) * Math.PI * 2;
        const bx = x + Math.cos(a) * (r * 0.55 - 1.4);
        const bz = z + Math.sin(a) * (r * 0.55 - 1.4);
        wood.box(bx, 0.42, bz, 1.8, 0.1, 0.5, -a + Math.PI / 2);
        wood.box(bx, 0, bz, 1.6, 0.42, 0.3, -a + Math.PI / 2);
      }
      for (const a of [a0, a0 + Math.PI / 2, a0 + Math.PI, a0 + (3 * Math.PI) / 2]) {
        const lx = x + Math.cos(a) * (r * 0.86) + Math.cos(a + Math.PI / 2) * 3;
        const lz = z + Math.sin(a) * (r * 0.86) + Math.sin(a + Math.PI / 2) * 3;
        stone.box(lx, 0, lz, 0.7, 0.9, 0.7, a);
        stone.box(lx, 0.9, lz, 0.45, 0.8, 0.45, a);
        stone.box(lx, 1.7, lz, 1.0, 0.25, 1.0, a);
        lanternLights.push(lx, 1.3, lz);
      }
      // A shrine gate (torii) on the path into the biggest park.
      if (n === 0) {
        const gx = x + Math.cos(a0) * (r * 0.75);
        const gz = z + Math.sin(a0) * (r * 0.75);
        const across = a0 + Math.PI / 2;
        for (const side of [-1, 1]) {
          torii.cylinder(gx + Math.cos(across) * side * 2.6, 0, gz + Math.sin(across) * side * 2.6, 0.32, 0.28, 6.2, 10);
        }
        torii.box(gx, 4.6, gz, 6.6, 0.4, 0.4, -across);
        torii.box(gx, 5.9, gz, 8.2, 0.5, 0.7, -across);
        this.footprints.push(
          { x: gx + Math.cos(across) * 2.6, z: gz + Math.sin(across) * 2.6, hw: 0.4, hd: 0.4 },
          { x: gx - Math.cos(across) * 2.6, z: gz - Math.sin(across) * 2.6, hw: 0.4, hd: 0.4 },
        );
      }
    });
    this.group.add(new THREE.Mesh(stone.build(), new THREE.MeshLambertMaterial({ color: 0x9a968c })));
    this.group.add(new THREE.Mesh(wood.build(), new THREE.MeshLambertMaterial({ color: 0x6b4a32 })));
    if (!torii.isEmpty) this.group.add(new THREE.Mesh(torii.build(), new THREE.MeshLambertMaterial({ color: 0xd8341f })));
    const glow = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xffcf8a,
      size: 3,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanternLights, 3));
    this.group.add(new THREE.Points(glowGeo, glow));
    this.features.push({
      group: new THREE.Group(),
      setTimeOfDay: (tod) => {
        glow.opacity = tod === 'night' ? 0.9 : tod === 'sunset' ? 0.4 : 0;
      },
    });
    // The trees, instanced, with their contact shadows.
    const shadowGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const shadowMat = contactShadowMaterial(0.5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    for (const { shape, at } of trees) {
      if (!at.length) continue;
      const crowns = new THREE.InstancedMesh(shape.crown, swayMaterial({ color: 0xffffff }, shape.sway, 0.04), at.length);
      const trunks = shape.trunk ? new THREE.InstancedMesh(shape.trunk, swayMaterial({ color: shape.trunkColor }, shape.sway, 0), at.length) : null;
      const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, at.length);
      at.forEach(([x, z], i) => {
        const s = 0.8 + rng() * 0.5;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        m.compose(v.set(x, 0, z), q, sc.set(s, s * (0.85 + rng() * 0.3), s));
        crowns.setMatrixAt(i, m);
        trunks?.setMatrixAt(i, m);
        crowns.setColorAt(i, color.setHex(shape.palette[Math.floor(rng() * shape.palette.length)]));
        m.compose(v.set(x, 0.06, z), q, sc.set(shape.shadow * s, 1, shape.shadow * s));
        shadows.setMatrixAt(i, m);
      });
      for (const mesh of [crowns, trunks, shadows]) {
        if (!mesh) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      crowns.castShadow = true;
    }
  }
}

/**
 * A channel on the giant screens: bold, bright motion graphics (a festival promo, a drink ad,
 * the city GP), drawn on a canvas a dozen times a second.
 */
class VideoChannel {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;

  constructor(private readonly kind: number) {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(0);
  }

  draw(time: number): void {
    const g = this.g;
    const W = 320;
    const H = 180;
    const t = time;
    if (this.kind === 0) {
      // Festival promo: sweeping hues, pulsing rings, big type.
      const hue = (t * 40) % 360;
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, `hsl(${hue}, 85%, 55%)`);
      grad.addColorStop(1, `hsl(${(hue + 120) % 360}, 85%, 45%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      for (let k = 0; k < 4; k++) {
        const r = ((t * 60 + k * 45) % 180) + 10;
        g.strokeStyle = `rgba(255,255,255,${1 - r / 190})`;
        g.lineWidth = 6;
        g.beginPath();
        g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '900 italic 40px system-ui, sans-serif';
      g.fillText('DRIFT FES', W / 2, H / 2 + 6);
      g.font = '700 20px "Hiragino Sans", "Yu Gothic", sans-serif';
      g.fillText('ドリフト祭り · 今夜', W / 2, H / 2 + 36);
    } else if (this.kind === 1) {
      // A soda ad: rising bubbles over cool blue, the can bobbing.
      g.fillStyle = '#0a5fb8';
      g.fillRect(0, 0, W, H);
      for (let k = 0; k < 24; k++) {
        const x = (k * 53) % W;
        const y = H - ((t * 50 + k * 37) % (H + 20));
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.arc(x, y, 3 + (k % 4), 0, Math.PI * 2);
        g.fill();
      }
      const bob = Math.sin(t * 3) * 6;
      g.fillStyle = '#e6f3ff';
      g.fillRect(40, 40 + bob, 56, 104);
      g.fillStyle = '#ff3d73';
      g.fillRect(40, 70 + bob, 56, 40);
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.font = '900 34px system-ui, sans-serif';
      g.fillText('SAKURA', 120, 80);
      g.fillText('SODA', 120, 116);
      g.font = '700 18px "Hiragino Sans", "Yu Gothic", sans-serif';
      g.fillText('さくらソーダ', 122, 146);
    } else {
      // The city GP: a racing stripe sweep and a countdown.
      g.fillStyle = '#111';
      g.fillRect(0, 0, W, H);
      const x = ((t * 220) % (W + 200)) - 100;
      g.fillStyle = '#ff2d6f';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 70, 0);
      g.lineTo(x - 30, H);
      g.lineTo(x - 100, H);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffd21f';
      g.textAlign = 'center';
      g.font = '900 italic 36px system-ui, sans-serif';
      g.fillText('CITY GRAND PRIX', W / 2, 78);
      g.fillStyle = '#fff';
      g.font = '700 22px system-ui, sans-serif';
      const n = 5 - (Math.floor(t) % 6);
      g.fillText(n > 0 ? `STARTS IN ${n}` : 'GO!', W / 2, 122);
    }
    this.texture.needsUpdate = true;
  }
}

const GREY = new THREE.Color(0x8d9096);
const AC = new THREE.Color(0xd9dbd6);
const STEEL = new THREE.Color(0x7c8086);
const TANK = new THREE.Color(0xe8e6e0);
const CROWNS = [0xdfefff, 0x9fe8ff, 0xffb0d8, 0xffe0a8, 0xc8b8ff];

/** Paint and cladding colours per facade (multiplied over the facade texture). */
const TINTS: Record<FacadeStyle, number[]> = {
  glass: [0xffffff, 0xd0e0f0, 0xb8d0e0, 0xa8c8c8, 0xc8d0ff, 0x98b0c8, 0xb0e0d8],
  darkglass: [0xffffff, 0xd8c8b0, 0xb8c8d8, 0xc0c0c0, 0xa8b8b0],
  office: [0xffffff, 0xece6da, 0xd6dade, 0xc8ccd0, 0xe8e0cc, 0xb8bcc0],
  tile: [0xffffff, 0xe8d4bc, 0xc8b090, 0xb8c4c8, 0xe8c8b0, 0xa8b8a0, 0xd8c0a8, 0xc0b0a0],
  apartment: [0xffffff, 0xf0e6d4, 0xdce6ec, 0xf0dcdc, 0xe2ead4, 0xe8dcc8, 0xd0d8e0],
  brick: [0xffffff, 0xe0c8b8, 0xc8a898, 0xd8b8a0, 0xb89888],
  old: [0xffffff, 0xd8d2c8, 0xc0c4c8, 0xd8ccb8, 0xb8b0a0, 0xa8acb0],
  warehouse: [0xffffff, 0xb0c8e0, 0xe8dcb8, 0xc8e0c8, 0xe0c0b0, 0xa0b0c8, 0xd8d8d0],
};

function styleFor(l: Lot, rng: () => number): FacadeStyle {
  const r = rng();
  switch (l.district) {
    case 'downtown':
      return r < 0.4 ? 'glass' : r < 0.62 ? 'darkglass' : r < 0.86 ? 'office' : 'tile';
    case 'commercial':
      return r < 0.32 ? 'tile' : r < 0.55 ? 'old' : r < 0.75 ? 'office' : r < 0.9 ? 'apartment' : 'glass';
    case 'residential':
      return r < 0.55 ? 'apartment' : r < 0.85 ? 'brick' : 'tile';
    default:
      // Low sheds are warehouses; the taller blocks out here are flats and offices.
      if (l.h <= 20) return r < 0.75 ? 'warehouse' : 'tile';
      return r < 0.45 ? 'apartment' : r < 0.75 ? 'office' : r < 0.9 ? 'tile' : 'brick';
  }
}

/** A City Kit model on a lot: the one closest in proportion, stretched to fit and facing the street. */
function kitBuilding(kit: BuildingTemplate[], rng: () => number, l: Lot, solid: THREE.BufferGeometry[], windows: THREE.BufferGeometry[]): void {
  const want = l.h / Math.max(l.w, l.d);
  const ranked = [...kit].sort(
    (a, b) => Math.abs(Math.log(a.size.y / Math.max(a.size.x, a.size.z) / want)) - Math.abs(Math.log(b.size.y / Math.max(b.size.x, b.size.z) / want)),
  );
  const t = ranked[Math.floor(rng() * Math.min(3, ranked.length))];
  const sx = l.w / t.size.x;
  const sz = l.d / t.size.z;
  const matrix = new THREE.Matrix4()
    .makeTranslation(l.x, 0, l.z)
    .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(l.fx, l.fz)))
    .multiply(new THREE.Matrix4().makeScale(sx, (sx + sz) / 2, sz));
  const wall = new THREE.Color(TINTS.tile[Math.floor(rng() * TINTS.tile.length)]).multiply(new THREE.Color(0xd8cfc0));
  for (const part of t.parts) {
    const g = part.geometry.clone().applyMatrix4(matrix);
    const c = part.name === '_defaultMat' ? wall : part.color;
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    (part.name === 'window' ? windows : solid).push(g);
  }
}
