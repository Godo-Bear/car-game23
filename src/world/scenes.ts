import * as THREE from 'three';
import { smoothstep } from '../core/math';
import type { WorldId } from '../track/tracks';
import type { CityScene } from './City';
import { fbm, mountainTerrain, type RuralScene, snowTerrain, valleyTerrain } from './Nature';

/**
 * What surrounds each circuit: the city's waterfront, districts and landmarks, or the
 * countryside's terrain, lake, vegetation, villages, railway and signs.
 */
export type Scene = ({ kind: 'city' } & CityScene) | ({ kind: 'rural' } & RuralScene);

const MOUNTAIN_GRASS = { base: 0x2c4a1c, tip: 0x86a043, flowers: [0xf2efe4], height: 0.5 };
const MEADOW_GRASS = { base: 0x3b6a20, tip: 0xa3c84e, flowers: [0xf4a6c8, 0xf6f2e8, 0xf1d24a], height: 0.6 };

export const SCENES: Record<WorldId, Scene> = {
  tokyo: {
    kind: 'city',
    bayZ: 762,
    tower: { x: 900, z: -538, height: 333 },
    skytree: { x: 1438, z: -1875 },
    bridge: { x: 875, z: 1575 },
    rail: { x: 100, toZ: 800 },
    crossings: [
      [-60, 330],
      [-10, 330],
    ],
    fujiAt: [-3300, 3600],
    skyline: [188, -125],
    // Shinjuku towers north of the main straight, Shiodome towers by the hairpin.
    height(x, z, rng) {
      if (z < -50 && x > -650 && x < 400) return 55 + rng() ** 1.4 * 170;
      if (x < -325 && z > 350) return 35 + rng() * 95;
      return rng() < 0.05 ? 90 + rng() * 80 : 9 + rng() ** 2 * 45;
    },
  },
  osaka: {
    kind: 'city',
    bayZ: 975,
    // Tsutenkaku's taller cousin stands over Shinsekai; Osaka Castle in its park to the east.
    tower: { x: -900, z: -412, height: 260 },
    castle: { x: 650, z: -162 },
    supertall: { x: 225, z: -525, height: 300 },
    ferrisWheel: { x: -750, z: 325, radius: 34 },
    rail: { x: -188, toZ: 950 },
    crossings: [
      [75, 328],
      [75, 398],
    ],
    fujiAt: null,
    skyline: [0, 125],
    // Umeda's towers to the north; low, dense Namba and Dotonbori around the circuit.
    height(x, z, rng) {
      if (z < -100 && x > -562 && x < 525) return 50 + rng() ** 1.3 * 150;
      return rng() < 0.04 ? 80 + rng() * 60 : 10 + rng() ** 2 * 38;
    },
  },
  yokohama: {
    kind: 'city',
    bayZ: 775,
    // The Marine Tower by the harbour, the Landmark Tower and the Cosmo Clock big wheel.
    tower: { x: 900, z: 350, height: 210 },
    supertall: { x: -175, z: -212, height: 296 },
    ferrisWheel: { x: -112, z: 754, radius: 48 },
    bridge: { x: -312, z: 1662 },
    rail: { x: 175, toZ: 762 },
    crossings: [
      [-320, 262],
      [-322, 206],
    ],
    fujiAt: [-3800, 1500],
    skyline: [0, -250],
    // Minato Mirai's office towers between the circuit and the Landmark Tower.
    height(x, z, rng) {
      if (z < -75 && x > -525 && x < 450) return 45 + rng() ** 1.3 * 140;
      return rng() < 0.05 ? 70 + rng() * 70 : 10 + rng() ** 2 * 40;
    },
  },
  hakone: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 11, lake: { x: 0, z: 493, rx: 488, rz: 280 }, fujiAt: [-4000, 5100] }),
    vegetation: 'cedar',
    props: ['castle', 'autumnTree', 'sign'],
    signs: [
      ['箱根峠', 'HAKONE PASS'],
      ['芦ノ湖', 'LAKE ASHI'],
      ['急カーブ', 'SHARP BENDS'],
      ['ようこそ', 'WELCOME'],
    ],
    startTree: { id: 'autumnTree', height: 15 },
    shoreLandmark: { id: 'castle', height: 34 },
    torii: true,
    ryokan: [-262, 105],
    ropeway: [
      [475, 952],
      [1125, 1955],
    ],
    machines: [40, 260, 1100],
    grass: MOUNTAIN_GRASS,
  },
  irohazaka: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 37, lake: { x: 0, z: 561, rx: 412, rz: 221 }, fujiAt: [3250, -5440], autumn: true }),
    vegetation: 'autumn',
    props: ['pagoda', 'autumnTree', 'sign'],
    signs: [
      ['いろは坂', 'IROHAZAKA'],
      ['日光', 'NIKKO'],
      ['ヘアピン', 'HAIRPINS'],
      ['紅葉', 'AUTUMN LEAVES'],
    ],
    startTree: { id: 'autumnTree', height: 16 },
    // Nikko's shrines have a five-storey pagoda.
    shoreLandmark: { id: 'pagoda', height: 30 },
    ryokan: [188, 366],
    ropeway: [
      [700, -442],
      [1312, -1190],
    ],
    machines: [40, 950, 1900],
    particles: 'leaves',
    grass: { base: 0x4a4420, tip: 0xa08a3a, flowers: [0xd8641e, 0xe0b040], height: 0.45 },
  },
  haruna: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 53, lake: { x: -62, z: 500, rx: 375, rz: 175 }, fujiAt: [-3750, 4000] }),
    vegetation: 'cedar',
    props: ['autumnTree', 'sign'],
    signs: [
      ['榛名山', 'MT. HARUNA'],
      ['榛名湖', 'LAKE HARUNA'],
      ['峠', 'MOUNTAIN PASS'],
      ['ようこそ', 'WELCOME'],
    ],
    startTree: { id: 'autumnTree', height: 14 },
    torii: true,
    ryokan: [150, 131],
    ropeway: [
      [-650, 525],
      [-1188, 1125],
    ],
    machines: [60, 700, 1500],
    grass: MOUNTAIN_GRASS,
  },
  niseko: {
    kind: 'rural',
    theme: 'mountain',
    // Mt. Yotei, "Ezo Fuji", stands over Niseko.
    terrain: snowTerrain({ seed: 67, lake: { x: 0, z: 375, rx: 438, rz: 175 }, fujiAt: [3125, -3500] }),
    vegetation: 'snow',
    props: ['sign'],
    signs: [
      ['ニセコ', 'NISEKO'],
      ['羊蹄山', 'MT. YOTEI'],
      ['凍結注意', 'ICY ROAD'],
      ['北海道', 'HOKKAIDO'],
    ],
    ryokan: [-188, 150],
    ropeway: [
      [-1188, -812],
      [-1875, -1438],
    ],
    machines: [62, 1500],
    snowPoles: true,
    particles: 'snow',
    grass: null,
  },
  sakura: {
    kind: 'rural',
    theme: 'countryside',
    terrain: valleyTerrain({ seed: 29, lake: { x: -75, z: 250, rx: 256, rz: 125 }, fujiAt: [-4250, 3625] }),
    vegetation: 'blossom',
    props: ['pagoda', 'bonsai', 'sign'],
    signs: [
      ['桜谷', 'SAKURA VALLEY'],
      ['五重塔', 'PAGODA'],
      ['田園', 'RICE FIELDS'],
      ['ようこそ', 'WELCOME'],
    ],
    startTree: { id: 'bonsai', height: 17 },
    pagoda: true,
    villages: 3,
    koinobori: true,
    paddies: true,
    rail: { z: 312, kind: 'shinkansen', deckY: 25 },
    machines: [30, 700, 1500],
    lanterns: true,
    particles: 'petals',
    grass: MEADOW_GRASS,
  },
  arashiyama: {
    kind: 'rural',
    theme: 'countryside',
    terrain: valleyTerrain({ seed: 83, lake: { x: -38, z: 188, rx: 150, rz: 69 }, fujiAt: null, hills: 2.4, moss: true }),
    vegetation: 'bamboo',
    props: ['pagoda', 'autumnTree', 'sign'],
    signs: [
      ['嵐山', 'ARASHIYAMA'],
      ['竹林の小径', 'BAMBOO GROVE'],
      ['京都', 'KYOTO'],
      ['渡月橋', 'TOGETSUKYO'],
    ],
    startTree: { id: 'autumnTree', height: 14 },
    shoreLandmark: { id: 'pagoda', height: 28 },
    villages: 2,
    // The Sagano line.
    rail: { z: -162, kind: 'commuter', deckY: 14 },
    machines: [30, 900, 1800],
    lanterns: true,
    particles: 'leaves',
    grass: { base: 0x335a1c, tip: 0x7fa040, flowers: [0xf6f2e8], height: 0.5 },
  },
  izu: {
    kind: 'rural',
    theme: 'countryside',
    // The sea fills the south; Mt. Fuji across the water to the north.
    terrain: valleyTerrain({
      seed: 71,
      lake: { x: 125, z: 1025, rx: 1750, rz: 612 },
      fujiAt: [-800, -4200],
      waterColor: 0x1f6f8a,
      coast: true,
    }),
    vegetation: 'coast',
    props: ['bonsai', 'sign'],
    signs: [
      ['伊豆', 'IZU'],
      ['海岸線', 'COAST ROAD'],
      ['河津桜', 'KAWAZU CHERRY'],
      ['富士山', 'MT. FUJI'],
    ],
    startTree: { id: 'bonsai', height: 15 },
    shoreLandmark: { id: 'lighthouse', height: 22 },
    villages: 3,
    koinobori: true,
    rail: { z: -500, kind: 'commuter', deckY: 16 },
    machines: [40, 800, 1600],
    particles: 'petals',
    grass: MEADOW_GRASS,
  },
  freeroam: {
    kind: 'rural',
    theme: 'countryside',
    // A flat city basin, mountains all round it.
    terrain: {
      ...valleyTerrain({ seed: 97, lake: { x: 99999, z: 99999, rx: 10, rz: 10 }, fujiAt: [-1500, -5600], hills: 0.4 }),
      natural(x, z) {
        const rc = Math.hypot(x, z);
        const hills = fbm(x / 300, z / 300, 97) * 12 + fbm(x / 90, z / 90, 109) * 3;
        const mountains = smoothstep(1350, 2700, rc) * (260 + fbm(x / 500, z / 500, 75) * 170);
        return (hills + mountains) * smoothstep(1150, 1450, rc);
      },
      color(h, slope, x, z, d, out) {
        const n = fbm(x / 120, z / 120, 77) * 0.5 + 0.5;
        out.copy(new THREE.Color(0x4f7d2c)).lerp(new THREE.Color(0x87a844), n);
        if (slope > 0.5) out.lerp(new THREE.Color(0x6d6a60), smoothstep(0.5, 0.95, slope));
        if (h > 230) out.lerp(new THREE.Color(0xeef2f5), smoothstep(230, 300, h));
        if (Math.hypot(x, z) < 1180) out.set(0x9a9890);
        if (d < 9) out.lerp(new THREE.Color(0x7d8a52), smoothstep(9, 6, d) * 0.6);
      },
    },
    vegetation: 'blossom',
    props: ['pagoda', 'castle', 'bonsai', 'autumnTree', 'sign'],
    signs: [
      ['自由', 'FREE ROAM'],
      ['山道', 'MOUNTAIN ROAD'],
      ['市街地', 'CITY CENTRE'],
      ['林道', 'DIRT TRAILS'],
    ],
    startTree: { id: 'bonsai', height: 17 },
    villages: 6,
    koinobori: true,
    machines: [40, 3000, 7000, 11000],
    particles: 'petals',
    grass: MEADOW_GRASS,
    density: 1.4,
    cityRadius: 1180,
    trails: [
      [
        [-1600, -200],
        [-1900, -500],
        [-2300, -400],
        [-2600, -900],
        [-2400, -1500],
      ],
      [
        [700, -1900],
        [500, -2300],
        [100, -2500],
        [-500, -2400],
        [-1100, -1900],
      ],
      [
        [2000, 200],
        [2400, 0],
        [2700, -400],
        [2500, -900],
        [1900, -1500],
      ],
      [
        [1700, 1300],
        [2200, 1500],
        [2600, 1200],
        [2700, 600],
        [2000, 200],
      ],
      [
        [-1800, 1400],
        [-2300, 1700],
        [-2700, 1200],
        [-2500, 600],
        [-2200, 600],
      ],
      [
        [0, 1550],
        [-200, 2000],
        [300, 2400],
        [900, 2200],
        [1700, 1300],
      ],
    ],
    city: {
      bayZ: 99999,
      tower: { x: 420, z: -380, height: 333 },
      skytree: { x: -520, z: 650 },
      castle: { x: -560, z: -480 },
      ferrisWheel: { x: 700, z: 420, radius: 40 },
      supertall: { x: 120, z: 160, height: 280 },
      rail: { x: 99999, toZ: 0 },
      crossings: [],
      fujiAt: null,
      skyline: [99999, 99999],
      bright: true,
      height(x, z, rng) {
        const rc = Math.hypot(x, z);
        if (rc < 450) return 60 + rng() ** 1.3 * 170;
        if (rc < 800) return 25 + rng() ** 1.5 * 80;
        return 9 + rng() ** 2 * 30;
      },
    },
  },
};

/** Model files a map places (loaded before it is built). */
export function sceneProps(id: WorldId): RuralScene['props'] {
  const scene = SCENES[id];
  if (scene.kind === 'rural') return scene.props;
  return scene.castle ? ['castle'] : [];
}
