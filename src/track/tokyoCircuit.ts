import type { TrackLayout } from './TrackPath';

/**
 * "Shinjuku–Bay Street Circuit" — a fictional ~2.6 km Tokyo street circuit, driven clockwise.
 *
 *   A ── Shinjuku main straight (start/finish) ──────────────── B
 *   │                                                           │ T1 (heavy braking)
 *   K ── J   "Shibuya Scramble" chicane                         C ── D   Akasaka esses
 *        │                                                            │
 *        I                                                            │  climb onto the
 *       ╱  Roppongi kink                                              │  elevated Shuto
 *      H   Shiodome hairpin ── G ──── elevated Shuto Expressway ── F ─ E
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
    { x: -250, z: 538, radius: 240, y: 6.5 }, // G  fast kink, start of descent
    { x: -525, z: 588, radius: 43 }, // H  hairpin
    { x: -225, z: 375, radius: 64 }, // I
    { x: -225, z: 188, radius: 46 }, // J  Shibuya chicane (left)
    { x: -375, z: 188, radius: 46 }, // K  Shibuya chicane (right)
  ],
};
