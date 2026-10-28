import type { CareerStats, Wallet } from './api';
import { CAREER_EVENTS } from './career';
import { CAR_PRICES } from './economy';

/**
 * Quests: goals across the whole game with a cash reward, claimed once each from the home
 * screen. Shared by the game (guests) and the Worker, which checks them against the account's
 * own stats, so rewards can't be claimed early.
 */
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
/** Cars bought (the free starter car doesn't count). */
const carsBought = (w: Wallet) => w.owned.filter((c) => CAR_PRICES[c] > 0).length;

const q = (id: string, name: string, detail: string, reward: number, goal: number, progress: Quest['progress']): Quest => ({
  id,
  name,
  detail,
  reward,
  goal,
  progress,
});

export const QUESTS: Quest[] = [
  q('first-win', 'First win', 'Win any race', 5000, 1, (_, s) => s.wins),
  q('career-3', 'Career start', 'Get 3 career events on the podium', 8000, 3, careerPodiums),
  q('upgrades-4', 'Tuner', 'Fit 4 upgrades to your cars', 6000, 4, upgradeLevels),
  q('races-10', 'Keep racing', 'Finish 10 races', 8000, 10, (_, s) => s.races),
  q('podiums-5', 'Podium regular', 'Finish on the podium 5 times', 10000, 5, (_, s) => s.podiums),
  q('first-car', 'New wheels', 'Buy a car in the shop', 10000, 1, carsBought),
  q('circuits-5', 'Tourist', 'Set a lap time on 5 circuits', 12000, 5, (_, s) => Object.keys(s.bestLaps).length),
  q('laps-40', 'Lap after lap', 'Drive 40 laps', 12000, 40, (_, s) => s.totalLaps),
  q('career-10', 'Rising star', 'Get 10 career events on the podium', 25000, 10, careerPodiums),
  q('upgrades-16', 'Tuning shop', 'Fit 16 upgrades to your cars', 20000, 16, upgradeLevels),
  q('wins-10', 'Champion', 'Win 10 races', 30000, 10, (_, s) => s.wins),
  q('circuits-10', 'Grand tour', 'Set a lap time on all 10 circuits', 30000, 10, (_, s) => Object.keys(s.bestLaps).length),
  q('cars-3', 'Collector', 'Buy 3 cars', 40000, 3, carsBought),
  q('career-20', 'Legend', 'Get every career event on the podium', 100000, CAREER_EVENTS.length, careerPodiums),
];

export const QUEST_IDS = QUESTS.map((x) => x.id);

export function questDone(quest: Quest, wallet: Wallet, stats: CareerStats): boolean {
  return quest.progress(wallet, stats) >= quest.goal;
}

/** The home screen's list: rewards waiting to be claimed first, then the closest to done. */
export function questsToShow(wallet: Wallet, stats: CareerStats, count: number): Quest[] {
  const open = QUESTS.filter((x) => !wallet.quests.includes(x.id));
  const score = (x: Quest) => (questDone(x, wallet, stats) ? 2 : Math.min(1, x.progress(wallet, stats) / x.goal));
  return [...open].sort((a, b) => score(b) - score(a) || QUESTS.indexOf(a) - QUESTS.indexOf(b)).slice(0, count);
}

/** Claim a finished quest's reward (once). */
export function claimQuest(wallet: Wallet, stats: CareerStats, id: string): Wallet | string {
  const quest = QUESTS.find((x) => x.id === id);
  if (!quest) return 'Unknown quest.';
  if (wallet.quests.includes(id)) return 'Already claimed.';
  if (!questDone(quest, wallet, stats)) return 'That quest is not finished yet.';
  return { ...wallet, credits: wallet.credits + quest.reward, quests: [...wallet.quests, id] };
}
