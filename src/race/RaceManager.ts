import type { BoostKind } from '../physics/VehiclePhysics';
import type { PickupKind } from './Pickups';
export interface RacerInfo {
  id: number;
  name: string;
  isPlayer: boolean;
}

export interface RacerState extends RacerInfo {
  /** Distance travelled since the start line (negative while still behind it on the grid). */
  totalDistance: number;
  /** Laps fully completed. */
  lapsCompleted: number;
  /** 1-based lap currently being driven (capped at total laps). */
  currentLap: number;
  lapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  lapTimes: number[];
  finished: boolean;
  finishTime: number | null;
  position: number;
  /** Lap distance from the previous update, used to unwrap progress across the start line. */
  prevLapDistance: number;
}

export type RaceEvent =
  | { type: 'lap'; racerId: number; lap: number; time: number; best: boolean }
  | { type: 'finalLap'; racerId: number }
  | { type: 'finish'; racerId: number; position: number; time: number }
  /** Nitro pickups and special boosts (see Pickups.ts and VehiclePhysics). */
  | { type: 'pickup'; racerId: number; kind: PickupKind }
  | { type: 'boost'; racerId: number; kind: BoostKind };

/**
 * Tracks laps, lap times and race positions.
 *
 * Progress is measured as a continuous distance along the racing line ("total distance"):
 * each update adds the (wrap-corrected) change in lap distance. Driving backwards reduces it,
 * so reversing over the line can never count a lap, and positions are simply sorted by it.
 */
export class RaceManager {
  readonly trackLength: number;
  readonly totalLaps: number;
  readonly racers: RacerState[];
  raceTime = 0;
  started = false;
  private finishOrder = 0;

  constructor(trackLength: number, totalLaps: number, racers: RacerInfo[], startLapDistances: number[]) {
    this.trackLength = trackLength;
    this.totalLaps = totalLaps;
    this.racers = racers.map((r, i) => {
      const d = startLapDistances[i];
      // Grid slots sit just behind the line, i.e. at the very end of the previous lap.
      const total = d > trackLength / 2 ? d - trackLength : d;
      return {
        id: r.id,
        name: r.name,
        isPlayer: r.isPlayer,
        totalDistance: total,
        lapsCompleted: 0,
        currentLap: 1,
        lapStartTime: 0,
        lastLapTime: null,
        bestLapTime: null,
        lapTimes: [],
        finished: false,
        finishTime: null,
        position: i + 1,
        prevLapDistance: d,
      };
    });
    this.updatePositions();
  }

  start(): void {
    this.started = true;
    this.raceTime = 0;
    for (const r of this.racers) r.lapStartTime = 0;
  }

  get leaderLap(): number {
    return Math.max(...this.racers.map((r) => r.currentLap));
  }

  /**
   * Advance race time and feed the latest lap distance (0..trackLength) for each racer,
   * indexed like the constructor's `racers` array.
   */
  update(dt: number, lapDistances: number[]): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (!this.started) return events;
    this.raceTime += dt;
    const L = this.trackLength;

    for (let i = 0; i < this.racers.length; i++) {
      const r = this.racers[i];
      const d = lapDistances[i];
      let delta = d - r.prevLapDistance;
      if (delta < -L / 2) delta += L;
      else if (delta > L / 2) delta -= L;
      r.prevLapDistance = d;
      r.totalDistance += delta;
      if (r.finished) continue;

      const laps = Math.max(0, Math.floor(r.totalDistance / L));
      while (laps > r.lapsCompleted && !r.finished) {
        // Interpolate the exact crossing time within this step for accurate lap times.
        const over = r.totalDistance - (r.lapsCompleted + 1) * L;
        const frac = delta > 1e-6 ? Math.min(1, over / delta) : 0;
        const crossTime = this.raceTime - dt * frac;
        const lapTime = crossTime - r.lapStartTime;
        r.lapsCompleted++;
        r.lapTimes.push(lapTime);
        r.lastLapTime = lapTime;
        const best = r.bestLapTime === null || lapTime < r.bestLapTime;
        if (best) r.bestLapTime = lapTime;
        r.lapStartTime = crossTime;
        events.push({ type: 'lap', racerId: r.id, lap: r.lapsCompleted, time: lapTime, best });

        if (r.lapsCompleted >= this.totalLaps) {
          r.finished = true;
          r.finishTime = crossTime;
          r.position = ++this.finishOrder;
          events.push({ type: 'finish', racerId: r.id, position: r.position, time: crossTime });
        } else {
          r.currentLap = r.lapsCompleted + 1;
          if (r.currentLap === this.totalLaps) events.push({ type: 'finalLap', racerId: r.id });
        }
      }
    }
    this.updatePositions();
    return events;
  }

  currentLapTime(r: RacerState): number {
    return r.finished ? (r.lapTimes[r.lapTimes.length - 1] ?? 0) : this.raceTime - r.lapStartTime;
  }

  standings(): RacerState[] {
    return [...this.racers].sort((a, b) => a.position - b.position);
  }

  private updatePositions(): void {
    const finished = this.racers.filter((r) => r.finished).sort((a, b) => a.position - b.position);
    const running = this.racers.filter((r) => !r.finished).sort((a, b) => b.totalDistance - a.totalDistance);
    let pos = finished.length;
    for (const r of running) r.position = ++pos;
  }
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
