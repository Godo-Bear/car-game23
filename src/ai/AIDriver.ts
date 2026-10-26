import { clamp, damp, lerp, mod } from '../core/math';
import type { VehicleControls, VehiclePhysics } from '../physics/VehiclePhysics';
import type { TrackProjection } from '../track/TrackPath';
import type { RacingLine } from './RacingLine';

export interface AIProfile {
  /** Cornering commitment in g. The car can do ~1.45 g, so 1.2-1.35 is quick but safe. */
  cornerGrip: number;
  /** Planned braking deceleration in m/s^2 (the car can do ~12). */
  brakeDecel: number;
  /** Personal lateral preference relative to the ideal line, in metres. */
  laneBias: number;
  /** How keen the driver is to dive for a gap (0..1). */
  aggression: number;
}

export interface TrafficCar {
  car: VehiclePhysics;
  proj: TrackProjection;
  /** Give this car extra room (the human player). */
  readonly cautious?: boolean;
}

/** Extra daylight (m) left beside / behind a cautious car vs. another AI. */
const MARGIN = { normal: 0.6, cautious: 1.4 };
const GAP = { normal: 1.5, cautious: 3.5 };
/** Deceleration (m/s^2) the AI plans with when closing on traffic - well inside the car's limit. */
const FOLLOW_DECEL = 6.5;
/** Speed (m/s) kept while sidestepping a stopped car, so the manoeuvre can complete. */
const CREEP_SPEED = 5;
/** Aim this much wider than the minimum gap when pulling out to pass. */
const PASS_EXTRA = 0.5;

const TOP_SPEED = 75;

/**
 * Drives a car around the racing line:
 * - steering: pure pursuit toward a speed-dependent look-ahead point on the (possibly offset) line
 * - pedals: follow the precomputed speed profile with a small anticipation window
 * - traffic: pick a side to pass slower cars, never close faster than it could stop behind them,
 *   and give the human player extra room
 * - recovery: back up and re-align when stuck against a barrier or another car
 */
export class AIDriver {
  readonly line: RacingLine;
  readonly profile: AIProfile;
  private speeds: Float32Array;
  /** Absolute lateral position (m from the centre line) we're steering to around traffic. */
  private avoidLateral = 0;
  /** 0 = follow the racing line, 1 = follow avoidLateral. */
  private avoidWeight = 0;
  // Scratch buffers reused every step (no per-frame allocation).
  private readonly bands: number[] = [];
  private readonly ahead: { lo: number; hi: number; gap: number; bumperGap: number; otherU: number }[] = [];
  private stuckTime = 0;
  private reverseTime = 0;
  private readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  constructor(line: RacingLine, profile: AIProfile) {
    this.line = line;
    this.profile = profile;
    this.speeds = line.speedProfile(profile.cornerGrip, profile.brakeDecel, TOP_SPEED);
  }

  /** Target speed at a sample index (exposed for debugging/visualisation). */
  targetSpeed(index: number): number {
    return this.speeds[mod(index, this.speeds.length)];
  }

  reset(): void {
    this.avoidLateral = 0;
    this.avoidWeight = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
  }

  drive(car: VehiclePhysics, proj: TrackProjection, traffic: readonly TrafficCar[], dt: number): VehicleControls {
    const track = this.line.track;
    const n = track.count;
    const c = this.controls;
    const u = car.forwardSpeed;
    const idx = proj.index;

    // ---- Stuck recovery: reverse out, swinging the nose toward the gap we were aiming for ----
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      const aim = track.sample(idx + 6);
      const aimLateral = this.avoidWeight > 0.5 ? this.avoidLateral : 0;
      const headingErr = angleTo(car, aim.x + aim.rx * aimLateral, aim.z + aim.rz * aimLateral);
      c.throttle = 0;
      c.brake = 1;
      c.steer = clamp(headingErr * 2, -1, 1);
      c.handbrake = false;
      return c;
    }
    const facingWrongWay = Math.cos(car.heading - proj.heading) < -0.2;
    if (u < 1.5) {
      this.stuckTime += dt;
      if (this.stuckTime > (facingWrongWay ? 0.8 : 1.6)) {
        this.stuckTime = 0;
        this.reverseTime = 1.8;
      }
    } else {
      this.stuckTime = 0;
    }

