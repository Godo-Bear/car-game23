import { describe, expect, it } from 'vitest';
import { BRIDGE_CLEARANCE, createProjection, TrackPath } from '../src/track/TrackPath';
import { TOKYO_CIRCUIT } from '../src/track/tokyoCircuit';
import { TRACKS } from '../src/track/tracks';

describe.each(Object.values(TRACKS))('$name circuit geometry', (def) => {
  const track = new TrackPath(def.layout);

  it('is a closed circuit of sensible length with the start line where it was asked for', () => {
    expect(track.length).toBeGreaterThan(2200);
    expect(track.length).toBeLessThan(4200);
    const s = track.samples[0];
    expect(Math.hypot(s.x - def.layout.start.x, s.z - def.layout.start.z)).toBeLessThan(3);
    expect(s.dist).toBe(0);
  });

  it('never runs close to another part of itself (except over and under a bridge)', () => {
    const minGap = 2 * track.wallOffset + 4;
    const n = track.count;
    const skip = Math.ceil(80 / track.spacing);
    let worst = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + skip; j < n; j += 2) {
        if (n - (j - i) < skip) continue;
        const a = track.samples[i];
        const b = track.samples[j];
        // Where the course crosses itself one pass is a bridge high over the other.
        if (Math.abs(a.y - b.y) > BRIDGE_CLEARANCE - 1.5) continue;
        worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(worst).toBeGreaterThan(minGap);
  });

  it('keeps corners and gradients drivable', () => {
    const maxSlope = def.theme === 'mountain' ? 0.15 : 0.08;
    for (const s of track.samples) {
      expect(Math.abs(s.curvature)).toBeLessThan(1 / 16);
      expect(Math.abs(s.slope)).toBeLessThan(maxSlope);
    }
  });
});

describe('TrackPath', () => {
  const track = new TrackPath(TOKYO_CIRCUIT);

  it('places index 0 on the Tokyo start line, heading east down the main straight', () => {
    const s = track.samples[0];
    expect(Math.abs(s.x - -125)).toBeLessThan(1);
    expect(Math.abs(s.z)).toBeLessThan(1);
    expect(s.tx).toBeCloseTo(1, 3);
    expect(s.dist).toBe(0);
  });

  it('projects offset points back onto the centre line', () => {
    const out = createProjection();
    for (const i of [0, 137, 400, 777, track.count - 3]) {
      const s = track.samples[i];
      // (With the height: sample 137 is on the main straight, under the flyover.)
      const p = track.project(s.x + s.rx * 3, s.z + s.rz * 3, -1, out, s.y);
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

describe('Crossovers', () => {
  it('Tokyo, Hakone and Haruna cross over themselves on a bridge with headroom', () => {
    for (const id of ['tokyo', 'hakone', 'haruna'] as const) {
      const track = new TrackPath(TRACKS[id].layout);
      expect(track.crossings.length).toBe(1);
      for (const c of track.crossings) {
        const up = track.samples[c.upper];
        const low = track.samples[c.lower];
        expect(up.y - low.y).toBeGreaterThanOrEqual(BRIDGE_CLEARANCE - 0.01);
        // The ground under the bridge is down at the road below.
        expect(Math.abs(up.y - up.bridge - low.y)).toBeLessThan(0.5);
        expect(low.bridge).toBe(0);
      }
    }
    // The other circuits don't cross themselves.
    expect(new TrackPath(TRACKS.sakura.layout).crossings).toEqual([]);
  });

  it('keeps a car on its own level where the roads cross', () => {
    const track = new TrackPath(TRACKS.tokyo.layout);
    const { upper, lower } = track.crossings[0];
    const out = createProjection();
    // Following the road underneath (with the hint), it stays on the lower road...
    const low = track.samples[lower];
    track.project(low.x, low.z, lower - 1, out);
    expect(Math.abs(out.index - lower)).toBeLessThan(3);
    expect(out.y).toBeCloseTo(low.y, 0);
    // ...and on the bridge, on the bridge.
    const up = track.samples[upper];
    track.project(up.x, up.z, upper - 1, out);
    expect(Math.abs(out.index - upper)).toBeLessThan(3);
    // Without a hint, the height picks the level.
    expect(Math.abs(track.project(up.x, up.z, -1, out, up.y).index - upper)).toBeLessThan(3);
    expect(Math.abs(track.project(up.x, up.z, -1, out, low.y).index - lower)).toBeLessThan(3);
  });
});
