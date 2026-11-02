import type { Difficulty } from '../../shared/api';
import { type Cup, GP_RIVALS, pointsFor, standings } from '../../shared/grandprix';

/**
 * A Grand Prix in progress: which cup and class, which round, and how everyone has finished so
 * far. Drivers are numbered 0 (you) then 1..GP_RIVALS for the AI, who keep their names and cars
 * for the whole cup (the field is built from the same seed every round).
 */
export class GrandPrixSession {
  round = 0;
  /** Finishing place of every driver in each race run so far. */
  readonly results: number[][] = [];
  readonly drivers = GP_RIVALS + 1;

  constructor(
    readonly cup: Cup,
    readonly difficulty: Difficulty,
    readonly seed: number,
  ) {}

  get race(): Cup['races'][number] {
    return this.cup.races[this.round];
  }

  get last(): boolean {
    return this.round === this.cup.races.length - 1;
  }

  /** All races done (after the last one is recorded). */
  get over(): boolean {
    return this.results.length >= this.cup.races.length;
  }

  /**
   * Your grid slot: at the back for the first race, then the cup leader starts at the back and
   * whoever's last at the front (like a reverse grid).
   */
  playerSlot(): number {
    if (this.results.length === 0) return this.drivers - 1;
    const rank = standings(this.results).findIndex((r) => r.driver === 0) + 1;
    return this.drivers - rank;
  }

  /** Record a race: each driver's finishing place. */
  record(places: number[]): void {
    if (this.results.length === this.round) this.results.push(places);
    else this.results[this.round] = places;
  }

  next(): void {
    this.round = Math.min(this.round + 1, this.cup.races.length - 1);
  }

  /** The standings now: driver, total points, and points from the latest race. */
  table(): { driver: number; points: number; race: number; place: number }[] {
    const latest = this.results[this.results.length - 1] ?? [];
    return standings(this.results).map((r) => ({ ...r, race: pointsFor(latest[r.driver] ?? 99), place: latest[r.driver] ?? 0 }));
  }

  /** Your place overall (1-based). */
  playerPlace(): number {
    return standings(this.results).findIndex((r) => r.driver === 0) + 1;
  }
}

/**
 * Which GP driver each car in a race is: you are 0, and the AI keep the order they're handed
 * out in (by grid slot, skipping yours).
 */
export function driverOfCars(cars: { id: number; isPlayer: boolean }[]): number[] {
  const out: number[] = [];
  let ai = 0;
  for (const c of [...cars].sort((a, b) => a.id - b.id)) out[c.id] = c.isPlayer ? 0 : ++ai;
  return out;
}
