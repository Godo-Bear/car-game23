import type { AdminRequest, AdminStats } from '../../shared/admin';
import type { CareerStats, PlayerSettings, ProfileResponse, Purchase, RaceRecord, Wallet } from '../../shared/api';
import { newWallet, purchase } from '../../shared/economy';
import { claimDaily, claimQuest, settleResult, todayKey } from '../../shared/quests';
import { cleanWallet, hasGuestProgress } from '../../shared/wallet';

/** 'no-database': the API Worker is deployed but its D1 binding is missing. */
export type BackendStatus = 'unknown' | 'online' | 'offline' | 'no-database';

const GUEST_KEY = 'tokyo-circuit.guest.v1';

interface GuestData {
  stats: CareerStats;
  settings: Partial<PlayerSettings>;
  recent: RaceRecord[];
  wallet: Wallet;
}

const emptyStats = (): CareerStats => ({ races: 0, wins: 0, podiums: 0, bestLap: null, bestLaps: {}, totalLaps: 0 });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Player accounts. Signed-in players are stored server-side (Cloudflare Pages Functions + D1),
 * so their career follows them to any device. Without an account - or when the game runs
 * without the backend, e.g. `npm run dev` - progress is kept as a guest profile in this
 * browser's localStorage.
 */
export class AccountService {
  backend: BackendStatus = 'unknown';
  profile: ProfileResponse | null = null;
  private guest: GuestData = loadGuest();
  private listeners = new Set<() => void>();
  /** Set when this device's guest progress has just been added to the account. */
  notice: string | null = null;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get signedIn(): boolean {
    return this.profile !== null;
  }

  get displayName(): string {
    return this.profile?.username ?? 'Guest';
  }

  get stats(): CareerStats {
    return this.profile?.stats ?? this.guest.stats;
  }

  get recent(): RaceRecord[] {
    return this.profile?.recent ?? this.guest.recent;
  }

  get settings(): Partial<PlayerSettings> {
    return this.profile ? this.profile.settings : this.guest.settings;
  }

  get wallet(): Wallet {
    return this.profile?.wallet ?? this.guest.wallet;
  }

  /** Admin tools on the server (the code travels with every request and is checked there). */
  admin<T>(request: AdminRequest): Promise<T> {
    return this.call<T>('POST', '/api/admin', request);
  }

  /** An admin changed a wallet: the signed-in player's (online) or this device's guest. */
  replaceWallet(wallet: Wallet): void {
    if (this.profile) {
      this.profile.wallet = wallet;
    } else {
      this.guest.wallet = cleanWallet(wallet);
      saveGuest(this.guest);
    }
    this.emit();
  }

  /** An admin changed career stats: the signed-in player's (already saved online) or the guest's. */
  replaceStats(stats: AdminStats): void {
    if (this.profile) this.profile.stats = { ...this.profile.stats, ...stats };
    else {
      this.guest.stats = { ...this.guest.stats, ...stats };
      saveGuest(this.guest);
    }
    this.emit();
  }

  /** Buy a car or an upgrade. Accounts are charged by the server; guests on this device. */
  async buy(p: Purchase): Promise<void> {
    if (this.profile) {
      const res = await this.call<{ wallet: Wallet }>('POST', '/api/shop', p);
      this.profile.wallet = res.wallet;
    } else {
      const wallet =
        p.kind === 'quest'
          ? claimQuest(this.guest.wallet, this.guest.stats, p.quest)
          : p.kind === 'daily'
            ? claimDaily(this.guest.wallet, p.quest, todayKey())
            : purchase(this.guest.wallet, p);
      if (typeof wallet === 'string') throw new ApiError(wallet, 400);
      this.guest.wallet = wallet;
      saveGuest(this.guest);
    }
    this.emit();
  }

