import { clamp } from './math';
import type { VehicleControls } from '../physics/VehiclePhysics';

export type Action = 'pause' | 'camera' | 'reset' | 'mute' | 'confirm' | 'controls';

/** Keyboard bindings. Shown verbatim in the Controls panel, so keep labels human-friendly. */
export const KEY_BINDINGS: { action: string; keys: string[]; codes: string[] }[] = [
  { action: 'Accelerate', keys: ['W', '↑'], codes: ['KeyW', 'ArrowUp'] },
  { action: 'Brake / Reverse', keys: ['S', '↓'], codes: ['KeyS', 'ArrowDown'] },
  { action: 'Steer left', keys: ['A', '←'], codes: ['KeyA', 'ArrowLeft'] },
  { action: 'Steer right', keys: ['D', '→'], codes: ['KeyD', 'ArrowRight'] },
  { action: 'Handbrake / drift', keys: ['Space'], codes: ['Space'] },
  { action: 'Change camera', keys: ['C'], codes: ['KeyC'] },
  { action: 'Reset car to track', keys: ['R'], codes: ['KeyR'] },
  { action: 'Pause', keys: ['Esc', 'P'], codes: ['Escape', 'KeyP'] },
  { action: 'Show controls', keys: ['H'], codes: ['KeyH'] },
  { action: 'Mute sound', keys: ['M'], codes: ['KeyM'] },
];

export const GAMEPAD_BINDINGS: { action: string; button: string }[] = [
  { action: 'Accelerate', button: 'Right trigger (RT / R2)' },
  { action: 'Brake / Reverse', button: 'Left trigger (LT / L2)' },
  { action: 'Steer', button: 'Left stick' },
  { action: 'Handbrake / drift', button: 'A / Cross' },
  { action: 'Change camera', button: 'Y / Triangle' },
  { action: 'Reset car', button: 'View / Share' },
  { action: 'Pause', button: 'Menu / Options' },
];

const ACTION_CODES: Record<Action, string[]> = {
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  mute: ['KeyM'],
  confirm: ['Enter'],
  controls: ['KeyH'],
};

const GAMEPAD_ACTIONS: Partial<Record<Action, number>> = { camera: 3, reset: 8, pause: 9, confirm: 0 };
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private padPrev: boolean[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        for (const [action, codes] of Object.entries(ACTION_CODES) as [Action, string[]][]) {
          if (codes.includes(e.code)) this.pressed.add(action);
        }
      }
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** True once per press of the action's key/button. */
  consume(action: Action): boolean {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  clearActions(): void {
    this.pressed.clear();
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** Poll keyboard + first connected gamepad into `controls`. */
  update(): VehicleControls {
    const c = this.controls;
    let throttle = this.any('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.any('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0);
    let handbrake = this.any('Space');

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) steer = clamp(steer + Math.sign(axis) * ((Math.abs(axis) - 0.12) / 0.88), -1, 1);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake ||= pad.buttons[0]?.pressed ?? false;
      for (const [action, index] of Object.entries(GAMEPAD_ACTIONS) as [Action, number][]) {
        const now = pad.buttons[index]?.pressed ?? false;
        if (now && !this.padPrev[index]) this.pressed.add(action);
      }
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    c.throttle = throttle;
    c.brake = brake;
    c.steer = steer;
    c.handbrake = handbrake;
    return c;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
