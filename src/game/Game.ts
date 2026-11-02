import * as THREE from 'three';
import type { CarId, CarSetup, CityCourseId, CourseId, Difficulty, PlayerSettings, TimeOfDay, TrackId } from '../../shared/api';
import { careerEvent, starTimes } from '../../shared/career';
import { raceReward, upgradesOf } from '../../shared/economy';
import { cup, GP_RIVALS } from '../../shared/grandprix';
import { settleResult, todayKey } from '../../shared/quests';
import { AccountService } from '../account/AccountService';
import type { RacingLine } from '../ai/RacingLine';
import { type CameraMode, ChaseCamera } from '../camera/ChaseCamera';
import { AudioEngine } from '../core/AudioEngine';
import { Input } from '../core/Input';
import { createRng } from '../core/math';
import { type LocalSettings, SettingsStore } from '../core/Settings';
import { neutralControls } from '../physics/VehiclePhysics';
import { placePickups } from '../race/Pickups';
import { formatTime, type RaceEvent } from '../race/RaceManager';
import { DRIVER_NAMES, type FreeRoamGround, gridSlot, RaceSimulation } from '../race/RaceSimulation';
import { RenderPipeline } from '../render/RenderPipeline';
import { CourseDecor, coursePads } from '../track/CourseDecor';
import type { TrackPath } from '../track/TrackPath';
import { CITY_COURSE_DEFS, courseInfo, isCityCourse, TRACKS, WORLDS, type WorldId } from '../track/tracks';
import { DriveMap } from '../ui/DriveMap';
import { GamepadMenu } from '../ui/GamepadMenu';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { type HubPanel, type RaceReward, Screens } from '../ui/Screens';
import { TouchControls } from '../ui/TouchControls';
import { CarModel } from '../vehicles/CarModel';
import { AI_LIVERIES, aiField, CARS, carSetup, randomPlate, upgradedSpec } from '../vehicles/cars';
import { ItemView } from '../vehicles/ItemView';
import { loadCarAsset, loadCarAssets, onCarAssetLoaded } from '../vehicles/importedCars';
import { PickupView } from '../vehicles/PickupView';
import { Sparks } from '../vehicles/Sparks';
import { type EffectsCar, TireEffects } from '../vehicles/TireEffects';
import { FREE_DRIVE_MAP, FREE_DRIVE_SPOTS } from '../world/freeDrive';
import { Lighting } from '../world/Lighting';
import { loadProps, loadScenery } from '../world/sceneryModels';
import { sceneProps } from '../world/scenes';
import { buildWorld, type FreeRoamMap, type World } from '../world/World';
import { Cinematics } from './Cinematics';
import { FreeRoamPlay } from './FreeRoamPlay';
import { driverOfCars, GrandPrixSession } from './GrandPrix';
import { PerformanceMonitor } from './PerformanceMonitor';
import { RaceFeedback } from './RaceFeedback';
import { TrackLoader } from './TrackLoader';

type State = 'home' | 'intro' | 'countdown' | 'racing' | 'finished' | 'freedrive';

/** What's being raced: the course, the conditions, and what kind of race it is. */
interface RaceSetup {
  course: CourseId;
  timeOfDay: TimeOfDay;
  laps: number;
  difficulty: Difficulty;
  opponents: number;
  /**
   * Item boxes and items. Only the kart-style races have them: Grand Prix rounds and the city
   * street races (not career events, and not free drive).
   */
  items: boolean;
  /** A career event. */
  event?: string;
  /** A Grand Prix round (see gp). */
  gp?: boolean;
  /** A city race started from free drive (afterwards you go back to it). */
  fromFreeDrive?: boolean;
  playerSlot?: number;
  seed?: number;
}

