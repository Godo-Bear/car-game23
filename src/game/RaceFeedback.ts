import type { ChaseCamera } from '../camera/ChaseCamera';
import type { AudioEngine } from '../core/AudioEngine';
import { clamp, smoothstep } from '../core/math';
import type { SettingsStore } from '../core/Settings';
import type { RaceSimulation } from '../race/RaceSimulation';
import { KERB_INNER, KERB_OUTER, kerbSide } from '../track/TrackMesh';
import type { Hud } from '../ui/Hud';
import type { Sparks } from '../vehicles/Sparks';

/**
 * Everything the race tells you through sound, camera and screen effects: impacts, kerb rumble,
 * barrier scrapes with sparks, drift points, the wrong-way warning and speed blur.
 */
export class RaceFeedback {
  private driftScore = 0;
  /** Drift points banked this race (each drift counts once it ends cleanly). */
  private banked = 0;
  private driftQuiet = 0;
  private wrongWayTime = 0;
  private kerbPhase = 0;
  private sparkCarry = 0;
  /** Wall-contact counts seen last frame, per car (a frame spans several physics steps). */
  private readonly lastContacts = new WeakMap<object, number>();
  private scrapeHold = 0;
  /** Free drive: no wrong way (there's no right way). */
  freeDrive = false;

  constructor(
    private readonly hud: Hud,
    private readonly audio: AudioEngine,
    private readonly cam: ChaseCamera,
    private readonly sparks: Sparks,
    private readonly store: SettingsStore,
  ) {}

  reset(): void {
    this.driftScore = 0;
    this.banked = 0;
    this.driftQuiet = 0;
    this.wrongWayTime = 0;
    this.sparks.clear();
    this.audio.surface(0, 0);
  }

  /** Drift points scored this race, including a drift still going (call at the finish). */
  get driftPoints(): number {
    return Math.round(this.banked + (this.driftScore >= 100 ? this.driftScore : 0));
  }

  /** Silence continuous sounds (menus, pause). */
  quiet(): void {
    this.audio.surface(0, 0);
  }

  /**
   * Per-frame update while a race is on screen. `impact` is the strongest player impact over this
   * frame's physics steps. Returns the speed-blur amount (0..1).
   */
  update(sim: RaceSimulation, racing: boolean, impact: number, dt: number): number {
    const player = sim.player;
    const p = player.physics;
    const shake = this.store.value.cameraShake;
    if (impact > 1.5) {
      this.audio.impact(impact);
      if (shake) this.cam.addShake(Math.min(1, impact / 15));
    }

    // Kerbs: any wheel on the painted strip rumbles (pulsing as it crosses the stripes).
    const track = sim.track;
    const side = kerbSide(track, player.proj.index);
    let kerb = 0;
    if (side !== 0 && p.speed > 4) {
      const hw = track.halfWidth;
      for (const offset of [-0.85, 0.85]) {
        const l = side * (player.proj.lateral + offset);
        if (l > hw - KERB_INNER && l < hw + KERB_OUTER) kerb += 0.5;
      }
    }
    this.kerbPhase += (p.speed / track.spacing) * Math.PI * dt;
    const rumble = kerb * (0.55 + 0.45 * Math.sin(this.kerbPhase));
    if (shake && kerb > 0) this.cam.addShake(kerb * clamp(p.speed / 30, 0.3, 1) * 2.2 * dt);

    // Barrier scrapes: sparks from the contact point (any car), grinding noise for the player.
    this.sparkCarry += dt * 110;
    const burst = Math.floor(this.sparkCarry);
    this.sparkCarry -= burst;
    this.scrapeHold = Math.max(0, this.scrapeHold - dt);
    for (const car of sim.cars) {
      const c = car.physics;
      const touched = car.wall.count !== (this.lastContacts.get(car) ?? 0);
      this.lastContacts.set(car, car.wall.count);
      if (!touched || c.speed < 6) continue;
      // Hold the grinding sound briefly: a scrape is a series of tiny bounces off the barrier.
      if (car === player) this.scrapeHold = 0.18;
      this.sparks.emit(car.wall.x, c.y + 0.35, car.wall.z, c.vx, c.vz, Math.max(3, Math.round(burst * clamp(c.speed / 35, 0.4, 1))));
    }
    const scrape = this.scrapeHold > 0 ? clamp(p.speed / 30, 0.25, 1) : 0;
    this.audio.surface(rumble, scrape);
    this.sparks.update(dt);

    if (racing) this.updateDrift(sim, impact, dt);
    if (!racing || !this.store.value.motionBlur) return 0;
    return smoothstep(48, 72, p.speed);
  }

  private updateDrift(sim: RaceSimulation, impact: number, dt: number): void {
    const player = sim.player;
    const p = player.physics;
    // Drift points: speed x angle while sliding; a crash during the drift loses them.
    const angle = Math.abs(p.driftAngle);
    if (impact > 3) this.driftScore = 0;
    if (p.drifting && angle > 0.2 && p.speed > 8) {
      this.driftScore += p.speed * angle * (180 / Math.PI) * 0.5 * dt;
      this.driftQuiet = 0;
    } else if (this.driftScore > 0) {
      this.driftQuiet += dt;
      if (this.driftQuiet > 0.6) {
        if (this.driftScore >= 100) {
          this.banked += this.driftScore;
          this.hud.showMessage(`+${Math.round(this.driftScore).toLocaleString('en-US')} DP`, 1.6, 'gold');
        }
        this.driftScore = 0;
      }
    }

    const along = p.vx * player.proj.tx + p.vz * player.proj.tz;
    if (along < -3) this.wrongWayTime += dt;
    else this.wrongWayTime = Math.max(0, this.wrongWayTime - dt * 2);
    if (this.wrongWayTime > 1.2 && !this.freeDrive) this.hud.showMessage('WRONG WAY', 0.3, 'warn');
  }
}
