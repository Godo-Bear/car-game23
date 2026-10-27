import type { VehicleControls } from '../physics/VehiclePhysics';
import { clamp } from './math';
import { type ActionId, DEFAULT_BINDINGS } from './Settings';

/** One-shot actions the game reacts to (on press, not while held). */
export type Action = 'pause' | 'camera' | 'reset' | 'mute' | 'confirm' | 'controls' | 'skip';

export const GAMEPAD_BINDINGS: { action: string; button: string }[] = [
  { action: 'Accelerate', button: 'Right trigger (RT / R2)' },
  { action: 'Brake / Reverse', button: 'Left trigger (LT / L2)' },
  { action: 'Steer', button: 'Left stick' },
  { action: 'Handbrake / drift', button: 'A / Cross' },
  { action: 'Nitro', button: 'X / Square or RB / R1' },
  { action: 'Change camera', button: 'Y / Triangle' },
  { action: 'Reset car', button: 'View / Share' },
  { action: 'Pause', button: 'Menu / Options' },
];

const EDGE_ACTIONS: Partial<Record<ActionId, Action>> = {
  camera: 'camera',
  reset: 'reset',
  pause: 'pause',
  controls: 'controls',
  mute: 'mute',
};
const GAMEPAD_ACTIONS: Partial<Record<Action, number>> = { camera: 3, reset: 8, pause: 9, confirm: 0 };
const NO_SCROLL = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  private readonly down = new Set<string>();
  private readonly pressed = new Set<Action>();
  private padPrev: boolean[] = [];
  /** code -> actions bound to it */
  private byCode = new Map<string, ActionId[]>();
  private capture: ((code: string | null) => void) | null = null;

  constructor(target: Window = window) {
    this.setBindings(DEFAULT_BINDINGS);
    target.addEventListener(
      'keydown',
      (e) => {
        if (this.capture) {
          // Rebinding: swallow the key and hand it to the settings screen (Escape cancels).
          e.preventDefault();
          e.stopImmediatePropagation();
          const done = this.capture;
          this.capture = null;
          done(e.code === 'Escape' ? null : e.code);
          return;
        }
        if (isTyping(e.target)) return;
        if (NO_SCROLL.has(e.code)) e.preventDefault();
        if (!e.repeat) {
          if (e.code === 'Escape') this.pressed.add('pause');
          if (e.code === 'Enter') this.pressed.add('confirm');
          for (const id of this.byCode.get(e.code) ?? []) {
            const action = EDGE_ACTIONS[id];
            if (action) this.pressed.add(action);
          }
          // Any key skips a cinematic.
          this.pressed.add('skip');
        }
        this.down.add(e.code);
      },
      true,
    );
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  setBindings(bindings: Record<ActionId, string[]>): void {
    this.byCode = new Map();
    for (const [id, codes] of Object.entries(bindings) as [ActionId, string[]][]) {
      for (const code of codes) {
        if (!code) continue;
        const list = this.byCode.get(code) ?? [];
        list.push(id);
        this.byCode.set(code, list);
      }
    }
  }

  /** Deliver the next key press to `fn` instead of the game (null if Escape cancelled). */
  captureNextKey(fn: (code: string | null) => void): void {
    this.capture = fn;
  }

  cancelCapture(): void {
    this.capture = null;
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

  private held(action: ActionId): boolean {
    for (const code of this.down) if (this.byCode.get(code)?.includes(action)) return true;
    return false;
  }

  /** Poll keyboard + first connected gamepad into `controls`. */
  update(): VehicleControls {
    const c = this.controls;
    let throttle = this.held('accelerate') ? 1 : 0;
    let brake = this.held('brake') ? 1 : 0;
    let steer = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let handbrake = this.held('handbrake');
    let nitro = this.held('nitro');

    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) steer = clamp(steer + Math.sign(axis) * ((Math.abs(axis) - 0.12) / 0.88), -1, 1);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake ||= pad.buttons[0]?.pressed ?? false;
      nitro ||= (pad.buttons[2]?.pressed || pad.buttons[5]?.pressed) ?? false;
      for (const [action, index] of Object.entries(GAMEPAD_ACTIONS) as [Action, number][]) {
        const now = pad.buttons[index]?.pressed ?? false;
        if (now && !this.padPrev[index]) {
          this.pressed.add(action);
          this.pressed.add('skip');
        }
      }
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    c.throttle = throttle;
    c.brake = brake;
    c.steer = steer;
    c.handbrake = handbrake;
    c.nitro = nitro;
    return c;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
