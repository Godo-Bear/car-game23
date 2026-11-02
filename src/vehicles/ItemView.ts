import * as THREE from 'three';
import type { ItemSystem } from '../race/Items';
import { glowTexture } from '../world/textures';

/**
 * What items look like in the world: the item boxes (glowing, colour-cycling cubes marked 福,
 * "fortune", spinning over the road), Shuriken and Paper Lanterns in flight, Oil Slicks on the
 * road and the golden bubble of a Lucky Cat around a car.
 */
export class ItemView {
  readonly group = new THREE.Group();
  private items: ItemSystem | null = null;
  private readonly boxMat: THREE.MeshBasicMaterial;
  private readonly boxRim: THREE.MeshBasicMaterial;
  private readonly boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  private readonly boxes = new THREE.Group();
  private boxMeshes: THREE.Group[] = [];
  private readonly shurikens: THREE.Group[] = [];
  private readonly lanterns: THREE.Group[] = [];
  private readonly slicks: THREE.Mesh[] = [];
  private readonly shields: THREE.Mesh[] = [];
  private readonly shurikenGeo: THREE.BufferGeometry;
  private readonly shurikenMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3b2,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x334455,
    emissiveIntensity: 0.6,
  });
  private readonly lanternBody = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14);
  private readonly lanternCap = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14);
  private readonly lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.35, 0.15) });
  private readonly capMat = new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.6 });
  private readonly glowMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xff7a3d,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly slickGeo = new THREE.CircleGeometry(2.1, 28).rotateX(-Math.PI / 2);
  private readonly slickMat = new THREE.MeshStandardMaterial({
    color: 0x07060a,
    metalness: 0.4,
    roughness: 0.08,
    emissive: 0x2a0c40,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private readonly shieldGeo = new THREE.SphereGeometry(3.1, 28, 18);
  private readonly shieldMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.3, 1.0, 0.25),
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  constructor() {
    const tex = fortuneTexture();
    this.boxMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.88 });
    this.boxRim = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 });
    this.shurikenGeo = shurikenGeometry();
    this.group.add(this.boxes);
    this.group.traverse((o) => {
      o.userData.noAO = true;
    });
  }

  /** Show a race's items (null for a race without them). */
  setItems(items: ItemSystem | null): void {
    this.items = items;
    this.boxes.clear();
    this.boxMeshes = [];
    if (!items) return;
    for (const b of items.boxes) {
      const g = new THREE.Group();
      g.position.set(b.x, b.y + 1.4, b.z);
      const cube = new THREE.Mesh(this.boxGeo, this.boxMat);
      const rim = new THREE.Mesh(this.boxGeo, this.boxRim);
      rim.scale.setScalar(1.04);
      const glow = new THREE.Sprite(this.glowMat);
      glow.scale.setScalar(4);
      g.add(cube, rim, glow);
      g.userData.noAO = true;
      cube.userData.noAO = true;
      this.boxes.add(g);
      this.boxMeshes.push(g);
    }
  }

  /** `roots`: the cars' models (by car id), for the Lucky Cat bubbles. */
  update(time: number, elapsed: number, roots: THREE.Object3D[]): void {
    const items = this.items;
    this.group.visible = !!items;
    if (!items) return;
    // The boxes: a slow rainbow, spinning and bobbing; a taken box pops back in.
    this.boxMat.color.setHSL((elapsed * 0.15) % 1, 0.8, 0.62);
    this.glowMat.color.setHSL((elapsed * 0.15 + 0.5) % 1, 1, 0.6);
    items.boxes.forEach((b, i) => {
      const g = this.boxMeshes[i];
      const back = time - b.backAt;
      g.visible = time >= b.backAt;
      const pop = b.backAt > 0 && back < 0.35 ? Math.max(0.05, back / 0.35) : 1;
      g.scale.setScalar(pop);
      g.rotation.set(0.5, elapsed * 1.6 + i, 0.3);
      g.position.y = b.y + 1.4 + Math.sin(elapsed * 2.4 + i) * 0.15;
    });

    // Shots: a spinning shuriken, or a glowing lantern bobbing as it flies.
    let ns = 0;
    let nl = 0;
    for (const shot of items.shots) {
      if (shot.kind === 'shuriken') {
        const m = this.pool(this.shurikens, ns++, () => {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(this.shurikenGeo, this.shurikenMat));
          return g;
        });
        m.position.set(shot.x, shot.y + 0.9, shot.z);
        m.rotation.set(0, elapsed * 30, 0);
      } else {
        const m = this.pool(this.lanterns, nl++, () => {
          const g = new THREE.Group();
          const body = new THREE.Mesh(this.lanternBody, this.lanternMat);
          const top = new THREE.Mesh(this.lanternCap, this.capMat);
          top.position.y = 0.62;
          const bottom = top.clone();
          bottom.position.y = -0.62;
          const glow = new THREE.Sprite(this.glowMat.clone());
          glow.material.color.set(0xff6a2a);
          glow.scale.setScalar(5);
          g.add(body, top, bottom, glow);
          return g;
        });
        m.position.set(shot.x, shot.y + 1.3 + Math.sin(elapsed * 9) * 0.2, shot.z);
        m.rotation.z = Math.sin(elapsed * 7) * 0.25;
      }
    }
    for (let i = ns; i < this.shurikens.length; i++) this.shurikens[i].visible = false;
    for (let i = nl; i < this.lanterns.length; i++) this.lanterns[i].visible = false;

    // Oil on the road.
    let no = 0;
    for (const slick of items.slicks) {
      const m = this.pool(this.slicks, no++, () => new THREE.Mesh(this.slickGeo, this.slickMat));
      m.position.set(slick.x, slick.y + 0.07, slick.z);
      // Spreads out as it lands.
      m.scale.setScalar(Math.min(1, 0.3 + slick.age * 2.5));
    }
    for (let i = no; i < this.slicks.length; i++) this.slicks[i].visible = false;

    // Lucky Cat bubbles (flickering in their last two seconds).
    let nb = 0;
    items.state.forEach((s, id) => {
      if (s.shield <= 0 || !roots[id]) return;
      if (s.shield < 2 && Math.floor(elapsed * 10) % 2 === 0) return;
      const m = this.pool(this.shields, nb++, () => new THREE.Mesh(this.shieldGeo, this.shieldMat));
      m.position.copy(roots[id].position);
      m.position.y += 0.9;
      m.scale.set(1, 0.62, 1.25);
      m.rotation.y = roots[id].rotation.y;
    });
    for (let i = nb; i < this.shields.length; i++) this.shields[i].visible = false;
  }

  private pool<T extends THREE.Object3D>(list: T[], i: number, make: () => T): T {
    let m = list[i];
    if (!m) {
      m = make();
      m.traverse((o) => {
        o.userData.noAO = true;
      });
      list.push(m);
      this.group.add(m);
    }
    m.visible = true;
    return m;
  }
}

/** The item box face: 福 ("fortune") in a ring, white on clear (tinted by the material). */
function fortuneTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.beginPath();
  g.arc(64, 64, 42, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 60px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('福', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A flat four-pointed throwing star with a hole in the middle. */
function shurikenGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const points = 4;
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.95 : 0.28;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.03, 0);
  return geo;
}
