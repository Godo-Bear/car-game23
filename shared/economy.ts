import type { CarId, Difficulty, Purchase, RaceRecord, UpgradePart, Upgrades, Wallet } from './api';
import { shopItem } from './items';

/**
 * The career economy, shared by the game (guest profiles) and the Worker (accounts), so prices
 * and race pay are identical either way and the server can check every purchase itself.
 */

/** The one car you drive (the Kaze GT); the other cars are the AI's. */
export const PLAYER_CAR: CarId = 'gt';
/** Enough for a first upgrade. */
export const STARTING_CREDITS = 3000;
/** Levels per part. Every part at the top level maxes out every stat, on any car. */
export const MAX_UPGRADE = 4;
export const UPGRADE_PARTS: UpgradePart[] = ['engine', 'gearbox', 'aero', 'tyres', 'suspension', 'brakes', 'diff', 'nitro'];
/** Price of each part's first level (later levels cost more). */
const PART_PRICE: Record<UpgradePart, number> = {
  engine: 3500,
  gearbox: 2500,
  aero: 2000,
  tyres: 2500,
  suspension: 2500,
  brakes: 2000,
  diff: 2000,
  nitro: 2000,
};
const LEVEL_PRICE = [1, 1.7, 2.6, 3.8];
/** Prices as the Kaze GT's were when every car was for sale. */
const UPGRADE_FACTOR = 1.15;

/** Share of the winner's pay by finishing position. */
const PLACE_SHARE = [1, 0.7, 0.5, 0.35, 0.25, 0.2, 0.16, 0.13, 0.11, 0.1, 0.1, 0.1];
const DIFFICULTY_PAY: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.4 };
const PAY_PER_LAP = 3500;

export const NO_UPGRADES: Upgrades = { engine: 0, gearbox: 0, aero: 0, tyres: 0, suspension: 0, brakes: 0, diff: 0, nitro: 0 };

export function newWallet(): Wallet {
  return {
    credits: STARTING_CREDITS,
    owned: [PLAYER_CAR],
    upgrades: {},
    events: {},
    quests: [],
    daily: { day: '', races: 0, wins: 0, podiums: 0, laps: 0, night: 0, mountain: 0, hard: 0, drift: 0, tracks: [], claimed: [] },
    stars: {},
    dp: 0,
    dpTotal: 0,
    items: [],
  };
}

/** Pay for a finished race: more for a better place, more laps, a harder field and more rivals. */
export function raceReward(r: Pick<RaceRecord, 'position' | 'fieldSize' | 'laps' | 'difficulty'>): number {
  const rivals = 0.6 + 0.4 * Math.min(1, (r.fieldSize - 1) / 7);
  const share = PLACE_SHARE[Math.min(r.position, PLACE_SHARE.length) - 1];
  return Math.round((PAY_PER_LAP * r.laps * share * DIFFICULTY_PAY[r.difficulty] * rivals) / 100) * 100;
}

/** Price of upgrade `level` (1..MAX_UPGRADE) of a part. */
export function upgradeCost(part: UpgradePart, level: number): number {
  return Math.round((PART_PRICE[part] * LEVEL_PRICE[level - 1] * UPGRADE_FACTOR) / 100) * 100;
}

export function upgradesOf(wallet: Wallet, car: CarId): Upgrades {
  return { ...NO_UPGRADES, ...wallet.upgrades[car] };
}

/** Apply a purchase, or say why it can't be made. Never changes `wallet`. */
export function purchase(wallet: Wallet, p: Purchase): Wallet | string {
  // Quest rewards need the player's stats too: see claimQuest (shared/quests.ts).
  if (p.kind === 'quest' || p.kind === 'daily') return 'Not a shop purchase.';
  if (p.kind === 'item') {
    const item = shopItem(p.item);
    if (!item) return 'Unknown item.';
    if (wallet.items.includes(item.id)) return 'You already own this.';
    if (item.currency === 'dp') {
      if (wallet.dp < item.price) return 'Not enough drift points.';
      return { ...wallet, dp: wallet.dp - item.price, items: [...wallet.items, item.id] };
    }
    if (wallet.credits < item.price) return 'Not enough money.';
    return { ...wallet, credits: wallet.credits - item.price, items: [...wallet.items, item.id] };
  }
  if (p.kind === 'car') return 'Cars are not for sale: the Kaze GT is your car.';
  if (p.car !== PLAYER_CAR) return 'You can only upgrade your Kaze GT.';
  if (!UPGRADE_PARTS.includes(p.part)) return 'Unknown upgrade.';
  const current = upgradesOf(wallet, p.car);
  const level = current[p.part] + 1;
  if (level > MAX_UPGRADE) return 'Already fully upgraded.';
  const price = upgradeCost(p.part, level);
  if (wallet.credits < price) return 'Not enough money.';
  return { ...wallet, credits: wallet.credits - price, upgrades: { ...wallet.upgrades, [p.car]: { ...current, [p.part]: level } } };
}

/** "¥12,300" */
export function formatYen(n: number): string {
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}
