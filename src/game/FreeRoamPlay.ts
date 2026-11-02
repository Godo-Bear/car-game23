import * as THREE from 'three';
import type { CityCourseId } from '../../shared/api';
import type { AudioEngine } from '../core/AudioEngine';
import type { RaceSimulation } from '../race/RaceSimulation';
import { CITY_COURSE_DEFS } from '../track/tracks';
import type { Hud } from '../ui/Hud';
import { type FreeActivities, JUMP_STARS, starsFor, TRAP_STARS, ZONE_STARS } from '../world/activities';
import { glowTexture } from '../world/textures';

const KEY = 'tokyo-circuit.freeroam.v1';

/** Your free drive records (kept on this device). */
export interface FreeProgress {
  /** Lucky cats found (their indices). */
  cats: number[];
  /** Best speed past each speed trap (km/h), longest jump off each ramp (m), best score in each drift zone. */
  traps: Record<string, number>;
  jumps: Record<string, number>;
  zones: Record<string, number>;
}

function load(): FreeProgress {
  const fresh: FreeProgress = { cats: [], traps: {}, jumps: {}, zones: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return fresh;
    const nums = (o: unknown) =>
      Object.fromEntries(
        Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0),
      ) as Record<string, number>;
    return {
      cats: Array.isArray(raw.cats) ? raw.cats.filter((n: unknown) => Number.isInteger(n)) : [],
      traps: nums(raw.traps),
      jumps: nums(raw.jumps),
      zones: nums(raw.zones),
    };
  } catch {
    return fresh;
  }
}

const STAR = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/**
 * Free drive's things to do, while you drive: stop in a race marker to race that city course,
 * find the lucky cats, set speeds past the speed traps, fly off the ramps and score in the drift
 * zones. Draws the markers and cats, calls out records, and keeps your progress.
 */
