import { CAR_IDS, type CarId, type CarSetup, type UpgradePart, type Upgrades } from '../../shared/api';
import { MAX_UPGRADE } from '../../shared/economy';
import { clamp, createRng, lerp } from '../core/math';
import { SPORTS_CAR, type VehicleSpec } from '../physics/VehiclePhysics';

/** The garage: every drivable car, its handling and its body shape. */

export type WingStyle = 'none' | 'lip' | 'roof' | 'gt' | 'rally';

export interface BodyDef {
  /** Side profile of the lower body, [z (forward), y (up)] in metres. */
  profile: [number, number][];
  /** Side profile of the glasshouse. */
  cabin: [number, number][];
  width: number;
  cabinWidth: number;
  /** Painted roof panel: centre z, length, height. */
  roof: { z: number; length: number; y: number };
  wheelRadius: number;
  trackHalf: number;
  frontAxle: number;
  rearAxle: number;
  wing: WingStyle;
  /** Rally kit: roof scoop, light pod, mud flaps, splitter, tow hooks, louvres and diffuser. */
  rally?: boolean;
  /** Bonnet scoop. */
  hoodScoop?: boolean;
  /** Bolt-on wheel-arch flares. */
  flares?: boolean;
  /** Mid-engine side intakes and engine-cover louvres. */
  sideIntakes?: boolean;
  /** Vents on the bonnet. */
  hoodVents?: boolean;
}

export interface CarDef {
  id: CarId;
  name: string;
  /** Class shown in the garage. */
  kind: string;
  blurb: string;
  /**
   * 1..10 bars in the garage, before upgrades. The cars start close together (each with a
   * little personality) and every one of them reaches 10 everywhere when fully upgraded.
   */
  stats: { speed: number; acceleration: number; handling: number; braking: number; drift: number };
  spec: VehicleSpec;
  /** AI cornering speed relative to the GT (cars with less grip must be driven slower). */
  aiGrip: number;
  body: BodyDef;
  setup: CarSetup;
}

const torque = (scale: number) => SPORTS_CAR.torqueCurve.map(([rpm, nm]) => [rpm, nm * scale] as const);

