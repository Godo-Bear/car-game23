import type { TrackId } from '../../shared/api';
import type { CityScene } from './City';
import { mountainTerrain, type RuralScene, snowTerrain, valleyTerrain } from './Nature';

/**
 * What surrounds each circuit: the city's waterfront, districts and landmarks, or the
 * countryside's terrain, lake, vegetation, villages, railway and signs.
 */
export type Scene = ({ kind: 'city' } & CityScene) | ({ kind: 'rural' } & RuralScene);

const MOUNTAIN_GRASS = { base: 0x2c4a1c, tip: 0x86a043, flowers: [0xf2efe4], height: 0.5 };
const MEADOW_GRASS = { base: 0x3b6a20, tip: 0xa3c84e, flowers: [0xf4a6c8, 0xf6f2e8, 0xf1d24a], height: 0.6 };

export const SCENES: Record<TrackId, Scene> = {
  tokyo: {
    kind: 'city',
    bayZ: 610,
    tower: { x: 720, z: -430, height: 333 },
    skytree: { x: 1150, z: -1500 },
    bridge: { x: 700, z: 1260 },
    rail: { x: 80, toZ: 640 },
    crossings: [
      [-218, 150],
      [-262, 150],
    ],
    fujiAt: [-3300, 3600],
    skyline: [150, -100],
    // Shinjuku towers north of the main straight, Shiodome towers by the hairpin.
    height(x, z, rng) {
      if (z < -40 && x > -520 && x < 320) return 55 + rng() ** 1.4 * 170;
      if (x < -260 && z > 280) return 35 + rng() * 95;
      return rng() < 0.05 ? 90 + rng() * 80 : 9 + rng() ** 2 * 45;
    },
  },
  osaka: {
    kind: 'city',
    bayZ: 780,
    // Tsutenkaku's taller cousin stands over Shinsekai; Osaka Castle in its park to the east.
    tower: { x: -720, z: -330, height: 260 },
    castle: { x: 520, z: -130 },
    supertall: { x: 180, z: -420, height: 300 },
    ferrisWheel: { x: -600, z: 260, radius: 34 },
    rail: { x: -150, toZ: 760 },
    crossings: [
      [60, 262],
      [60, 318],
    ],
    fujiAt: null,
    skyline: [0, 100],
    // Umeda's towers to the north; low, dense Namba and Dotonbori around the circuit.
    height(x, z, rng) {
      if (z < -80 && x > -450 && x < 420) return 50 + rng() ** 1.3 * 150;
      return rng() < 0.04 ? 80 + rng() * 60 : 10 + rng() ** 2 * 38;
    },
  },
  yokohama: {
    kind: 'city',
    bayZ: 620,
    // The Marine Tower by the harbour, the Landmark Tower and the Cosmo Clock big wheel.
    tower: { x: 720, z: 280, height: 210 },
    supertall: { x: -140, z: -170, height: 296 },
    ferrisWheel: { x: -90, z: 603, radius: 48 },
    bridge: { x: -250, z: 1330 },
    rail: { x: 140, toZ: 610 },
    crossings: [
      [-256, 210],
      [-258, 165],
    ],
    fujiAt: [-3800, 1500],
    skyline: [0, -200],
    // Minato Mirai's office towers between the circuit and the Landmark Tower.
    height(x, z, rng) {
      if (z < -60 && x > -420 && x < 360) return 45 + rng() ** 1.3 * 140;
      return rng() < 0.05 ? 70 + rng() * 70 : 10 + rng() ** 2 * 40;
    },
  },
  hakone: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 11, lake: { x: 0, z: 290, rx: 390, rz: 165 }, fujiAt: [-3200, 3000] }),
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
    ryokan: [-210, 62],
    ropeway: [
      [380, 560],
      [900, 1150],
    ],
    machines: [40, 260, 1100],
    grass: MOUNTAIN_GRASS,
  },
  irohazaka: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 37, lake: { x: 0, z: 330, rx: 330, rz: 130 }, fujiAt: [2600, -3200], autumn: true }),
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
    ryokan: [150, 215],
    ropeway: [
      [560, -260],
      [1050, -700],
    ],
    machines: [40, 950, 1900],
    particles: 'leaves',
    grass: { base: 0x4a4420, tip: 0xa08a3a, flowers: [0xd8641e, 0xe0b040], height: 0.45 },
  },
  haruna: {
    kind: 'rural',
    theme: 'mountain',
    terrain: mountainTerrain({ seed: 53, lake: { x: -50, z: 260, rx: 300, rz: 140 }, fujiAt: [-3000, 3200] }),
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
    ryokan: [120, 105],
    ropeway: [
      [-520, 420],
      [-950, 900],
    ],
    machines: [60, 700, 1500],
    grass: MOUNTAIN_GRASS,
  },
  niseko: {
    kind: 'rural',
    theme: 'mountain',
    // Mt. Yotei, "Ezo Fuji", stands over Niseko.
    terrain: snowTerrain({ seed: 67, lake: { x: 0, z: 300, rx: 350, rz: 140 }, fujiAt: [2500, -2800] }),
    vegetation: 'snow',
    props: ['sign'],
    signs: [
      ['ニセコ', 'NISEKO'],
      ['羊蹄山', 'MT. YOTEI'],
      ['凍結注意', 'ICY ROAD'],
      ['北海道', 'HOKKAIDO'],
    ],
    ryokan: [-150, 120],
    ropeway: [
      [-950, -650],
      [-1500, -1150],
    ],
    machines: [50, 1200],
    snowPoles: true,
    particles: 'snow',
    grass: null,
  },
  sakura: {
    kind: 'rural',
    theme: 'countryside',
    terrain: valleyTerrain({ seed: 29, lake: { x: -60, z: 200, rx: 205, rz: 100 }, fujiAt: [-3400, 2900] }),
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
    rail: { z: 250, kind: 'shinkansen', deckY: 25 },
    machines: [30, 700, 1500],
    lanterns: true,
    particles: 'petals',
    grass: MEADOW_GRASS,
  },
  arashiyama: {
    kind: 'rural',
    theme: 'countryside',
    terrain: valleyTerrain({ seed: 83, lake: { x: -30, z: 150, rx: 120, rz: 55 }, fujiAt: null, hills: 2.4, moss: true }),
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
    rail: { z: -130, kind: 'commuter', deckY: 14 },
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
      lake: { x: 100, z: 820, rx: 1400, rz: 490 },
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
    rail: { z: -400, kind: 'commuter', deckY: 16 },
    machines: [40, 800, 1600],
    particles: 'petals',
    grass: MEADOW_GRASS,
  },
};

/** Model files a map places (loaded before it is built). */
export function sceneProps(id: TrackId): RuralScene['props'] {
  const scene = SCENES[id];
  if (scene.kind === 'rural') return scene.props;
  return scene.castle ? ['castle'] : [];
}
