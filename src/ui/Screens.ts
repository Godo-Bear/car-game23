import type { PlayerSettings, TrackId } from '../../shared/api';
import { type AccountService, ApiError } from '../account/AccountService';
import type { Input } from '../core/Input';
import type { SettingsStore } from '../core/Settings';
import { formatTime, type RacerState } from '../race/RaceManager';
import { TrackPath } from '../track/TrackPath';
import { TRACKS, type TrackTheme } from '../track/tracks';
import { CARS } from '../vehicles/cars';
import { GarageScreen } from './GarageScreen';
import { SettingsPanel, type SettingsTab } from './SettingsPanel';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  laps: 3,
  opponents: 7,
  difficulty: 'normal',
  assists: true,
  camera: 'chase',
  track: 'tokyo',
  timeOfDay: 'night',
  car: 'gt',
  garage: {},
};

export type HubPanel = 'race' | 'garage' | 'career';

export interface ScreenHandlers {
  onRace(settings: PlayerSettings): void;
  /** Race setup or car changed (already applied to `settings`); `car` is true for garage changes. */
  onSettingsChanged(settings: PlayerSettings, car: boolean): void;
  onHubPanel(panel: HubPanel): void;
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

const THEME_LABEL: Record<TrackTheme, string> = { city: 'City streets', mountain: 'Mountain pass', countryside: 'Countryside' };

/** Owns every menu/overlay outside the in-race HUD. */
export class Screens {
  settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  panelName: HubPanel = 'race';
  private authMode: AuthMode = 'login';
  private settingsReturnTo: 'none' | 'pause' = 'none';
  private readonly panel: SettingsPanel;
  private readonly garage: GarageScreen;

  constructor(
    private readonly account: AccountService,
    private readonly handlers: ScreenHandlers,
    store: SettingsStore,
    private readonly input: Input,
  ) {
    this.panel = new SettingsPanel(store, input, (open) => {
      if (!open && this.settingsReturnTo === 'pause') this.showPause(true);
      if (!open) this.settingsReturnTo = 'none';
      this.handlers.onModalChange(this.isModalOpen);
    });
    this.garage = new GarageScreen(
      () => this.settings,
      (patch) => this.update(patch, true),
    );
    this.buildTrackCards();
    this.wire();
    account.onChange(() => this.renderProfile());
  }

  // ---------- visibility ----------
  get isModalOpen(): boolean {
    return !$('modal-auth').classList.contains('hidden') || this.panel.isOpen;
  }

  get homeVisible(): boolean {
    return !$('screen-home').classList.contains('hidden');
  }

  showHome(panel: HubPanel = this.panelName): void {
    this.hideAll();
    $('screen-home').classList.remove('hidden');
    this.showPanel(panel);
    this.render();
  }