export const CARS: Record<CarId, CarDef> = {
  starter: {
    id: 'starter',
    name: 'Mame 1.3',
    kind: 'Starter Car',
    blurb: 'Soft and honest. Every legend starts somewhere: win races, earn yen and tune it into a giant-killer.',
    stats: { speed: 4, acceleration: 4, handling: 5, braking: 4, drift: 4 },
    spec: {
      ...SPORTS_CAR,
      mass: 1150,
      inertia: 1500,
      wheelbase: 2.5,
      cgToFront: 1.1,
      cgToRear: 1.4,
      cgHeight: 0.52,
      halfWidth: 0.86,
      halfLength: 2.0,
      wheelRadius: 0.31,
      tireGrip: 1.52,
      corneringStiffnessFront: 84000,
      corneringStiffnessRear: 100000,
      handbrakeGrip: 0.6,
      maxBrakeForce: 12500,
      dragCoefficient: 0.44,
      torqueCurve: torque(0.75),
      finalDrive: 4.1,
      maxSteer: 0.6,
      nitroForce: 3600,
    },
    aiGrip: 0.97,
    body: {
      profile: [
        [-2.0, 0.32],
        [1.92, 0.32],
        [2.02, 0.46],
        [1.98, 0.66],
        [1.0, 0.84],
        [-1.7, 0.9],
        [-2.02, 0.84],
        [-2.04, 0.46],
      ],
      cabin: [
        [-1.8, 0.86],
        [0.9, 0.82],
        [0.1, 1.32],
        [-1.4, 1.36],
        [-1.82, 1.0],
      ],
      width: 1.74,
      cabinWidth: 1.48,
      roof: { z: -0.65, length: 1.4, y: 1.36 },
      wheelRadius: 0.31,
      trackHalf: 0.76,
      frontAxle: 1.25,
      rearAxle: -1.25,
      wing: 'none',
    },
    setup: {
      paint: '#4a78c2',
      finish: 'gloss',
      pattern: 'none',
      accent: '#ffffff',
      rims: '#d6dae2',
      number: 13,
      plate: 'MAME 13',
    },
  },
  gt: {
    id: 'gt',
    name: 'Kaze GT',
    kind: 'Grand Tourer',
    blurb: 'The all-rounder: stable under braking, quick on the straights and happy to slide.',
    stats: { speed: 5, acceleration: 5, handling: 5, braking: 5, drift: 5 },
    spec: SPORTS_CAR,
    aiGrip: 1,
    body: {
      profile: [
        [-2.24, 0.3],
        [2.08, 0.3],
        [2.2, 0.42],
        [2.16, 0.6],
        [1.05, 0.8],
        [-1.55, 0.86],
        [-2.18, 0.9],
        [-2.27, 0.72],
        [-2.27, 0.42],
      ],
      cabin: [
        [-1.5, 0.84],
        [1.0, 0.8],
        [0.2, 1.2],
        [-0.85, 1.23],
        [-1.52, 0.9],
      ],
      width: 1.88,
      cabinWidth: 1.46,
      roof: { z: -0.33, length: 0.95, y: 1.245 },
      wheelRadius: 0.33,
      trackHalf: 0.8,
      frontAxle: 1.2,
      rearAxle: -1.4,
      wing: 'gt',
      hoodVents: true,
    },
    setup: {
      paint: '#1e88ff',
      finish: 'metallic',
      pattern: 'stripes',
      accent: '#ffffff',
      rims: '#d6dae2',
      number: 23,
      plate: 'KAZE GT',
    },
  },
  hatch: {
    id: 'hatch',
    name: 'Shiro Spyder',
    kind: 'Roadster',
    blurb: 'Light and eager, roof down. Gives away top speed but darts into corners and never bites.',
    stats: { speed: 4, acceleration: 5, handling: 6, braking: 5, drift: 4 },
    spec: {
      ...SPORTS_CAR,
      mass: 1120,
      inertia: 1450,
      wheelbase: 2.55,
      cgToFront: 1.15,
      cgToRear: 1.4,
      halfWidth: 0.88,
      halfLength: 1.95,
      wheelRadius: 0.31,
      tireGrip: 1.56,
      corneringStiffnessFront: 88000,
      corneringStiffnessRear: 104000,
      handbrakeGrip: 0.6,
      maxBrakeForce: 14000,
      dragCoefficient: 0.4,
      torqueCurve: torque(0.76),
      finalDrive: 4.15,
      maxSteer: 0.62,
    },
    aiGrip: 1.02,
    body: {
      profile: [
        [-1.92, 0.31],
        [1.86, 0.31],
        [1.97, 0.44],
        [1.93, 0.66],
        [1.0, 0.86],
        [-1.75, 0.92],
        [-1.96, 0.86],
        [-1.98, 0.44],
      ],
      cabin: [
        [-1.86, 0.88],
        [0.95, 0.84],
        [0.12, 1.38],
        [-1.58, 1.42],
        [-1.88, 1.02],
      ],
      width: 1.76,
      cabinWidth: 1.5,
      roof: { z: -0.73, length: 1.55, y: 1.42 },
      wheelRadius: 0.31,
      trackHalf: 0.76,
      frontAxle: 1.25,
      rearAxle: -1.3,
      wing: 'roof',
    },
    setup: {
      paint: '#f2f2f2',
      finish: 'gloss',
      pattern: 'race',
      accent: '#e8202a',
      rims: '#23262b',
      number: 8,
      plate: 'SPYDER',
    },
  },
  rally: {
    id: 'rally',
    name: 'Yama R4',
    kind: 'Rally Special',
    blurb: 'Long-travel suspension and a rally-bred chassis. Explosive off the line, loves to be thrown sideways.',
    stats: { speed: 4, acceleration: 6, handling: 5, braking: 5, drift: 6 },
    spec: {
      ...SPORTS_CAR,
      mass: 1230,
      inertia: 1600,
      wheelbase: 2.55,
      cgToFront: 1.15,
      cgToRear: 1.4,
      cgHeight: 0.56,
      halfWidth: 0.92,
      halfLength: 2.0,
      wheelRadius: 0.35,
      tireGrip: 1.55,
      corneringStiffnessFront: 92000,
      corneringStiffnessRear: 100000,
      handbrakeGrip: 0.45,
      dragCoefficient: 0.5,
      torqueCurve: torque(0.86),
      finalDrive: 4.4,
      shiftTime: 0.1,
      maxSteer: 0.64,
    },
    aiGrip: 1,
    body: {
      // A WRC-style hatch: low wedge nose, steep raked screen, short tail.
      profile: [
        [-1.96, 0.4],
        [1.94, 0.4],
        [2.06, 0.5],
        [2.03, 0.68],
        [1.6, 0.84],
        [0.95, 0.97],
        [-1.78, 1.03],
        [-2.0, 0.96],
        [-2.03, 0.54],
      ],
      cabin: [
        [-1.86, 0.99],
        [0.92, 0.95],
        [0.02, 1.47],
        [-1.5, 1.52],
        [-1.9, 1.16],
      ],
      width: 1.9,
      cabinWidth: 1.5,
      roof: { z: -0.72, length: 1.48, y: 1.52 },
      wheelRadius: 0.35,
      trackHalf: 0.8,
      frontAxle: 1.25,
      rearAxle: -1.3,
      wing: 'rally',
      rally: true,
      flares: true,
      hoodScoop: true,
      hoodVents: true,
    },
    setup: {
      paint: '#0a3d91',
      finish: 'gloss',
      pattern: 'race',
      accent: '#ffd400',
      rims: '#ffd400',
      number: 5,
      plate: 'YAMA R4',
    },
  },
  drift: {
    id: 'drift',
    name: 'Oni 86R',
    kind: 'Drift Coupe',
    blurb: 'A rear-drive brawler with a loose tail. Hard to keep straight, glorious when it is not.',
    stats: { speed: 5, acceleration: 5, handling: 4, braking: 4, drift: 7 },
    spec: {
      ...SPORTS_CAR,
      mass: 1280,
      inertia: 1750,
      halfWidth: 0.92,
      tireGrip: 1.5,
      corneringStiffnessFront: 98000,
      corneringStiffnessRear: 96000,
      handbrakeGrip: 0.4,
      torqueCurve: torque(0.92),
      finalDrive: 3.95,
      dragCoefficient: 0.44,
      maxSteer: 0.66,
    },
    aiGrip: 0.95,
    body: {
      profile: [
        [-2.2, 0.28],
        [2.16, 0.28],
        [2.26, 0.4],
        [2.22, 0.62],
        [0.85, 0.78],
        [-1.6, 0.82],
        [-2.2, 0.85],
        [-2.28, 0.66],
        [-2.28, 0.4],
      ],
      cabin: [
        [-1.45, 0.8],
        [0.8, 0.78],
        [0.05, 1.17],
        [-0.95, 1.19],
        [-1.5, 0.86],
      ],
      width: 1.8,
      cabinWidth: 1.42,
      roof: { z: -0.45, length: 0.95, y: 1.21 },
      wheelRadius: 0.32,
      trackHalf: 0.8,
      frontAxle: 1.25,
      rearAxle: -1.35,
      wing: 'gt',
      hoodScoop: true,
      flares: true,
    },
    setup: {
      paint: '#ff4fa3',
      finish: 'pearl',
      pattern: 'side',
      accent: '#1a1a1a',
      rims: '#c9a24a',
      number: 86,
      plate: 'ONI 86R',
    },
  },
  super: {
    id: 'super',
    name: 'Raijin V12',
    kind: 'Hypercar',
    blurb: 'Mid-engined, with the highest top speed off the showroom floor. Brake early - it arrives at corners in a hurry.',
    stats: { speed: 6, acceleration: 5, handling: 5, braking: 6, drift: 3 },
    spec: {
      ...SPORTS_CAR,
      mass: 1420,
      inertia: 2050,
      wheelbase: 2.8,
      cgToFront: 1.3,
      cgToRear: 1.5,
      cgHeight: 0.42,
      halfWidth: 1.0,
      halfLength: 2.3,
      wheelRadius: 0.35,
      tireGrip: 1.56,
      corneringStiffnessFront: 108000,
      corneringStiffnessRear: 130000,
      handbrakeGrip: 0.6,
      maxBrakeForce: 18000,
      dragCoefficient: 0.38,
      torqueCurve: torque(1.02),
      finalDrive: 3.55,
    },
    aiGrip: 1.05,
    body: {
      profile: [
        [-2.3, 0.26],
        [2.2, 0.26],
        [2.33, 0.36],
        [2.26, 0.5],
        [0.75, 0.74],
        [-1.0, 0.88],
        [-2.26, 0.88],
        [-2.34, 0.66],
        [-2.34, 0.38],
      ],
      cabin: [
        [-1.15, 0.86],
        [0.9, 0.72],
        [0.15, 1.1],
        [-0.6, 1.12],
        [-1.2, 0.92],
      ],
      width: 2.0,
      cabinWidth: 1.4,
      roof: { z: -0.22, length: 0.72, y: 1.13 },
      wheelRadius: 0.35,
      trackHalf: 0.86,
      frontAxle: 1.35,
      rearAxle: -1.45,
      wing: 'gt',
      flares: true,
      sideIntakes: true,
    },
    setup: {
      paint: '#ff6a00',
      finish: 'metallic',
      pattern: 'twotone',
      accent: '#111214',
      rims: '#111214',
      number: 1,
      plate: 'RAIJIN',
    },
  },
};

