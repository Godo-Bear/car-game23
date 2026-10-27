import { GAMEPAD_BINDINGS, type Input } from '../core/Input';
import { ACTIONS, type ActionId, keyLabel, type Quality, type SettingsStore } from '../core/Settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type SettingsTab = 'graphics' | 'audio' | 'controls';

const QUALITY_BLURB: Record<Quality, string> = {
  low: 'Fastest. Lower resolution, no shadows or ambient occlusion, fewer trees. For older laptops and phones.',
  medium: 'Balanced. Smooth edges, sun shadows, contact shading and full scenery.',
  high: 'Best looking. Full resolution, sharper shadows and real-time ambient occlusion. Needs a good graphics card.',
};

/** The Settings window: graphics quality, audio levels and keyboard rebinding. */
export class SettingsPanel {
  private listening: { action: ActionId; slot: number } | null = null;

  constructor(
    private readonly store: SettingsStore,
    private readonly input: Input,
    private readonly onOpenChange: (open: boolean) => void,
  ) {
    $('controls-gamepad').innerHTML = GAMEPAD_BINDINGS.map((b) => `<tr><td>${b.action}</td><td>${b.button}</td></tr>`).join('');
    this.wire();
    this.render();
    store.onChange(() => this.render());
  }

  get isOpen(): boolean {
    return !$('modal-settings').classList.contains('hidden');
  }

  open(tab: SettingsTab): void {
    this.showTab(tab);
    $('modal-settings').classList.remove('hidden');
    $('settings-close').focus({ preventScroll: true });
    this.onOpenChange(true);
  }

  close(): void {
    this.stopListening();
    $('modal-settings').classList.add('hidden');
    this.onOpenChange(false);
  }

  private showTab(tab: SettingsTab): void {
    document.querySelectorAll<HTMLElement>('#modal-settings [data-tab]').forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll<HTMLElement>('#modal-settings [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
  }

  private render(): void {
    const s = this.store.value;
    $('set-quality')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => b.classList.toggle('active', b.dataset.value === s.quality));
    $('quality-blurb').textContent = QUALITY_BLURB[s.quality];
    $<HTMLInputElement>('set-motion-blur').checked = s.motionBlur;
    $<HTMLInputElement>('set-camera-shake').checked = s.cameraShake;
    $<HTMLInputElement>('set-auto-quality').checked = s.autoQuality;
    $<HTMLInputElement>('set-show-fps').checked = s.showFps;
    for (const key of ['master', 'engine', 'effects'] as const) {
      const input = $<HTMLInputElement>(`vol-${key}`);
      input.value = String(Math.round(s.volume[key] * 100));
      (input.nextElementSibling as HTMLOutputElement).textContent = input.value;
    }
    this.renderBindings();
  }

  private renderBindings(): void {
    const s = this.store.value;
    const rows = ACTIONS.map(({ id, label }) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = label;
      tr.append(name);
      for (const slot of [0, 1]) {
        const td = document.createElement('td');
        const btn = document.createElement('button');
        const code = s.bindings[id][slot];
        const listening = this.listening?.action === id && this.listening.slot === slot;
        btn.className = `bind-key${code ? '' : ' empty'}${listening ? ' listening' : ''}`;
        btn.textContent = listening ? 'Press a key…' : keyLabel(code);
        btn.title = code ? 'Click to change · right-click to clear' : 'Click to set';
        btn.addEventListener('click', () => this.listen(id, slot));
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.store.clearBinding(id, slot);
        });
        td.append(btn);
        tr.append(td);
      }
      return tr;
    });
    $('bind-table').replaceChildren(...rows);
  }

  private listen(action: ActionId, slot: number): void {
    this.listening = { action, slot };
    this.renderBindings();
    this.input.captureNextKey((code) => {
      this.listening = null;
      if (code && code !== 'Enter') this.store.bind(action, slot, code);
      else this.renderBindings();
    });
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = null;
    this.input.cancelCapture();
    this.renderBindings();
  }

  private wire(): void {
    document.querySelectorAll<HTMLElement>('#modal-settings [data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.stopListening();
        this.showTab(b.dataset.tab as SettingsTab);
      }),
    );
    $('set-quality').addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest('button')?.dataset.value as Quality | undefined;
      if (value) this.store.update({ quality: value });
    });
    $<HTMLInputElement>('set-motion-blur').addEventListener('change', (e) => this.store.update({ motionBlur: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('set-camera-shake').addEventListener('change', (e) => this.store.update({ cameraShake: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('set-auto-quality').addEventListener('change', (e) => this.store.update({ autoQuality: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('set-show-fps').addEventListener('change', (e) => this.store.update({ showFps: (e.target as HTMLInputElement).checked }));
    for (const key of ['master', 'engine', 'effects'] as const) {
      $<HTMLInputElement>(`vol-${key}`).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        this.store.update({ volume: { ...this.store.value.volume, [key]: v } });
      });
    }
    $('btn-reset-binds').addEventListener('click', () => {
      this.stopListening();
      this.store.resetBindings();
    });
    $('settings-close').addEventListener('click', () => this.close());
  }
}
