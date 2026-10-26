import { clamp, mod, wrapAngle } from '../core/math';
import type { TrackPath } from '../track/TrackPath';

const G = 9.81;

/**
 * An "ideal" line around the circuit, stored as a lateral offset from the centre line for every
 * track sample. It is found by relaxing the line toward minimum curvature (wide entry, clip the
 * apex, wide exit) while staying `margin` metres inside the road edges.
 */
export class RacingLine {
  readonly track: TrackPath;
  readonly offsets: Float32Array;
  readonly curvature: Float32Array;
  /** Distance between consecutive racing-line points (varies slightly from the centre-line spacing). */
  readonly segment: Float32Array;

  constructor(track: TrackPath, margin = 2.2, iterations = 2500) {
    this.track = track;
    const n = track.count;
    const maxOff = track.halfWidth - margin;

    // Relax on a coarse copy of the track (~8 m spacing) so the long-wavelength shape converges quickly.
    const stride = Math.max(1, Math.round(8 / track.spacing));
    const m = Math.floor(n / stride);
    const cx = new Float64Array(m);
    const cz = new Float64Array(m);
    const rx = new Float64Array(m);
    const rz = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const s = track.samples[i * stride];
      cx[i] = s.x;
      cz[i] = s.z;
      rx[i] = s.rx;
      rz[i] = s.rz;
    }
    const off = new Float64Array(m);
    const px = (i: number) => cx[mod(i, m)] + rx[mod(i, m)] * off[mod(i, m)];
    const pz = (i: number) => cz[mod(i, m)] + rz[mod(i, m)] * off[mod(i, m)];
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < m; i++) {
        // Minimising the squared second difference => P_i = (4(P_i-1 + P_i+1) - (P_i-2 + P_i+2)) / 6
        const tx = (4 * (px(i - 1) + px(i + 1)) - (px(i - 2) + px(i + 2))) / 6;
        const tz = (4 * (pz(i - 1) + pz(i + 1)) - (pz(i - 2) + pz(i + 2))) / 6;
        const o = (tx - cx[i]) * rx[i] + (tz - cz[i]) * rz[i];
        off[i] = clamp(off[i] + (o - off[i]) * 1.2, -maxOff, maxOff);
      }
    }

    this.offsets = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = i / stride;
      const i0 = Math.floor(f) % m;
      const t = f - Math.floor(f);
      this.offsets[i] = off[i0] + (off[(i0 + 1) % m] - off[i0]) * t;
    }

    // Geometry of the final line.
    const x = new Float64Array(n);
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = track.samples[i];
      x[i] = s.x + s.rx * this.offsets[i];
      z[i] = s.z + s.rz * this.offsets[i];
    }
    this.segment = new Float32Array(n);
    const heading = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.segment[i] = Math.hypot(x[j] - x[i], z[j] - z[i]);
      heading[i] = Math.atan2(x[j] - x[i], z[j] - z[i]);
    }
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const prev = mod(i - 1, n);
      raw[i] = wrapAngle(heading[i] - heading[prev]) / Math.max(0.1, (this.segment[i] + this.segment[prev]) / 2);
    }
    // Light smoothing removes interpolation noise without hiding real corners.
    this.curvature = new Float32Array(n);
    const w = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -w; k <= w; k++) sum += raw[mod(i + k, n)];
      this.curvature[i] = sum / (2 * w + 1);
    }
  }

  /**
   * Maximum speed (m/s) at each sample for a driver who corners at `gripG` g and brakes at
   * `brakeDecel` m/s^2. A backward pass makes sure every corner is reachable from the straight before it.
   */
  speedProfile(gripG: number, brakeDecel: number, topSpeed: number): Float32Array {
    const n = this.offsets.length;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curvature[i]);
      v[i] = Math.min(topSpeed, Math.sqrt((gripG * G) / Math.max(k, 1e-5)));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = v[(i + 1) % n];
        const reachable = Math.sqrt(next * next + 2 * brakeDecel * this.segment[i]);
        if (reachable < v[i]) v[i] = reachable;
      }
    }
    return v;
  }
}