/** Paint swatches offered in the garage (a colour picker allows anything else). */
export const PAINT_SWATCHES = [
  '#1e88ff',
  '#e8202a',
  '#f5f5f5',
  '#111214',
  '#ffb000',
  '#13c27a',
  '#9b3cff',
  '#ff4fa3',
  '#00c8e0',
  '#c0c4cc',
  '#ff6a00',
  '#0a3d91',
  '#6b8e23',
  '#7a1020',
];
export const RIM_SWATCHES = ['#d6dae2', '#23262b', '#c9a24a', '#ffd400', '#f5f5f5', '#e8202a', '#8a5a2b'];

/** Livery colours for AI cars. */
export const AI_LIVERIES: Omit<CarSetup, 'finish' | 'plate'>[] = [
  { paint: '#e8202a', pattern: 'stripes', accent: '#ffffff', rims: '#d6dae2', number: 1 },
  { paint: '#f5f5f5', pattern: 'race', accent: '#d01020', rims: '#23262b', number: 7 },
  { paint: '#ffb000', pattern: 'side', accent: '#111111', rims: '#23262b', number: 11 },
  { paint: '#13c27a', pattern: 'none', accent: '#ffffff', rims: '#d6dae2', number: 44 },
  { paint: '#9b3cff', pattern: 'stripes', accent: '#ffffff', rims: '#c9a24a', number: 86 },
  { paint: '#202326', pattern: 'race', accent: '#ff6a00', rims: '#ff6a00', number: 3 },
  { paint: '#ff4fa3', pattern: 'twotone', accent: '#1a1a1a', rims: '#23262b', number: 32 },
  { paint: '#00c8e0', pattern: 'side', accent: '#101010', rims: '#f5f5f5', number: 55 },
  { paint: '#c0c4cc', pattern: 'stripes', accent: '#1e88ff', rims: '#23262b', number: 17 },
  { paint: '#6b8e23', pattern: 'none', accent: '#ffffff', rims: '#8a5a2b', number: 9 },
  { paint: '#ff7a1a', pattern: 'race', accent: '#0a2a6a', rims: '#d6dae2', number: 77 },
];

