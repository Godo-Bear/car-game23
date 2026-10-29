import type { CareerStats, RaceRecord, Wallet } from './api';
import { CAREER_EVENTS, careerEvent, MAX_STARS, raceDriftPoints, type Settled, settleRace, totalStars } from './career';
import { MAX_UPGRADE, UPGRADE_PARTS } from './economy';
import { ITEM_IDS } from './items';

/**
 * Quests, shared by the game (guests) and the Worker (which checks every claim):
 *  - mega quests: big goals that take a while, each claimed once for a large reward;
 *  - daily quests: three small goals a day (UTC), counted from that day's races.
 */

// ---------------------------------------------------------------- mega quests

export interface Quest {
  id: string;
  name: string;
  detail: string;
  reward: number;
  goal: number;
  progress(wallet: Wallet, stats: CareerStats): number;
}

const careerPodiums = (w: Wallet) => CAREER_EVENTS.filter((e) => (w.events[e.id] ?? 99) <= 3).length;
const upgradeLevels = (w: Wallet) => Object.values(w.upgrades).reduce((sum, u) => sum + Object.values(u ?? {}).reduce((a, b) => a + b, 0), 0);
/** Shop cosmetics owned. */
const itemsOwned = (w: Wallet) => w.items.length;
/** Best-upgraded car: how many parts are at the top level. */
const maxedParts = (w: Wallet) => Math.max(0, ...Object.values(w.upgrades).map((u) => UPGRADE_PARTS.filter((p) => (u?.[p] ?? 0) >= MAX_UPGRADE).length));

const q = (id: string, name: string, detail: string, reward: number, goal: number, progress: Quest['progress']): Quest => ({
  id,
  name,
  detail,
  reward,
  goal,
  progress,
});

export const MEGA_QUESTS: Quest[] = [
  q('career-10', 'Rising star', 'Get 10 career events on the podium', 25000, 10, careerPodiums),
  q('circuits-10', 'Grand tour', 'Set a lap time on all 10 circuits', 30000, 10, (_, s) => Object.keys(s.bestLaps).length),
  q('items-5', 'Collector', 'Buy 5 cosmetics in the shop', 40000, 5, itemsOwned),
  q('upgrades-32', 'Tuning shop', 'Fit all 32 upgrades to your Kaze GT', 40000, 32, upgradeLevels),
  q('wins-25', 'Champion', 'Win 25 races', 50000, 25, (_, s) => s.wins),
  q('max-car', 'Maxed out', 'Fully upgrade every part of your car', 50000, UPGRADE_PARTS.length, maxedParts),
  q('podiums-50', 'Podium machine', 'Finish on the podium 50 times', 60000, 50, (_, s) => s.podiums),
  q('laps-300', 'Road warrior', 'Drive 300 laps', 70000, 300, (_, s) => s.totalLaps),
  q('races-100', 'Marathon', 'Finish 100 races', 80000, 100, (_, s) => s.races),
  q('stars-30', 'Star collector', 'Earn 30 career stars', 60000, 30, totalStars),
  q('drift-100k', 'Drift king', 'Score 100,000 drift points', 60000, 100_000, (w) => w.dpTotal),
  q('career-20', 'Legend', 'Get every career event on the podium', 100000, CAREER_EVENTS.length, careerPodiums),
  q('items-all', 'Show-off', 'Own every cosmetic in the shop', 150000, ITEM_IDS.length, itemsOwned),
  q('stars-all', 'Perfectionist', 'Earn every career star', 200000, CAREER_EVENTS.length * MAX_STARS, totalStars),
];

export const QUEST_IDS = MEGA_QUESTS.map((x) => x.id);

export function questDone(quest: Quest, wallet: Wallet, stats: CareerStats): boolean {
  return quest.progress(wallet, stats) >= quest.goal;
}

/** Mega quests in display order: rewards waiting to be claimed first, then the closest to done. */
export function megaToShow(wallet: Wallet, stats: CareerStats): Quest[] {
  const open = MEGA_QUESTS.filter((x) => !wallet.quests.includes(x.id));
  const score = (x: Quest) => (questDone(x, wallet, stats) ? 2 : Math.min(1, x.progress(wallet, stats) / x.goal));
  return [...open].sort((a, b) => score(b) - score(a) || MEGA_QUESTS.indexOf(a) - MEGA_QUESTS.indexOf(b));
}

/** Claim a finished mega quest's reward (once). */
export function claimQuest(wallet: Wallet, stats: CareerStats, id: string): Wallet | string {
  const quest = MEGA_QUESTS.find((x) => x.id === id);
  if (!quest) return 'Unknown quest.';
  if (wallet.quests.includes(id)) return 'Already claimed.';
  if (!questDone(quest, wallet, stats)) return 'That quest is not finished yet.';
  return { ...wallet, credits: wallet.credits + quest.reward, quests: [...wallet.quests, id] };
}

