import type { TrackId } from '../../shared/api';
import { ARASHIYAMA, FREE_ROAM, HAKONE_PASS, HARUNA, IROHAZAKA, IZU_COAST, NISEKO, SAKURA_VALLEY } from './circuits';
import { OSAKA_CIRCUIT, YOKOHAMA_CIRCUIT } from './cityCircuits';
import type { TrackLayout } from './TrackPath';
import { TOKYO_CIRCUIT } from './tokyoCircuit';

export type TrackTheme = 'city' | 'mountain' | 'countryside';

/** Everything the game can load: the ten circuits, and the free drive map. */
export type WorldId = TrackId | 'freeroam';

export interface TrackDef {
  id: WorldId;
  name: string;
  /** Short name for tight UI spots. */
  short: string;
  /** Full circuit name. */
  circuit: string;
  /** Short line for the homescreen. */
  blurb: string;
  theme: TrackTheme;
  /** Kind of road, for the track picker. */
  label: string;
  /** Subtitle on the start/finish gantry. */
  banner: string;
  layout: TrackLayout;
}

/** A race circuit. */
export interface CircuitDef extends TrackDef {
  id: TrackId;
}

/** Every circuit, in the order the track picker shows them. */
export const TRACKS: Record<TrackId, CircuitDef> = {
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo',
    short: 'Tokyo',
    circuit: 'Shinjuku–Bay Street Circuit',
    blurb: 'Shinjuku–Bay Street Circuit · neon city streets, an elevated expressway and a flyover over the main straight',
    theme: 'city',
    label: 'City streets',
    banner: '東京 ストリート サーキット',
    layout: TOKYO_CIRCUIT,
  },
  osaka: {
    id: 'osaka',
    name: 'Osaka',
    short: 'Osaka',
    circuit: 'Namba–Dotonbori Street Circuit',
    blurb: 'Namba–Dotonbori Street Circuit · neon blocks, the Hanshin Expressway and Osaka Castle',
    theme: 'city',
    label: 'City streets',
    banner: '大阪 ストリート サーキット',
    layout: OSAKA_CIRCUIT,
  },
  yokohama: {
    id: 'yokohama',
    name: 'Yokohama',
    short: 'Yokohama',
    circuit: 'Minato Mirai Bay Circuit',
    blurb: 'Minato Mirai Bay Circuit · downtown blocks and an elevated run along the harbour',
    theme: 'city',
    label: 'Harbour city',
    banner: '横浜 ベイ サーキット',
    layout: YOKOHAMA_CIRCUIT,
  },
  hakone: {
    id: 'hakone',
    name: 'Hakone',
    short: 'Hakone',
    circuit: 'Hakone Mountain Pass',
    blurb: 'Mountain Pass · hairpin switchbacks through cedar forest, then a viaduct high over the start straight',
    theme: 'mountain',
    label: 'Mountain pass',
    banner: '箱根 峠 · HAKONE PASS',
    layout: HAKONE_PASS,
  },
  irohazaka: {
    id: 'irohazaka',
    name: 'Irohazaka',
    short: 'Irohazaka',
    circuit: 'Irohazaka Hairpins',
    blurb: 'Nikko · a ladder of tight hairpins through blazing autumn maples',
    theme: 'mountain',
    label: 'Autumn hairpins',
    banner: 'いろは坂 · IROHAZAKA',
    layout: IROHAZAKA,
  },
  haruna: {
    id: 'haruna',
    name: 'Mt. Haruna',
    short: 'Haruna',
    circuit: 'Mt. Haruna Touge',
    blurb: 'Mt. Haruna · back-to-back hairpins, a fast ridge and a bridge back over the start straight',
    theme: 'mountain',
    label: 'Mountain pass',
    banner: '榛名山 · MT. HARUNA',
    layout: HARUNA,
  },
  niseko: {
    id: 'niseko',
    name: 'Niseko',
    short: 'Niseko',
    circuit: 'Niseko Snow Pass',
    blurb: 'Hokkaido · fast, flowing winter road between snowy firs under Mt. Yotei',
    theme: 'mountain',
    label: 'Snow pass',
    banner: 'ニセコ · NISEKO SNOW PASS',
    layout: NISEKO,
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura Valley',
    short: 'Sakura',
    circuit: 'Sakura Valley Countryside Circuit',
    blurb: 'Countryside · fast sweepers through cherry blossoms with Mt. Fuji on the horizon',
    theme: 'countryside',
    label: 'Countryside',
    banner: '桜 バレー · SAKURA VALLEY',
    layout: SAKURA_VALLEY,
  },
  arashiyama: {
    id: 'arashiyama',
    name: 'Arashiyama',
    short: 'Arashiyama',
    circuit: 'Arashiyama Bamboo Circuit',
    blurb: 'Kyoto · through the bamboo grove and red maples around the temple pond',
    theme: 'countryside',
    label: 'Bamboo & temples',
    banner: '嵐山 · ARASHIYAMA',
    layout: ARASHIYAMA,
  },
  izu: {
    id: 'izu',
    name: 'Izu Coast',
    short: 'Izu',
    circuit: 'Izu Coast Road',
    blurb: 'Izu peninsula · a long beachfront blast, then up into the hills with Fuji across the bay',
    theme: 'countryside',
    label: 'Coast road',
    banner: '伊豆 · IZU COAST ROAD',
    layout: IZU_COAST,
  },
};

/**
 * Free drive: a big open map (unlocked by finishing career races) - a city with winding streets
 * in a basin, a ring road round it with slip roads in from the avenues, mountains all round and
 * dirt trails through the hills. Not a circuit: the ring road is just the road it's built on.
 */
export const FREE_ROAM_DEF: TrackDef = {
  id: 'freeroam',
  name: 'Free Drive',
  short: 'Free Drive',
  circuit: 'Free Drive',
  blurb: 'Drive anywhere: the city, the ring road, the mountains and the dirt trails',
  theme: 'countryside',
  label: 'Free drive',
  banner: 'FREE DRIVE',
  layout: FREE_ROAM,
};

/** Every map by id. */
export const WORLDS: Record<WorldId, TrackDef> = { ...TRACKS, freeroam: FREE_ROAM_DEF };
