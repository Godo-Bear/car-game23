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
  open(x: number, z: number, heading: number): void {
    const [fx, fy] = mapFraction(x, z);
    this.me.style.left = `${fx * 100}%`;
    this.me.style.top = `${fy * 100}%`;
    // The arrow points up the picture (-z) at rest; turn it to face the heading.
    this.me.style.transform = `translate(-50%, -50%) rotate(${Math.PI - heading}rad)`;
    this.root.classList.remove('hidden');
    this.frame.querySelector<HTMLElement>('.pin')?.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.add('hidden');
  }
}
