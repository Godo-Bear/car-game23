import { CAR_IDS, type CarId, TRACK_IDS, type Upgrades, type Wallet } from './api';
import { CAREER_EVENT_IDS, MAX_STARS } from './career';
import { MAX_UPGRADE, newWallet, PLAYER_CAR, UPGRADE_PARTS } from './economy';
import { ITEM_IDS } from './items';
import { DAILY_POOL, freshDaily, QUEST_IDS } from './quests';

/*
 * Wallet validation lives on its own because it needs the economy, the career and the quests
 * (which themselves depend on the economy) - keeping those modules free of import cycles.
 */

/** What each car cost when cars were sold (to refund them: see cleanWallet). */
const OLD_CAR_PRICES: Record<CarId, number> = { starter: 0, hatch: 30_000, gt: 60_000, drift: 80_000, rally: 100_000, super: 220_000 };

/** Validate a wallet from storage; anything missing or odd falls back to a fresh start. */
export function cleanWallet(raw: unknown): Wallet {
  const fresh = newWallet();
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const base = Number.isInteger(r.credits) && (r.credits as number) >= 0 ? Math.min(r.credits as number, 1e9) : fresh.credits;
  // You drive one car now. Saves from when cars were sold: the money for any other car bought
  // comes back, and the Kaze GT gets the best level of each part fitted to any of your cars.
  const hadOwned = Array.isArray(r.owned) ? CAR_IDS.filter((id) => (r.owned as unknown[]).includes(id)) : [];
  const refund = hadOwned.reduce((sum, id) => sum + (id === PLAYER_CAR ? 0 : OLD_CAR_PRICES[id]), 0);
  const credits = Math.min(base + refund, 1e9);
  const owned = [PLAYER_CAR];
  const rawUpgrades = r.upgrades && typeof r.upgrades === 'object' ? (r.upgrades as Record<string, unknown>) : {};
  const level = (v: unknown) => (Number.isInteger(v) ? Math.max(0, Math.min(MAX_UPGRADE, v as number)) : 0);
  let best: Upgrades | null = null;
  // (The free starter car was always owned, so its upgrades count too.)
  for (const id of new Set<CarId>([...hadOwned, 'starter', PLAYER_CAR])) {
    const u = rawUpgrades[id] as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') continue;
    // Saves from before the parts were split up had one "handling" upgrade: tyres, suspension and brakes.
    const old = level(u.handling);
    const levels = Object.fromEntries(
      UPGRADE_PARTS.map((part) => [part, u[part] === undefined && ['tyres', 'suspension', 'brakes'].includes(part) ? old : level(u[part])]),
    ) as Upgrades;
    best = best ? (Object.fromEntries(UPGRADE_PARTS.map((part) => [part, Math.max(best![part], levels[part])])) as Upgrades) : levels;
  }
  const upgrades: Wallet['upgrades'] = best ? { [PLAYER_CAR]: best } : {};
  // Career results (only known events, positions 1..12).
  const events: Wallet['events'] = {};
  const rawEvents = r.events && typeof r.events === 'object' ? (r.events as Record<string, unknown>) : {};
  for (const [id, pos] of Object.entries(rawEvents)) {
    if (CAREER_EVENT_IDS.includes(id) && Number.isInteger(pos) && (pos as number) >= 1 && (pos as number) <= 12) events[id] = pos as number;
  }
  const stars: Wallet['stars'] = {};
  const rawStars = r.stars && typeof r.stars === 'object' ? (r.stars as Record<string, unknown>) : {};
  for (const [id, n] of Object.entries(rawStars)) {
    if (CAREER_EVENT_IDS.includes(id) && Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_STARS) stars[id] = n as number;
  }
  const amount = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, 1e9) : 0);
  const dp = amount(r.dp);
  const dpTotal = Math.max(dp, amount(r.dpTotal));
  const items = Array.isArray(r.items) ? ITEM_IDS.filter((id) => (r.items as unknown[]).includes(id)) : [];
  const quests = Array.isArray(r.quests) ? QUEST_IDS.filter((id) => (r.quests as unknown[]).includes(id)) : [];
  // Today's daily quest progress (counts are whole numbers, lists of known ids).
  const d = r.daily && typeof r.daily === 'object' ? (r.daily as Record<string, unknown>) : {};
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, 10000) : 0);
  const ids = (v: unknown, known: string[]) => (Array.isArray(v) ? known.filter((id) => v.includes(id)) : []);
  const daily = {
    ...freshDaily(typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : ''),
    races: count(d.races),
    wins: count(d.wins),
    podiums: count(d.podiums),
    laps: count(d.laps),
    night: count(d.night),
    mountain: count(d.mountain),
    hard: count(d.hard),
    drift: Number.isInteger(d.drift) && (d.drift as number) >= 0 ? Math.min(d.drift as number, 1e7) : 0,
    tracks: ids(d.tracks, TRACK_IDS),
    claimed: ids(
      d.claimed,
      DAILY_POOL.map((x) => x.id),
    ),
  };
  return { credits, owned, upgrades, events, quests, daily, stars, dp, dpTotal, items };
}
