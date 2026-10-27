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
