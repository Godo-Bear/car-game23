import { CAR_IDS, type Upgrades, type Wallet } from './api';
import { CAREER_EVENT_IDS } from './career';
import { MAX_UPGRADE, newWallet, STARTER_CAR, UPGRADE_PARTS } from './economy';
import { QUEST_IDS } from './quests';

/*
 * Wallet validation lives on its own because it needs the economy, the career and the quests
 * (which themselves depend on the economy) - keeping those modules free of import cycles.
 */

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
    // Saves from before the parts were split up had one "handling" upgrade: tyres, suspension and brakes.
    const old = level(u.handling);
    upgrades[id] = Object.fromEntries(
      UPGRADE_PARTS.map((part) => [part, u[part] === undefined && ['tyres', 'suspension', 'brakes'].includes(part) ? old : level(u[part])]),
    ) as Upgrades;
  }
  // Career results (only known events, positions 1..12).
  const events: Wallet['events'] = {};
  const rawEvents = r.events && typeof r.events === 'object' ? (r.events as Record<string, unknown>) : {};
  for (const [id, pos] of Object.entries(rawEvents)) {
    if (CAREER_EVENT_IDS.includes(id) && Number.isInteger(pos) && (pos as number) >= 1 && (pos as number) <= 12) events[id] = pos as number;
  }
  const quests = Array.isArray(r.quests) ? QUEST_IDS.filter((id) => (r.quests as unknown[]).includes(id)) : [];
  return { credits, owned, upgrades, events, quests };
}
