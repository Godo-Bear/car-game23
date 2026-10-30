import type { TrackLayout } from './TrackPath';

/**
 * "Hakone Mountain Pass" — a ~3.9 km touge loop. A long lakeside start straight, then a ladder of
 * hairpin switchbacks climbing ~55 m through cedar forest, a ridge road, a hairpin, and a
 * descent that crosses high over the start straight on a viaduct before looping back to it.
 *
 *     R2 ═══════ ridge ═════════════════ R1
 *      ╲                    L4 ═══════════ L5
 *       D1                  ║ hairpin
 *        ║ viaduct          L3 ════════════ L2
 *     S0 ╋══════ lakeside start straight ══ S1
 *        ║
 *     D3 ══ D2
 */
export const HAKONE_PASS: TrackLayout = {
  name: 'Hakone Mountain Pass',
  width: 12,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: 62, z: 0 },
  vertices: [
    { x: -437, z: 0, radius: 97, y: 0 }, // S0
    { x: 313, z: 0, radius: 52, y: 2 }, // S1  first hairpin (left)
    { x: 313, z: -102, radius: 50, y: 4 }, // L1
    { x: -187, z: -102, radius: 50, y: 26 }, // L2  second hairpin (right)
    { x: -187, z: -204, radius: 50, y: 28 }, // L3
    { x: 250, z: -204, radius: 52, y: 50 }, // L4  third hairpin (left)
    { x: 250, z: -306, radius: 52, y: 52 }, // L5
    { x: -375, z: -340, radius: 100, y: 55 }, // R1  ridge
    { x: -720, z: -300, radius: 45, y: 44 }, // R2  hairpin at the top of the descent
    { x: -300, z: -150, radius: 60, y: 30 }, // D1  down onto the viaduct
    { x: -300, z: 230, radius: 60, y: 12 }, // D2  over the start straight
    { x: -800, z: 200, radius: 90, y: 5 }, // D3
  ],
};

/**
 * "Sakura Valley" — a ~2.9 km fast countryside circuit over rolling grassland, around a lake,
 * through cherry-blossom avenues with Mt. Fuji on the horizon.
 */
export const SAKURA_VALLEY: TrackLayout = {
  name: 'Sakura Valley',
  width: 13,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -150, z: -24 },
  vertices: [
    { x: -475, z: 0, radius: 88, y: 0 }, // A
    { x: 225, z: -50, radius: 112, y: 5 }, // B
    { x: 538, z: 138, radius: 120, y: 12 }, // C
    { x: 575, z: 488, radius: 72, y: 7 }, // D
    { x: 300, z: 600, radius: 128, y: 2 }, // E
    { x: 13, z: 475, radius: 152, y: 9 }, // F
    { x: -262, z: 600, radius: 74, y: 4 }, // G
    { x: -587, z: 500, radius: 88, y: 13 }, // H
    { x: -700, z: 213, radius: 96, y: 7 }, // I
  ],
};

/**
 * "Irohazaka" — Nikko's famous hairpin road: a ladder of four tight switchbacks climbing ~70 m
 * through autumn maples, a fast ridge, and sweeping bends back down past the river lake.
 */
export const IROHAZAKA: TrackLayout = {
  name: 'Irohazaka',
  width: 11.5,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -75, z: 0 },
  vertices: [
    { x: -325, z: 0, radius: 93, y: 0 },
    { x: 163, z: 0, radius: 42, y: 2 }, // hairpin 1 (left)
    { x: 163, z: -85, radius: 42, y: 4 },
    { x: -162, z: -85, radius: 37, y: 17 }, // hairpin 2 (right)
    { x: -162, z: -161, radius: 37, y: 19 },
    { x: 125, z: -161, radius: 37, y: 31 }, // hairpin 3 (left)
    { x: 125, z: -238, radius: 37, y: 33 },
    { x: -162, z: -238, radius: 40, y: 44 }, // hairpin 4 (right)
    { x: -162, z: -314, radius: 40, y: 46 },
    { x: 325, z: -399, radius: 151, y: 50 }, // ridge
    { x: 550, z: -119, radius: 130, y: 40 },
    { x: 450, z: 221, radius: 119, y: 24 },
    { x: -150, z: 238, radius: 151, y: 9 },
    { x: -475, z: 170, radius: 104, y: 3 },
  ],
};

/**
 * "Mt. Haruna" — a touge over the shoulder of Mt. Haruna: two back-to-back hairpins up from the
 * lake, a fast ridge, then a long run down that bridges high over the start straight.
 */
