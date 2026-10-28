import { type AdminPlayer, isAdminCode } from '../../shared/admin';
import { CAR_IDS, type CarId, type UpgradePart, type Upgrades, type Wallet } from '../../shared/api';
import { cleanWallet, formatYen, MAX_UPGRADE, STARTER_CAR, UPGRADE_PARTS, upgradesOf } from '../../shared/economy';
import { type AccountService, ApiError } from '../account/AccountService';
import { CARS } from '../vehicles/cars';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Admin window: unlock with the admin code, then set any player's money, cars and upgrades.
 * Online it edits accounts through the server (which checks the code on every request);
 * without a server it edits this device's guest profile.
 */
export class AdminPanel {
  private code = '';
  /** Who is being edited: an account's username, or null for this device's guest. */
  private target: string | null = null;
  private wallet: Wallet | null = null;

  constructor(
    private readonly account: AccountService,
    private readonly onOpenChange: (open: boolean) => void,
  ) {
    $('btn-admin').addEventListener('click', () => this.open());
    $('admin-close').addEventListener('click', () => this.close());
    $('admin-unlock').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.unlock();
    });
    $('admin-load').addEventListener('click', () => void this.load($<HTMLInputElement>('admin-user').value.trim()));
    $('admin-list').addEventListener('click', () => void this.list());
    $('admin-save').addEventListener('click', () => void this.save());
    $('admin-give-all').addEventListener('click', () => {
      if (!this.wallet) return;
      const upgrades: Wallet['upgrades'] = {};
      for (const id of CAR_IDS) upgrades[id] = Object.fromEntries(UPGRADE_PARTS.map((part) => [part, MAX_UPGRADE])) as Upgrades;
      this.wallet = { credits: this.wallet.credits + 1_000_000, owned: [...CAR_IDS], upgrades };
      this.render();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-admin-add]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.wallet) return;
        const add = Number(b.dataset.adminAdd);
        this.wallet = { ...this.wallet, credits: add === 0 ? 0 : this.wallet.credits + add };
        this.render();
      }),
    );
    $<HTMLInputElement>('admin-credits').addEventListener('change', (e) => {
      if (!this.wallet) return;
      const n = Math.floor(Number((e.target as HTMLInputElement).value));
      this.wallet = { ...this.wallet, credits: Number.isFinite(n) && n >= 0 ? n : this.wallet.credits };
      this.render();
    });
  }

  get isOpen(): boolean {
    return !$('modal-admin').classList.contains('hidden');
  }

  private get online(): boolean {
    return this.account.backend === 'online';
  }

  open(): void {
    $('modal-admin').classList.remove('hidden');
    $('admin-msg').textContent = '';
    if (!this.code) $('admin-code').focus();
    this.onOpenChange(true);
  }

  close(): void {
    $('modal-admin').classList.add('hidden');
    this.onOpenChange(false);
  }

  private say(text: string): void {
    $('admin-msg').textContent = text;
  }

  private async unlock(): Promise<void> {
    const code = $<HTMLInputElement>('admin-code').value;
    try {
      if (this.online) await this.account.admin({ code, action: 'check' });
      else if (!(await isAdminCode(code))) throw new ApiError('Wrong admin code.', 403);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not check the code.');
      return;
    }
    this.code = code;
    $<HTMLInputElement>('admin-code').value = '';
    $('admin-unlock').classList.add('hidden');
    $('admin-tools').classList.remove('hidden');
    $('admin-find').classList.toggle('hidden', !this.online);
    this.say(this.online ? 'Unlocked. Load a player by name, or list everyone.' : 'Unlocked. No server here, so you are editing this device’s guest profile.');
    if (this.online) {
      if (this.account.signedIn) void this.load(this.account.displayName);
    } else {
      this.edit(null, this.account.wallet);
    }
  }

  private async list(): Promise<void> {
    try {
      const { players } = await this.account.admin<{ players: AdminPlayer[] }>({ code: this.code, action: 'list' });
      $('admin-players').replaceChildren(
        ...players.map((p) => {
          const li = document.createElement('li');
          const name = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: p.username });
          name.addEventListener('click', () => this.edit(p.username, p.wallet));
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
      this.edit(p.username, p.wallet);
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not load that player.');
    }
  }

  private edit(target: string | null, wallet: Wallet): void {
    this.target = target;
    this.wallet = cleanWallet(wallet);
    $('admin-editor').classList.remove('hidden');
    $('admin-who').textContent = target ?? 'This device (guest)';
    this.say('');
    this.render();
  }

  private render(): void {
    const w = this.wallet;
    if (!w) return;
    const credits = $<HTMLInputElement>('admin-credits');
    if (document.activeElement !== credits) credits.value = String(w.credits);
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
    select.addEventListener('change', () => {
      const w = this.wallet!;
      this.wallet = { ...w, upgrades: { ...w.upgrades, [car]: { ...upgradesOf(w, car), [part]: Number(select.value) } } };
    });
    return select;
  }

  private setOwned(car: CarId, owned: boolean): void {
    const w = this.wallet!;
    const upgrades = { ...w.upgrades };
    if (!owned) delete upgrades[car];
    this.wallet = { ...w, owned: owned ? [...w.owned, car] : w.owned.filter((id) => id !== car), upgrades };
    this.render();
  }

  private async save(): Promise<void> {
    const wallet = cleanWallet(this.wallet);
    try {
      if (this.target === null) {
        this.account.replaceWallet(wallet);
      } else {
        const p = await this.account.admin<AdminPlayer>({ code: this.code, action: 'set', username: this.target, wallet });
        // Editing yourself: show it straight away.
        if (this.account.signedIn && p.username.toLowerCase() === this.account.displayName.toLowerCase()) this.account.replaceWallet(p.wallet);
      }
      this.wallet = wallet;
      this.render();
      this.say(
        `Saved ✓ ${this.target ?? 'This device'} now has ${formatYen(wallet.credits)} and ${wallet.owned.length} car${wallet.owned.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      this.say(e instanceof ApiError ? e.message : 'Could not save.');
    }
  }
}
