import type { TrackLayout } from './TrackPath';

/**
 * "Shinjuku–Bay Street Circuit" — a fictional ~4.2 km Tokyo street circuit, driven clockwise, that
 * crosses itself: the run back from the Shiodome hairpin climbs onto a flyover straight over the
 * Shinjuku main straight, before swinging round to the start.
 *
 *     L ─────────────────────── K  (north loop)
 *     │                         ┃
 *     A ═══ main straight ════ ━╋━ ═══ B         ┃ = the flyover, over the main straight
 *                               ┃       │ T1
 *                               ┃       C ── D   Akasaka esses
 *          I ────────────────── J            │
 *         ╱                                  │ climb onto the
 *        H   Shiodome hairpin ── G ── F ──── E elevated Shuto Expressway
 *
 * Units are metres; +x is east and +z is south (three.js world axes).
 */
export const TOKYO_CIRCUIT: TrackLayout = {
  name: 'Shinjuku–Bay Street Circuit',
  width: 14,
  wallMargin: 0.6,
  sampleSpacing: 2,
  start: { x: -125, z: 0 },
  vertices: [
    { x: -375, z: 0, radius: 48 }, // A
    { x: 325, z: 0, radius: 53 }, // B  T1
    { x: 325, z: 200, radius: 56 }, // C  T2
    { x: 525, z: 200, radius: 56 }, // D  T3
    { x: 525, z: 525, radius: 112, y: 8 }, // E  T4 onto the expressway
    { x: 150, z: 600, radius: 240, y: 11 }, // F  fast kink
    { x: -250, z: 538, radius: 120, y: 6.5 }, // G  fast kink, start of descent
    { x: -525, z: 588, radius: 43 }, // H  hairpin
    { x: -200, z: 330, radius: 64 }, // I
    { x: 150, z: 330, radius: 60 }, // J  onto the flyover
    { x: 150, z: -200, radius: 60 }, // K  off it, north loop
    { x: -520, z: -150, radius: 60 }, // L
  ],
};
