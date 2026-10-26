import { formatTime } from '../race/RaceManager';
import type { RaceSimulation } from '../race/RaceSimulation';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM heads-up display. Text nodes are only touched when their value changes. */
export class Hud {
  private readonly root = $('hud');
  private readonly message = $('hud-message');
  private readonly rpmBar = $('hud-rpm');
  private readonly standings = $('hud-standings');
  private readonly tow = $('hud-tow');
  private readonly cache = new Map<string, string>();
  private messageTimer = 0;
  private standingsKey = '';

  constructor(private readonly colors: string[]) {}

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Big centred text, e.g. countdown numbers, "FINAL LAP", "WRONG WAY". */
  showMessage(text: string, seconds: number, style: '' | 'go' | 'warn' | 'gold' | 'small' | 'lights' = ''): void {
    this.message.textContent = text;
    this.message.className = `hud-message show ${style}`;
    this.messageTimer = seconds;
  }

  clearMessage(): void {
    this.messageTimer = 0;
    this.message.className = 'hud-message';
  }

  private set(id: string, value: string): void {
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    $(id).textContent = value;
  }

  update(sim: RaceSimulation, dt: number): void {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.className = 'hud-message';
    }
    const player = sim.player;
    const race = sim.race;
    const me = race.racers[player.id];
    const p = player.physics;

    this.set('hud-speed', String(Math.round(p.speedKmh)));
    this.set('hud-gear', p.gearLabel());
    this.set('hud-pos', String(me.position));
    this.set('hud-pos-total', `/${race.racers.length}`);
    this.set('hud-lap', String(Math.min(me.currentLap, race.totalLaps)));
    this.set('hud-lap-total', `/${race.totalLaps}`);
    this.set('hud-time-lap', formatTime(race.started ? race.currentLapTime(me) : 0));
    this.set('hud-time-last', formatTime(me.lastLapTime));
    this.set('hud-time-best', formatTime(me.bestLapTime));
    this.set('hud-time-race', formatTime(me.finished ? me.finishTime : race.raceTime));

    const rpm = p.rpm / p.spec.redlineRpm;
    this.rpmBar.style.width = `${Math.min(100, rpm * 100).toFixed(1)}%`;
    this.rpmBar.parentElement!.classList.toggle('redline', p.rpm > p.spec.shiftUpRpm);
    this.tow.classList.toggle('on', player.slipstream > 0.25 && p.speedKmh > 80);

    const order = race.standings();
    const key = order.map((r) => r.id).join(',');
    if (key !== this.standingsKey) {
      this.standingsKey = key;
      this.standings.replaceChildren(
        ...order.map((r) => {
          const li = document.createElement('li');
          if (r.isPlayer) li.className = 'me';
          const pos = document.createElement('span');
          pos.className = 'p';
          pos.textContent = String(r.position);
          const swatch = document.createElement('span');
          swatch.className = 'swatch';
          swatch.style.background = this.colors[r.id] ?? '#fff';
          const name = document.createElement('span');
          name.textContent = r.name;
          li.append(pos, swatch, name);
          return li;
        }),
      );
    }
  }
}
