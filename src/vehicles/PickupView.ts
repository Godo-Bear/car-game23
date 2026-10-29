import * as THREE from 'three';
import type { Pickup } from '../race/Pickups';
import { glowTexture } from '../world/textures';

/**
 * The nitro pickups on the road: a glowing bottle (blue, or gold for a super boost) spinning
 * and bobbing over a pool of light, hidden while it's away after being collected.
 */
export class PickupView {
  readonly group = new THREE.Group();
  private items: { pickup: Pickup; root: THREE.Group; spin: THREE.Group }[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  /** Build the bottles for a race's pickups (replacing any from before). */
  setPickups(pickups: Pickup[]): void {
    this.clear();
    const body = this.geo(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 16));
    const neck = this.geo(new THREE.CylinderGeometry(0.14, 0.22, 0.28, 12));
    neck.translate(0, 0.59, 0);
    const cap = this.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12));
    cap.translate(0, 0.79, 0);
    const band = this.geo(new THREE.TorusGeometry(0.33, 0.05, 8, 24));
    band.rotateX(Math.PI / 2);
    const pool = this.geo(new THREE.PlaneGeometry(4.2, 4.2));
    pool.rotateX(-Math.PI / 2);
    const look = {
      nitro: { glass: new THREE.Color(0.02, 0.28, 1.25), band: 0x9fdcff, pool: 0x2f8cff },
      super: { glass: new THREE.Color(1.7, 0.95, 0.08), band: 0xfff1b0, pool: 0xffb02e },
    };
    const mats = Object.fromEntries(
      Object.entries(look).map(([kind, c]) => [
        kind,
        {
          // Bright enough to bloom.
          glass: this.mat(new THREE.MeshBasicMaterial({ color: c.glass, transparent: true, opacity: 0.92 })),
          trim: this.mat(new THREE.MeshStandardMaterial({ color: c.band, metalness: 0.9, roughness: 0.2, emissive: c.band, emissiveIntensity: 0.4 })),
          pool: this.mat(
            new THREE.MeshBasicMaterial({
              color: c.pool,
              map: glowTexture(),
              transparent: true,
              opacity: 0.8,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          ),
        },
      ]),
    ) as unknown as Record<Pickup['kind'], { glass: THREE.Material; trim: THREE.Material; pool: THREE.Material }>;

    for (const pickup of pickups) {
      const m = mats[pickup.kind];
      const root = new THREE.Group();
      root.position.set(pickup.x, pickup.y, pickup.z);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(body, m.glass), new THREE.Mesh(neck, m.trim), new THREE.Mesh(cap, m.trim), new THREE.Mesh(band, m.trim));
      // Super boosts are a bigger bottle.
      spin.scale.setScalar(pickup.kind === 'super' ? 2.1 : 1.6);
      const light = new THREE.Mesh(pool, m.pool);
      light.position.y = 0.06;
      light.renderOrder = 2;
      root.add(spin, light);
      root.traverse((o) => {
        o.userData.noAO = true;
      });
      this.group.add(root);
      this.items.push({ pickup, root, spin });
    }
  }

  /** Spin and bob; hide the ones that have been taken. */
  update(raceTime: number, elapsed: number): void {
    for (const { pickup, root, spin } of this.items) {
      root.visible = raceTime >= pickup.backAt;
      if (!root.visible) continue;
      spin.rotation.y = elapsed * 2.2 + pickup.distance;
      spin.position.y = 1.5 + Math.sin(elapsed * 3 + pickup.distance) * 0.2;
    }
  }

  private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private clear(): void {
    this.group.clear();
    this.items = [];
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
  }
}