/** A random plate like "KTR 482" (for AI cars and the garage's dice button). */
export function randomPlate(seed: number): string {
  const h = (k: number) => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const pick = (k: number) => letters[Math.floor(h(k) * letters.length)];
  return `${pick(1)}${pick(2)}${pick(3)} ${String(Math.floor(h(4) * 1000)).padStart(3, '0')}`;
}

export interface FieldCar {
  car: CarDef;
  /** Engine scale that evens the field out a little (see aiField). */
  power: number;
}

/**
 * The cars the AI drive: your car's class and the ones either side of it (the shop's order), in
 * a shuffled order with your car in twice, so a few usually match. Engines are evened out a
 * little toward your car's pace; upgrades are yours alone, so tuning your car pays off.
 */
export function aiField(player: CarId, count: number, seed: number): FieldCar[] {
  const rng = createRng(seed);
  const tier = CAR_IDS.indexOf(player);
  const order = [...CAR_IDS.filter((_, i) => Math.abs(i - tier) <= 1), player];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pace = (c: CarDef) => c.stats.speed + c.stats.acceleration;
  return Array.from({ length: count }, (_, i) => {
    const car = CARS[order[i % order.length]];
    return { car, power: clamp(1 + 0.03 * (pace(CARS[player]) - pace(car)), 0.85, 1.15) };
  });
}