const LIGHT_INTERVAL = 0.8;
/** The homescreen backdrop: cars racing over the Hakone pass on a sunny day. */
const HOME_TRACK: TrackId = 'hakone';
const HOME_TIME: TimeOfDay = 'day';
const TIME_LABEL: Record<TimeOfDay, string> = { day: 'Day', sunset: 'Sunset', night: 'Night' };

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly cam = new ChaseCamera(window.innerWidth / window.innerHeight);
  private readonly pipeline: RenderPipeline;
  private readonly store: SettingsStore;
  private readonly input = new Input();
  private readonly touch = new TouchControls(this.input);
  private readonly padMenu = new GamepadMenu();
  /** Free drive: the map you teleport with. */
  private readonly driveMap = new DriveMap(
    (to) => this.teleport(to),
    () => this.closeDriveMap(),
  );
  private readonly pickupView = new PickupView();
  private readonly itemView = new ItemView();
  private readonly audio = new AudioEngine();
  private readonly account = new AccountService();
  private readonly loader = new TrackLoader();
  private readonly cine = new Cinematics(this.cam.camera);
  private readonly effects = new TireEffects();
  private readonly sparks = new Sparks();
  private readonly perf = new PerformanceMonitor();
  private readonly sunScreen = new THREE.Vector3();
  private feedback!: RaceFeedback;
  /** Free drive's race markers, lucky cats, speed traps, jumps and drift zones. */
  private freePlay!: FreeRoamPlay;
  private lastTime = -1;

  private track!: TrackPath;
  private line!: RacingLine;
  private world: World | null = null;
  /** The race now (or last) run. */
  private setup: RaceSetup | null = null;
  /** A Grand Prix in progress. */
  private gp: GrandPrixSession | null = null;
  /** Trophy won by the last race of a cup (from its settled result). */
  private gpTrophy = { place: 0, bonus: 0 };
  /** A city course's start gantry, arrows and signs (while racing one). */
  private courseDecor: CourseDecor | null = null;
  /** Built worlds are kept (except on Low quality) so going back to a circuit is instant. */
  private readonly worlds = new Map<WorldId, World>();
  private lighting!: Lighting;
  private timeOfDay: TimeOfDay = HOME_TIME;
  /** The player's real headlights (only lit after dark). */
  private readonly headlight = new THREE.SpotLight(0xfff1dc, 0, 120, 0.5, 0.6, 0.8);
  private hud!: Hud;
  private minimap!: Minimap;
  private screens!: Screens;
  private sim!: RaceSimulation;
  private readonly carModels: CarModel[] = [];
  /** The car the current simulation was built around. */
  private simCar: CarId | null = null;
  private effectCars: EffectsCar[] = [];
  private readonly colors: string[] = [];

  private state: State = 'home';
  private hubPanel: HubPanel = 'home';
  private paused = false;
  private modalOpen = false;
  private busy = false;
  private accumulator = 0;
  private countdownTime = 0;
  private lightsOn = 0;
  private lightsOutAt = 0;
  /** Strongest player impact over this frame's physics steps. */
  private frameImpact = 0;
  private resultsTimer = 0;
  private elapsed = 0;
  private timeScale = 1;
  private applied: LocalSettings;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new RenderPipeline(canvas, this.scene, this.cam.camera, 'medium');
    this.store = new SettingsStore(gpuName(this.pipeline.renderer));
    this.applied = this.store.value;
    this.pipeline.setQuality(this.applied.quality);
    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    this.lighting = new Lighting(this.scene, this.pipeline.renderer);
    this.scene.add(this.effects.group, this.sparks.points, this.pickupView.group, this.itemView.group);
    // On the front bumper, aimed down the road (so it never lights our own bodywork).
    this.headlight.target.position.set(0, 0, 32);
    this.loader.line(HOME_TRACK);
    await nextFrame();

    this.hud = new Hud(this.colors);
    this.feedback = new RaceFeedback(this.hud, this.audio, this.cam, this.sparks, this.store);
    this.freePlay = new FreeRoamPlay(this.hud, this.audio, (course) => this.startCityRace(course));
    this.scene.add(this.freePlay.group);
    this.screens = new Screens(
      this.account,
      {
        onRace: (settings) => void this.startRace(settings),
        onSettingsChanged: (settings, car) => this.onSettingsChanged(settings, car),
        onHubPanel: (panel) => this.onHubPanel(panel),
        onTryOn: (setup) => this.onTryOn(setup),
        onResume: () => this.setPaused(false),
        onRestart: () => void (this.setup ? this.startSetup(this.setup) : this.startRace(this.screens.settings)),
        onGrandPrix: (cupId, difficulty) => this.startGrandPrix(cupId, difficulty),
        onGpNext: () => this.gpNext(),
        onFreeBack: () => void this.backToFreeDrive(),
        onFreeDrive: (spot, tod) => void this.startFreeDrive(spot, tod),
        onQuit: () => void this.goHome(),
        onModalChange: (open) => {
          this.modalOpen = open;
          if (open && this.inRace && !this.paused) this.setPaused(true, false);
        },
      },
      this.store,
      this.input,
    );
    this.applyLocalSettings(this.store.value, true);
    this.store.onChange((s) => this.applyLocalSettings(s, false));

    // Any interaction unlocks audio (browser autoplay policy).
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('blur', () => {
      if (this.inRace) this.setPaused(true);
    });

    // Fetch the profile while the homescreen scenery is being built.
    const profile = this.account.init();
    setLoading(`Loading ${TRACKS[HOME_TRACK].name}…`);
    await this.loadTrack(HOME_TRACK);
    await profile;
    this.screens.loadSettings(this.account.settings);
    // Cars swap to their model files as they arrive; the player's is waited for.
    onCarAssetLoaded((id) => {
      for (const m of this.carModels) m.refresh(id);
    });
    await loadCarAsset(this.screens.settings.car);
    await this.goHome(true);
    // Racing lines for the other circuits are worked out in the background.
    this.loader.prefetchAll();
    void loadCarAssets();
    setLoading(null);
    this.pipeline.renderer.setAnimationLoop((time) => this.frame(time));
  }

  private get inRace(): boolean {
    return this.state === 'intro' || this.state === 'countdown' || this.state === 'racing' || this.state === 'freedrive';
  }

  // ---------------------------------------------------------------- settings

  /** Per-device settings: quality, volumes, key bindings. */
  private applyLocalSettings(s: LocalSettings, first: boolean): void {
    this.audio.setVolumes(s.volume);
    this.input.setBindings(s.bindings);
    if (first || s.quality !== this.applied.quality) {
      this.pipeline.setQuality(s.quality);
      const q = this.pipeline.quality;
      this.lighting.setShadowQuality(q.shadows, q.shadowMapSize);
      for (const w of this.worlds.values()) w.setDetail(q.detail, q.grass);
      if (s.quality === 'low') this.trimWorlds();
      this.pipeline.setRenderScale(1);
      this.perf.reset();
      // Shadow and light changes need shaders rebuilt.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    this.applied = s;
  }

  private trimWorlds(): void {
    for (const [id, w] of this.worlds) {
      if (w === this.world) continue;
      w.dispose();
      this.worlds.delete(id);
    }
  }

  /** Race setup / garage changes from the menus. */
  private onSettingsChanged(settings: PlayerSettings, car: boolean): void {
    void this.account.saveSettings(settings);
    if (!car || this.state !== 'home') return;
    const def = CARS[settings.car];
    if (settings.car !== this.simCar) {
      // A different car: rebuild the field around it (parked on the grid while in the garage).
      this.createSimulation(this.homeRaceSettings(), true);
      if (!this.showroom) this.startAttract();
    } else {
      this.carModels[0].build(def, carSetup(settings.car, settings.garage));
      this.colors[this.sim.player.id] = carSetup(settings.car, settings.garage).paint;
    }
  }

  /** Your car on the turntable (behind the career map too); the profile shows the homescreen race. */
  private get showroom(): boolean {
    return this.hubPanel !== 'profile';
  }

  private onHubPanel(panel: HubPanel): void {
    const was = this.hubPanel;
    const wasShowroom = this.showroom;
    this.hubPanel = panel;
    if (this.state !== 'home' || !this.sim || panel === was) return;
    // Park the field on the grid for the turntable (and put your car back after a shop preview).
    if (was === 'shop' || (this.showroom && !wasShowroom)) this.createSimulation(this.homeRaceSettings(), true);
    if (!this.showroom && wasShowroom) this.startAttract();
  }

  /** Shop: your car on the turntable with a cosmetic tried on. */
  private onTryOn(setup: CarSetup): void {
    const id = this.screens.settings.car;
    if (this.state !== 'home' || this.hubPanel !== 'shop') return;
    this.carModels[0].build(CARS[id], setup);
    // Light the nitro so a flame colour can be seen.
    this.carModels[0].showFlames = !!setup.flame;
  }

  // ---------------------------------------------------------------- tracks & lighting

  /** Build (or reuse) the circuit and swap in its scenery. */
  private async loadTrack(id: WorldId): Promise<void> {
    const line = this.loader.line(id);
    if (this.world?.def.id !== id) await this.swapWorld(id, line);
    else if (this.track !== this.loader.track(id)) {
      // Back from a city course on the same map: its own road again.
      this.track = this.loader.track(id);
      this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, this.track, this.colors);
    }
    this.showCourse(null);
    this.line = await line;
  }

  /** Race a city course on the free drive map: its line, minimap and decorations. */
  private async useCourse(id: CityCourseId): Promise<void> {
    this.track = this.loader.track(id);
    this.line = await this.loader.line(id);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, this.track, this.colors);
    this.showCourse(id);
  }

  private showCourse(id: CityCourseId | null): void {
    this.courseDecor?.dispose();
    this.courseDecor = null;
    if (!id) return;
    this.courseDecor = new CourseDecor(this.track, CITY_COURSE_DEFS[id].data, coursePads(this.track));
    this.scene.add(this.courseDecor.group);
  }

  /** The start lights: on the city course's gantry, or the circuit's. */
  private setStartLights(n: number): void {
    if (this.courseDecor) this.courseDecor.setStartLights(n);
    else this.world!.trackVisual.setStartLights(n);
  }

  private async swapWorld(id: WorldId, line: Promise<RacingLine>): Promise<void> {
    const def = WORLDS[id];
    this.world?.group.removeFromParent();
    let world = this.worlds.get(id);
    const track = this.loader.track(id);
    if (!world) {
      setLoading(`Loading ${def.name}…`);
      // Buildings, Tokyo Tower and the countryside landmarks come from model files (loaded once).
      await Promise.all([loadScenery(), loadProps(sceneProps(id))]);
      await nextFrame();
      await nextFrame();
      world = buildWorld(def, track, createRng(2023), this.pipeline.quality.detail, this.pipeline.quality.grass);
      this.worlds.set(id, world);
      void line.then((l) => world!.addRacingLine(l));
    }
    if (this.pipeline.quality.detail < 1) this.trimWorlds();
    this.world = world;
    this.track = track;
    this.scene.add(world.group);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, track, this.colors);
    this.effects.clear();
    this.sparks.clear();
  }

  private applyTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    const theme = this.world!.def.theme;
    this.pipeline.setBloom(this.lighting.apply(theme, tod));
    this.pipeline.setGrade(this.lighting.grade);
    this.world!.setTimeOfDay(tod);
    for (const m of this.carModels) m.setLighting(tod, theme !== 'city');
    this.headlight.intensity = tod === 'night' ? (theme === 'city' ? 5 : 13) : 0;
  }

  /** Compile shaders without blocking the page where the browser supports it. */
  private async compile(): Promise<void> {
    try {
      await this.pipeline.renderer.compileAsync(this.scene, this.cam.camera);
    } catch {
      this.pipeline.compile();
    }
  }

  // ---------------------------------------------------------------- race lifecycle

  private homeRaceSettings(): PlayerSettings {
    return { ...this.screens.settings, laps: 99, opponents: 5, difficulty: 'normal' };
  }

  private createSimulation(
    settings: PlayerSettings,
    home = false,
    freeRoam?: FreeRoamGround,
    extra: {
      items?: boolean;
      seed?: number;
      playerSlot?: number;
      gates?: number[];
      pads?: { x: number; z: number; heading: number }[];
    } = {},
  ): void {
    const total = settings.opponents + 1;
    const car = CARS[settings.car];
    this.simCar = settings.car;
    const seed = extra.seed ?? Math.floor(Math.random() * 1e6);
    // A mixed field of cars around the player's class (a few the same as the player's).
    const field = aiField(settings.car, settings.opponents, seed);
    this.sim = new RaceSimulation(
      this.track,
      {
        laps: settings.laps,
        opponents: settings.opponents,
        difficulty: settings.difficulty,
        playerAssist: settings.assists ? 0.7 : 0.15,
        // Start mid-pack so there is someone to race either way (at the front for the showroom).
        playerGridSlot: extra.playerSlot ?? (home ? 0 : Math.min(total - 1, Math.floor(total / 2) + 1)),
        seed,
        // Your car with the upgrades you've bought fitted.
        carSpec: upgradedSpec(car.spec, upgradesOf(this.account.wallet, settings.car)),
        aiGrip: car.aiGrip,
        aiCars: field.map((f) => ({ spec: f.car.spec, aiGrip: f.car.aiGrip, power: f.power })),
        freeRoam,
        items: extra.items,
        gates: extra.gates,
        boostPads: extra.pads,
      },
      this.line,
    );
    while (this.carModels.length < total) {
      const model = new CarModel(car, car.setup);
      this.carModels.push(model);
      this.scene.add(model.root);
    }
    // AI cars come in grid order, as the simulation hands them out.
    let ai = 0;
    this.sim.cars.forEach((c, i) => {
      const def = c.isPlayer ? car : field[ai].car;
      const setup = c.isPlayer
        ? carSetup(settings.car, settings.garage)
        : { finish: 'metallic' as const, plate: randomPlate(i + 1), ...AI_LIVERIES[ai++ % AI_LIVERIES.length] };
      this.carModels[i].build(def, setup);
      this.colors[c.id] = setup.paint;
    });
    this.carModels.forEach((m, i) => {
      m.root.visible = i < total;
      m.setLighting(this.timeOfDay, this.world?.def.theme !== 'city');
    });
    // Model order follows the car order, so the player's model is wherever the player sits.
    const playerModel = this.playerModel;
    playerModel.root.add(this.headlight, this.headlight.target);
    this.headlight.position.set(0, 0.75, playerModel.frontZ + 0.25);
    this.effectCars = this.sim.cars.map((c, i) => ({ car: c, root: this.carModels[i].root, look: this.carModels[i] }));
    // Nitro pickups on the road (not in the homescreen's showcase race).
    this.pickupView.setPickups(home ? [] : this.sim.pickups);
    this.itemView.setItems(this.sim.items);
    this.effects.clear();
    this.feedback.reset();
    this.syncCarModels(1, 0);
  }

  private get playerModel(): CarModel {
    return this.carModels[this.sim.cars.indexOf(this.sim.player)];
  }

  /** Homescreen: the field racing round Hakone on autopilot, filmed like TV coverage. */
  private async goHome(first = false): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.state = 'home';
    this.paused = false;
    this.timeScale = 1;
    this.hud.setFreeDrive(false);
    this.feedback.freeDrive = false;
    this.gp = null;
    this.setup = null;
    this.freePlay.setActivities(null);
    this.screens.gp.hideTrophy();
    this.cine.endIntro();
    showCinematic(null);
    this.hud.setVisible(false);
    this.touch.release();
    this.screens.hideAll();
    await this.loadTrack(HOME_TRACK);
    this.applyTimeOfDay(HOME_TIME);
    this.setStartLights(0);
    this.createSimulation(this.homeRaceSettings(), true);
    if (!this.showroom) this.startAttract();
    if (first) await this.compile();
    setLoading(null);
    this.screens.showHome();
    this.input.clearActions();
    this.busy = false;
  }

  private startAttract(): void {
    for (const car of this.sim.cars) car.autopilot = true;
    this.sim.startRace();
    this.cine.resetAttract(this.track, this.sim.player.proj.distance);
  }

  /** A career event (or the race picked in the menus). */
  private startRace(settings: PlayerSettings): Promise<void> {
    this.gp = null;
    return this.startSetup({
      course: settings.track,
      timeOfDay: settings.timeOfDay,
      laps: settings.laps,
      difficulty: settings.difficulty,
      opponents: settings.opponents,
      items: false,
      ...(this.screens.raceEvent ? { event: this.screens.raceEvent } : {}),
    });
  }

  private async startSetup(setup: RaceSetup): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setup = setup;
    this.freePlay.setActivities(null);
    this.audio.unlock();
    this.screens.hideAll();
    this.screens.gp.hideTrophy();
    this.feedback.quiet();
    this.hud.setFreeDrive(false);
    this.feedback.freeDrive = false;
    const city = isCityCourse(setup.course);
    const worldId: WorldId = city ? 'freeroam' : (setup.course as TrackId);
    const fresh = !this.worlds.has(worldId);
    await Promise.all([this.loadTrack(worldId), loadCarAssets()]);
    let ground: FreeRoamGround | undefined;
    let gates: number[] | undefined;
    let pads: { x: number; z: number; heading: number }[] | undefined;
    if (city) {
      // A street race through the free drive city: you can leave the course (the shortcuts!).
      const def = CITY_COURSE_DEFS[setup.course as CityCourseId];
      await this.useCourse(def.id);
      const map = this.world!.freeRoam!;
      const bonus = def.data.shortcuts.map((s) => {
        const [x, z] = s.pts[Math.floor(s.pts.length / 2)];
        return { x, y: 0.07, z, kind: 'super' as const };
      });
      ground = { ...map, pickups: [...map.pickups, ...bonus] };
      gates = def.data.gates;
      pads = coursePads(this.track);
    }
    this.applyTimeOfDay(setup.timeOfDay);
    this.createSimulation({ ...this.screens.settings, laps: setup.laps, difficulty: setup.difficulty, opponents: setup.opponents }, false, ground, {
      items: setup.items,
      seed: setup.seed,
      playerSlot: setup.playerSlot,
      gates,
      pads,
    });
    if (fresh) await this.compile();
    setLoading(null);
    this.cam.mode = this.screens.settings.camera;
    this.paused = false;
    this.timeScale = 1;
    this.countdownTime = 0;
    this.lightsOn = 0;
    this.lightsOutAt = 5 * LIGHT_INTERVAL + 0.6 + Math.random() * 0.9;
    this.accumulator = 0;
    this.setStartLights(0);
    this.hud.clearMessage();
    this.input.clearActions();

    // Fly-in over the grid, ending in the chase camera.
    this.cam.snap();
    this.cam.follow(this.playerModel, 0, 0);
    const chase = this.cam.camera.position.clone();
    const rows = Math.ceil(this.sim.cars.length / 2);
    this.cine.startIntro(this.track, gridSlot(this.track, rows).distance + rows * 3, this.playerModel.root, chase);
    const info = courseInfo(setup.course);
    const gp = this.gp;
    showCinematic({
      kicker: gp ? `${gp.cup.name} · Race ${gp.round + 1} of ${gp.cup.races.length}` : `${info.short} · ${TIME_LABEL[setup.timeOfDay]}`,
      name: info.circuit,
      meta: `${setup.laps} lap${setup.laps > 1 ? 's' : ''} · ${this.sim.cars.length} cars${setup.items ? ' · items on' : ''} · ${CARS[this.screens.settings.car].name}`,
    });
    this.state = 'intro';
    this.hud.setVisible(false);
    this.busy = false;
  }

  // ---------------------------------------------------------------- grand prix

  private startGrandPrix(cupId: string, difficulty: Difficulty): void {
    const c = cup(cupId);
    if (!c) return;
    this.gp = new GrandPrixSession(c, difficulty, Math.floor(Math.random() * 1e6));
    void this.startRound();
  }

  private startRound(): Promise<void> {
    const gp = this.gp!;
    return this.startSetup({
      course: gp.race.track,
      timeOfDay: gp.race.timeOfDay,
      laps: gp.cup.laps,
      difficulty: gp.difficulty,
      opponents: GP_RIVALS,
      items: true,
      gp: true,
      playerSlot: gp.playerSlot(),
      seed: gp.seed,
    });
  }

  /** After a cup race: on to the next race, or the trophy after the last. */
  private gpNext(): void {
    const gp = this.gp;
    if (!gp) return;
    if (gp.over) {
      this.screens.hideAll();
      this.screens.gp.showTrophy({ cupName: gp.cup.name, difficulty: gp.difficulty, place: gp.playerPlace(), bonus: this.gpTrophy.bonus, rows: this.gpRows() });
      return;
    }
    gp.next();
    void this.startRound();
  }

  /** The cup standings, with each driver's name and colour (from the race just run). */
  private gpRows() {
    const gp = this.gp!;
    const drivers = driverOfCars(this.sim.cars);
    const carOf: number[] = [];
    drivers.forEach((d, carId) => {
      carOf[d] = carId;
    });
    return gp.table().map((r) => ({
      name: r.driver === 0 ? 'YOU' : DRIVER_NAMES[(r.driver - 1) % DRIVER_NAMES.length],
      color: this.colors[carOf[r.driver]] ?? '#888',
      me: r.driver === 0,
      place: r.place,
      race: r.race,
      points: r.points,
    }));
  }

  // ---------------------------------------------------------------- free drive

  /** From free drive: race a city course, starting right here in the city. */
  private startCityRace(id: CityCourseId): void {
    this.gp = null;
    void this.startSetup({
      course: id,
      timeOfDay: this.timeOfDay,
      laps: 2,
      difficulty: this.screens.settings.difficulty,
      opponents: 7,
      items: true,
      fromFreeDrive: true,
    });
  }

  /** After a city race started from free drive: back to driving round, at the course's start. */
  private backToFreeDrive(): Promise<void> {
    const start = this.track.samples[0];
    return this.startFreeDrive({ x: start.x, z: start.z, heading: start.heading }, this.timeOfDay);
  }

  /**
   * Free drive: the open map - the city, the ring road, the mountains and the dirt trails - with
   * a few cars cruising the ring road. No laps or timing; Esc for the menu.
   */
  private async startFreeDrive(spot: string | { x: number; z: number; heading: number } = 'centre', tod: TimeOfDay = 'day'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.gp = null;
    this.setup = null;
    this.audio.unlock();
    this.screens.hideAll();
    this.feedback.quiet();
    const fresh = !this.worlds.has('freeroam');
    await Promise.all([this.loadTrack('freeroam'), loadCarAssets()]);
    const map = this.world!.freeRoam!;
    this.applyTimeOfDay(tod);
    // Traffic: the AI lap the ring road (they keep to it); you can go anywhere.
    // Boost pads round town. (No items: they're for the Grand Prix and the city races.)
    this.createSimulation({ ...this.screens.settings, laps: 99, opponents: 6, difficulty: 'easy' }, false, map, { pads: map.activities.pads });
    this.freePlay.setActivities(map.activities, (x, z) => map.surfaceAt(x, z));
    for (const car of this.sim.cars) car.autopilot = !car.isPlayer;
    this.sim.startRace();
    this.placeAtSpawn(typeof spot === 'string' ? (FREE_DRIVE_SPOTS.find((s) => s.id === spot) ?? map.spawn) : spot);
    if (fresh) await this.compile();
    setLoading(null);
    this.cam.mode = this.screens.settings.camera;
    this.paused = false;
    this.timeScale = 1;
    this.accumulator = 0;
    this.cam.snap();
    this.cam.follow(this.playerModel, 0, 0);
    this.hud.clearMessage();
    this.hud.setFreeDrive(true);
    this.feedback.freeDrive = true;
    this.input.clearActions();
    this.state = 'freedrive';
    this.hud.setVisible(true);
    this.hud.showMessage('FREE DRIVE', 2.5, 'gold');
    this.busy = false;
  }

  /**
   * Put the player on the road nearest a free drive place, stopped, facing along the road (the
   * way `at.heading` points, if given).
   */
  private placeAtSpawn(at: { x: number; z: number; heading?: number }): void {
    const map = this.world?.freeRoam;
    if (!map) return;
    const road = map.roadNear(at.x, at.z);
    const { x, z } = road;
    const heading = at.heading !== undefined && Math.cos(road.heading - at.heading) < 0 ? road.heading + Math.PI : road.heading;
    const car = this.sim.player;
    car.physics.place(x, z, heading, map.surfaceAt(x, z));
    this.sim.track.project(x, z, -1, car.proj);
    // On the ring road: its surface.
    if (Math.abs(car.proj.lateral) < this.sim.track.halfWidth) car.physics.y = car.proj.y;
    car.prevX = x;
    car.prevZ = z;
    car.prevY = car.physics.y;
    car.prevHeading = heading;
    car.vy = 0;
    car.grounded = true;
    car.groundRoll = 0;
    this.cam.snap();
  }

  private openDriveMap(): void {
    const p = this.sim.player.physics;
    this.setPaused(true, false);
    this.driveMap.open(p.x, p.z, p.heading, this.world?.freeRoam?.activities ?? null, this.freePlay.progress, this.freePlay.summary());
  }

  private closeDriveMap(): void {
    this.driveMap.close();
    this.setPaused(false);
  }

  /** Free drive: jump to a place picked on the map. */
  private teleport(to: { x: number; z: number; heading?: number }): void {
    this.placeAtSpawn(to);
    this.cam.follow(this.playerModel, 0, 0);
    this.closeDriveMap();
  }

  /**
   * Render the free drive map picture (`node scripts/render-freedrive-map.mjs` saves it as
   * public/freedrive/map.jpg): the whole map from straight above, north up, in daylight, covering
   * FREE_DRIVE_MAP (so the starting-place pins line up). Size the page 16:9 first.
   */
  async captureFreeDriveMap(): Promise<string> {
    this.busy = true;
    this.screens.hideAll();
    await this.loadTrack('freeroam');
    this.applyTimeOfDay('day');
    for (const m of this.carModels) m.root.visible = false;
    this.pickupView.group.visible = false;
    const { minX, minZ, width, height } = FREE_DRIVE_MAP;
    const cam = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 10, 6000);
    cam.position.set(minX + width / 2, 3000, minZ + height / 2);
    cam.up.set(0, 0, -1);
    cam.lookAt(minX + width / 2, 0, minZ + height / 2);
    const fog = this.scene.fog;
    this.scene.fog = null;
    // The far ridges ring the map: from above they'd be blobs over its edges.
    const ridges = this.world!.group.getObjectByName('ridges');
    if (ridges) ridges.visible = false;
    this.world!.update(this.elapsed, 0, cam);
    await this.compile();
    const renderer = this.pipeline.renderer;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, cam);
    // Over the picture, a clear road map: buildings, then the trails, roads and the nitro.
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(renderer.domElement, 0, 0);
    const map = this.world!.freeRoam!;
    drawRoadMap(g, map, [...map.pickups, ...placePickups(this.track)], canvas.width / width, minX, minZ);
    const data = canvas.toDataURL('image/jpeg', 0.88);
    if (ridges) ridges.visible = true;
    this.scene.fog = fog;
    this.pickupView.group.visible = true;
    return data;
  }

  /**
   * Render a picture of a circuit for the track picker (`npm run previews` saves these into
   * public/previews). Uses a pose from the intro fly-in.
   */
  async capturePreview(track: TrackId, tod: TimeOfDay): Promise<string> {
    this.busy = true;
    this.screens.hideAll();
    await this.loadTrack(track);
    this.applyTimeOfDay(tod);
    this.createSimulation({ ...this.screens.settings, track, timeOfDay: tod, opponents: 7 });
    this.cam.snap();
    this.cam.follow(this.playerModel, 0, 0);
    this.cine.startIntro(this.track, gridSlot(this.track, 4).distance + 12, this.playerModel.root, this.cam.camera.position.clone());
    this.cine.updateIntro(2.2);
    this.cine.endIntro();
    this.world!.update(this.elapsed, 0, this.cam.camera);
    this.lighting.follow(this.playerModel.root.position);
    this.lighting.update(this.elapsed, this.cam.camera);
    this.pipeline.setSpeedEffect(0, 0);
    await this.compile();
    this.pipeline.render(0);
    return this.pipeline.renderer.domElement.toDataURL('image/jpeg', 0.82);
  }

  private beginCountdown(): void {
    this.cine.endIntro();
    showCinematic(null);
    this.cam.snap();
    this.state = 'countdown';
    this.hud.setVisible(true);
    this.input.clearActions();
  }

  private setPaused(paused: boolean, showMenu = true): void {
    if (this.state === 'home') return;
    this.paused = paused;
    this.screens.freeDrive = this.state === 'freedrive';
    this.screens.showPause(paused && showMenu);
    if (paused) {
      this.feedback.quiet();
      this.touch.release();
    } else this.input.clearActions();
  }

  /** The frame rate has stayed low: step the graphics down (if the player allows it). */
  private onSlowFrames(): void {
    if (!this.applied.autoQuality) return;
    const q = this.applied.quality;
    if (q === 'high' || q === 'medium') {
      this.store.update({ quality: q === 'high' ? 'medium' : 'low' });
    } else if (this.pipeline.scale > 0.65) {
      // Already on Low: render at a lower resolution instead.
      this.pipeline.setRenderScale(Math.max(0.65, this.pipeline.scale - 0.15));
    } else {
      return;
    }
    if (this.inRace) this.hud.showMessage('Graphics lowered for a smoother frame rate', 2.5, 'small');
  }

  // ---------------------------------------------------------------- main loop

  private frame(time: number): void {
    // Clamp so a stalled tab or debugger pause never fast-forwards the race.
    const rawDt = this.lastTime < 0 ? 0 : (time - this.lastTime) / 1000;
    const dt = Math.min(rawDt, 0.1);
    this.lastTime = time;
    this.elapsed += dt;
    const controls = this.input.update();
    // Gamepad menus while a menu is up (not mid-race).
    const menus = this.state === 'home' || this.paused || this.modalOpen || this.screens.resultsVisible || this.screens.gp.trophyVisible;
    this.input.mapKeys = this.state === 'freedrive' && !this.paused && !this.modalOpen;
    this.padMenu.update(dt, menus && !this.busy);
    this.handleActions();
    const measuring = !this.busy && !this.paused && !this.modalOpen && document.visibilityState === 'visible';
    if (this.perf.update(rawDt, measuring, this.applied.showFps)) this.onSlowFrames();
    if (this.busy) {
      this.pipeline.render(dt);
      return;
    }

    const home = this.state === 'home';
    const garage = home && this.showroom;
    const running = !this.paused && !this.modalOpen && !garage;
    const simDt = running ? dt * this.timeScale : 0;
    if (running) {
      if (this.state === 'countdown') this.updateCountdown(dt);
      this.accumulator += simDt;
      const step = RaceSimulation.STEP;
      const input = this.state === 'countdown' || this.state === 'racing' || this.state === 'freedrive' ? controls : neutralControls();
      while (this.accumulator >= step) {
        this.accumulator -= step;
        const events = this.sim.step(input);
        this.frameImpact = Math.max(this.frameImpact, this.sim.player.impact);
        if (!home) this.handleEvents(events);
      }
    }

    const alpha = running ? this.accumulator / RaceSimulation.STEP : 1;
    this.syncCarModels(alpha, simDt);
    this.effects.update(this.effectCars, simDt, this.cam.camera, this.pipeline.renderer.domElement.height);
    this.pickupView.update(this.sim.time, this.elapsed);
    this.itemView.update(
      this.sim.time,
      this.elapsed,
      this.carModels.map((m) => m.root),
    );
    this.courseDecor?.update(this.elapsed);
    if (this.state === 'freedrive' && running) {
      this.freePlay.update(this.sim, this.feedback.driftPoints, simDt, this.elapsed);
      this.hud.setFreeInfo(this.freePlay.summary());
    }
    // City courses: lost off the course for a while - point the way back.
    if (this.state === 'racing' && this.sim.offCourseTime > 6) this.hud.showMessage('BACK TO THE COURSE · R to return', 0.3, 'warn');
    const blur = running && !home ? this.feedback.update(this.sim, this.state === 'racing' || this.state === 'freedrive', this.frameImpact, simDt) : 0;
    if (running && !home && this.frameImpact > 3) this.input.rumble(this.frameImpact / 15);
    this.frameImpact = 0;
    const boosting = running && !home && this.sim.player.physics.nitroActive;
    this.pipeline.setSpeedEffect(Math.min(1, blur + (boosting ? 0.35 : 0)), this.elapsed);

    // Camera.
    const player = this.sim.player;
    const model = this.playerModel;
    if (!garage) this.cine.setFraming(0);
    if (garage) {
      this.cine.garage(model.root, dt);
    } else if (home) {
      this.cine.attract(this.track, model.root, player.proj.distance, dt);
    } else if (this.state === 'intro') {
      if (this.cine.updateIntro(running ? dt : 0)) this.beginCountdown();
    } else if (this.state === 'finished' && this.cine.finishActive) {
      this.timeScale = this.cine.updateFinish(model.root, running ? dt : 0);
      if (!this.cine.finishActive) this.cam.snap();
    } else {
      this.cam.follow(model, player.physics.speed, running ? dt : 0, boosting);
    }

    const p = player.physics;
    if (home || this.state === 'intro') this.audio.update(home ? p.rpm : p.spec.idleRpm, home ? 0.4 : 0, 0, home ? p.speed : 0, !garage && running);
    else this.audio.update(p.rpm, p.throttleApplied, Math.max(p.rearSlide, p.frontSlide * 0.6), p.speed, running);
    this.world!.update(this.elapsed, dt, this.cam.camera);
    this.lighting.follow(model.root.position);
    this.lighting.update(this.elapsed, this.cam.camera);
    this.updateSunGlare();

    if (this.state === 'countdown' || this.state === 'racing' || this.state === 'finished' || this.state === 'freedrive') {
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
    this.pipeline.render(dt);
    this.effects.onRendered();
  }

  /** Lens glare when looking toward the sun. */
  private updateSunGlare(): void {
    const cam = this.cam.camera;
    let strength = 0;
    if (this.lighting.sunVisible) {
      const p = this.sunScreen.copy(cam.position).addScaledVector(this.lighting.skySunDirection, 1000).project(cam);
      const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
      if (p.z < 1 && edge < 1.15) strength = Math.min(1, (1.15 - edge) / 0.25);
      this.pipeline.setSun(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, strength * this.lighting.grade.glare, this.lighting.sun.color);
    } else {
      this.pipeline.setSun(0.5, 0.5, 0, this.lighting.sun.color);
    }
  }

  private handleActions(): void {
    const input = this.input;
    if (input.consume('controls')) this.screens.toggleControls();
    if (input.consume('mute')) this.audio.toggleMute();
    if (this.modalOpen || this.busy) {
      input.clearActions();
      return;
    }
    if (this.state === 'home') {
      if (input.consume('confirm') && document.activeElement?.tagName !== 'BUTTON') this.screens.quickStart();
      if (input.consume('pause')) this.screens.back();
      input.clearActions();
      return;
    }
    if (this.state === 'intro') {
      if (input.consume('skip') && !this.paused) this.beginCountdown();
      if (input.consume('pause')) this.setPaused(!this.paused);
      input.clearActions();
      return;
    }
    if (this.driveMap.isOpen) {
      // Esc (or B) closes the map.
      if (input.consume('pause')) this.closeDriveMap();
      input.clearActions();
      return;
    }
    if (this.state === 'freedrive' && !this.paused && input.consume('map')) this.openDriveMap();
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
    if (input.consume('item') && (this.state === 'racing' || this.state === 'freedrive')) this.sim.useItem(this.sim.player);
    if (input.consume('jump') && this.state === 'freedrive' && this.sim.jump(this.sim.player)) this.input.rumble(0.3, 80);
    if (input.consume('reset') && this.state === 'freedrive') {
      // Back on your wheels where you are (stopped).
      const p = this.sim.player.physics;
      p.place(p.x, p.z, p.heading, p.y);
      this.sim.player.vy = 0;
      this.sim.player.grounded = true;
      this.cam.snap();
    }
    if (input.consume('reset') && this.state === 'racing') {
      this.sim.respawn(this.sim.player);
      this.cam.snap();
    }
    if (input.consume('confirm') && this.screens.resultsVisible) void this.startRace(this.screens.settings);
    input.clearActions();
  }

  private updateCountdown(dt: number): void {
    this.countdownTime += dt;
    const lights = Math.min(5, Math.floor(this.countdownTime / LIGHT_INTERVAL));
    if (lights !== this.lightsOn && this.countdownTime < this.lightsOutAt) {
      this.lightsOn = lights;
      this.setStartLights(lights);
      if (lights > 0) {
        this.audio.beep(false);
        this.hud.showMessage('●'.repeat(lights) + '○'.repeat(5 - lights), 5, 'lights');
      }
    }
    if (this.countdownTime >= this.lightsOutAt) {
      this.setStartLights(0);
      this.audio.beep(true);
      this.hud.showMessage('GO!', 1.2, 'go');
      this.state = 'racing';
      this.sim.startRace();
    }
  }

  private handleEvents(events: RaceEvent[]): void {
    const playerId = this.sim.player.id;
    for (const e of events) {
      if (e.type === 'itemUse' || e.type === 'itemHit' || e.type === 'itemBlocked' || e.type === 'itemReady') {
        this.onItemEvent(e, playerId);
        continue;
      }
      if (e.racerId !== playerId) continue;
      // Free drive has no laps: only pickups and boosts count.
      if (this.state === 'freedrive' && e.type !== 'pickup' && e.type !== 'boost') continue;
      if (e.type === 'lap' && e.lap < this.sim.race.totalLaps) {
        this.hud.showMessage(`LAP ${e.lap}  ${formatTime(e.time)}`, 2.5, e.best && e.lap > 1 ? 'gold' : 'small');
      } else if (e.type === 'finalLap') {
        setTimeout(() => this.hud.showMessage('FINAL LAP', 2, 'gold'), 2600);
      } else if (e.type === 'finish') {
        this.onPlayerFinished(e.position);
      } else if (e.type === 'pickup' || e.type === 'boost') {
        this.onBoost(e.kind === 'nitro' ? 'pickup' : e.kind);
      } else if (e.type === 'pad') {
        this.hud.showBoost('BOOST!', 'perfect');
        this.audio.boost(1);
      } else if (e.type === 'checkpoint') {
        this.hud.showMessage('CHECKPOINT MISSED!', 2, 'warn');
        this.audio.item(2);
        this.cam.snap();
      }
    }
  }

  /** Items: sounds, flashes and callouts for what happens to you (or what you do to others). */
  private onItemEvent(e: Extract<RaceEvent, { type: 'itemUse' | 'itemHit' | 'itemBlocked' | 'itemReady' }>, me: number): void {
    // A Thunder Drum from anyone flashes the sky.
    if (e.type === 'itemUse' && e.item === 'thunder') {
      this.hud.showFlash('thunder');
      this.audio.impact(14);
    }
    if (e.type === 'itemReady' && e.racerId === me) this.audio.item(0);
    else if (e.type === 'itemUse' && e.racerId === me) {
      if (e.item === 'ramune' || e.item === 'ramune3') this.onBoost('super');
      else this.audio.item(1);
      if (e.item === 'luckycat') this.hud.showBoost('LUCKY CAT!', 'perfect');
    } else if (e.type === 'itemHit' && e.racerId === me) {
      this.audio.item(2);
      this.hud.showFlash(e.item === 'thunder' ? 'thunder' : 'hit');
      this.hud.showMessage(e.item === 'thunder' ? 'STUNNED!' : 'SPUN OUT!', 1.2, 'warn');
      if (this.applied.cameraShake) this.cam.addShake(0.6);
      this.input.rumble(0.9, 400);
    } else if (e.type === 'itemHit' && e.by === me && e.item !== 'thunder') {
      this.hud.showBoost('HIT!', 'shockwave');
      this.audio.item(3);
    } else if (e.type === 'itemBlocked' && e.racerId === me) {
      this.audio.item(3);
      this.hud.showBoost('BLOCKED!', 'perfect');
    }
  }

  /** Nitro pickups and special boosts: a callout over the speedo, a sound and a kick. */
  private onBoost(kind: 'pickup' | 'perfect' | 'shockwave' | 'super' | 'normal'): void {
    if (kind === 'normal') return;
    const text = { pickup: '+NITRO', perfect: 'PERFECT NITRO!', shockwave: 'SHOCKWAVE!', super: 'SUPER NITRO!' }[kind];
    this.hud.showBoost(text, kind);
    this.audio.boost(kind === 'pickup' ? 0 : kind === 'perfect' ? 1 : 2);
    if (kind === 'shockwave' || kind === 'super') {
      if (this.applied.cameraShake) this.cam.addShake(0.5);
      this.input.rumble(0.7, 260);
    }
  }

  private onPlayerFinished(position: number): void {
    this.state = 'finished';
    this.sim.player.autopilot = true;
    this.hud.showMessage(position === 1 ? 'YOU WIN!' : `FINISHED P${position}`, 3, position <= 3 ? 'gold' : '');
    // Slow-motion shot from beside the line, on the side the car is not on.
    this.cine.startFinish(this.track, this.sim.player.proj.lateral > 0 ? -1 : 1);
    const me = this.sim.race.racers[this.sim.player.id];
    const setup = this.setup!;
    const gp = this.gp;
    if (gp) {
      // Everyone's place now (cars still running are placed by how far round they are).
      const drivers = driverOfCars(this.sim.cars);
      const places: number[] = [];
      for (const r of this.sim.race.racers) places[drivers[r.id]] = r.position;
      gp.record(places);
    }
    const record = {
      track: setup.course,
      position,
      fieldSize: this.sim.cars.length,
      laps: setup.laps,
      difficulty: setup.difficulty,
      totalTime: me.finishTime,
      bestLap: me.bestLapTime,
      driftPoints: this.feedback.driftPoints,
      ...(setup.event ? { event: setup.event } : {}),
      ...(gp ? { gp: { cup: gp.cup.id, round: gp.round, ...(gp.last ? { place: gp.playerPlace() } : {}) } } : {}),
    };
    // What this result pays (prize money, a career event's first-podium and star bonuses, a cup's
    // trophy, drift points).
    const settled = settleResult(this.account.wallet, record, todayKey());
    const ev = careerEvent(record.event);
    if (gp?.last) this.gpTrophy = { place: gp.playerPlace(), bonus: typeof settled === 'string' ? 0 : (settled.trophyBonus ?? 0) };
    const reward: RaceReward =
      typeof settled === 'string'
        ? { earned: raceReward(record), dp: 0 }
        : {
            earned: settled.earned,
            dp: settled.dp,
            ...(ev ? { event: { stars: settled.stars, newStars: settled.newStars, times: starTimes(ev), bonus: settled.bonus } } : {}),
          };
    const saving = this.account.recordRace(record);
    setTimeout(async () => {
      if (this.state !== 'finished') return;
      this.screens.showResults(this.resultsData(), 'Saving result…', reward);
      this.screens.gp.showStandings(gp ? { cupName: gp.cup.name, round: gp.round, rounds: gp.cup.races.length, rows: this.gpRows() } : null);
      this.screens.showFreeBack(!!setup.fromFreeDrive);
      const where = await saving;
      if (this.state !== 'finished') return;
      this.screens.setResultsSaved(
        where === 'account'
          ? `Saved to ${this.account.displayName}'s career ✓`
          : where === 'device'
            ? 'Saved on this device. Log in from the homescreen to keep your career in your account.'
            : 'Could not save this result (server unreachable).',
      );
    }, 3200);
  }

  private resultsData() {
    return { standings: this.sim.race.standings(), playerId: this.sim.player.id, colors: this.colors };
  }

  private syncCarModels(alpha: number, dt: number): void {
    for (let i = 0; i < this.sim.cars.length; i++) this.carModels[i].update(this.sim.cars[i], alpha, dt, this.sim.items?.state[this.sim.cars[i].id]);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pipeline.resize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }
}