    // ---- Traffic ----
    // Every nearby car blocks a band of road (its footprint plus a safety margin, stretched toward
    // where it's heading). We steer for the open gap nearest to where we already are, and never
    // approach a car in our way faster than we could stop behind it.
    const myLateral = proj.lateral;
    const maxLateral = track.halfWidth - 1.3;
    const myHalfWidth = car.spec.halfWidth;
    // Far enough ahead to stop for a car parked on the track.
    const lookAhead = 30 + Math.max(u, 0) ** 2 / (2 * FOLLOW_DECEL);
    const commitDistance = 25 + Math.max(u, 0) ** 2 / (2 * FOLLOW_DECEL);
    const bands = this.bands;
    const ahead = this.ahead;
    bands.length = 0;
    ahead.length = 0;
    let needAvoid = false;
    let speedCap = Infinity;
    // Where the racing line would take us next (the steering look-ahead point).
    const look = clamp(6 + Math.abs(u) * 0.5, 8, 36);
    const j = mod(idx + Math.round(look / track.spacing), n);
    const lineLateral = this.line.offsets[j] + this.profile.laneBias;
    for (const other of traffic) {
      if (other.car === car) continue;
      let ds = other.proj.distance - proj.distance;
      if (ds > track.length / 2) ds -= track.length;
      else if (ds < -track.length / 2) ds += track.length;
      // A car that is sideways (spun, drifting) blocks much more of the road.
      const rel = other.car.heading - other.proj.heading;
      const sin = Math.abs(Math.sin(rel));
      const cos = Math.abs(Math.cos(rel));
      const otherHalfWidth = other.car.spec.halfWidth * cos + other.car.spec.halfLength * sin;
      const otherHalfLength = other.car.spec.halfLength * cos + other.car.spec.halfWidth * sin;
      const clearance = myHalfWidth + otherHalfWidth + (other.cautious ? MARGIN.cautious : MARGIN.normal);
      // Their speed along the track (a spun car may be going nowhere, or backwards) and sideways.
      const otherU = other.car.vx * other.proj.tx + other.car.vz * other.proj.tz;
      const latVel = other.car.vx * other.proj.rx + other.car.vz * other.proj.rz;
      const futureLat = other.proj.lateral + latVel * (other.cautious ? 0.7 : 0.3);
      const lo = Math.min(other.proj.lateral, futureLat) - clearance;
      const hi = Math.max(other.proj.lateral, futureLat) + clearance;
      const inBand = (x: number) => x > lo && x < hi;

      const alongside = Math.abs(ds) < car.spec.halfLength + otherHalfLength + 1;
      if (alongside) {
        // Keep their space blocked while level with them, so we don't drift back onto our line into them.
        if (!inBand(myLateral) && !inBand(lineLateral) && this.avoidWeight < 0.5) continue;
        bands.push(lo, hi);
        needAvoid ||= inBand(myLateral) || inBand(lineLateral) || this.avoidWeight > 0.5;
        const dLat = other.proj.lateral - myLateral;
        // Don't nose into their flank.
        if (ds > 0 && Math.abs(dLat) < myHalfWidth + otherHalfWidth + 0.3) speedCap = Math.min(speedCap, otherU - 1);
        // Level with the player and they're coming across: give way by dropping back.
        if (other.cautious && ds > -2 && Math.abs(futureLat - myLateral) < Math.abs(dLat)) speedCap = Math.min(speedCap, otherU - 2.5);
        continue;
      }
      if (ds <= 0 || ds > lookAhead) continue;
      const closing = u - otherU;
      if (closing < 0.3 && ds > 12) continue;
      // Is this car in our way - where we are now, or where our racing line takes us when we get there?
      const lineThere = this.line.offsets[other.proj.index] + this.profile.laneBias;
      if (!inBand(myLateral) && !inBand(lineThere)) continue;
      const bumperGap = ds - car.spec.halfLength - otherHalfLength;
      const gap = bumperGap - (other.cautious ? GAP.cautious : GAP.normal);
      ahead.push({ lo, hi, gap, bumperGap, otherU });
      if (ds < Math.max(commitDistance, 25 + closing * 2.5) && (this.profile.aggression > 0.2 || other.cautious)) {
        bands.push(lo, hi);
        needAvoid = true;
      }
    }

    // Nearest open gap to where we are (or where we were already heading, to avoid dithering).
    const gapTarget = needAvoid ? this.nearestGap(this.avoidWeight > 0.5 ? this.avoidLateral : myLateral, maxLateral) : null;

    // Speed: cars still in our way cap our speed to what we could stop from. While stepping
    // around one, keep rolling - a car can't move sideways standing still.
    for (const a of ahead) {
      const gapIsClear = gapTarget !== null && (gapTarget < a.lo || gapTarget > a.hi);
      const inTheWay = myLateral > a.lo && myLateral < a.hi;
      if (gapIsClear && !inTheWay) continue;
      let safe = Math.sqrt(Math.max(0, a.otherU) ** 2 + 2 * FOLLOW_DECEL * Math.max(0, a.gap));
      // (Creep slower the closer we are, but only while there's real space between bumpers.)
      if (gapIsClear && a.bumperGap > 0.8) safe = Math.max(safe, Math.min(CREEP_SPEED, 1 + a.bumperGap));
      speedCap = Math.min(speedCap, safe);
    }

