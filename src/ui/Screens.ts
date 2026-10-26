import { ApiError, type AccountService } from '../account/AccountService';
import { GAMEPAD_BINDINGS, KEY_BINDINGS } from '../core/Input';
import { formatTime, type RacerState } from '../race/RaceManager';
import type { PlayerSettings } from '../../shared/api';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  laps: 3,
  opponents: 7,
  difficulty: 'normal',
  assists: true,
  camera: 'chase',
};

export interface ScreenHandlers {
  onRace(settings: PlayerSettings): void;
  onSettingsChanged(settings: PlayerSettings): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** Called whenever a modal opens/closes so the game can pause input. */
  onModalChange(open: boolean): void;
}

export interface ResultsData {
  standings: RacerState[];
  playerId: number;
  colors: string[];
}

type AuthMode = 'login' | 'register';

/** Owns every menu/overlay outside the in-race HUD. */
export class Screens {
  settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  private authMode: AuthMode = 'login';
  private controlsReturnTo: 'none' | 'pause' = 'none';

  constructor(
    private readonly account: AccountService,
    private readonly handlers: ScreenHandlers,
  ) {
    this.buildControlsTables();
    this.wire();
    account.onChange(() => this.renderProfile());
  }

  // ---------- visibility ----------
  get isModalOpen(): boolean {
    return ['modal-auth', 'modal-controls'].some((id) => !$(id).classList.contains('hidden'));
  }

  get homeVisible(): boolean {
    return !$('screen-home').classList.contains('hidden');
  }

  get controlsOpen(): boolean {
    return !$('modal-controls').classList.contains('hidden');
  }

  showHome(): void {
    this.hideAll();
    $('screen-home').classList.remove('hidden');
    this.renderProfile();
    this.renderSettings();
    $('btn-race').focus({ preventScroll: true });
  }

  hideAll(): void {
    for (const id of ['screen-home', 'screen-pause', 'screen-results', 'modal-auth', 'modal-controls']) $(id).classList.add('hidden');
    this.handlers.onModalChange(false);
  }

  showPause(show: boolean): void {
    $('screen-pause').classList.toggle('hidden', !show);
    if (show) $('btn-resume').focus({ preventScroll: true });
  }

  openControls(fromPause = false): void {
    this.controlsReturnTo = fromPause ? 'pause' : 'none';
    if (fromPause) $('screen-pause').classList.add('hidden');
    $('modal-controls').classList.remove('hidden');
    $('controls-close').focus({ preventScroll: true });
    this.handlers.onModalChange(true);
  }

  closeControls(): void {
    $('modal-controls').classList.add('hidden');
    if (this.controlsReturnTo === 'pause') this.showPause(true);
    this.controlsReturnTo = 'none';
    this.handlers.onModalChange(this.isModalOpen);
  }

  toggleControls(): void {
    if (this.controlsOpen) this.closeControls();
    else this.openControls(!$('screen-pause').classList.contains('hidden'));
  }

  /** Settings from the account (or guest profile) merged over defaults. */
  loadSettings(saved: Partial<PlayerSettings>): void {
    this.settings = { ...DEFAULT_PLAYER_SETTINGS, ...saved };
    this.renderSettings();
  }

  // ---------- results ----------
  showResults(data: ResultsData, savedText: string): void {
    const me = data.standings.find((r) => r.id === data.playerId)!;
    const title = $('results-title');
    title.textContent = me.position === 1 ? 'P1 — Victory!' : me.position <= 3 ? `P${me.position} — Podium!` : `P${me.position} — Finished`;
    this.renderResultsTable(data);
    $('results-saved').textContent = savedText;
    $('screen-results').classList.remove('hidden');
    $('btn-again').focus({ preventScroll: true });
  }

  updateResults(data: ResultsData): void {
    if (!$('screen-results').classList.contains('hidden')) this.renderResultsTable(data);
  }

  setResultsSaved(text: string): void {
    $('results-saved').textContent = text;
  }

  get resultsVisible(): boolean {
    return !$('screen-results').classList.contains('hidden');
  }

  private renderResultsTable(data: ResultsData): void {
    const table = $('results-table');
    const leader = data.standings[0];
    const rows = data.standings.map((r) => {
      let time = 'Running…';
      if (r.finished && r.finishTime !== null) {
        time = r === leader ? formatTime(r.finishTime) : `+${(r.finishTime - (leader.finishTime ?? 0)).toFixed(3)}s`;
      }
      return `<tr class="${r.id === data.playerId ? 'me' : ''}"><td>${r.position}</td><td><span style="display:inline-block;width:4px;height:12px;border-radius:2px;margin-right:8px;background:${data.colors[r.id]}"></span>${escapeHtml(r.name)}</td><td>${time}</td><td>${formatTime(r.bestLapTime)}</td></tr>`;
    });
    table.innerHTML = `<tr><th>Pos</th><th>Driver</th><th>Time</th><th>Best lap</th></tr>${rows.join('')}`;
  }

