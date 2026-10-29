/**
 * Drive the menus with a gamepad: the D-pad or left stick moves between buttons (to the nearest
 * one in that direction), A presses, B goes back, LB / RB switch the bottom-bar tabs, and on a
 * slider left/right changes its value. Runs while a menu is on screen (not while racing).
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const LAYERS = ['modal-auth', 'modal-settings', 'screen-pause', 'screen-results', 'screen-home'];
const TABS = ['home', 'career', 'garage', 'shop', 'quests', 'profile'];
/** Stick/D-pad auto-repeat: first delay, then the interval. */
const REPEAT_FIRST = 0.38;
const REPEAT_NEXT = 0.13;

type Dir = 'up' | 'down' | 'left' | 'right';

export class GamepadMenu {
  private prev: boolean[] = [];
  private held: Dir | null = null;
  private repeat = 0;

  constructor() {
    // The mouse or a finger takes over again: drop the gamepad focus ring.
    window.addEventListener('pointerdown', () => document.documentElement.classList.remove('gamepad'), true);
  }

  update(dt: number, active: boolean): void {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (!pad) return;
    const now = pad.buttons.map((b) => b.pressed);
    const before = this.prev;
    const pressed = (i: number) => now[i] && !before[i];
    this.prev = now;
    if (!active) {
      this.held = null;
      return;
    }

    // Direction from the D-pad or the left stick, repeating while held.
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const dir: Dir | null = now[12] || ay < -0.6 ? 'up' : now[13] || ay > 0.6 ? 'down' : now[14] || ax < -0.6 ? 'left' : now[15] || ax > 0.6 ? 'right' : null;
    if (dir !== this.held) {
      this.held = dir;
      this.repeat = REPEAT_FIRST;
      if (dir) this.move(dir);
    } else if (dir) {
      this.repeat -= dt;
      if (this.repeat <= 0) {
        this.repeat = REPEAT_NEXT;
        this.move(dir);
      }
    }

    if (pressed(0)) this.press();
    // B: the same as Escape (close a window, back to Home, resume).
    if (pressed(1)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    if (pressed(4)) this.switchTab(-1);
    if (pressed(5)) this.switchTab(1);
  }

  /** The topmost visible menu layer. */
  private layer(): HTMLElement | null {
    for (const id of LAYERS) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return el;
    }
    return null;
  }

  private candidates(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
      if (!el.getClientRects().length) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    });
  }

  private focus(el: HTMLElement): void {
    document.documentElement.classList.add('gamepad');
    document.querySelectorAll('.pad-focus').forEach((e) => e.classList.remove('pad-focus'));
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private move(dir: Dir): void {
    const root = this.layer();
    if (!root) return;
    const current = document.activeElement as HTMLElement | null;
    // Sliders take left/right as a value change.
    if (current instanceof HTMLInputElement && current.type === 'range' && (dir === 'left' || dir === 'right')) {
      if (dir === 'left') current.stepDown();
      else current.stepUp();
      current.dispatchEvent(new Event('input', { bubbles: true }));
      current.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const all = this.candidates(root);
    if (!current || !root.contains(current) || !all.includes(current)) {
      if (all[0]) this.focus(all[0]);
      return;
    }
    const from = current.getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const el of all) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - cx;
      const y = r.top + r.height / 2 - cy;
      // Distance along the direction, and how far off to the side it is.
      const along = dir === 'up' ? -y : dir === 'down' ? y : dir === 'left' ? -x : x;
      const side = dir === 'up' || dir === 'down' ? Math.abs(x) : Math.abs(y);
      if (along <= 4) continue;
      const score = along + side * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this.focus(best);
  }

  private press(): void {
    const el = document.activeElement as HTMLElement | null;
    const root = this.layer();
    if (!el || !root?.contains(el)) {
      const first = root && this.candidates(root)[0];
      if (first) this.focus(first);
      return;
    }
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.click();
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus();
    else el.click();
  }

  /** LB / RB: the previous / next tab of the bottom bar. */
  private switchTab(step: number): void {
    if (this.layer()?.id !== 'screen-home') return;
    const current = document.getElementById('screen-home')!.dataset.panel ?? 'home';
    const next = TABS[(TABS.indexOf(current) + step + TABS.length) % TABS.length];
    const tab = document.querySelector<HTMLElement>(`.hub-nav [data-panel="${next}"]`);
    if (!tab) return;
    tab.click();
    this.focus(tab);
  }
}
