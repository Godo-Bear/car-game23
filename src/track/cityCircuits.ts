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
  start: { x: -100, z: 0 },
  vertices: [
    { x: -350, z: 0, radius: 30 },
    { x: 250, z: 0, radius: 30 },
    { x: 250, z: 200, radius: 35 },
    { x: 60, z: 200, radius: 28 },
    { x: 60, z: 380, radius: 30 },
    { x: 420, z: 400, radius: 60, y: 8 }, // onto the expressway
    { x: 300, z: 640, radius: 90, y: 10 },
    { x: -300, z: 600, radius: 80, y: 7 },
    { x: -450, z: 420, radius: 30 }, // back down
    { x: -300, z: 250, radius: 28 },
    { x: -420, z: 120, radius: 28 },
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
  start: { x: -100, z: 0 },
  vertices: [
    { x: -400, z: 0, radius: 35 },
    { x: 300, z: 0, radius: 45 },
    { x: 450, z: 150, radius: 40 },
    { x: 350, z: 300, radius: 30 },
    { x: 480, z: 450, radius: 45, y: 4 },
    { x: 200, z: 560, radius: 80, y: 9 }, // Bayshore, along the harbour
    { x: -350, z: 560, radius: 40, y: 9 },
    { x: -480, z: 380, radius: 35, y: 3 },
    { x: -250, z: 260, radius: 30 },
    { x: -260, z: 120, radius: 30 },
    { x: -480, z: 120, radius: 30 },
  ],
};
