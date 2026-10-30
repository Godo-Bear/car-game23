/**
 * Free drive: where you can start, and the top-down map picture you pick them on
 * (public/freedrive/map.jpg, rendered from the game by `node scripts/render-freedrive-map.mjs`).
 * Positions are on the free drive map's streets and roads (see World.ts: streetNetwork and the
 * ring road); headings point along the road.
 */
export interface FreeDriveSpot {
  id: string;
  name: string;
  blurb: string;
  x: number;
  z: number;
  heading: number;
}

export const FREE_DRIVE_SPOTS: FreeDriveSpot[] = [
  { id: 'centre', name: 'City Centre', blurb: 'Downtown, among the tallest towers', x: 138.9, z: -27.6, heading: 1.94 },
  { id: 'tower', name: 'Tokyo Tower', blurb: 'Under the red-and-white tower', x: 439.3, z: -421.8, heading: -0.42 },
  { id: 'castle', name: 'Castle Park', blurb: 'Beside the castle walls', x: -560.4, z: -415.8, heading: -0.31 },
  { id: 'wheel', name: 'Big Wheel', blurb: 'By the Ferris wheel in the east of town', x: 666.3, z: 385.9, heading: -0.83 },
  { id: 'skytree', name: 'Skytree', blurb: 'At the foot of the Skytree', x: -486.1, z: 566.4, heading: -1.95 },
  { id: 'ring', name: 'Ring Road', blurb: 'The fast ring road around town', x: -0.6, z: 1548.3, heading: 1.6 },
  { id: 'mountain', name: 'Mountain Road', blurb: 'High on the ring road, in the mountains', x: 702.1, z: -1882, heading: -1.46 },
  { id: 'trails', name: 'Dirt Trails', blurb: 'Off-road trails through the hills', x: -1645, z: -245, heading: -2.36 },
];

/** The world area the map picture covers (16:9, north at the top). */
export const FREE_DRIVE_MAP = { minX: -3400, minZ: -2012, width: 6800, height: 3825 };

/** Where a world position falls on the map picture (fractions of its width and height). */
export function mapFraction(x: number, z: number): [number, number] {
  const m = FREE_DRIVE_MAP;
  return [(x - m.minX) / m.width, (z - m.minZ) / m.height];
}

/** The world position at a place on the map picture (fractions of its width and height). */
export function mapPosition(fx: number, fy: number): [number, number] {
  const m = FREE_DRIVE_MAP;
  return [m.minX + fx * m.width, m.minZ + fy * m.height];
}
