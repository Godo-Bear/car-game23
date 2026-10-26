import { clamp, damp, mod } from '../core/math';
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
}

const TOP_SPEED = 75;

/**
 * Drives a car around the racing line:
 * - steering: pure pursuit toward a speed-dependent look-ahead point on the (possibly offset) line
 * - pedals: follow the precomputed speed profile with a small anticipation window
 * - traffic: pick a side to pass slower cars, otherwise tuck in behind them
 * - recovery: back up and re-align when stuck against a barrier or another car
 */
export class AIDriver {
  readonly line: RacingLine;
  readonly profile: AIProfile;
  private speeds: Float32Array;
  private avoidOffset = 0;
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
    this.avoidOffset = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
  }

  drive(car: VehiclePhysics, proj: TrackProjection, traffic: readonly TrafficCar[], dt: number): VehicleControls {
    const track = this.line.track;
    const n = track.count;
    const c = this.controls;
    const u = car.forwardSpeed;
    const idx = proj.index;

    // ---- Stuck recovery: reverse out with opposite lock ----
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      const headingErr = angleTo(car, track.sample(idx + 6).x, track.sample(idx + 6).z);
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
        this.reverseTime = 1.3;
      }
    } else {
      this.stuckTime = 0;
    }

    // ---- Traffic: choose a lateral offset around slower cars ----
    const lineOffsetHere = this.line.offsets[idx];
    const myLateral = proj.lateral;
    const maxLateral = track.halfWidth - 1.3;
    let desiredAvoid = 0;
    let speedCap = Infinity;
    let urgency = Infinity;
    for (const other of traffic) {
      if (other.car === car) continue;
      let ds = other.proj.distance - proj.distance;
      if (ds > track.length / 2) ds -= track.length;
      else if (ds < -track.length / 2) ds += track.length;
      const dLat = other.proj.lateral - myLateral;
      const otherU = other.car.forwardSpeed;

      if (ds > -4 && ds < 4 && Math.abs(dLat) < 2.6) {
        // Alongside: keep a car's width of daylight.
        const want = other.proj.lateral - Math.sign(dLat || 1) * 2.8 - lineOffsetHere;
        if (Math.abs(ds) < urgency) {
          urgency = Math.abs(ds);
          desiredAvoid = want;
        }
        continue;
      }
      if (ds <= 0 || ds > 32) continue;
      const closing = u - otherU;
      if (Math.abs(dLat) > 2.7 || (closing < 0.5 && ds > 9)) continue;
      // Pass on whichever side has more room.
      const roomLeft = other.proj.lateral + maxLateral;
      const roomRight = maxLateral - other.proj.lateral;
      const goLeft = roomLeft > roomRight;
      const room = goLeft ? roomLeft : roomRight;
      if (room > 3.2 && this.profile.aggression > 0.2) {
        const target = other.proj.lateral + (goLeft ? -3.1 : 3.1);
        if (ds < urgency) {
          urgency = ds;
          desiredAvoid = target - lineOffsetHere;
        }
      }
      // Not alongside yet (or no room to pull out): match their speed instead of rear-ending them.
      if (Math.abs(dLat) < 2.2 && ds < 8 + Math.max(0, closing) * 0.6) {
        speedCap = Math.min(speedCap, otherU + (ds - 5) * 0.8);
      }
    }
    this.avoidOffset = damp(this.avoidOffset, desiredAvoid, desiredAvoid === 0 ? 1.2 : 2.5, dt);

    // ---- Steering: pure pursuit ----
    const look = clamp(6 + Math.abs(u) * 0.5, 8, 36);
    const j = mod(idx + Math.round(look / track.spacing), n);
    const s = track.samples[j];
    const lateral = clamp(this.line.offsets[j] + this.profile.laneBias + this.avoidOffset, -maxLateral, maxLateral);
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
      c.brake = clamp(-err * 0.25, 0.15, 1);
    }
    if (facingWrongWay && u < 3) {
      c.throttle = 0.6;
      c.brake = 0;
    }
    return c;
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