function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}

/** Full-screen loading overlay (null hides it). */
function setLoading(text: string | null): void {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.toggle('hidden', text === null);
  const label = el.querySelector('.muted');
  if (text && label) label.textContent = text;
}

/** Letterbox bars + title card for the race intro (null hides it). */
function showCinematic(card: { kicker: string; name: string; meta: string } | null): void {
  const el = document.getElementById('cinematic')!;
  el.classList.toggle('hidden', card === null);
  if (!card) return;
  document.getElementById('cine-kicker')!.textContent = card.kicker;
  document.getElementById('cine-name')!.textContent = card.name;
  document.getElementById('cine-meta')!.textContent = card.meta;
  // Restart the title animation.
  const title = el.querySelector<HTMLElement>('.cine-title')!;
  title.style.animation = 'none';
  void title.offsetWidth;
  title.style.animation = '';
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The free drive map picture's road map, drawn over the view from above (`scale` px per metre). */
function drawRoadMap(g: CanvasRenderingContext2D, map: FreeRoamMap, pickups: FreeRoamMap['pickups'], scale: number, minX: number, minZ: number): void {
  const px = (x: number) => (x - minX) * scale;
  const pz = (z: number) => (z - minZ) * scale;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Buildings and landmarks (not the trees).
  g.fillStyle = 'rgba(70, 74, 88, 0.85)';
  g.strokeStyle = 'rgba(30, 32, 40, 0.9)';
  g.lineWidth = 1;
  for (const o of map.obstacles) {
    if (o.layer) continue;
    g.fillRect(px(o.x - o.hw), pz(o.z - o.hd), o.hw * 2 * scale, o.hd * 2 * scale);
    g.strokeRect(px(o.x - o.hw), pz(o.z - o.hd), o.hw * 2 * scale, o.hd * 2 * scale);
  }
  const line = (pts: [number, number][], width: number, color: string, dash: number[] = []) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
    g.setLineDash(dash);
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, width * scale);
    g.stroke();
    g.setLineDash([]);
  };
  for (const r of map.roads.filter((r) => r.kind === 'trail')) line(r.pts, r.width, '#b08a52', [10, 7]);
  // Kerbs first, then the asphalt over them, so crossings join up cleanly.
  for (const r of map.roads.filter((r) => r.kind !== 'trail')) line(r.pts, r.width + 5, r.kind === 'ring' ? '#f4f4f4' : '#d9d9de');
  for (const r of map.roads.filter((r) => r.kind !== 'trail')) line(r.pts, r.width, r.kind === 'ring' ? '#2b2c33' : '#3c3d45');
  // Nitro: blue bottles, gold super boosts.
  for (const p of pickups) {
    g.beginPath();
    g.arc(px(p.x), pz(p.z), p.kind === 'super' ? 6 : 4.5, 0, Math.PI * 2);
    g.fillStyle = p.kind === 'super' ? '#ffc42e' : '#3aa0ff';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#fff';
    g.stroke();
  }
}
