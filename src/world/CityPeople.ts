import * as THREE from 'three';
import { damp } from '../core/math';
import { type CityStreet, PAVEMENT, StreetField } from './cityPlan';

/**
 * People on the pavements: walking up and down the streets (busiest downtown and in the
 * shopping districts), turning back at the end of a street, with a walking bob and swinging
 * legs. They hop out of the way of a car coming at them - nobody gets run over.
 */
interface Walker {
  k: number;
  s: number;
  dir: 1 | -1;
  side: 1 | -1;
  speed: number;
  /** How far toward the buildings they've stepped to let a car past (m). */
  dodge: number;
  phase: number;
  x: number;
  z: number;
  heading: number;
}

export class CityPeople {
  readonly group = new THREE.Group();
  private readonly field: StreetField;
  private readonly walkers: Walker[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private recycle = 0;

  constructor(
    private readonly streets: CityStreet[],
    count: number,
    private readonly rng: () => number,
  ) {
    this.group.name = 'people';
    this.field = new StreetField(streets);
    // More people the nearer the middle of town.
    const weight = streets.map((_, k) => {
      const mid = this.field.at(k, this.field.length(k) / 2);
      const r = Math.hypot(mid.x, mid.z);
      return this.field.length(k) * (r < 330 ? 3 : r < 720 ? 2 : r < 1050 ? 0.8 : 0.3);
    });
    const total = weight.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      let pick = rng() * total;
      let k = 0;
      while (k < streets.length - 1 && pick > weight[k]) pick -= weight[k++];
      const w: Walker = {
        k,
        s: rng() * this.field.length(k),
        dir: rng() < 0.5 ? 1 : -1,
        side: rng() < 0.5 ? 1 : -1,
        speed: 1.1 + rng() * 0.6,
        dodge: 0,
        phase: rng() * 10,
        x: 0,
        z: 0,
        heading: 0,
      };
      this.place(w, 0);
      this.walkers.push(w);
    }
    // Low-poly figures: a body (coat or shirt colour), a head, two legs.
    const body = new THREE.CylinderGeometry(0.2, 0.24, 0.75, 7).translate(0, 1.15, 0);
    const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.66, 0);
    const leg = new THREE.BoxGeometry(0.12, 0.8, 0.14).translate(0, -0.4, 0);
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
    this.heads = new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ color: 0x2a1f1a }), count);
    this.legs = new THREE.InstancedMesh(leg, new THREE.MeshLambertMaterial({ color: 0x2b2d36 }), count * 2);
    const clothes = [0x2f3542, 0xdedede, 0x6a7b8c, 0xb0413e, 0x3d5a80, 0xe9c46a, 0x8d99ae, 0x264653, 0xf4a261, 0x9c6644, 0xffffff, 0x111111];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) this.bodies.setColorAt(i, c.setHex(clothes[Math.floor(rng() * clothes.length)]));
    for (const mesh of [this.bodies, this.heads, this.legs]) {
      mesh.frustumCulled = false;
      mesh.userData.noAO = true;
      this.group.add(mesh);
    }
    this.draw(0);
  }

  /** On the pavement: `side` of the street, stepped back by `dodge`. */
  private place(w: Walker, dt: number): void {
    const L = this.field.length(w.k);
    if (w.s < 1 || w.s > L - 1) {
      w.s = Math.max(1, Math.min(L - 1, w.s));
      w.dir = w.dir === 1 ? -1 : 1;
    }
    const p = this.field.at(w.k, w.s);
    const off = this.streets[w.k].width / 2 + PAVEMENT / 2 + w.dodge;
    const x = p.x - p.tz * off * w.side;
    const z = p.z + p.tx * off * w.side;
    const heading = Math.atan2(p.tx * w.dir, p.tz * w.dir);
    if (dt === 0) {
      w.x = x;
      w.z = z;
      w.heading = heading;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      w.x += (x - w.x) * k;
      w.z += (z - w.z) * k;
      w.heading = heading;
    }
  }

  /** Walk everyone on; anyone a car's coming at steps aside. */
  update(dt: number, time: number, car: { x: number; z: number; speed: number }): void {
    // People are about where you are: anyone far off turns up on a pavement nearer you.
    for (let n = 0; n < 4; n++) {
      const w = this.walkers[this.recycle++ % this.walkers.length];
      if ((w.x - car.x) ** 2 + (w.z - car.z) ** 2 > 300 * 300) {
        const a = this.rng() * Math.PI * 2;
        const r = 80 + this.rng() * 200;
        const hit = this.field.nearest(car.x + Math.cos(a) * r, car.z + Math.sin(a) * r, 30);
        if (hit) {
          w.k = hit.k;
          w.s = hit.s;
          w.dodge = 0;
          this.place(w, 0);
        }
      }
    }
    for (const w of this.walkers) {
      w.s += w.speed * w.dir * dt;
      const d = Math.hypot(car.x - w.x, car.z - w.z);
      const threat = d < 9 && car.speed > 2;
      w.dodge = damp(w.dodge, threat ? 2.2 : 0, threat ? 14 : 2, dt);
      // Too close (you came round a corner fast): a quick hop clear.
      if (d < 2.4 && car.speed > 2) w.dodge = 2.6;
      this.place(w, dt);
    }
    this.draw(time);
  }

  private draw(time: number): void {
    this.walkers.forEach((w, i) => {
      const step = (time + w.phase) * w.speed * 4.2;
      const bob = Math.abs(Math.sin(step)) * 0.05;
      this.q.setFromAxisAngle(this.up, w.heading);
      this.m.compose(this.v.set(w.x, 0.14 + bob, w.z), this.q, this.sc);
      this.bodies.setMatrixAt(i, this.m);
      this.heads.setMatrixAt(i, this.m);
      // Legs swing from the hips.
      for (const side of [-1, 1]) {
        const swing = Math.sin(step) * 0.45 * side;
        const hipX = Math.cos(w.heading) * 0.11 * side;
        const hipZ = -Math.sin(w.heading) * 0.11 * side;
        const leg = new THREE.Quaternion()
          .setFromAxisAngle(this.up, w.heading)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), swing));
        this.m.compose(this.v.set(w.x + hipX, 0.94 + bob, w.z + hipZ), leg, this.sc);
        this.legs.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }
}
