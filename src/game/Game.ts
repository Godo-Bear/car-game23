import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { PlayerSettings } from '../../shared/api';
import { AccountService } from '../account/AccountService';
import { RacingLine } from '../ai/RacingLine';
import { ChaseCamera, type CameraMode } from '../camera/ChaseCamera';
import { AudioEngine } from '../core/AudioEngine';
import { Input } from '../core/Input';
import { createRng } from '../core/math';
import { neutralControls } from '../physics/VehiclePhysics';
import { formatTime, type RaceEvent } from '../race/RaceManager';
import { gridSlot, RaceSimulation } from '../race/RaceSimulation';
import { tokyoCircuitLandmarks, TOKYO_CIRCUIT } from '../track/tokyoCircuit';
import { buildTrackVisual, type TrackVisual } from '../track/TrackMesh';
import { TrackPath } from '../track/TrackPath';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { Screens } from '../ui/Screens';
import { CarModel, LIVERIES } from '../vehicles/CarModel';
import { TireEffects, type EffectsCar } from '../vehicles/TireEffects';
import { City, placeLamps } from '../world/City';
import { setupEnvironment } from '../world/Environment';

type State = 'home' | 'countdown' | 'racing' | 'finished';

const LIGHT_INTERVAL = 0.8;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cam: ChaseCamera;
  private readonly input = new Input();
  private readonly audio = new AudioEngine();
  private readonly account = new AccountService();
  private lastTime = -1;

  private track!: TrackPath;
  private line!: RacingLine;
  private trackVisual!: TrackVisual;
  private city!: City;
  private hud!: Hud;
  private minimap!: Minimap;
  private screens!: Screens;
  private sim!: RaceSimulation;
  private readonly carModels: CarModel[] = [];
  /** Sim car index -> pooled model / livery index (0 is always the player's livery). */
  private modelOf: number[] = [];
  private readonly colors = LIVERIES.map((l) => '#' + l.color.toString(16).padStart(6, '0'));

  private state: State = 'home';
  private paused = false;
  private modalOpen = false;
  private accumulator = 0;
  private countdownTime = 0;
  private lightsOn = 0;
  private lightsOutAt = 0;
  private wrongWayTime = 0;
  /** Strongest player impact over this frame's physics steps. */
  private frameImpact = 0;
  private driftScore = 0;
  private driftQuiet = 0;
  private readonly effects = new TireEffects();
  private effectCars: EffectsCar[] = [];
  private resultsTimer = 0;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.cam = new ChaseCamera(window.innerWidth / window.innerHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.7, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    const rng = createRng(2023);
    setupEnvironment(this.scene, this.renderer, rng);
    await nextFrame();

    this.track = new TrackPath(TOKYO_CIRCUIT);
    this.line = new RacingLine(this.track);
    const lamps = placeLamps(this.track);
    const marks = tokyoCircuitLandmarks(this.track);
    this.trackVisual = buildTrackVisual(this.track, rng, {
      gridSlots: Array.from({ length: 12 }, (_, i) => gridSlot(this.track, i)),
      lamps,
      crossings: marks.crossings,
    });
    this.scene.add(this.trackVisual.group);
    await nextFrame();
    this.city = new City(this.track, lamps, rng);
    this.scene.add(this.city.group);
    this.scene.add(this.effects.group);

    this.hud = new Hud(this.colors);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, this.track, this.colors);
    this.screens = new Screens(this.account, {
      onRace: (settings) => this.startRace(settings),
      onSettingsChanged: (settings) => void this.account.saveSettings(settings),
      onResume: () => this.setPaused(false),
      onRestart: () => this.startRace(this.screens.settings),
      onQuit: () => this.goHome(),
      onModalChange: (open) => {
        this.modalOpen = open;
        if (open && (this.state === 'racing' || this.state === 'countdown') && !this.paused) this.setPaused(true, false);
      },
    });

    // Any interaction unlocks audio (browser autoplay policy).
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('blur', () => {
      if (this.state === 'racing' || this.state === 'countdown') this.setPaused(true);
    });

    await this.account.init();
    this.screens.loadSettings(this.account.settings);
    this.createSimulation(this.screens.settings);
    this.goHome();

    // Compile shaders up front so the first frames of the race don't hitch.
    this.renderer.compile(this.scene, this.cam.camera);
    document.getElementById('loading')?.remove();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  // ---------------------------------------------------------------- race lifecycle

  private createSimulation(settings: PlayerSettings): void {
    const total = settings.opponents + 1;
    this.sim = new RaceSimulation(
      this.track,
      {
        laps: settings.laps,
        opponents: settings.opponents,
        difficulty: settings.difficulty,
        playerAssist: settings.assists ? 0.7 : 0.15,
        // Start mid-pack so there is someone to race either way.
        playerGridSlot: Math.min(total - 1, Math.floor(total / 2) + 1),
        seed: Math.floor(Math.random() * 1e6),
      },
      this.line,
    );
    // Car meshes are pooled: livery 0 is the player's, AI take the rest in grid order.
    let ai = 1;
    this.modelOf = this.sim.cars.map((c) => (c.isPlayer ? 0 : ai++));
    while (this.carModels.length < total) {
      const model = new CarModel(LIVERIES[this.carModels.length % LIVERIES.length]);
      this.carModels.push(model);
      this.scene.add(model.root);
    }
    this.carModels.forEach((m, i) => (m.root.visible = i < total));
    this.effectCars = this.sim.cars.map((car, i) => ({ car, root: this.carModels[this.modelOf[i]].root }));
    this.effects.clear();
    this.driftScore = 0;
    this.colors.length = 0;
    this.sim.cars.forEach((car, i) => {
      this.colors[car.id] = '#' + LIVERIES[this.modelOf[i] % LIVERIES.length].color.toString(16).padStart(6, '0');
    });
    this.syncCarModels(1, 0);
  }

  private startRace(settings: PlayerSettings): void {
    this.audio.unlock();
    this.screens.hideAll();
    this.createSimulation(settings);
    this.cam.mode = settings.camera;
    this.cam.snap();
    this.state = 'countdown';
    this.paused = false;
    this.countdownTime = 0;
    this.lightsOn = 0;
    this.lightsOutAt = 5 * LIGHT_INTERVAL + 0.6 + Math.random() * 0.9;
    this.wrongWayTime = 0;
    this.accumulator = 0;
    this.trackVisual.setStartLights(0);
    this.hud.setVisible(true);
    this.hud.clearMessage();
    this.input.clearActions();
  }

  private goHome(): void {
    this.state = 'home';
    this.paused = false;
    this.hud.setVisible(false);
    this.trackVisual.setStartLights(0);
    this.createSimulation(this.screens.settings);
    this.screens.showHome();
    this.input.clearActions();
  }

  private setPaused(paused: boolean, showMenu = true): void {
    if (this.state === 'home') return;
    this.paused = paused;
    this.screens.showPause(paused && showMenu);
    if (!paused) this.input.clearActions();
  }

  // ---------------------------------------------------------------- main loop

  private frame(time: number): void {
    // Clamp so a stalled tab or debugger pause never fast-forwards the race.
    const dt = this.lastTime < 0 ? 0 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    this.elapsed += dt;
    const controls = this.input.update();
    this.handleActions();

    const running = !this.paused && !this.modalOpen && this.state !== 'home';
    if (running) {
      if (this.state === 'countdown') this.updateCountdown(dt);
      this.accumulator += dt;
      const step = RaceSimulation.STEP;
      while (this.accumulator >= step) {
        this.accumulator -= step;
        const events = this.sim.step(this.state === 'finished' ? neutralControls() : controls);
        this.frameImpact = Math.max(this.frameImpact, this.sim.player.impact);
        this.handleEvents(events);
      }
      this.updateRaceFeedback(dt);
      this.frameImpact = 0;
    }

    const alpha = running ? this.accumulator / RaceSimulation.STEP : 1;
    this.syncCarModels(alpha, dt);
    this.effects.update(this.effectCars, running ? dt : 0, this.cam.camera, this.renderer.domElement.height);

    const player = this.sim.player;
    const playerModel = this.carModels[0];
    if (this.state === 'home') {
      this.cam.orbit(playerModel.root.position, dt);
      this.audio.update(this.sim.player.physics.spec.idleRpm, 0, 0, 0, false);
    } else {
      this.cam.follow(playerModel, player.physics.speed, running ? dt : 0);
      const p = player.physics;
      this.audio.update(p.rpm, p.throttleApplied, Math.max(p.rearSlide, p.frontSlide * 0.6), p.speed, running);
    }
    this.city.update(this.elapsed);

    if (this.state !== 'home') {
      this.hud.update(this.sim, dt);
      this.minimap.draw(this.sim);
    }
    if (this.state === 'finished') {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) {
        this.resultsTimer = 0.5;
        this.screens.updateResults(this.resultsData());
      }
    }
    this.composer.render(dt);
    this.effects.onRendered();
  }

  private handleActions(): void {
    const input = this.input;
    if (input.consume('controls')) this.screens.toggleControls();
    if (input.consume('mute')) this.audio.toggleMute();
    if (this.modalOpen) {
      input.clearActions();
      return;
    }
    if (this.state === 'home') {
      if (input.consume('confirm')) this.startRace(this.screens.settings);
      input.clearActions();
      return;
    }
    if (input.consume('pause') && !this.screens.resultsVisible) this.setPaused(!this.paused);
    if (this.paused) {
      input.clearActions();
      return;
    }
    if (input.consume('camera')) {
      const mode: CameraMode = this.cam.cycle();
      this.screens.settings = { ...this.screens.settings, camera: mode };
      void this.account.saveSettings({ camera: mode });
    }
    if (input.consume('reset') && this.state === 'racing') {
      this.sim.respawn(this.sim.player);
      this.cam.snap();
    }
    if (input.consume('confirm') && this.screens.resultsVisible) this.startRace(this.screens.settings);
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const lights = Math.min(5, Math.floor(this.countdownTime / LIGHT_INTERVAL));
    if (lights !== this.lightsOn && this.countdownTime < this.lightsOutAt) {
      this.lightsOn = lights;
      this.trackVisual.setStartLights(lights);
      if (lights > 0) {
        this.audio.beep(false);
        this.hud.showMessage('●'.repeat(lights) + '○'.repeat(5 - lights), 5, 'lights');
      }
    }
    if (this.countdownTime >= this.lightsOutAt) {
      this.trackVisual.setStartLights(0);
      this.audio.beep(true);
      this.hud.showMessage('GO!', 1.2, 'go');
      this.state = 'racing';
      this.sim.startRace();
    }
  }

  private handleEvents(events: RaceEvent[]): void {
    const playerId = this.sim.player.id;
    for (const e of events) {
      if (e.racerId !== playerId) continue;
      if (e.type === 'lap' && e.lap < this.sim.race.totalLaps) {
        this.hud.showMessage(`LAP ${e.lap}  ${formatTime(e.time)}`, 2.5, e.best && e.lap > 1 ? 'gold' : 'small');
      } else if (e.type === 'finalLap') {
        setTimeout(() => this.hud.showMessage('FINAL LAP', 2, 'gold'), 2600);
      } else if (e.type === 'finish') {
        this.onPlayerFinished(e.position);
      }
    }
  }

  private onPlayerFinished(position: number): void {
    this.state = 'finished';
    this.sim.player.autopilot = true;
    this.hud.showMessage(position === 1 ? 'YOU WIN!' : `FINISHED P${position}`, 3, position <= 3 ? 'gold' : '');
    const me = this.sim.race.racers[this.sim.player.id];
    const settings = this.screens.settings;
    const record = {
      position,
      fieldSize: this.sim.cars.length,
      laps: settings.laps,
      difficulty: settings.difficulty,
      totalTime: me.finishTime,
      bestLap: me.bestLapTime,
    };
    const saving = this.account.recordRace(record);
    setTimeout(async () => {
      if (this.state !== 'finished') return;
      this.screens.showResults(this.resultsData(), 'Saving result…');
      const where = await saving;
      if (this.state !== 'finished') return;
      this.screens.setResultsSaved(
        where === 'account'
          ? `Saved to ${this.account.displayName}'s career ✓`
          : where === 'device'
            ? 'Saved on this device. Log in from the homescreen to keep your career in your account.'
            : 'Could not save this result (server unreachable).',
      );
    }, 2500);
  }

  private resultsData() {
    return { standings: this.sim.race.standings(), playerId: this.sim.player.id, colors: this.colors };
  }

  /** Wrong-way warning, impacts (sound + camera shake), drift scoring. */
  private updateRaceFeedback(dt: number): void {
    const player = this.sim.player;
    if (this.frameImpact > 1.5) {
      this.audio.impact(this.frameImpact);
      this.cam.addShake(Math.min(1, this.frameImpact / 15));
    }
    if (this.state !== 'racing') return;
    const p = player.physics;

    // Drift points: speed x angle while sliding; a crash during the drift loses them.
    const angle = Math.abs(p.driftAngle);
    if (this.frameImpact > 3) this.driftScore = 0;
    if (p.drifting && angle > 0.2 && p.speed > 8) {
      this.driftScore += p.speed * angle * (180 / Math.PI) * 0.5 * dt;
      this.driftQuiet = 0;
    } else if (this.driftScore > 0) {
      this.driftQuiet += dt;
      if (this.driftQuiet > 0.6) {
        if (this.driftScore >= 100) this.hud.showMessage(`+${Math.round(this.driftScore).toLocaleString('en-US')} DRIFT`, 1.6, 'gold');
        this.driftScore = 0;
      }
    }

    const along = p.vx * player.proj.tx + p.vz * player.proj.tz;
    if (along < -3) this.wrongWayTime += dt;
    else this.wrongWayTime = Math.max(0, this.wrongWayTime - dt * 2);
    if (this.wrongWayTime > 1.2) {
      this.hud.showMessage('WRONG WAY', 0.3, 'warn');
    }
  }

  private syncCarModels(alpha: number, dt: number): void {
    for (let i = 0; i < this.sim.cars.length; i++) {
      this.carModels[this.modelOf[i]].update(this.sim.cars[i], alpha, dt);
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
