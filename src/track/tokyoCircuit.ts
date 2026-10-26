import type { TrackLayout, TrackPath } from './TrackPath';

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
  start: { x: -100, z: 0 },
  vertices: [
    { x: -300, z: 0, radius: 30 }, // A
    { x: 260, z: 0, radius: 28 }, // B  T1
    { x: 260, z: 160, radius: 35 }, // C  T2
    { x: 420, z: 160, radius: 35 }, // D  T3
    { x: 420, z: 420, radius: 70, y: 8 }, // E  T4 onto the expressway
    { x: 120, z: 480, radius: 150, y: 11 }, // F  fast kink
    { x: -200, z: 430, radius: 150, y: 8 }, // G  fast kink, start of descent
    { x: -420, z: 470, radius: 20 }, // H  hairpin
    { x: -180, z: 300, radius: 40 }, // I
    { x: -180, z: 150, radius: 25 }, // J  Shibuya chicane (left)
    { x: -300, z: 150, radius: 25 }, // K  Shibuya chicane (right)
  ],
};

/** Shibuya-style zebra crossings on the J-K chicane straight, as lap distances. */
export function tokyoCircuitLandmarks(track: TrackPath): { crossings: number[] } {
  const distanceNear = (x: number, z: number) => {
    let best = 0;
    let bestD = Infinity;
    for (const s of track.samples) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s.dist;
      }
    }
    return best;
  };
  return { crossings: [distanceNear(-218, 150), distanceNear(-262, 150)] };
}
