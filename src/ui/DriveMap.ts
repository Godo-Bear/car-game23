import type { FreeProgress } from '../game/FreeRoamPlay';
import { CITY_COURSE_DEFS } from '../track/tracks';
import type { FreeActivities } from '../world/activities';
import { FREE_DRIVE_SPOTS, mapFraction, mapPosition } from '../world/freeDrive';
import { SPOT_ICON } from './Screens';

/**
 * Free drive: the map, over the paused game. It shows where you are; tap a starting-place pin to
 * go there, or anywhere else to go to the nearest road.
 */
export class DriveMap {
  private readonly root = document.getElementById('drive-map')!;
  private readonly frame = document.getElementById('drive-map-frame')!;
  private readonly me = document.getElementById('drive-map-me')!;
  private readonly acts = document.createElement('div');

  constructor(
    private readonly onTeleport: (to: { x: number; z: number; heading?: number }) => void,
    private readonly onClose: () => void,
  ) {
    for (const spot of FREE_DRIVE_SPOTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin spot';
      const [fx, fy] = mapFraction(spot.x, spot.z);
      b.style.left = `${fx * 100}%`;
      b.style.top = `${fy * 100}%`;
      const icon = document.createElement('span');
      icon.className = 'pin-icon';
      icon.innerHTML = SPOT_ICON;
      const label = document.createElement('span');
      label.className = 'pin-label';
      label.textContent = spot.name;
      b.append(icon, label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTeleport(spot);
      });
      this.frame.append(b);
    }
    this.acts.className = 'drive-map-acts';
    this.frame.append(this.acts);
    this.frame.addEventListener('click', (e) => {
      const r = this.frame.getBoundingClientRect();
      const [x, z] = mapPosition((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      this.onTeleport({ x, z });
    });
    document.getElementById('drive-map-close')!.addEventListener('click', () => this.onClose());
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show the map with you on it (heading: radians, 0 = +z, which is down the picture). */
  open(x: number, z: number, heading: number, acts: FreeActivities | null = null, progress?: FreeProgress, summary = ''): void {
    this.showActivities(acts, progress);
    document.getElementById('drive-map-summary')!.textContent = summary;
    const [fx, fy] = mapFraction(x, z);
    this.me.style.left = `${fx * 100}%`;
    this.me.style.top = `${fy * 100}%`;
    // The arrow points up the picture (-z) at rest; turn it to face the heading.
    this.me.style.transform = `translate(-50%, -50%) rotate(${Math.PI - heading}rad)`;
    this.root.classList.remove('hidden');
    this.frame.querySelector<HTMLElement>('.pin')?.focus({ preventScroll: true });
  }

  /** Race markers (tap one to go there), speed traps, ramps, drift zones and the lucky cats found so far. */
  private showActivities(acts: FreeActivities | null, progress?: FreeProgress): void {
    this.acts.replaceChildren();
    if (!acts) return;
    const icon = (x: number, z: number, glyph: string, title: string, cls: string, go?: { x: number; z: number; heading: number }) => {
      const el = document.createElement(go ? 'button' : 'span');
      el.className = `act ${cls}`;
      el.textContent = glyph;
      el.title = title;
      const [fx, fy] = mapFraction(x, z);
      el.style.left = `${fx * 100}%`;
      el.style.top = `${fy * 100}%`;
      if (go) {
        (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onTeleport(go);
        });
      }
      this.acts.append(el);
    };
    for (const m of acts.markers) icon(m.x, m.z, '🏁', `${CITY_COURSE_DEFS[m.course].name} - race`, 'race', { x: m.x, z: m.z, heading: m.heading });
    for (const t of acts.traps) icon(t.x, t.z, '📸', `${t.name}${progress?.traps[t.id] ? ` · best ${progress.traps[t.id]} km/h` : ''}`, 'trap');
    for (const r of acts.ramps) icon(r.x, r.z, '🛫', `${r.name}${progress?.jumps[r.id] ? ` · best ${progress.jumps[r.id]} m` : ''}`, 'ramp');
    for (const z of acts.zones)
      icon(z.x, z.z, '🌀', `${z.name}${progress?.zones[z.id] ? ` · best ${progress.zones[z.id].toLocaleString('en-US')}` : ''}`, 'zone');
    for (const i of progress?.cats ?? []) {
      const c = acts.cats[i];
      if (c) icon(c.x, c.z, '🐱', 'Lucky cat (found)', 'cat');
    }
  }

  close(): void {
    this.root.classList.add('hidden');
  }
}