  // ---------- profile ----------
  private renderProfile(): void {
    const a = this.account;
    $('profile-name').textContent = a.displayName;
    $('profile-avatar').textContent = a.displayName.slice(0, 1).toUpperCase();
    $('profile-status').textContent = a.signedIn
      ? 'Signed in · career saved to your account'
      : a.backend === 'online'
        ? 'Log in to save your career online'
        : 'Progress saved on this device';
    const s = a.stats;
    $('stat-races').textContent = String(s.races);
    $('stat-wins').textContent = String(s.wins);
    $('stat-podiums').textContent = String(s.podiums);
    $('stat-best').textContent = s.bestLap === null ? '--' : formatTime(s.bestLap);
    const list = $('recent-races');
    list.replaceChildren(
      ...(a.recent.length
        ? a.recent.map((r) => {
            const li = document.createElement('li');
            const left = document.createElement('span');
            left.textContent = `P${r.position}/${r.fieldSize} · ${r.laps} lap${r.laps > 1 ? 's' : ''} · ${r.difficulty}`;
            const right = document.createElement('span');
            right.textContent = r.bestLap === null ? '--' : formatTime(r.bestLap);
            li.append(left, right);
            return li;
          })
        : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No races yet — go set a lap time!' })]),
    );
    $('btn-login').classList.toggle('hidden', a.signedIn);
    $('btn-register').classList.toggle('hidden', a.signedIn);
    $('btn-logout').classList.toggle('hidden', !a.signedIn);
  }

  private renderSettings(): void {
    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const key = seg.dataset.setting as keyof PlayerSettings;
      const current = String(this.settings[key]);
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        const active = b.dataset.value === current;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
  }

  // ---------- auth ----------
  private openAuth(mode: AuthMode): void {
    this.authMode = mode;
    const register = mode === 'register';
    $('auth-title').textContent = register ? 'Create account' : 'Log in';
    $('auth-submit').textContent = register ? 'Create account' : 'Log in';
    $('auth-switch').textContent = register ? 'Already have an account? Log in' : 'Need an account? Create one';
    $<HTMLInputElement>('auth-password').autocomplete = register ? 'new-password' : 'current-password';
    $('auth-hint').classList.toggle('hidden', !register);
    $('auth-error').textContent = '';
    const offline = this.account.backend !== 'online';
    $('auth-offline').textContent =
      this.account.backend === 'no-database'
        ? "The game server is running, but its account database isn't connected yet (D1 binding \"DB\" in wrangler.jsonc). Your progress is saved on this device until then."
        : 'Online accounts need the Cloudflare backend (see docs/DEPLOY_CLOUDFLARE.md). Until then your progress is saved as a guest on this device.';
    $('auth-offline').classList.toggle('hidden', !offline);
    $<HTMLButtonElement>('auth-submit').disabled = offline;
    $('modal-auth').classList.remove('hidden');
    $('auth-username').focus();
    this.handlers.onModalChange(true);
  }

  private closeAuth(): void {
    $('modal-auth').classList.add('hidden');
    $<HTMLInputElement>('auth-password').value = '';
    this.handlers.onModalChange(this.isModalOpen);
  }

  private async submitAuth(): Promise<void> {
    const username = $<HTMLInputElement>('auth-username').value.trim();
    const password = $<HTMLInputElement>('auth-password').value;
    const error = $('auth-error');
    if (this.authMode === 'register') {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return void (error.textContent = 'Username must be 3-20 letters, numbers or underscores.');
      if (password.length < 8) return void (error.textContent = 'Password must be at least 8 characters.');
    } else if (!username || !password) {
      return void (error.textContent = 'Enter your username and password.');
    }
    const submit = $<HTMLButtonElement>('auth-submit');
    submit.disabled = true;
    error.textContent = '';
    try {
      if (this.authMode === 'register') await this.account.register(username, password);
      else await this.account.login(username, password);
      this.loadSettings(this.account.settings);
      this.closeAuth();
    } catch (e) {
      error.textContent = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
    } finally {
      submit.disabled = false;
    }
  }

  // ---------- wiring ----------
  private wire(): void {
    $('btn-race').addEventListener('click', () => this.handlers.onRace(this.settings));
    $('btn-controls').addEventListener('click', () => this.openControls());
    $('btn-hud-controls').addEventListener('click', () => this.openControls());
    $('btn-pause-controls').addEventListener('click', () => this.openControls(true));
    $('controls-close').addEventListener('click', () => this.closeControls());
    $('btn-login').addEventListener('click', () => this.openAuth('login'));
    $('btn-register').addEventListener('click', () => this.openAuth('register'));
    $('btn-logout').addEventListener('click', async () => {
      await this.account.logout();
      this.loadSettings(this.account.settings);
    });
    $('auth-cancel').addEventListener('click', () => this.closeAuth());
    $('auth-switch').addEventListener('click', (e) => {
      e.preventDefault();
      this.openAuth(this.authMode === 'login' ? 'register' : 'login');
    });
    $('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitAuth();
    });
    $('btn-resume').addEventListener('click', () => this.handlers.onResume());
    $('btn-restart').addEventListener('click', () => this.handlers.onRestart());
    $('btn-quit').addEventListener('click', () => this.handlers.onQuit());
    $('btn-again').addEventListener('click', () => this.handlers.onRestart());
    $('btn-home').addEventListener('click', () => this.handlers.onQuit());

    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (!button?.dataset.value) return;
        const key = seg.dataset.setting as keyof PlayerSettings;
        const raw = button.dataset.value;
        const value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
        this.settings = { ...this.settings, [key]: value } as PlayerSettings;
        this.renderSettings();
        this.handlers.onSettingsChanged(this.settings);
      });
    });

    // Escape closes the topmost modal.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (!$('modal-auth').classList.contains('hidden')) {
        e.stopImmediatePropagation();
        this.closeAuth();
      } else if (this.controlsOpen) {
        e.stopImmediatePropagation();
        this.closeControls();
      }
    }, true);
  }

  private buildControlsTables(): void {
    $('controls-keyboard').innerHTML = KEY_BINDINGS.map(
      (b) => `<tr><td>${b.action}</td><td>${b.keys.map((k) => `<kbd>${k}</kbd>`).join(' ')}</td></tr>`,
    ).join('');
    $('controls-gamepad').innerHTML = GAMEPAD_BINDINGS.map((b) => `<tr><td>${b.action}</td><td>${b.button}</td></tr>`).join('');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
