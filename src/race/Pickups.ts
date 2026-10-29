import type { TrackPath } from '../track/TrackPath';

/**
 * Nitro pickups on the road (as in Asphalt): blue bottles top up the nitro tank, and the rarer
 * gold ones give a super boost. A pickup comes back a while after it's taken.
 */
export type PickupKind = 'nitro' | 'super';

export interface Pickup {
  kind: PickupKind;
  /** Lap distance and sideways offset on the road (m). */
  distance: number;
  lateral: number;
  x: number;
  y: number;
  z: number;
  /** Race time when it's back after being taken (0 = there). */
  backAt: number;
}

/** Road between pickups (m), and every how many is a gold super boost. */
export const PICKUP_SPACING = 150;
export const SUPER_EVERY = 5;
/** What a blue bottle adds (share of a tank), and how long a super boost lasts (s). */
export const NITRO_PICKUP = 0.3;
export const SUPER_SECONDS = 2.6;
/** Seconds before a taken pickup comes back. */
export const PICKUP_RESPAWN = 15;
/** How close (m) along and across the road the car must pass to collect one. */
const REACH_ALONG = 3.5;
const REACH_ACROSS = 2.2;
/** No pickups this close to the start line (the grid). */
const CLEAR_OF_START = 120;

/** Pickups along a circuit, weaving across the road. */
export function placePickups(track: TrackPath): Pickup[] {
  const out: Pickup[] = [];
  const lanes = [-0.45, 0, 0.45, 0, -0.45, 0.45];
  let k = 0;
  for (let d = CLEAR_OF_START; d < track.length - 60; d += PICKUP_SPACING, k++) {
    const lateral = lanes[k % lanes.length] * track.halfWidth;
    const p = track.pointAt(d, lateral);
    out.push({ kind: (k + 1) % SUPER_EVERY === 0 ? 'super' : 'nitro', distance: d, lateral, x: p.x, y: p.y, z: p.z, backAt: 0 });
  }
  return out;
}

/** The pickup a car at (distance, lateral) drives through now, if any. */
export function pickupAt(pickups: Pickup[], trackLength: number, distance: number, lateral: number, time: number): Pickup | null {
  for (const p of pickups) {
    if (time < p.backAt) continue;
    let along = Math.abs(distance - p.distance) % trackLength;
    along = Math.min(along, trackLength - along);
    if (along < REACH_ALONG && Math.abs(lateral - p.lateral) < REACH_ACROSS) return p;
  }
  return null;
}