    // Last line of defence around the player: straight-line closest-approach check over the
    // next 1.5 s. If we'd touch, brake hard whatever the planner thought.
    for (const other of traffic) {
      if (!other.cautious) continue;
      const px = other.car.x - car.x;
      const pz = other.car.z - car.z;
      const dist = Math.hypot(px, pz);
      if (dist > 45 || dist < 1e-3) continue;
      const rvx = car.vx - other.car.vx;
      const rvz = car.vz - other.car.vz;
      const rv2 = rvx * rvx + rvz * rvz;
      if (rv2 < 1 || px * rvx + pz * rvz <= 0) continue;
      const tClosest = (px * rvx + pz * rvz) / rv2;
      if (tClosest > 1.5) continue;
      const miss = Math.hypot(px - rvx * tClosest, pz - rvz * tClosest);
      if (miss < 2.9) {
        const theirSpeedAlongUs = other.car.vx * Math.sin(car.heading) + other.car.vz * Math.cos(car.heading);
        speedCap = Math.min(speedCap, Math.max(0, theirSpeedAlongUs - 1));
      }
    }

    if (gapTarget !== null) {
      // Start the manoeuvre from where the car actually is, then ease toward the gap.
      if (this.avoidWeight < 0.05) this.avoidLateral = myLateral;
      this.avoidLateral = damp(this.avoidLateral, gapTarget, 3, dt);
      this.avoidWeight = damp(this.avoidWeight, 1, 5, dt);
    } else {
      this.avoidWeight = damp(this.avoidWeight, 0, 1, dt);
    }

    // ---- Steering: pure pursuit ----
    const s = track.samples[j];
    const lateral = clamp(lerp(lineLateral, this.avoidLateral, this.avoidWeight), -maxLateral, maxLateral);
    const tx = s.x + s.rx * lateral;
    const tz = s.z + s.rz * lateral;
    const alpha = angleTo(car, tx, tz);
    const dist = Math.hypot(tx - car.x, tz - car.z);
    const wheelbase = car.spec.wheelbase;
    // Pure pursuit gives a left-positive curvature; the car steers right-positive.
    const steerAngle = -Math.atan((2 * wheelbase * Math.sin(alpha)) / Math.max(dist, 1));
    c.steer = clamp(steerAngle / car.steerLimit(), -1, 1);
    c.handbrake = false;

    // ---- Pedals: follow the speed profile ----
    const anticipate = mod(idx + Math.round((Math.max(u, 0) * 0.3) / track.spacing), n);
    let target = Math.min(this.speeds[anticipate], this.speeds[idx], speedCap);
    // Ease off if the car is fighting a slide.
    if (Math.abs(car.lateralSpeed) > 3) target = Math.min(target, u - 1);
    const err = target - u;
    if (err > 1.5) {
      c.throttle = 1;
      c.brake = 0;
    } else if (err > -0.8) {
      c.throttle = clamp(0.55 + err * 0.3, 0, 1);
      c.brake = 0;
    } else {
      c.throttle = 0;
      c.brake = clamp(-err * 0.3, 0.15, 1);
    }
    if (facingWrongWay && u < 3) {
      c.throttle = 0.6;
      c.brake = 0;
    }
    return c;
  }

  /** Free lateral position closest to `ref`, outside every blocked band; null if the road is shut. */
  private nearestGap(ref: number, maxLateral: number): number | null {
    const bands = this.bands;
    let best: number | null = null;
    let bestDist = Infinity;
    const candidates = [clamp(ref, -maxLateral, maxLateral)];
    for (let k = 0; k < bands.length; k += 2) candidates.push(bands[k] - PASS_EXTRA, bands[k + 1] + PASS_EXTRA);
    for (const x of candidates) {
      if (x < -maxLateral || x > maxLateral) continue;
      let free = true;
      for (let k = 0; k < bands.length && free; k += 2) if (x > bands[k] - 1e-3 && x < bands[k + 1] + 1e-3) free = false;
      if (free && Math.abs(x - ref) < bestDist) {
        bestDist = Math.abs(x - ref);
        best = x;
      }
    }
    return best;
  }
}

/** Signed angle (rad, left positive) from the car's nose to a world point. */
function angleTo(car: VehiclePhysics, x: number, z: number): number {
  const dx = x - car.x;
  const dz = z - car.z;
  const sinH = Math.sin(car.heading);
  const cosH = Math.cos(car.heading);
  const fwd = dx * sinH + dz * cosH;
  const right = -dx * cosH + dz * sinH;
  return Math.atan2(-right, fwd);
}
