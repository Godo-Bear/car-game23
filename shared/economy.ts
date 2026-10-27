import { CAR_IDS, type CarId, type Difficulty, type Purchase, type RaceRecord, type UpgradePart, type Upgrades, type Wallet } from './api';

/**
 * The career economy, shared by the game (guest profiles) and the Worker (accounts), so prices
 * and race pay are identical either way and the server can check every purchase itself.
 */

export const STARTER_CAR: CarId = 'starter';
/** Enough for a first upgrade. */
export const STARTING_CREDITS = 3000;
export const MAX_UPGRADE = 3;
export const UPGRADE_PARTS: UpgradePart[] = ['engine', 'handling', 'nitro'];

/** Shop prices in yen; the starter car is free. */
export const CAR_PRICES: Record<CarId, number> = {
  starter: 0,
  hatch: 30_000,
  gt: 60_000,
  drift: 80_000,
  rally: 100_000,
  super: 220_000,
};

/** Share of the winner's pay by finishing position. */
const PLACE_SHARE = [1, 0.7, 0.5, 0.35, 0.25, 0.2, 0.16, 0.13, 0.11, 0.1, 0.1, 0.1];
const DIFFICULTY_PAY: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.4 };
const PAY_PER_LAP = 3500;

export const NO_UPGRADES: Upgrades = { engine: 0, handling: 0, nitro: 0 };

export function newWallet(): Wallet {
  return { credits: STARTING_CREDITS, owned: [STARTER_CAR], upgrades: {} };
}

/** Pay for a finished race: more for a better place, more laps, a harder field and more rivals. */
export function raceReward(r: Pick<RaceRecord, 'position' | 'fieldSize' | 'laps' | 'difficulty'>): number {
  const rivals = 0.6 + 0.4 * Math.min(1, (r.fieldSize - 1) / 7);
  const share = PLACE_SHARE[Math.min(r.position, PLACE_SHARE.length) - 1];
  return Math.round((PAY_PER_LAP * r.laps * share * DIFFICULTY_PAY[r.difficulty] * rivals) / 100) * 100;
}

/** Price of upgrade `level` (1..MAX_UPGRADE) for a car: dearer cars cost more to tune. */
export function upgradeCost(car: CarId, part: UpgradePart, level: number): number {
  const base = Math.max(2500, CAR_PRICES[car] * 0.08) * (part === 'nitro' ? 0.8 : 1);
  return Math.round((base * [1, 1.8, 3][level - 1]) / 100) * 100;
}

export function upgradesOf(wallet: Wallet, car: CarId): Upgrades {
  return { ...NO_UPGRADES, ...wallet.upgrades[car] };
}

/** Apply a purchase, or say why it can't be made. Never changes `wallet`. */
export function purchase(wallet: Wallet, p: Purchase): Wallet | string {
  if (!CAR_IDS.includes(p.car)) return 'Unknown car.';
  if (p.kind === 'car') {
    if (wallet.owned.includes(p.car)) return 'You already own this car.';
    const price = CAR_PRICES[p.car];
    if (wallet.credits < price) return 'Not enough money.';
    return { ...wallet, credits: wallet.credits - price, owned: [...wallet.owned, p.car] };
  }
  if (!wallet.owned.includes(p.car)) return 'Buy the car first.';
  if (!UPGRADE_PARTS.includes(p.part)) return 'Unknown upgrade.';
  const current = upgradesOf(wallet, p.car);
  const level = current[p.part] + 1;
  if (level > MAX_UPGRADE) return 'Already fully upgraded.';
  const price = upgradeCost(p.car, p.part, level);
  if (wallet.credits < price) return 'Not enough money.';
  return { ...wallet, credits: wallet.credits - price, upgrades: { ...wallet.upgrades, [p.car]: { ...current, [p.part]: level } } };
}

/** Validate a wallet from storage; anything missing or odd falls back to a fresh start. */
export function cleanWallet(raw: unknown): Wallet {
  const fresh = newWallet();
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const credits = Number.isInteger(r.credits) && (r.credits as number) >= 0 ? Math.min(r.credits as number, 1e9) : fresh.credits;
  const owned = CAR_IDS.filter((id) => id === STARTER_CAR || (Array.isArray(r.owned) && r.owned.includes(id)));
  const upgrades: Wallet['upgrades'] = {};
  const rawUpgrades = r.upgrades && typeof r.upgrades === 'object' ? (r.upgrades as Record<string, unknown>) : {};
  for (const id of owned) {
    const u = rawUpgrades[id] as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') continue;
    const level = (v: unknown) => (Number.isInteger(v) ? Math.max(0, Math.min(MAX_UPGRADE, v as number)) : 0);
    upgrades[id] = { engine: level(u.engine), handling: level(u.handling), nitro: level(u.nitro) };
  }
  return { credits, owned, upgrades };
}

/** "¥12,300" */
export function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}