// ---------------------------------------------------------------- daily quests

/** One day's racing (UTC), counted as results come in. */
export interface DailyProgress {
  day: string;
  races: number;
  wins: number;
  podiums: number;
  laps: number;
  night: number;
  mountain: number;
  hard: number;
  /** Drift points scored today. */
  drift: number;
  /** Circuits raced today. */
  tracks: string[];
  /** Daily quests claimed today. */
  claimed: string[];
}

export interface DailyQuest {
  id: string;
  name: string;
  detail: string;
  reward: number;
  goal: number;
  progress(d: DailyProgress): number;
}

const MOUNTAIN_TRACKS = ['hakone', 'irohazaka', 'haruna', 'niseko'];

const dq = (id: string, name: string, detail: string, reward: number, goal: number, progress: DailyQuest['progress']): DailyQuest => ({
  id,
  name,
  detail,
  reward,
  goal,
  progress,
});

export const DAILY_POOL: DailyQuest[] = [
  dq('d-races-3', 'Warm up', 'Finish 3 races', 3000, 3, (d) => d.races),
  dq('d-win', 'Winner', 'Win a race', 4000, 1, (d) => d.wins),
  dq('d-podiums-2', 'On the box', 'Finish on the podium twice', 4000, 2, (d) => d.podiums),
  dq('d-laps-10', 'Clock the laps', 'Drive 10 laps', 3000, 10, (d) => d.laps),
  dq('d-night', 'Night owl', 'Finish a race at night', 2500, 1, (d) => d.night),
  dq('d-mountain', 'Touge run', 'Race on a mountain pass', 3000, 1, (d) => d.mountain),
  dq('d-tracks-2', 'Road trip', 'Race on 2 different circuits', 3500, 2, (d) => d.tracks.length),
  dq('d-hard', 'No mercy', 'Finish a race on Hard', 4000, 1, (d) => d.hard),
  dq('d-drift', 'Sideways', 'Score 3,000 drift points', 3500, 3000, (d) => d.drift),
];

export const DAILY_COUNT = 3;

/** Today's date (UTC), the key daily quests reset on. */
export function todayKey(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Milliseconds until the daily quests reset (UTC midnight). */
export function msUntilReset(ms = Date.now()): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms;
}

export function freshDaily(day: string): DailyProgress {
  return { day, races: 0, wins: 0, podiums: 0, laps: 0, night: 0, mountain: 0, hard: 0, drift: 0, tracks: [], claimed: [] };
}

/** The wallet's progress for `day` (a new day starts from zero). */
export function dailyFor(wallet: Wallet, day: string): DailyProgress {
  return wallet.daily.day === day ? wallet.daily : freshDaily(day);
}

/** The day's three quests, picked from the pool by the date (the same for everyone). */
export function dailyQuests(day: string): DailyQuest[] {
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const pool = [...DAILY_POOL];
  const out: DailyQuest[] = [];
  for (let k = 0; k < DAILY_COUNT; k++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

/** Count a finished race toward the day's quests. */
export function recordDaily(wallet: Wallet, r: RaceRecord, day: string): Wallet {
  const d = dailyFor(wallet, day);
  const night = careerEvent(r.event)?.timeOfDay === 'night';
  return {
    ...wallet,
    daily: {
      ...d,
      races: d.races + 1,
      wins: d.wins + (r.position === 1 ? 1 : 0),
      podiums: d.podiums + (r.position <= 3 ? 1 : 0),
      laps: d.laps + r.laps,
      night: d.night + (night ? 1 : 0),
      mountain: d.mountain + (MOUNTAIN_TRACKS.includes(r.track) ? 1 : 0),
      hard: d.hard + (r.difficulty === 'hard' ? 1 : 0),
      drift: d.drift + raceDriftPoints(r),
      tracks: d.tracks.includes(r.track) ? d.tracks : [...d.tracks, r.track],
    },
  };
}

/** Claim one of today's finished daily quests. */
export function claimDaily(wallet: Wallet, id: string, day: string): Wallet | string {
  const quest = dailyQuests(day).find((x) => x.id === id);
  if (!quest) return 'That is not one of today’s quests.';
  const d = dailyFor(wallet, day);
  if (d.claimed.includes(id)) return 'Already claimed today.';
  if (quest.progress(d) < quest.goal) return 'That quest is not finished yet.';
  return { ...wallet, credits: wallet.credits + quest.reward, daily: { ...d, claimed: [...d.claimed, id] } };
}

/** A finished race: prize money and career event (see settleRace), plus the day's quests. */
export function settleResult(wallet: Wallet, r: RaceRecord, day: string): Settled | string {
  const settled = settleRace(wallet, r);
  if (typeof settled === 'string') return settled;
  return { ...settled, wallet: recordDaily(settled.wallet, r, day) };
}
