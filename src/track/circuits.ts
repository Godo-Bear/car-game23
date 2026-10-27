import type { TrackLayout } from './TrackPath';

/**
 * "Hakone Mountain Pass" — a ~2.9 km touge loop. A long lakeside start straight, then a ladder of
 * hairpin switchbacks climbing ~55 m through cedar forest, a fast ridge road, and a long sweeping
 * descent back down to the lake.
 *
 *          L5 ═══════════ ridge ═══════════════ R1
 *          ║ hairpin                              ╲
 *          L4 ═══════════════════ L3               R2
 *                       hairpin ║                    ╲
 *          L1 ═══════════════════ L2                  R3
 *    hairpin ║                                       ╱
 *          S1 ══════ lakeside start straight ══ S0 ─ R4
 */
export const HAKONE_PASS: TrackLayout = {
  name: 'Hakone Mountain Pass',
  width: 12,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: 50, z: 0 },
  vertices: [
    { x: -350, z: 0, radius: 45, y: 0 }, // S0
    { x: 250, z: 0, radius: 26, y: 2 }, // S1  first hairpin (left)
    { x: 250, z: -60, radius: 25, y: 4 }, // L1
    { x: -150, z: -60, radius: 24, y: 26 }, // L2  second hairpin (right)
    { x: -150, z: -120, radius: 24, y: 28 }, // L3
    { x: 200, z: -120, radius: 24, y: 50 }, // L4  third hairpin (left)
    { x: 200, z: -180, radius: 24, y: 52 }, // L5
    { x: -300, z: -200, radius: 70, y: 55 }, // R1  ridge
    { x: -560, z: -150, radius: 60, y: 42 }, // R2  descent
    { x: -700, z: 80, radius: 55, y: 20 }, // R3
    { x: -480, z: 130, radius: 50, y: 7 }, // R4
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
  start: { x: -120, z: -19 },
  vertices: [
    { x: -380, z: 0, radius: 55, y: 0 }, // A
    { x: 180, z: -40, radius: 70, y: 5 }, // B
    { x: 430, z: 110, radius: 75, y: 12 }, // C
    { x: 460, z: 390, radius: 45, y: 7 }, // D
    { x: 240, z: 480, radius: 80, y: 2 }, // E
    { x: 10, z: 380, radius: 95, y: 9 }, // F
    { x: -210, z: 480, radius: 46, y: 4 }, // G
    { x: -470, z: 400, radius: 55, y: 13 }, // H
    { x: -560, z: 170, radius: 60, y: 7 }, // I
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
  start: { x: -60, z: 0 },
  vertices: [
    { x: -260, z: 0, radius: 45, y: 0 },
    { x: 130, z: 0, radius: 24, y: 2 }, // hairpin 1 (left)
    { x: 130, z: -50, radius: 24, y: 4 },
    { x: -130, z: -50, radius: 22, y: 17 }, // hairpin 2 (right)
    { x: -130, z: -95, radius: 22, y: 19 },
    { x: 100, z: -95, radius: 22, y: 31 }, // hairpin 3 (left)
    { x: 100, z: -140, radius: 22, y: 33 },
    { x: -130, z: -140, radius: 22, y: 44 }, // hairpin 4 (right)
    { x: -130, z: -185, radius: 22, y: 46 },
    { x: 260, z: -235, radius: 70, y: 50 }, // ridge
    { x: 440, z: -70, radius: 60, y: 40 },
    { x: 360, z: 130, radius: 55, y: 24 },
    { x: -120, z: 140, radius: 70, y: 9 },
    { x: -380, z: 100, radius: 50, y: 3 },
  ],
};

/**
 * "Mt. Haruna" — a touge over the shoulder of Mt. Haruna: two back-to-back hairpins up from the
 * lake, a fast ridge and a tricky run of esses on the way down.
 */
export const HARUNA: TrackLayout = {
  name: 'Mt. Haruna',
  width: 11,
  wallMargin: 0.8,
  sampleSpacing: 2,
  start: { x: -50, z: 0 },
  vertices: [
    { x: -300, z: 0, radius: 45, y: 0 },
    { x: 200, z: 0, radius: 40, y: 4 },
    { x: 330, z: -150, radius: 30, y: 12 },
    { x: 180, z: -230, radius: 20, y: 19 }, // hairpin (right)
    { x: 400, z: -330, radius: 20, y: 27 }, // hairpin (left)
    { x: 120, z: -420, radius: 35, y: 35 },
    { x: -250, z: -380, radius: 60, y: 41 }, // ridge
    { x: -420, z: -250, radius: 40, y: 35 },
    { x: -300, z: -150, radius: 30, y: 24 }, // esses
    { x: -480, z: -60, radius: 35, y: 11 },
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
  start: { x: -100, z: 0 },
  vertices: [
    { x: -380, z: 0, radius: 50, y: 0 },
    { x: 270, z: 0, radius: 60, y: 5 },
    { x: 490, z: -195, radius: 45, y: 18 },
    { x: 325, z: -410, radius: 26, y: 32 },
    { x: -55, z: -355, radius: 70, y: 40 },
    { x: -325, z: -455, radius: 30, y: 50 },
    { x: -605, z: -270, radius: 55, y: 38 },
    { x: -560, z: -65, radius: 40, y: 18 },
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
  start: { x: -100, z: 0 },
  vertices: [
    { x: -330, z: 0, radius: 40, y: 0 },
    { x: 240, z: 0, radius: 35, y: 3 },
    { x: 330, z: 200, radius: 50, y: 6 },
    { x: 130, z: 330, radius: 30, y: 8 },
    { x: 285, z: 495, radius: 40, y: 5 },
    { x: -90, z: 570, radius: 70, y: 2 },
    { x: -385, z: 440, radius: 35, y: 6 },
    { x: -220, z: 240, radius: 30, y: 4 },
    { x: -460, z: 130, radius: 40, y: 2 },
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
  start: { x: -150, z: 253 },
  vertices: [
    { x: -400, z: 250, radius: 60, y: 0.5 },
    { x: 350, z: 260, radius: 50, y: 1.5 },
    { x: 420, z: 20, radius: 35, y: 10 },
    { x: 150, z: -60, radius: 45, y: 16 },
    { x: 40, z: -250, radius: 30, y: 22 },
    { x: -280, z: -200, radius: 50, y: 18 },
    { x: -260, z: 20, radius: 35, y: 10 },
    { x: -520, z: 60, radius: 45, y: 5 },
  ],
};