  showPanel(panel: HubPanel): void {
    this.panelName = panel;
    document.querySelectorAll<HTMLElement>('.hub-tabs [data-panel]').forEach((b) => {
      b.classList.toggle('active', b.dataset.panel === panel);
      b.setAttribute('aria-selected', String(b.dataset.panel === panel));
    });
    document.querySelectorAll<HTMLElement>('.hub-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== panel));
    if (panel === 'garage') this.garage.render();
    if (panel === 'race') $('btn-race').focus({ preventScroll: true });
    this.handlers.onHubPanel(panel);
  }

  hideAll(): void {
    for (const id of ['screen-home', 'screen-pause', 'screen-results', 'modal-auth', 'modal-settings']) $(id).classList.add('hidden');
    this.handlers.onModalChange(false);
  }

  showPause(show: boolean): void {
    $('screen-pause').classList.toggle('hidden', !show);
    if (show) $('btn-resume').focus({ preventScroll: true });
  }

  openSettings(tab: SettingsTab): void {
    const fromPause = !$('screen-pause').classList.contains('hidden');
    this.settingsReturnTo = fromPause ? 'pause' : 'none';
    if (fromPause) $('screen-pause').classList.add('hidden');
    this.panel.open(tab);
  }

  /** H key / ? button: open on the Controls tab, or close if already open. */
  toggleControls(): void {
    if (this.panel.isOpen) this.panel.close();
    else this.openSettings('controls');
  }

  /** Esc on the homescreen: back to the Race tab. Returns false if there was nothing to go back from. */
  back(): boolean {
    if (!this.homeVisible || this.panelName === 'race') return false;
    this.showPanel('race');
    return true;
  }

  /** Settings from the account (or guest profile) merged over defaults. */
  loadSettings(saved: Partial<PlayerSettings>): void {
    this.settings = { ...DEFAULT_PLAYER_SETTINGS, ...saved, garage: { ...saved.garage } };
    this.render();
  }

  private update(patch: Partial<PlayerSettings>, car: boolean): void {
    this.settings = { ...this.settings, ...patch };
    this.render();
    this.handlers.onSettingsChanged(this.settings, car);
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

  // ---------- rendering ----------
  private render(): void {
    this.renderProfile();
    this.renderEvent();
    this.garage.render();
  }

  private renderProfile(): void {
    const a = this.account;
    const status = a.signedIn
      ? 'Signed in · career saved online'
      : a.backend === 'online'
        ? 'Log in to save your career online'
        : 'Progress saved on this device';
    for (const prefix of ['profile', 'career']) {
      $(`${prefix}-name`).textContent = a.displayName;
      $(`${prefix}-avatar`).textContent = a.displayName.slice(0, 1).toUpperCase();
      $(`${prefix}-status`).textContent = status;
    }
    const s = a.stats;
    $('stat-races').textContent = String(s.races);
    $('stat-wins').textContent = String(s.wins);
    $('stat-podiums').textContent = String(s.podiums);
    $('stat-laps').textContent = String(s.totalLaps);
    $('best-laps').replaceChildren(
      ...Object.values(TRACKS).map((t) => {
        const li = document.createElement('li');
        const best = s.bestLaps[t.id];
        li.append(
          Object.assign(document.createElement('span'), { textContent: t.name }),
          Object.assign(document.createElement('span'), { textContent: best === undefined ? '--' : formatTime(best) }),
        );
        return li;
      }),
    );
    $('recent-races').replaceChildren(
      ...(a.recent.length
        ? a.recent.map((r) => {
            const li = document.createElement('li');
            const left = document.createElement('span');
            left.textContent = `${TRACKS[r.track ?? 'tokyo'].short} · P${r.position}/${r.fieldSize} · ${r.laps} lap${r.laps > 1 ? 's' : ''} · ${r.difficulty}`;
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

  private buildTrackCards(): void {
    $('track-cards').replaceChildren(
      ...Object.values(TRACKS).map((t) => {
        const b = document.createElement('button');
        b.className = 'track-card';
        b.dataset.value = t.id;
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.addEventListener('error', () => (img.style.visibility = 'hidden'));
        img.addEventListener('load', () => (img.style.visibility = ''));
        const label = document.createElement('span');
        label.className = 'label';
        label.innerHTML = `<b>${t.short}</b><small>${THEME_LABEL[t.theme]} · ${trackLengthKm(t.id).toFixed(2)} km</small>`;
        b.append(img, label);
        b.addEventListener('click', () => this.update({ track: t.id }, false));
        return b;
      }),
    );
  }

  private renderEvent(): void {
    const s = this.settings;
    const track = TRACKS[s.track];
    $('track-blurb').textContent = track.blurb;
    document.querySelectorAll<HTMLButtonElement>('#track-cards .track-card').forEach((b) => {
      const active = b.dataset.value === s.track;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
      const img = b.querySelector('img')!;
      const src = `previews/${b.dataset.value}-${s.timeOfDay}.jpg`;
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
    $('event-car-name').textContent = CARS[s.car].name;
    document.querySelectorAll<HTMLElement>('.seg[data-setting]').forEach((seg) => {
      const key = seg.dataset.setting as keyof PlayerSettings;
      const current = String(s[key]);
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
        ? 'The game server is running, but its account database isn\'t connected yet (D1 binding "DB" in wrangler.jsonc). Your progress is saved on this device until then.'
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
      this.handlers.onSettingsChanged(this.settings, true);
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
    $('btn-garage-race').addEventListener('click', () => this.handlers.onRace(this.settings));
    $('btn-event-garage').addEventListener('click', () => this.showPanel('garage'));
    document
      .querySelectorAll<HTMLElement>('.hub-tabs [data-panel]')
      .forEach((b) => b.addEventListener('click', () => this.showPanel(b.dataset.panel as HubPanel)));
    $('profile-chip').addEventListener('click', () => this.showPanel('career'));
    $('btn-settings').addEventListener('click', () => this.openSettings('graphics'));
    $('btn-hud-controls').addEventListener('click', () => this.openSettings('controls'));
    $('btn-pause-settings').addEventListener('click', () => this.openSettings('graphics'));
    $('btn-login').addEventListener('click', () => this.openAuth('login'));
    $('btn-register').addEventListener('click', () => this.openAuth('register'));
    $('btn-logout').addEventListener('click', async () => {
      await this.account.logout();
      this.loadSettings(this.account.settings);
      this.handlers.onSettingsChanged(this.settings, true);
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

    document.querySelectorAll<HTMLElement>('.seg[data-setting]').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (!button?.dataset.value) return;
        const key = seg.dataset.setting as keyof PlayerSettings;
        const raw = button.dataset.value;
        const value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
        this.update({ [key]: value } as Partial<PlayerSettings>, false);
      });
    });

    // Escape closes the topmost modal (and doesn't also count as "pause").
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape') return;
        if (!$('modal-auth').classList.contains('hidden')) this.closeAuth();
        else if (this.panel.isOpen) this.panel.close();
        else return;
        e.stopImmediatePropagation();
        this.input.clearActions();
      },
      true,
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const lengths = new Map<TrackId, number>();
function trackLengthKm(id: TrackId): number {
  let km = lengths.get(id);
  if (km === undefined) {
    km = new TrackPath(TRACKS[id].layout).length / 1000;
    lengths.set(id, km);
  }
  return km;
}
