import type { CarId, PlayerSettings, TrackId } from '../../shared/api';
import { bestResult, CAREER_EVENTS, careerEvent, eventUnlocked, nextEvent } from '../../shared/career';
import { formatYen, raceReward, STARTER_CAR, upgradesOf } from '../../shared/economy';
import { QUESTS, questDone, questsToShow } from '../../shared/quests';
import { type AccountService, ApiError } from '../account/AccountService';
import type { Input } from '../core/Input';
import type { SettingsStore } from '../core/Settings';
import { formatTime, type RacerState } from '../race/RaceManager';
import { TrackPath } from '../track/TrackPath';
import { TRACKS } from '../track/tracks';
import { CARS } from '../vehicles/cars';
import { AdminPanel } from './AdminPanel';
import { GarageScreen } from './GarageScreen';
import { SettingsPanel, type SettingsTab } from './SettingsPanel';
import { ShopScreen } from './ShopScreen';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  laps: 3,
  opponents: 7,
  difficulty: 'normal',
  assists: true,
  camera: 'chase',
  track: 'tokyo',
  timeOfDay: 'night',
  car: STARTER_CAR,
  garage: {},
};

export type HubPanel = 'home' | 'career' | 'garage' | 'shop' | 'profile';

export interface ScreenHandlers {
  onRace(settings: PlayerSettings): void;
  /** Race setup or car changed (already applied to `settings`); `car` is true for garage changes. */
  onSettingsChanged(settings: PlayerSettings, car: boolean): void;
  onHubPanel(panel: HubPanel): void;
  /** The shop is showing a car (on the turntable). */
  onPreviewCar(id: CarId): void;
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
  panelName: HubPanel = 'home';
  /** Career event picked on the map, and the one being raced (sent with the result). */
  private selectedEvent = '';
  private mapPos: [number, number] = [0, 0];
  raceEvent: string | null = null;
  private authMode: AuthMode = 'login';
  private settingsReturnTo: 'none' | 'pause' = 'none';
  private readonly panel: SettingsPanel;
  private readonly garage: GarageScreen;
  private readonly shop: ShopScreen;
  private readonly admin: AdminPanel;

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
      account,
    );
    this.shop = new ShopScreen(
      account,
      (id) => this.handlers.onPreviewCar(id),
      (id) => this.update({ car: id }, true),
    );
    this.buildPins();
    this.wireMapDrag();
    this.wire();
    this.admin = new AdminPanel(account, () => this.handlers.onModalChange(this.isModalOpen));
    // Money, cars and upgrades change with purchases, race results and the admin tools.
    account.onChange(() => {
      // An admin may have taken away the car you were going to race.
      if (!account.wallet.owned.includes(this.settings.car)) this.update({ car: STARTER_CAR }, true);
      this.renderProfile();
      this.garage.render();
      this.shop.render();
    });
  }

  // ---------- visibility ----------
  get isModalOpen(): boolean {
    return !$('modal-auth').classList.contains('hidden') || this.panel.isOpen || this.admin?.isOpen;
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
    $('screen-home').dataset.panel = panel;
    document.querySelectorAll<HTMLElement>('.hub-nav [data-panel]').forEach((b) => {
      b.classList.toggle('active', b.dataset.panel === panel);
      b.setAttribute('aria-selected', String(b.dataset.panel === panel));
    });
    document.querySelectorAll<HTMLElement>('.hub-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== panel));
    if (panel === 'garage') this.garage.render();
    if (panel === 'career') {
      $('btn-race').focus({ preventScroll: true });
      // Always open on the next event to race.
      this.focusNext();
    }
    if (panel === 'home') $('home-quick').focus({ preventScroll: true });
    this.handlers.onHubPanel(panel);
    // After the turntable is set up, so the shop's first car replaces yours on it.
    if (panel === 'shop') this.shop.open();
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

  /** Home cards: the next race, your car and your career at a glance. */
  private renderHome(): void {
    const s = this.settings;
    const a = this.account;
    const car = CARS[s.car];
    const next = nextEvent(a.wallet);
    $('home-quick-name').textContent = next.name;
    $('home-quick-info').textContent = `${TRACKS[next.track].name} · ${next.laps} laps · ${next.difficulty}`;
    $('home-quick').style.backgroundImage =
      `linear-gradient(100deg, rgba(20, 8, 40, 0.92) 30%, rgba(20, 8, 40, 0.35)), url(previews/${next.track}-${next.timeOfDay}.jpg)`;
    $('home-car').textContent = car.name;
    const levels = Object.values(upgradesOf(a.wallet, s.car)).reduce((sum, v) => sum + v, 0);
    $('home-car-lv').textContent = `LV ${levels}`;
    $('home-wins').textContent = `${a.stats.wins} win${a.stats.wins === 1 ? '' : 's'}`;
    $('home-car-kind').textContent = car.kind;
    this.renderQuests();
    $('home-car-name').textContent = car.name;
  }

  /** Quests on the home screen: rewards to claim first, then the ones closest to done. */
  private renderQuests(): void {
    const a = this.account;
    const wallet = a.wallet;
    const shown = questsToShow(wallet, a.stats, 4);
    $('quests-count').textContent = `${wallet.quests.length} / ${QUESTS.length} done`;
    $('quest-list').replaceChildren(
      ...(shown.length
        ? shown.map((quest) => {
            const done = questDone(quest, wallet, a.stats);
            const have = Math.min(quest.goal, quest.progress(wallet, a.stats));
            const li = document.createElement('li');
            li.className = done ? 'quest ready' : 'quest';
            li.innerHTML = `<div class="quest-text"><b>${escapeHtml(quest.name)}</b><small>${escapeHtml(quest.detail)}</small>
              <span class="quest-bar"><i style="width:${(have / quest.goal) * 100}%"></i></span></div>`;
            if (done) {
              const claim = Object.assign(document.createElement('button'), {
                type: 'button',
                className: 'claim',
                textContent: `CLAIM ${formatYen(quest.reward)}`,
              });
              claim.addEventListener('click', () => void this.claimQuest(quest.id, quest.reward));
              li.append(claim);
            } else {
              li.append(
                Object.assign(document.createElement('span'), {
                  className: 'quest-reward',
                  innerHTML: `${have}/${quest.goal}<b>${formatYen(quest.reward)}</b>`,
                }),
              );
            }
            return li;
          })
        : [Object.assign(document.createElement('li'), { className: 'quest muted', textContent: 'Every quest done — legend!' })]),
    );
  }

  private async claimQuest(id: string, reward: number): Promise<void> {
    const note = $('quest-note');
    try {
      await this.account.buy({ kind: 'quest', quest: id });
      note.textContent = `+${formatYen(reward)} claimed!`;
    } catch (e) {
      note.textContent = e instanceof ApiError ? e.message : 'Could not claim that. Please try again.';
    }
    this.render();
  }

  /** Esc on the homescreen: back to Home. Returns false if there was nothing to go back from. */
  back(): boolean {
    if (!this.homeVisible || this.panelName === 'home') return false;
    this.showPanel('home');
    return true;
  }

  /** Settings from the account (or guest profile) merged over defaults. */
  loadSettings(saved: Partial<PlayerSettings>): void {
    this.settings = { ...DEFAULT_PLAYER_SETTINGS, ...saved, garage: { ...saved.garage } };
    // You can only race a car you own (e.g. a new account, or settings from before the shop).
    if (!this.account.wallet.owned.includes(this.settings.car)) this.settings.car = STARTER_CAR;
    this.render();
  }

  private update(patch: Partial<PlayerSettings>, car: boolean): void {
    this.settings = { ...this.settings, ...patch };
    this.render();
    this.handlers.onSettingsChanged(this.settings, car);
  }

  // ---------- results ----------
  showResults(data: ResultsData, savedText: string, earned: number): void {
    const me = data.standings.find((r) => r.id === data.playerId)!;
    const title = $('results-title');
    title.textContent = me.position === 1 ? 'P1 — Victory!' : me.position <= 3 ? `P${me.position} — Podium!` : `P${me.position} — Finished`;
    $('results-earned').textContent = `+${formatYen(earned)} prize money`;
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
    this.renderCareer();
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
    }
    $('career-status').textContent = status;
    $('money').textContent = formatYen(a.wallet.credits);
    this.renderHome();
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

  /**
   * Size and place the map picture: at least 1.3x the screen so there is something to drag,
   * centred on `focus` (a pin, as fractions of the picture) in the part of the screen beside
   * the event card, and never leaving a gap at the edges.
   */
  private panMap(focus?: [number, number], dx = 0, dy = 0): void {
    const view = document.querySelector<HTMLElement>('.career-map')!;
    const frame = $('map-frame');
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    if (!vw || !vh) return;
    const w = Math.max(vw * 1.3, vh * 1.3 * (16 / 9));
    const h = (w * 9) / 16;
    frame.style.width = `${w}px`;
    if (focus) {
      const card = document.querySelector<HTMLElement>('.event-card');
      const left = vw > 760 && card ? card.getBoundingClientRect().right : 0;
      this.mapPos = [left + (vw - left) / 2 - focus[0] * w, vh / 2 - focus[1] * h];
    }
    // The picture may slide out from under the card and the top bar, so no pin stays hidden.
    const card = document.querySelector<HTMLElement>('.event-card');
    const maxX = vw > 760 && card ? card.getBoundingClientRect().right : 0;
    const x = Math.min(maxX, Math.max(vw - w, this.mapPos[0] + dx));
    const y = Math.min(90, Math.max(vh - h, this.mapPos[1] + dy));
    this.mapPos = [x, y];
    frame.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Pick the next event and bring its pin into view beside the event card. */
  private focusNext(): void {
    const e = nextEvent(this.account.wallet);
    this.selectedEvent = e.id;
    this.renderCareer();
    requestAnimationFrame(() => this.panMap(e.pin));
  }

  /** Drag the map with the mouse or a finger (a short tap still picks a pin). */
  private wireMapDrag(): void {
    const view = document.querySelector<HTMLElement>('.career-map')!;
    let start: [number, number] | null = null;
    let moved = false;
    view.addEventListener('pointerdown', (e) => {
      start = [e.clientX, e.clientY];
      moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start[0];
      const dy = e.clientY - start[1];
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      view.classList.add('dragging');
      this.panMap(undefined, dx, dy);
      start = [e.clientX, e.clientY];
    });
    window.addEventListener('pointerup', () => {
      start = null;
      view.classList.remove('dragging');
    });
    // A drag shouldn't also count as clicking the pin it started on.
    view.addEventListener(
      'click',
      (e) => {
        if (moved) e.stopPropagation();
        moved = false;
      },
      true,
    );
    window.addEventListener('resize', () => this.panMap());
  }

  /** One pin per career event on the city map. */
  private buildPins(): void {
    $('map-frame').replaceChildren(
      ...CAREER_EVENTS.map((e, k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pin';
        b.dataset.event = e.id;
        b.style.left = `${e.pin[0] * 100}%`;
        b.style.top = `${e.pin[1] * 100}%`;
        b.innerHTML = `<span class="pin-icon"><span class="pin-num">${k + 1}</span>${PADLOCK}</span><span class="pin-label">${escapeHtml(e.name)}</span>`;
        b.addEventListener('click', () => {
          this.selectedEvent = e.id;
          this.renderCareer();
        });
        return b;
      }),
    );
  }

  /** The career map: pin states, and the card for the selected event. */
  private renderCareer(): void {
    const wallet = this.account.wallet;
    const next = nextEvent(wallet);
    if (!this.selectedEvent) this.selectedEvent = next.id;
    document.querySelectorAll<HTMLButtonElement>('#map-frame .pin').forEach((b) => {
      const id = b.dataset.event!;
      const best = bestResult(wallet, id);
      const open = eventUnlocked(wallet, id);
      b.classList.toggle('locked', !open);
      b.classList.toggle('done', best !== undefined && best <= 3);
      b.dataset.medal = best === undefined || best > 3 ? '' : String(best);
      b.classList.toggle('next', id === next.id && open);
      b.classList.toggle('selected', id === this.selectedEvent);
    });
    const e = careerEvent(this.selectedEvent) ?? next;
    const k = CAREER_EVENTS.indexOf(e);
    const track = TRACKS[e.track];
    const open = eventUnlocked(wallet, e.id);
    const best = bestResult(wallet, e.id);
    $('ev-num').textContent = `EVENT ${k + 1} / ${CAREER_EVENTS.length}`;
    $('ev-name').textContent = e.name;
    $('ev-track').textContent = `${track.name} · ${track.label} · ${trackLengthKm(e.track).toFixed(2)} km`;
    $('ev-course').innerHTML = courseMap(e.track);
    const time = { day: '☀ Day', sunset: '🌇 Sunset', night: '🌙 Night' }[e.timeOfDay];
    $('ev-chips').replaceChildren(
      ...[time, `${e.laps} laps`, `${e.rivals} rivals`, e.difficulty].map((t) => Object.assign(document.createElement('span'), { textContent: t })),
    );
    const win = raceReward({ position: 1, fieldSize: e.rivals + 1, laps: e.laps, difficulty: e.difficulty });
    const claimed = best !== undefined && best <= 3;
    $('ev-reward').innerHTML = `Win <b>${formatYen(win)}</b> · ${claimed ? 'podium bonus claimed ✓' : `first podium bonus <b>${formatYen(e.bonus)}</b>`}`;
    $('ev-best').textContent = best === undefined ? 'Not raced yet' : `Best finish: P${best}`;
    $('event-car-name').textContent = CARS[this.settings.car].name;
    const race = $<HTMLButtonElement>('btn-race');
    race.disabled = !open;
    race.textContent = open ? 'START EVENT ▶' : '🔒 LOCKED';
    $('ev-locked').textContent = open ? '' : `Finish “${CAREER_EVENTS[k - 1].name}” on the podium to unlock.`;
    const done = CAREER_EVENTS.filter((ev) => (bestResult(wallet, ev.id) ?? 99) <= 3).length;
    $('career-progress').textContent = `${done} / ${CAREER_EVENTS.length} events on the podium`;
    this.renderSegs();
  }

  private renderSegs(): void {
    const s = this.settings;
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

  /** Race a career event (if it's unlocked): its circuit, time, laps, rivals and difficulty. */
  startEvent(id: string): void {
    const e = careerEvent(id);
    if (!e || !eventUnlocked(this.account.wallet, id)) return;
    this.raceEvent = id;
    this.selectedEvent = id;
    this.update({ track: e.track, timeOfDay: e.timeOfDay, laps: e.laps, opponents: e.rivals, difficulty: e.difficulty }, false);
    this.handlers.onRace(this.settings);
  }

  /** Enter / quick buttons: the selected event on the career map, otherwise the next one. */
  quickStart(): void {
    const wallet = this.account.wallet;
    const pick = this.panelName === 'career' && this.selectedEvent && eventUnlocked(wallet, this.selectedEvent) ? this.selectedEvent : nextEvent(wallet).id;
    this.startEvent(pick);
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
    $('btn-race').addEventListener('click', () => this.selectedEvent && this.startEvent(this.selectedEvent));
    $('btn-map-next').addEventListener('click', () => this.focusNext());
    $('home-quick').addEventListener('click', () => this.startEvent(nextEvent(this.account.wallet).id));
    $('home-garage').addEventListener('click', () => this.showPanel('garage'));
    $('home-career').addEventListener('click', () => this.showPanel('profile'));
    $('btn-garage-race').addEventListener('click', () => this.quickStart());
    $('btn-event-garage').addEventListener('click', () => this.showPanel('garage'));
    document
      .querySelectorAll<HTMLElement>('.hub-nav [data-panel]')
      .forEach((b) => b.addEventListener('click', () => this.showPanel(b.dataset.panel as HubPanel)));
    $('profile-chip').addEventListener('click', () => this.showPanel('profile'));
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
    $('btn-home').addEventListener('click', () => {
      this.panelName = 'home';
      this.handlers.onQuit();
    });
    $('btn-results-map').addEventListener('click', () => {
      // Back to the map with the next event picked.
      this.panelName = 'career';
      this.selectedEvent = nextEvent(this.account.wallet).id;
      this.handlers.onQuit();
    });

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
        else if (this.admin.isOpen) this.admin.close();
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

const paths = new Map<TrackId, TrackPath>();
function trackPath(id: TrackId): TrackPath {
  let path = paths.get(id);
  if (!path) {
    path = new TrackPath(TRACKS[id].layout);
    paths.set(id, path);
  }
  return path;
}

function trackLengthKm(id: TrackId): number {
  return trackPath(id).length / 1000;
}

/**
 * The course you'll race, as an SVG map like the in-race minimap (north up): the road, a
 * start/finish line and an arrow showing which way round it goes.
 */
function courseMap(id: TrackId): string {
  const track = trackPath(id);
  const W = 100;
  const H = 62;
  const pad = 7;
  const b = track.bounds;
  const scale = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxZ - b.minZ));
  const ox = W / 2 - ((b.minX + b.maxX) / 2) * scale;
  const oz = H / 2 - ((b.minZ + b.maxZ) / 2) * scale;
  const at = (i: number) => {
    const s = track.samples[i % track.count];
    return [ox + s.x * scale, oz + s.z * scale];
  };
  const step = Math.max(1, Math.floor(track.count / 220));
  const pts: string[] = [];
  for (let i = 0; i < track.count; i += step)
    pts.push(
      at(i)
        .map((v) => v.toFixed(1))
        .join(','),
    );
  const d = `M${pts.join('L')}Z`;
  const s0 = track.samples[0];
  const [sx, sy] = at(0);
  const startAngle = (Math.atan2(s0.tz, s0.tx) * 180) / Math.PI;
  // Direction arrow a little way after the start.
  const a = Math.floor(track.count * 0.06);
  const [ax, ay] = at(a);
  const sa = track.samples[a];
  const arrowAngle = (Math.atan2(sa.tz, sa.tx) * 180) / Math.PI;
  return `<svg class="course" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="rgba(0,0,0,0.65)" stroke-width="5" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#eef0fa" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="-0.8" y="-3.4" width="1.6" height="6.8" fill="#ff2d6f" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${startAngle.toFixed(0)})"/>
    <path d="M2.6 0 L-1.6 -2.2 L-0.6 0 L-1.6 2.2 Z" fill="#19d3ff" transform="translate(${ax.toFixed(1)} ${ay.toFixed(1)}) rotate(${arrowAngle.toFixed(0)})"/>
  </svg>`;
}

const PADLOCK =
  '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1Zm2 0h6V7a3 3 0 0 0-6 0v3Zm3 4a1.5 1.5 0 0 0-.8 2.8V19h1.6v-2.2A1.5 1.5 0 0 0 12 14Z" fill="currentColor"/></svg>';
