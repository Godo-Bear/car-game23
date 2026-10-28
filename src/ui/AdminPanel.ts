import { type AdminPlayer, type AdminStats, cleanAdminStats, isAdminCode } from '../../shared/admin';
import { CAR_IDS, type CarId, type UpgradePart, type Upgrades, type Wallet } from '../../shared/api';
import { CAREER_EVENT_IDS, MAX_STARS, totalStars } from '../../shared/career';
import { formatYen, MAX_UPGRADE, STARTER_CAR, UPGRADE_PARTS, upgradesOf } from '../../shared/economy';
import { formatDp, ITEM_IDS } from '../../shared/items';
import { DAILY_POOL, dailyFor, freshDaily, MEGA_QUESTS, todayKey } from '../../shared/quests';
import { cleanWallet } from '../../shared/wallet';
import { type AccountService, ApiError } from '../account/AccountService';
import { CARS } from '../vehicles/cars';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Remembered unlock: the admin code, tied to the account it was entered on (this device only). */
const REMEMBER_KEY = 'tokyo-circuit.admin.v1';

type ProfileTab = 'career' | 'admin';

/**
 * The Admin tab on the Profile page, shown once unlocked with the admin code: set any player's
 * money, drift points, cars, upgrades, shop items, career results, stars, quests and stats.
 * Online it edits accounts through the server (which checks the code on every request); without
 * a server it edits this device's guest profile.
 */
export class AdminPanel {
  private code = '';
  /** Whose session the panel was unlocked in (an account's name, or "" for a guest). */
  private codeUser = '';
  /** Who is being edited: an account's username, or null for this device's guest. */
  private target: string | null = null;
  private wallet: Wallet | null = null;