export const HARUNA: TrackLayout = {
  name: 'Mt. Haruna',
  width: 11,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -62, z: 0 },
  vertices: [
    { x: -375, z: 0, radius: 72, y: 0 },
    { x: 250, z: 0, radius: 64, y: 4 },
    { x: 413, z: -187, radius: 48, y: 12 },
    { x: 225, z: -287, radius: 32, y: 19 }, // hairpin (right)
    { x: 500, z: -412, radius: 32, y: 27 }, // hairpin (left)
    { x: 150, z: -525, radius: 56, y: 35 },
    { x: -312, z: -475, radius: 96, y: 41 }, // ridge
    { x: -525, z: -312, radius: 64, y: 35 },
    { x: 120, z: -150, radius: 56, y: 24 }, // down to the bridge
    { x: 120, z: 200, radius: 56, y: 9 }, // over the start straight
    { x: -600, z: 160, radius: 64, y: 3 },
  ],
};

/**
 * "Niseko Snow Pass" — a winter road in Hokkaido: wide, fast and flowing between snowy
 * firs, with one tight corner at the top and Mt. Yotei on the horizon.
 */
export const NISEKO: TrackLayout = {
  name: 'Niseko Snow Pass',
  width: 12.5,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -125, z: 0 },
  vertices: [
    { x: -475, z: 0, radius: 80, y: 0 },
    { x: 338, z: 0, radius: 96, y: 5 },
    { x: 613, z: -244, radius: 72, y: 18 },
    { x: 406, z: -512, radius: 42, y: 32 },
    { x: -69, z: -444, radius: 112, y: 40 },
    { x: -406, z: -569, radius: 48, y: 50 },
    { x: -756, z: -337, radius: 88, y: 38 },
    { x: -700, z: -81, radius: 64, y: 18 },
  ],
};

/**
 * "Arashiyama" — Kyoto's western hills: narrow lanes through the bamboo grove, maples and
 * temples around a pond, with short bursts of speed between the bends.
 */
export const ARASHIYAMA: TrackLayout = {
  name: 'Arashiyama',
  width: 12,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -125, z: 0 },
  vertices: [
    { x: -412, z: 0, radius: 64, y: 0 },
    { x: 300, z: 0, radius: 56, y: 3 },
    { x: 413, z: 250, radius: 80, y: 6 },
    { x: 163, z: 413, radius: 48, y: 8 },
    { x: 356, z: 619, radius: 64, y: 5 },
    { x: -112, z: 713, radius: 112, y: 2 },
    { x: -481, z: 550, radius: 56, y: 6 },
    { x: -275, z: 300, radius: 48, y: 4 },
    { x: -575, z: 163, radius: 64, y: 2 },
  ],
};

/**
 * "Izu Coast" — a seaside road on the Izu peninsula: a long run along the beach, then up into
 * the hills and back down, with Mt. Fuji across the bay.
 */
export const IZU_COAST: TrackLayout = {
  name: 'Izu Coast Road',
  width: 13,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -188, z: 316 },
  vertices: [
    { x: -500, z: 313, radius: 96, y: 0.5 },
    { x: 438, z: 325, radius: 80, y: 1.5 },
    { x: 525, z: 25, radius: 56, y: 10 },
    { x: 188, z: -75, radius: 72, y: 16 },
    { x: 50, z: -312, radius: 48, y: 22 },
    { x: -350, z: -250, radius: 80, y: 18 },
    { x: -325, z: 25, radius: 56, y: 10 },
    { x: -650, z: 75, radius: 72, y: 5 },
  ],
};

/** The free drive map: a huge ring road round a city, mountains all round (see FREE_ROAM_DEF). */
export const FREE_ROAM: TrackLayout = {
  name: 'Free Roam',
  width: 13,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -900, z: 1480 },
  vertices: [
    { x: -1800, z: 1400, radius: 160, y: 2 },
    { x: 0, z: 1550, radius: 260, y: 3 },
    { x: 1700, z: 1300, radius: 200, y: 4 },
    { x: 2000, z: 200, radius: 220, y: 8 },
    { x: 1500, z: -700, radius: 120, y: 18 },
    { x: 1900, z: -1500, radius: 110, y: 55 },
    { x: 700, z: -1900, radius: 180, y: 90 },
    { x: -300, z: -1300, radius: 140, y: 45 },
    { x: -1100, z: -1900, radius: 120, y: 60 },
    { x: -2000, z: -1200, radius: 200, y: 40 },
    { x: -1600, z: -200, radius: 160, y: 14 },
    { x: -2200, z: 600, radius: 170, y: 5 },
  ],
};