  /** Detect the backend and restore an existing session cookie. */
  async init(): Promise<void> {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      // The Vite dev server answers unknown paths with index.html, so insist on JSON.
      const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
      if (!isJson || res.status === 404) {
        this.backend = 'offline';
      } else if (res.status === 503) {
        this.backend = 'no-database';
        console.warn('[accounts] Backend is deployed but the D1 database binding is missing.');
      } else {
        this.backend = 'online';
        this.profile = res.ok ? ((await res.json()) as ProfileResponse) : null;
      }
    } catch {
      this.backend = 'offline';
    }
    this.emit();
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection.', 0);
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    const data = isJson ? await res.json() : null;
    if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  }

  async register(username: string, password: string): Promise<void> {
    this.profile = await this.call<ProfileResponse>('POST', '/api/register', { username, password });
    // Carry this device's guest settings (paint, fitted cosmetics...) over to the new account.
    if (Object.keys(this.guest.settings).length) await this.saveSettings(this.guest.settings);
    await this.importGuest();
    this.emit();
  }

  async login(username: string, password: string): Promise<void> {
    this.profile = await this.call<ProfileResponse>('POST', '/api/login', { username, password });
    await this.importGuest();
    this.emit();
  }

  /**
   * Anything earned or bought as a guest on this device (money, drift points, cosmetics,
   * upgrades, career results) is added to the account just signed in to, and the guest profile
   * starts afresh so it can't be added twice.
   */
  private async importGuest(): Promise<void> {
    const g = this.guest;
    if (!hasGuestProgress(g.wallet) && g.stats.races === 0) return;
    try {
      this.profile = await this.call<ProfileResponse>('POST', '/api/import', { wallet: g.wallet, stats: g.stats });
    } catch (e) {
      console.warn('[accounts] guest progress not moved', e);
      return;
    }
    // Cosmetics fitted as a guest stay fitted if the account had none on its car.
    const garage = g.settings.garage;
    if (garage && !this.profile.settings.garage?.gt && garage.gt) await this.saveSettings({ garage: { ...this.profile.settings.garage, gt: garage.gt } });
    this.guest = { ...g, stats: emptyStats(), recent: [], wallet: newWallet() };
    saveGuest(this.guest);
    this.notice = 'Your guest progress and purchases were added to this account ✓';
  }

  async logout(): Promise<void> {
    try {
      await this.call('POST', '/api/logout', {});
    } finally {
      this.profile = null;
      this.notice = null;
      this.emit();
    }
  }

  async saveSettings(settings: Partial<PlayerSettings>): Promise<void> {
    if (this.profile) {
      this.profile.settings = { ...this.profile.settings, ...settings };
      try {
        await this.call('PUT', '/api/settings', this.profile.settings);
      } catch (e) {
        console.warn('[accounts] settings not saved', e);
      }
    } else {
      this.guest.settings = { ...this.guest.settings, ...settings };
      saveGuest(this.guest);
    }
  }

  /** Save a finished race to the career. Returns where it was stored. */
  async recordRace(result: RaceRecord): Promise<'account' | 'device' | 'failed'> {
    if (this.profile) {
      try {
        // The server pays the prize money (see shared/economy.ts).
        this.profile = await this.call<ProfileResponse>('POST', '/api/races', result);
        this.emit();
        return 'account';
      } catch (e) {
        console.warn('[accounts] race not saved', e);
        return 'failed';
      }
    }
    const s = this.guest.stats;
    s.races++;
    if (result.position === 1) s.wins++;
    if (result.position <= 3) s.podiums++;
    if (result.bestLap !== null && (s.bestLap === null || result.bestLap < s.bestLap)) s.bestLap = result.bestLap;
    const trackBest = s.bestLaps[result.track];
    if (result.bestLap !== null && (trackBest === undefined || result.bestLap < trackBest)) s.bestLaps[result.track] = result.bestLap;
    s.totalLaps += result.laps;
    const settled = settleResult(this.guest.wallet, result, todayKey());
    if (typeof settled !== 'string') this.guest.wallet = settled.wallet;
    this.guest.recent = [{ ...result, createdAt: Math.floor(Date.now() / 1000) }, ...this.guest.recent].slice(0, 5);
    saveGuest(this.guest);
    this.emit();
    return 'device';
  }
}

function loadGuest(): GuestData {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<GuestData>;
      const stats = { ...emptyStats(), ...data.stats };
      // Guest results from before multiple circuits were all on the Tokyo circuit.
      if (stats.bestLap !== null && stats.bestLaps.tokyo === undefined && !data.stats?.bestLaps) stats.bestLaps = { tokyo: stats.bestLap };
      const recent = (data.recent ?? []).map((r) => ({ ...r, track: r.track ?? 'tokyo' }));
      return { stats, settings: data.settings ?? {}, recent, wallet: cleanWallet(data.wallet) };
    }
  } catch {
    // Storage blocked (private mode etc.) - fall through to a fresh profile.
  }
  return { stats: emptyStats(), settings: {}, recent: [], wallet: newWallet() };
}

function saveGuest(data: GuestData): void {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(data));
  } catch {
    // Ignore: guest progress just won't persist.
  }
}
