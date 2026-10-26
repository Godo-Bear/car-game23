import { clamp } from './math';

/**
 * Per-device preferences: graphics quality, audio levels and key bindings. Stored in this
 * browser (graphics hardware and keyboards differ per machine, so they're not synced to the
 * account like race setup is).
 */

export type Quality = 'low' | 'medium' | 'high';

export type ActionId = 'accelerate' | 'brake' | 'left' | 'right' | 'handbrake' | 'camera' | 'reset' | 'pause' | 'controls' | 'mute';

export const ACTIONS: { id: ActionId; label: string }[] = [
  { id: 'accelerate', label: 'Accelerate' },
  { id: 'brake', label: 'Brake / Reverse' },
  { id: 'left', label: 'Steer left' },
  { id: 'right', label: 'Steer right' },
  { id: 'handbrake', label: 'Handbrake / drift' },
  { id: 'camera', label: 'Change camera' },
  { id: 'reset', label: 'Reset car to track' },
  { id: 'pause', label: 'Pause' },
  { id: 'controls', label: 'Controls & settings' },
  { id: 'mute', label: 'Mute sound' },
];

/** Two slots per action. Escape and Enter are fixed (pause/back and confirm). */
export const DEFAULT_BINDINGS: Record<ActionId, string[]> = {
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space', ''],
  camera: ['KeyC', ''],
  reset: ['KeyR', ''],
  pause: ['KeyP', ''],
  controls: ['KeyH', ''],
  mute: ['KeyM', ''],
};

export const RESERVED_KEYS = new Set(['Escape', 'Enter']);

export interface Volumes {
  master: number;
  engine: number;
  effects: number;
}

export interface LocalSettings {
  quality: Quality;
  /** Speed blur and speed lines. */
  motionBlur: boolean;
  cameraShake: boolean;
  volume: Volumes;
  bindings: Record<ActionId, string[]>;
}

const KEY = 'tokyo-circuit.settings.v1';

function cloneBindings(b: Record<ActionId, string[]>): Record<ActionId, string[]> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]])) as Record<ActionId, string[]>;
}

/** A sensible starting quality: integrated / mobile GPUs get Low or Medium. */
export function detectQuality(gpu = ''): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (/Intel|Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe/i.test(gpu)) return 'medium';
  return (navigator.hardwareConcurrency ?? 4) >= 8 ? 'high' : 'medium';
}

export function defaultSettings(gpu = ''): LocalSettings {
  return {
    quality: detectQuality(gpu),
    motionBlur: true,
    cameraShake: true,
    volume: { master: 0.8, engine: 0.8, effects: 0.8 },
    bindings: cloneBindings(DEFAULT_BINDINGS),
  };
}

export class SettingsStore {
  value: LocalSettings;
  private readonly listeners = new Set<(s: LocalSettings) => void>();

  constructor(gpu = '') {
    const defaults = defaultSettings(gpu);
    this.value = defaults;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.value = sanitize(JSON.parse(raw), defaults);
    } catch {
      // Storage blocked or corrupt: keep defaults.
    }
  }

  onChange(fn: (s: LocalSettings) => void): void {
    this.listeners.add(fn);
  }

  update(patch: Partial<LocalSettings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Not persisted this session; still applied.
    }
    for (const fn of this.listeners) fn(this.value);
  }

  /** Assign `code` to `action` slot; if another action used it, that slot is cleared (moved). */
  bind(action: ActionId, slot: number, code: string): void {
    const bindings = cloneBindings(this.value.bindings);
    for (const id of Object.keys(bindings) as ActionId[]) {
      bindings[id] = bindings[id].map((c) => (c === code ? '' : c));
    }
    bindings[action][slot] = code;
    this.update({ bindings });
  }

  clearBinding(action: ActionId, slot: number): void {
    const bindings = cloneBindings(this.value.bindings);
    bindings[action][slot] = '';
    this.update({ bindings });
  }

  resetBindings(): void {
    this.update({ bindings: cloneBindings(DEFAULT_BINDINGS) });
  }
}

function sanitize(raw: Partial<LocalSettings>, defaults: LocalSettings): LocalSettings {
  const quality = raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high' ? raw.quality : defaults.quality;
  const vol = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
  const bindings = cloneBindings(DEFAULT_BINDINGS);
  if (raw.bindings && typeof raw.bindings === 'object') {
    for (const id of Object.keys(bindings) as ActionId[]) {
      const b = (raw.bindings as Record<string, unknown>)[id];
      if (Array.isArray(b)) bindings[id] = [0, 1].map((i) => (typeof b[i] === 'string' && !RESERVED_KEYS.has(b[i]) ? b[i] : ''));
    }
  }
  return {
    quality,
    motionBlur: typeof raw.motionBlur === 'boolean' ? raw.motionBlur : defaults.motionBlur,
    cameraShake: typeof raw.cameraShake === 'boolean' ? raw.cameraShake : defaults.cameraShake,
    volume: {
      master: vol(raw.volume?.master, defaults.volume.master),
      engine: vol(raw.volume?.engine, defaults.volume.engine),
      effects: vol(raw.volume?.effects, defaults.volume.effects),
    },
    bindings,
  };
}

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Meta',
  MetaRight: 'R Meta',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** Human-readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
