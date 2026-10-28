import type { PaintFinish } from './api';

/**
 * Cosmetics in the shop. Underglow, nitro flames and tyre smoke are bought with drift points
 * (DP, scored by drifting in races); the premium paint finishes cost money. Once bought, an item
 * can be fitted to any of your cars in the garage. Shared by the game and the Worker.
 */

export type ItemKind = 'glow' | 'flame' | 'smoke' | 'finish';
export type Currency = 'dp' | 'credits';

export interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** Hex colour (glow, flame, smoke); a finish's swatch colour. */
  color: string;
  price: number;
  currency: Currency;
  /** The paint finish a 'finish' item unlocks. */
  finish?: PaintFinish;
}

const item = (kind: ItemKind, key: string, name: string, color: string, price: number, currency: Currency = 'dp'): ShopItem => ({
  id: `${kind}-${key}`,
  kind,
  name,
  color,
  price,
  currency,
});

export const ITEM_KINDS: { kind: ItemKind; name: string }[] = [
  { kind: 'glow', name: 'Underglow' },
  { kind: 'flame', name: 'Nitro flames' },
  { kind: 'smoke', name: 'Tyre smoke' },
  { kind: 'finish', name: 'Paint finishes' },
];

export const SHOP_ITEMS: ShopItem[] = [
  item('glow', 'blue', 'Neon blue', '#2f8cff', 6000),
  item('glow', 'pink', 'Hot pink', '#ff3fa4', 6000),
  item('glow', 'green', 'Toxic green', '#3dff6e', 8000),
  item('glow', 'red', 'Brake red', '#ff2a2a', 8000),
  item('glow', 'purple', 'Ultraviolet', '#9a4dff', 10000),
  item('glow', 'gold', 'Gold rush', '#ffc53d', 14000),
  item('glow', 'white', 'Ice white', '#e8f4ff', 14000),
  item('flame', 'orange', 'Classic orange', '#ff7a1a', 5000),
  item('flame', 'red', 'Inferno red', '#ff2a1a', 7000),
  item('flame', 'green', 'Acid green', '#4dff3a', 9000),
  item('flame', 'purple', 'Plasma purple', '#b04dff', 11000),
  item('flame', 'pink', 'Sakura pink', '#ff5fc8', 11000),
  item('flame', 'white', 'White hot', '#f2f6ff', 16000),
  item('smoke', 'red', 'Red smoke', '#ff3b3b', 5000),
  item('smoke', 'blue', 'Blue smoke', '#3b8cff', 5000),
  item('smoke', 'pink', 'Pink smoke', '#ff6ec7', 7000),
  item('smoke', 'green', 'Green smoke', '#4dff7a', 7000),
  item('smoke', 'yellow', 'Yellow smoke', '#ffd93b', 9000),
  item('smoke', 'purple', 'Purple smoke', '#a35bff', 9000),
  item('smoke', 'black', 'Black smoke', '#1a1a1e', 15000),
  { ...item('finish', 'satin', 'Satin', '#8b93a1', 20000, 'credits'), finish: 'satin' },
  { ...item('finish', 'candy', 'Candy', '#d01c3c', 35000, 'credits'), finish: 'candy' },
  { ...item('finish', 'chrome', 'Chrome', '#d9dee6', 60000, 'credits'), finish: 'chrome' },
];

export const ITEM_IDS = SHOP_ITEMS.map((x) => x.id);

export function shopItem(id: string | undefined): ShopItem | undefined {
  return SHOP_ITEMS.find((x) => x.id === id);
}

/** Paint finishes everyone has; the rest are shop items. */
export const FREE_FINISHES: PaintFinish[] = ['gloss', 'metallic', 'matte', 'pearl'];

/** The shop item that unlocks a paint finish (undefined for the free ones). */
export function finishItem(finish: PaintFinish): ShopItem | undefined {
  return SHOP_ITEMS.find((x) => x.finish === finish);
}

/** "12,300 DP" */
export function formatDp(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} DP`;
}