/**
 * Fully upgraded, every car reaches the same top performance (scaled to its weight); each part
 * moves its share of the car's setup from where it started toward that target.
 */
const MAXED = {
  /** Peak torque per kg. */
  torquePerKg: 0.5,
  finalDrive: 3.7,
  shiftTime: 0.07,
  drivetrainEfficiency: 0.92,
  dragCoefficient: 0.33,
  tireGrip: 1.9,
  /** Cornering stiffness per kg, front and rear. */
  stiffnessPerKg: [92, 102] as const,
  /** Brake force per kg. */
  brakesPerKg: 15.5,
  handbrakeGrip: 0.4,
  nitroPerKg: 6.5,
  nitroCapacity: 6,
};

/** A car's handling with its upgrades fitted. */
export function upgradedSpec(spec: VehicleSpec, u: Upgrades): VehicleSpec {
  const f = (part: UpgradePart) => clamp(u[part] / MAX_UPGRADE, 0, 1);
  const to = (from: number, target: number, part: UpgradePart) => lerp(from, target, f(part));
  const peak = Math.max(...spec.torqueCurve.map(([, nm]) => nm));
  const power = to(1, (MAXED.torquePerKg * spec.mass) / peak, 'engine');
  return {
    ...spec,
    torqueCurve: spec.torqueCurve.map(([rpm, nm]) => [rpm, nm * power] as const),
    finalDrive: to(spec.finalDrive, MAXED.finalDrive, 'gearbox'),
    shiftTime: to(spec.shiftTime, MAXED.shiftTime, 'gearbox'),
    drivetrainEfficiency: to(spec.drivetrainEfficiency, MAXED.drivetrainEfficiency, 'gearbox'),
    dragCoefficient: to(spec.dragCoefficient, MAXED.dragCoefficient, 'aero'),
    tireGrip: to(spec.tireGrip, MAXED.tireGrip, 'tyres'),
    corneringStiffnessFront: to(spec.corneringStiffnessFront, MAXED.stiffnessPerKg[0] * spec.mass, 'suspension'),
    corneringStiffnessRear: to(spec.corneringStiffnessRear, MAXED.stiffnessPerKg[1] * spec.mass, 'suspension'),
    maxBrakeForce: to(spec.maxBrakeForce, MAXED.brakesPerKg * spec.mass, 'brakes'),
    handbrakeGrip: to(spec.handbrakeGrip, MAXED.handbrakeGrip, 'diff'),
    nitroForce: to(spec.nitroForce, MAXED.nitroPerKg * spec.mass, 'nitro'),
    nitroCapacity: to(spec.nitroCapacity, MAXED.nitroCapacity, 'nitro'),
  };
}

export type CarStats = CarDef['stats'] & { nitro: number };

/** The garage's stat bars (1..10) with upgrades counted in: all 10s when fully upgraded. */
export function carStats(def: CarDef, u: Upgrades): CarStats {
  const f = (...parts: UpgradePart[]) => parts.reduce((sum, p) => sum + clamp(u[p] / MAX_UPGRADE, 0, 1), 0) / parts.length;
  const bar = (base: number, done: number) => Math.round((base + (10 - base) * done) * 2) / 2;
  const b = def.stats;
  return {
    speed: bar(b.speed, f('engine', 'aero')),
    acceleration: bar(b.acceleration, f('engine', 'gearbox')),
    handling: bar(b.handling, f('tyres', 'suspension')),
    braking: bar(b.braking, f('brakes')),
    drift: bar(b.drift, f('diff')),
    nitro: bar(4, f('nitro')),
  };
}

export function carSetup(id: CarId, garage: Partial<Record<CarId, CarSetup>> | undefined): CarSetup {
  return { ...CARS[id].setup, ...garage?.[id] };
}