export class FreeRoamPlay {
  readonly group = new THREE.Group();
  readonly progress = load();
  private acts: FreeActivities | null = null;
  private cats: THREE.Object3D[] = [];
  private markers: THREE.Object3D[] = [];
  private readonly trapWait = new Map<string, number>();
  private zone: { id: string; start: number; shown: number } | null = null;
  private takeoff: { x: number; z: number; ramp: string | null; t: number } | null = null;
  private wasGrounded = true;
  private hold = 0;
  private holdCourse: CityCourseId | null = null;
  private readonly beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 0.7, 0.15),
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly catMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.85, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.5 });
  private readonly glow = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xffd34d,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor(
    private readonly hud: Hud,
    private readonly audio: AudioEngine,
    /** Stopped in a race marker: race that course. */
    private readonly onRace: (course: CityCourseId) => void,
  ) {
    this.group.name = 'free-activities';
  }

  /** The free drive map's activities (null to hide them, outside free drive). */
  setActivities(acts: FreeActivities | null, groundAt?: (x: number, z: number) => number): void {
    this.group.clear();
    this.cats = [];
    this.markers = [];
    this.acts = acts;
    this.zone = null;
    this.takeoff = null;
    this.hold = 0;
    if (!acts) return;
    const beamGeo = new THREE.CylinderGeometry(5, 5, 70, 28, 1, true);
    const ringGeo = new THREE.RingGeometry(7.5, 9, 40).rotateX(-Math.PI / 2);
    for (const m of acts.markers) {
      const g = new THREE.Group();
      const y = groundAt?.(m.x, m.z) ?? 0;
      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.position.y = 35;
      const ring = new THREE.Mesh(ringGeo, this.beamMat);
      ring.position.y = 0.2;
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture(`🏁 ${CITY_COURSE_DEFS[m.course].name}`, 'Stop here to race'), depthWrite: false }),
      );
      label.scale.set(18, 4.5, 1);
      label.position.y = 9;
      g.add(beam, ring, label);
      g.position.set(m.x, y, m.z);
      this.group.add(g);
      this.markers.push(g);
    }
    const body = new THREE.SphereGeometry(0.55, 14, 10);
    const head = new THREE.SphereGeometry(0.45, 14, 10);
    const ear = new THREE.ConeGeometry(0.16, 0.32, 8);
    const paw = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8);
    acts.cats.forEach((c, i) => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(body, this.catMat);
      b.scale.set(1, 1.1, 0.9);
      const h = new THREE.Mesh(head, this.catMat);
      h.position.y = 0.85;
      const e1 = new THREE.Mesh(ear, this.catMat);
      e1.position.set(-0.24, 1.25, 0);
      const e2 = e1.clone();
      e2.position.x = 0.24;
      const p = new THREE.Mesh(paw, this.catMat);
      p.position.set(0.5, 0.9, 0);
      p.rotation.z = -0.3;
      const glow = new THREE.Sprite(this.glow);
      glow.scale.setScalar(3.5);
      glow.position.y = 0.6;
      g.add(b, h, e1, e2, p, glow);
      g.position.set(c.x, c.y + 0.6, c.z);
      g.visible = !this.progress.cats.includes(i);
      this.group.add(g);
      this.cats.push(g);
    });
    this.group.traverse((o) => {
      o.userData.noAO = true;
    });
  }

  /** One frame of free drive: what you're doing near the activities. */
  update(sim: RaceSimulation, driftPoints: number, dt: number, elapsed: number): void {
    const acts = this.acts;
    if (!acts) return;
    const car = sim.player;
    const p = car.physics;
    for (const c of this.cats) {
      if (!c.visible) continue;
      c.rotation.y = elapsed * 1.8;
      c.children[0].position.y = Math.sin(elapsed * 3) * 0.05;
    }
    this.beamMat.opacity = 0.26 + Math.sin(elapsed * 2.5) * 0.06;

    // Lucky cats.
    acts.cats.forEach((c, i) => {
      if (!this.cats[i].visible || (c.x - p.x) ** 2 + (c.z - p.z) ** 2 > 3.4 ** 2 || Math.abs(c.y - p.y) > 3) return;
      this.cats[i].visible = false;
      this.progress.cats.push(i);
      this.save();
      this.audio.item(0);
      this.hud.showBoost(`LUCKY CAT! ${this.progress.cats.length}/${acts.cats.length}`, 'super');
    });

    // Speed traps: the camera clocks you as you go by.
    for (const t of acts.traps) {
      const wait = (this.trapWait.get(t.id) ?? 0) - dt;
      this.trapWait.set(t.id, wait);
      if (wait > 0 || (t.x - p.x) ** 2 + (t.z - p.z) ** 2 > 11 ** 2) continue;
      this.trapWait.set(t.id, 4);
      const kmh = Math.round(p.speedKmh);
      if (kmh < 40) continue;
      const best = this.progress.traps[t.id] ?? 0;
      const record = kmh > best;
      if (record) this.progress.traps[t.id] = kmh;
      this.save();
      this.audio.item(record ? 0 : 1);
      this.hud.showMessage(
        `📸 ${t.name}: ${kmh} km/h ${STAR(starsFor(Math.max(kmh, best), TRAP_STARS))}${record && best ? ' · NEW RECORD!' : ''}`,
        2.5,
        record ? 'gold' : 'small',
      );
    }

    // Jumps: from leaving the ground to landing again.
    const grounded = car.grounded;
    if (this.wasGrounded && !grounded) {
      const ramp = acts.ramps.find((r) => Math.hypot(r.x + Math.sin(r.heading) * (r.length / 2) - p.x, r.z + Math.cos(r.heading) * (r.length / 2) - p.z) < 7);
      this.takeoff = { x: p.x, z: p.z, ramp: ramp?.id ?? null, t: sim.time };
    } else if (!this.wasGrounded && grounded && this.takeoff) {
      const air = sim.time - this.takeoff.t;
      const dist = Math.round(Math.hypot(p.x - this.takeoff.x, p.z - this.takeoff.z));
      const id = this.takeoff.ramp;
      if (id && dist >= 5) {
        const ramp = acts.ramps.find((r) => r.id === id)!;
        const best = this.progress.jumps[id] ?? 0;
        const record = dist > best;
        if (record) this.progress.jumps[id] = dist;
        this.save();
        this.audio.item(record ? 0 : 1);
        this.hud.showMessage(
          `🛫 ${ramp.name}: ${dist} m ${STAR(starsFor(Math.max(dist, best), JUMP_STARS))}${record && best ? ' · NEW RECORD!' : ''}`,
          2.5,
          record ? 'gold' : 'small',
        );
      } else if (air > 0.9 && dist > 20) {
        this.hud.showBoost(`BIG AIR ${dist} m`, 'perfect');
      }
      this.takeoff = null;
    }
    this.wasGrounded = grounded;

    // Drift zones: points scored from driving in to driving out.
    const inZone = acts.zones.find((z) => (z.x - p.x) ** 2 + (z.z - p.z) ** 2 < z.r * z.r);
    if (inZone && !this.zone) {
      this.zone = { id: inZone.id, start: driftPoints, shown: 0 };
      this.hud.showMessage(`🌀 DRIFT ZONE · ${inZone.name}`, 1.6, 'gold');
    } else if (this.zone && (!inZone || inZone.id !== this.zone.id)) {
      const z = acts.zones.find((x) => x.id === this.zone!.id)!;
      const score = Math.max(0, driftPoints - this.zone.start);
      const best = this.progress.zones[z.id] ?? 0;
      const record = score > best;
      if (record) this.progress.zones[z.id] = score;
      this.save();
      if (score > 0) {
        this.audio.item(record ? 0 : 1);
        this.hud.showMessage(
          `🌀 ${z.name}: ${score.toLocaleString('en-US')} ${STAR(starsFor(Math.max(score, best), ZONE_STARS))}${record && best ? ' · NEW RECORD!' : ''}`,
          2.5,
          record ? 'gold' : 'small',
        );
      }
      this.zone = null;
    } else if (this.zone) {
      const score = Math.max(0, driftPoints - this.zone.start);
      if (score !== this.zone.shown) {
        this.zone.shown = score;
        this.hud.showBoost(`ZONE ${score.toLocaleString('en-US')}`, 'perfect');
      }
    }

    // Race markers: stop in one to race that course.
    const marker = acts.markers.find((m) => (m.x - p.x) ** 2 + (m.z - p.z) ** 2 < 10 * 10);
    if (marker) {
      const name = CITY_COURSE_DEFS[marker.course].name;
      if (p.speed < 3) {
        if (this.holdCourse !== marker.course) this.hold = 0;
        this.holdCourse = marker.course;
        this.hold += dt;
        this.hud.showMessage(`🏁 ${name} · starting…`, 0.3, 'gold');
        if (this.hold > 1.2) {
          this.hold = 0;
          this.holdCourse = null;
          this.onRace(marker.course);
        }
      } else {
        this.hold = 0;
        this.hud.showMessage(`🏁 ${name} · stop here to race (2 laps, items on)`, 0.3, 'small');
      }
    } else this.hold = 0;
  }

  /** "🐱 4/30 · ★7/54" for the HUD and the map. */
  summary(): string {
    const acts = this.acts;
    if (!acts) return '';
    const stars =
      acts.traps.reduce((s, t) => s + starsFor(this.progress.traps[t.id] ?? 0, TRAP_STARS), 0) +
      acts.ramps.reduce((s, r) => s + starsFor(this.progress.jumps[r.id] ?? 0, JUMP_STARS), 0) +
      acts.zones.reduce((s, z) => s + starsFor(this.progress.zones[z.id] ?? 0, ZONE_STARS), 0);
    const max = (acts.traps.length + acts.ramps.length + acts.zones.length) * 3;
    return `🐱 ${this.progress.cats.length}/${acts.cats.length} lucky cats · ★ ${stars}/${max}`;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.progress));
    } catch {
      // Not kept this time.
    }
  }
}

/** A floating name board over a race marker. */
function labelTexture(title: string, sub: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 8, 30, 0.82)';
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 24);
  g.fill();
  g.strokeStyle = '#ffb02e';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = 'bold 48px system-ui, sans-serif';
  g.fillText(title, 256, 62);
  g.font = '28px system-ui, sans-serif';
  g.fillStyle = '#ffd38a';
  g.fillText(sub, 256, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
