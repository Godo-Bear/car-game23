import { describe, expect, it } from 'vitest';
import { createProjection, TrackPath } from '../src/track/TrackPath';
import { TOKYO_CIRCUIT } from '../src/track/tokyoCircuit';

describe('TrackPath', () => {
  const track = new TrackPath(TOKYO_CIRCUIT);

  it('builds a closed circuit of sensible length', () => {
    expect(track.length).toBeGreaterThan(2200);
    expect(track.length).toBeLessThan(3200);
    expect(track.count).toBeGreaterThan(1000);
  });

  it('places index 0 on the start line, heading east down the main straight', () => {
    const s = track.samples[0];
    expect(Math.abs(s.x - -100)).toBeLessThan(1);
    expect(Math.abs(s.z)).toBeLessThan(1);
    expect(s.tx).toBeCloseTo(1, 3);
    expect(s.dist).toBe(0);
  });

  it('never runs close to another part of itself', () => {
    const minGap = 2 * track.wallOffset + 4;
    const n = track.count;
    const skip = Math.ceil(80 / track.spacing);
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + skip; j < n; j++) {
        if (n - (j - i) < skip) continue;
        const a = track.samples[i];
        const b = track.samples[j];
        worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(worst).toBeGreaterThan(minGap);
  });

  it('has smooth, bounded curvature and gentle gradients', () => {
    for (const s of track.samples) {
      expect(Math.abs(s.curvature)).toBeLessThan(1 / 18);
      expect(Math.abs(s.slope)).toBeLessThan(0.08);
    }
  });

  it('projects offset points back onto the centre line', () => {
    const out = createProjection();
    for (const i of [0, 137, 400, 777, track.count - 3]) {
      const s = track.samples[i];
      const p = track.project(s.x + s.rx * 3, s.z + s.rz * 3, -1, out);
      expect(p.lateral).toBeCloseTo(3, 1);
      expect(Math.abs(p.distance - s.dist)).toBeLessThan(0.5);
    }
  });

  it('uses the hint window and wraps distance across the start line', () => {
    const out = createProjection();
    const last = track.samples[track.count - 1];
    track.project(last.x + last.tx * 0.5, last.z + last.tz * 0.5, track.count - 2, out);
    expect(out.distance).toBeGreaterThan(track.length - 2);
    const first = track.samples[1];
    track.project(first.x, first.z, track.count - 1, out);
    expect(out.distance).toBeLessThan(3);
  });
});
