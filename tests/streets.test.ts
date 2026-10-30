import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { streetNetwork } from '../src/world/World';

describe('free drive streets', () => {
  const R = 1180;
  const t0 = performance.now();
  const net = streetNetwork(R, createRng(77), [{ x: 420, z: -380, r: 52 }]);
  const ms = performance.now() - t0;

  it('is a joined-up network: every street ends on another street (or at the edge of town)', () => {
    expect(ms).toBeLessThan(5000);
    expect(net.streets.length).toBeGreaterThan(40);
    // (Loops have no ends.)
    const open = net.streets
      .map((s, id) => ({ s, id }))
      .filter(({ s }) => Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) > 5);
    const ends = open.flatMap(({ s, id }) => [s.pts[0], s.pts[s.pts.length - 1]].map((p) => ({ p, id })));
    let dead = 0;
    for (const { p, id } of ends) {
      const [x, z] = p;
      if (Math.hypot(x, z) > R - 40) continue;
      // Another street's road surface within a few metres of this end.
      const joined = net.streets.some((s, j) => j !== id && s.pts.some((q, i) => i > 0 && segDist(x, z, s.pts[i - 1], q) < s.width / 2 + 5));
      if (!joined) dead++;
    }
    expect(dead).toBeLessThanOrEqual(2);
  });

  it('keeps streets off the landmarks', () => {
    for (const s of net.streets) for (const [x, z] of s.pts) expect(Math.hypot(x - 420, z + 380)).toBeGreaterThan(51);
  });
});

function segDist(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}
