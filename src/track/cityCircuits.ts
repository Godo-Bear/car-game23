import type { TrackLayout } from './TrackPath';

/**
 * "Namba–Dotonbori Street Circuit" — a fictional ~2.8 km Osaka street circuit: a neon main
 * straight, a square block through Namba, then up onto the Hanshin Expressway and back down.
 */
export const OSAKA_CIRCUIT: TrackLayout = {
  name: 'Namba–Dotonbori Street Circuit',
  width: 14,
  wallMargin: 0.6,
  sampleSpacing: 2,
  start: { x: -125, z: 0 },
  vertices: [
    { x: -437, z: 0, radius: 48 },
    { x: 313, z: 0, radius: 48 },
    { x: 313, z: 250, radius: 56 },
    { x: 75, z: 250, radius: 45 },
    { x: 75, z: 475, radius: 48 },
    { x: 525, z: 500, radius: 96, y: 8 }, // onto the expressway
    { x: 375, z: 800, radius: 144, y: 10 },
    { x: -375, z: 750, radius: 128, y: 7 },
    { x: -562, z: 525, radius: 48 }, // back down
    { x: -375, z: 313, radius: 45 },
    { x: -525, z: 150, radius: 45 },
  ],
};

/**
 * "Minato Mirai Bay Circuit" — a fictional ~2.9 km Yokohama circuit: downtown blocks, then an
 * elevated Bayshore section running along the harbour past the big wheel.
 */
export const YOKOHAMA_CIRCUIT: TrackLayout = {
  name: 'Minato Mirai Bay Circuit',
  width: 14,
  wallMargin: 0.6,
  sampleSpacing: 2,
  start: { x: -125, z: 0 },
  vertices: [
    { x: -500, z: 0, radius: 56 },
    { x: 375, z: 0, radius: 72 },
    { x: 563, z: 188, radius: 64 },
    { x: 438, z: 375, radius: 48 },
    { x: 600, z: 563, radius: 72, y: 4 },
    { x: 250, z: 700, radius: 128, y: 9 }, // Bayshore, along the harbour
    { x: -437, z: 700, radius: 64, y: 9 },
    { x: -600, z: 475, radius: 56, y: 3 },
    { x: -312, z: 325, radius: 48 },
    { x: -325, z: 150, radius: 48 },
    { x: -600, z: 150, radius: 48 },
  ],
};
