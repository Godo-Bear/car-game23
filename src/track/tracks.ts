import type { TrackId } from '../../shared/api';
import { HAKONE_PASS, SAKURA_VALLEY } from './circuits';
import type { TrackLayout } from './TrackPath';
import { TOKYO_CIRCUIT } from './tokyoCircuit';

export type TrackTheme = 'city' | 'mountain' | 'countryside';

export interface TrackDef {
  id: TrackId;
  name: string;
  /** Short name for tight UI spots. */
  short: string;
  /** Full circuit name. */
  circuit: string;
  /** Short line for the homescreen. */
  blurb: string;
  theme: TrackTheme;
  layout: TrackLayout;
}

export const TRACKS: Record<TrackId, TrackDef> = {
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo',
    short: 'Tokyo',
    circuit: 'Shinjuku–Bay Street Circuit',
    blurb: 'Shinjuku–Bay Street Circuit · neon city streets and an elevated expressway',
    theme: 'city',
    layout: TOKYO_CIRCUIT,
  },
  hakone: {
    id: 'hakone',
    name: 'Hakone',
    short: 'Hakone',
    circuit: 'Hakone Mountain Pass',
    blurb: 'Mountain Pass · hairpin switchbacks through cedar forest above the lake',
    theme: 'mountain',
    layout: HAKONE_PASS,
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura Valley',
    short: 'Sakura',
    circuit: 'Sakura Valley Countryside Circuit',
    blurb: 'Countryside · fast sweepers through cherry blossoms with Mt. Fuji on the horizon',
    theme: 'countryside',
    layout: SAKURA_VALLEY,
  },
};