  constructor(private readonly account: AccountService) {
    document
      .querySelectorAll<HTMLElement>('.profile-tabs [data-ptab]')
      .forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.ptab as ProfileTab)));
    $('btn-admin').addEventListener('click', () => {
      this.showTab('admin');
      if (!this.code) $('admin-code').focus();
    });
    $('admin-lock').addEventListener('click', () => {
      this.lock(true);
      this.showTab('career');
    });
    $('admin-unlock').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.unlock();
    });
    $('admin-load').addEventListener('click', () => void this.load($<HTMLInputElement>('admin-user').value.trim()));
    $('admin-list').addEventListener('click', () => void this.list());
    $('admin-save').addEventListener('click', () => void this.save());
    $('admin-save-stats').addEventListener('click', () => void this.saveStats());
    $('admin-give-all').addEventListener('click', () =>
      this.change((w) => ({
        ...w,
        credits: w.credits + 1_000_000,
        dp: w.dp + 100_000,
        owned: [...CAR_IDS],
        upgrades: Object.fromEntries(CAR_IDS.map((id) => [id, Object.fromEntries(UPGRADE_PARTS.map((part) => [part, MAX_UPGRADE])) as Upgrades])),
        // Every career event won with every star (so they're all unlocked), and every item.
        events: Object.fromEntries(CAREER_EVENT_IDS.map((id) => [id, 1])),
        stars: Object.fromEntries(CAREER_EVENT_IDS.map((id) => [id, MAX_STARS])),
        items: [...ITEM_IDS],
      })),
    );
    const buttons = (attr: string, fn: (value: string, w: Wallet) => Wallet) =>
      document
        .querySelectorAll<HTMLButtonElement>(`[${attr}]`)
        .forEach((b) => b.addEventListener('click', () => this.change((w) => fn(b.getAttribute(attr)!, w))));
    buttons('data-admin-add', (v, w) => ({ ...w, credits: Number(v) === 0 ? 0 : w.credits + Number(v) }));
    buttons('data-admin-dp', (v, w) => ({ ...w, dp: Number(v) === 0 ? 0 : w.dp + Number(v), dpTotal: w.dpTotal + Number(v) }));
    buttons('data-admin-career', (v, w) =>
      v === 'win'
        ? { ...w, events: Object.fromEntries(CAREER_EVENT_IDS.map((id) => [id, 1])) }
        : v === 'stars'
          ? { ...w, stars: Object.fromEntries(CAREER_EVENT_IDS.map((id) => [id, MAX_STARS])) }
          : { ...w, events: {}, stars: {} },
    );
    buttons('data-admin-items', (v, w) => ({ ...w, items: v === 'all' ? [...ITEM_IDS] : [] }));
    buttons('data-admin-quests', (v, w) => {
      const day = todayKey();
      if (v === 'mega-reset') return { ...w, quests: [] };
      if (v === 'dailies-reset') return { ...w, daily: freshDaily(day) };
      // Enough of everything for any of today's quests (still to be claimed).
      const d = dailyFor(w, day);
      const goal = Math.max(...DAILY_POOL.map((q) => q.goal));
      return {
        ...w,
        daily: {
          ...d,
          races: goal,
          wins: goal,
          podiums: goal,
          laps: goal,
          night: goal,
          mountain: goal,
          hard: goal,
          drift: goal,
          tracks: ['tokyo', 'osaka', 'hakone'],
        },
      };
    });
    for (const [id, key] of [
      ['admin-credits', 'credits'],
      ['admin-dp', 'dp'],
    ] as const) {
      $<HTMLInputElement>(id).addEventListener('change', (e) => {
        const n = Math.floor(Number((e.target as HTMLInputElement).value));
        this.change((w) => (Number.isFinite(n) && n >= 0 ? { ...w, [key]: n, ...(key === 'dp' ? { dpTotal: Math.max(w.dpTotal, n) } : {}) } : w));
      });
    }
  }

  private get online(): boolean {
    return this.account.backend === 'online';
  }

  private get user(): string {
    return this.account.signedIn ? this.account.displayName : '';
  }

  /** Profile opened: show the Admin tab if this account unlocked it on this device. */
  onProfileOpen(): void {
    // Unlocked in someone else's session (logged out or switched accounts): lock again.
    if (this.code && this.codeUser !== this.user) this.lock(false);
    const saved = readRemembered();
    if (!this.code && saved && saved.user === this.user) void this.unlock(saved.code, true);
    this.refreshTab();
  }

  private refreshTab(): void {
    $('ptab-admin').classList.toggle('hidden', !this.code);
    $('btn-admin').classList.toggle('hidden', !!this.code);
  }

  private showTab(tab: ProfileTab): void {
    document.querySelectorAll<HTMLElement>('.profile-tabs [data-ptab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.ptab === tab);
      b.setAttribute('aria-selected', String(b.dataset.ptab === tab));
    });
    document.querySelectorAll<HTMLElement>('[data-ppane]').forEach((p) => p.classList.toggle('hidden', p.dataset.ppane !== tab));
    $('admin-msg').textContent = '';
    document.querySelector('.profile-panel')!.classList.toggle('wide', tab === 'admin');
  }

  /** Forget the admin code (and this device's remembered unlock). */
  private lock(forget: boolean): void {
    this.code = '';
    this.wallet = null;
    if (forget) {
      try {
        localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // Storage blocked: nothing was remembered.
      }
    }
    $('admin-unlock').classList.remove('hidden');
    $('admin-tools').classList.add('hidden');
    $('admin-editor').classList.add('hidden');
    $('admin-players').replaceChildren();
    this.refreshTab();
  }

  private say(text: string): void {
    $('admin-msg').textContent = text;
  }

  private async unlock(code = $<HTMLInputElement>('admin-code').value, remembered = false): Promise<void> {
    try {
      if (this.online) await this.account.admin({ code, action: 'check' });
      else if (!(await isAdminCode(code))) throw new ApiError('Wrong admin code.', 403);
    } catch (e) {
      // A remembered code that no longer works (e.g. it was changed) is forgotten.
      if (remembered && e instanceof ApiError && e.status === 403) this.lock(true);
      if (!remembered) this.say(e instanceof ApiError ? e.message : 'Could not check the code.');
      return;
    }
    this.code = code;
    this.codeUser = this.user;
    try {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ user: this.user, code }));
    } catch {
      // Storage blocked: it just won't be remembered.
    }
    $<HTMLInputElement>('admin-code').value = '';
    $('admin-unlock').classList.add('hidden');
    $('admin-tools').classList.remove('hidden');
    $('admin-find').classList.toggle('hidden', !this.online);
    this.refreshTab();
    if (!remembered) {
      this.showTab('admin');
      this.say(
        this.online ? 'Unlocked. Load a player by name, or list everyone.' : 'Unlocked. No server here, so you are editing this device’s guest profile.',
      );
    }
    if (this.online) {
      if (this.account.signedIn) void this.load(this.account.displayName);
    } else {
      this.edit(null, this.account.wallet, this.account.stats);
    }
  }

  private async list(): Promise<void> {
    try {
      const { players } = await this.account.admin<{ players: AdminPlayer[] }>({ code: this.code, action: 'list' });
      $('admin-players').replaceChildren(
        ...players.map((p) => {
          const li = document.createElement('li');
          const name = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: p.username });
          name.addEventListener('click', () => void this.load(p.username));
          li.append(name, Object.assign(document.createElement('span'), { textContent: `${formatYen(p.wallet.credits)} · ${p.wallet.owned.length} cars` }));
          return li;
        }),
      );
      this.say(`${players.length} player${players.length === 1 ? '' : 's'}.`);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not list players.');
    }
  }

  private async load(username: string): Promise<void> {
    if (!username) return this.say('Type a username first.');
    try {
      const p = await this.account.admin<AdminPlayer>({ code: this.code, action: 'get', username });
      this.edit(p.username, p.wallet, p.stats);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not load that player.');
    }
  }

  private edit(target: string | null, wallet: Wallet, stats?: AdminStats): void {
    this.target = target;
    this.wallet = cleanWallet(wallet);
    $('admin-editor').classList.remove('hidden');
    $('admin-who').textContent = target ?? 'This device (guest)';
    const set = (id: string, v: number | undefined) => {
      $<HTMLInputElement>(id).value = v === undefined ? '' : String(v);
    };
    set('admin-races', stats?.races);
    set('admin-wins', stats?.wins);
    set('admin-podiums', stats?.podiums);
    set('admin-laps', stats?.totalLaps);
    this.say('');
    this.render();
  }

  /** Change the wallet being edited (saved with "Save changes"). */
  private change(fn: (w: Wallet) => Wallet): void {
    if (!this.wallet) return;
    this.wallet = fn(this.wallet);
    this.render();
    this.say('Not saved yet — press Save changes.');
  }

  private render(): void {
    const w = this.wallet;
    if (!w) return;
    for (const [id, value] of [
      ['admin-credits', w.credits],
      ['admin-dp', w.dp],
    ] as const) {
      const input = $<HTMLInputElement>(id);
      if (document.activeElement !== input) input.value = String(value);
    }
    const podiums = CAREER_EVENT_IDS.filter((id) => (w.events[id] ?? 99) <= 3).length;
    $('admin-career-sum').textContent = `— ${podiums}/${CAREER_EVENT_IDS.length} podiums · ★ ${totalStars(w)}/${CAREER_EVENT_IDS.length * MAX_STARS}`;
    $('admin-items-sum').textContent = `— ${w.items.length}/${ITEM_IDS.length} owned · ${formatDp(w.dp)}`;
    $('admin-quests-sum').textContent = `— ${w.quests.length}/${MEGA_QUESTS.length} mega claimed`;
    $('admin-cars').replaceChildren(
      ...CAR_IDS.map((id) => {
        const row = document.createElement('tr');
        const owned = w.owned.includes(id);
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: owned, disabled: id === STARTER_CAR });
        box.setAttribute('aria-label', `Owns ${CARS[id].name}`);
        box.addEventListener('change', () => this.setOwned(id, box.checked));
        const name = document.createElement('label');
        name.append(box, ` ${CARS[id].name}`);
        const cells = [name, ...UPGRADE_PARTS.map((part) => this.levelPicker(id, part, owned))];
        row.append(
          ...cells.map((c) => {
            const td = document.createElement('td');
            td.append(c);
            return td;
          }),
        );
        return row;
      }),
    );
  }

  private levelPicker(car: CarId, part: UpgradePart, owned: boolean): HTMLElement {
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${CARS[car].name} ${part}`);
    for (let level = 0; level <= MAX_UPGRADE; level++) select.append(new Option(`${part[0].toUpperCase()}${part.slice(1)} ${level}`, String(level)));
    select.value = String(upgradesOf(this.wallet!, car)[part]);
    select.disabled = !owned;
    select.addEventListener('change', () =>
      this.change((w) => ({ ...w, upgrades: { ...w.upgrades, [car]: { ...upgradesOf(w, car), [part]: Number(select.value) } } })),
    );
    return select;
  }

  private setOwned(car: CarId, owned: boolean): void {
    this.change((w) => {
      const upgrades = { ...w.upgrades };
      if (!owned) delete upgrades[car];
      return { ...w, owned: owned ? [...w.owned, car] : w.owned.filter((id) => id !== car), upgrades };
    });
  }

  private isMe(username: string): boolean {
    return this.account.signedIn && username.toLowerCase() === this.account.displayName.toLowerCase();
  }

  private async save(): Promise<void> {
    const wallet = cleanWallet(this.wallet);
    try {
      if (this.target === null) {
        this.account.replaceWallet(wallet);
      } else {
        const p = await this.account.admin<AdminPlayer>({ code: this.code, action: 'set', username: this.target, wallet });
        // Editing yourself: show it straight away.
        if (this.isMe(p.username)) this.account.replaceWallet(p.wallet);
      }
      this.wallet = wallet;
      this.render();
      this.say(
        `Saved ✓ ${this.target ?? 'This device'} now has ${formatYen(wallet.credits)}, ${formatDp(wallet.dp)} and ${wallet.owned.length} car${wallet.owned.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not save.');
    }
  }

  private async saveStats(): Promise<void> {
    const num = (id: string) => Number($<HTMLInputElement>(id).value);
    const stats = cleanAdminStats({ races: num('admin-races'), wins: num('admin-wins'), podiums: num('admin-podiums'), totalLaps: num('admin-laps') });
    if (!stats) return this.say('Stats must be whole numbers, with wins ≤ podiums ≤ races.');
    try {
      if (this.target === null) this.account.replaceStats(stats);
      else {
        await this.account.admin({ code: this.code, action: 'stats', username: this.target, stats });
        if (this.isMe(this.target)) this.account.replaceStats(stats);
      }
      this.say(`Stats saved ✓ ${stats.races} races, ${stats.wins} wins, ${stats.podiums} podiums, ${stats.totalLaps} laps.`);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not save the stats.');
    }
  }
}

function readRemembered(): { user: string; code: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? 'null');
    return v && typeof v.user === 'string' && typeof v.code === 'string' ? v : null;
  } catch {
    return null;
  }
}
