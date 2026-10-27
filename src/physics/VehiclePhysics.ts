import { clamp, lerp, moveTowards, smoothstep } from '../core/math';

/**
 * Semi-arcade "bicycle model" vehicle simulation running in the world XZ plane.
 *
 * - Front/rear axles each produce a lateral tyre force from their slip angle (smoothly saturating at mu * load).
 * - Longitudinal weight transfer changes axle loads under braking/acceleration (lift-off/trail-braking rotation).
 * - Rear-wheel drive through a 6-speed automatic gearbox and an engine torque curve.
 * - Rear tyres obey a (softened) friction circle so the handbrake and power oversteer can break traction.
 * - Pulling the handbrake starts a drift: the rear stays loose while you hold it with throttle and
 *   countersteer, with a little automatic countersteer and an angle limiter so it's controllable.
 * - Below ~6 m/s the model blends into a kinematic model so it is stable when parking or launching.
 *
 * Pure TypeScript with no rendering dependencies so it can be unit tested and shared by player and AI cars.
 */

export interface VehicleSpec {
  mass: number;
  inertia: number;
  wheelbase: number;
  cgToFront: number;
  cgToRear: number;
  cgHeight: number;
  halfWidth: number;
  halfLength: number;
  wheelRadius: number;
  /** Peak tyre friction coefficient. */
  tireGrip: number;
  /** Lateral force per radian of slip, per axle (N/rad). */
  corneringStiffnessFront: number;
  corneringStiffnessRear: number;
  /** Rear grip multiplier while the handbrake is pulled. */
  handbrakeGrip: number;
  maxBrakeForce: number;
  frontBrakeBias: number;
  dragCoefficient: number;
  rollingResistance: number;
  /** [rpm, Nm] pairs, ascending rpm. */
  torqueCurve: ReadonlyArray<readonly [number, number]>;
  idleRpm: number;
  redlineRpm: number;
  gearRatios: readonly number[];
  reverseRatio: number;
  finalDrive: number;
  drivetrainEfficiency: number;
  shiftUpRpm: number;
  shiftDownRpm: number;
  shiftTime: number;
  /** Max steering angle (rad) when stationary; reduced with speed. */
  maxSteer: number;
  /** Speed (m/s) at which the steering lock has halved. */
  steerSpeedHalf: number;
  /** Steering speed in "full locks per second". */
  steerRate: number;
  /** Extra push (N) while the nitro fires. */
  nitroForce: number;
  /** Seconds of boost in a full nitro tank. */
  nitroCapacity: number;
}

export const SPORTS_CAR: VehicleSpec = {
  mass: 1300,
  inertia: 1900,
  wheelbase: 2.6,
  cgToFront: 1.2,
  cgToRear: 1.4,
  cgHeight: 0.48,
  halfWidth: 0.95,
  halfLength: 2.2,
  wheelRadius: 0.33,
  tireGrip: 1.55,
  corneringStiffnessFront: 95000,
  corneringStiffnessRear: 110000,
  handbrakeGrip: 0.55,
  maxBrakeForce: 15500,
  frontBrakeBias: 0.62,
  dragCoefficient: 0.42,
  rollingResistance: 12,
  torqueCurve: [
    [800, 250],
    [2000, 340],
    [3000, 410],
    [4000, 465],
    [5000, 500],
    [6000, 495],
    [7000, 455],
    [7800, 390],
  ],
  idleRpm: 900,
  redlineRpm: 7800,
  gearRatios: [3.3, 2.25, 1.7, 1.36, 1.12, 0.94],
  reverseRatio: 3.1,
  finalDrive: 3.85,
  drivetrainEfficiency: 0.85,
  shiftUpRpm: 7300,
  shiftDownRpm: 3900,
  shiftTime: 0.16,
  maxSteer: 0.6,
  steerSpeedHalf: 16,
  steerRate: 2.6,
  nitroForce: 5200,
  nitroCapacity: 3,
};

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverses when stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  nitro: boolean;
}

export function neutralControls(): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
}

const G = 9.81;
/** How quickly stability control pulls yaw rate back toward the neutral-steer reference (1/s at full assist). */
const ESC_YAW_GAIN = 12;
/** How quickly stability control bleeds off body slip beyond ~5 degrees (1/s at full assist). */
const ESC_SLIP_GAIN = 3;
/**
 * Fraction of longitudinal weight transfer that affects cornering grip. Enough for lift-off and
 * trail-brake rotation, not so much that braking into a corner on a keyboard spins the car.
 */
const LAT_TRANSFER = 0.35;
/** Rear grip while drifting with the handbrake released: loose enough to slide on throttle. */
const DRIFT_REAR_GRIP = 0.82;
/** Fraction of the body-slip angle fed back into the steering as automatic countersteer. */
const DRIFT_COUNTERSTEER = 0.7;
/** Body slip (rad) beyond which the drift limiter stops the car rotating further (~34 deg)... */
const DRIFT_MAX_ANGLE = 0.6;
/** ...tightening to ~24 deg at high speed, where a big angle would just scrub you into a wall. */
const DRIFT_MAX_ANGLE_FAST = 0.42;
/**
 * Drift carve (1/s): while sliding, the direction of travel is steadily pulled toward where the
 * car is pointing, so a drift follows the corner instead of sliding wide. Stronger at speed.
 */
const DRIFT_CARVE = 1.1;
const DRIFT_CARVE_FAST = 3.2;
/** Most extra cornering (m/s^2) the carve may add, so it helps without feeling on rails. */
const DRIFT_CARVE_ACCEL = 2.5;
const DRIFT_CARVE_ACCEL_FAST = 5.5;
/**
 * Recovery: lifting off the throttle (handbrake released) ends a drift. The rear tyres find
 * their grip again over ~1/DRIFT_REGRIP s while the slide is straightened out at this rate (1/s).
 */
const DRIFT_REGRIP = 3.5;
const DRIFT_RECOVER = 2.2;
/** Nitro tank refill (tanks per second): slowly on its own, quickly while drifting. */
const NITRO_REFILL = 1 / 45;
const NITRO_REFILL_DRIFT = 1 / 6;

export class VehiclePhysics {
  readonly spec: VehicleSpec;

  // World state
  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;

  // Drivetrain / steering state
  steerAngle = 0;
  /** -1 = reverse, 1..n = forward gears. */
  gear = 1;
  rpm = 900;
  private shiftTimer = 0;

  // Telemetry (read by visuals, audio and AI)
  forwardSpeed = 0;
  lateralSpeed = 0;
  longAccel = 0;
  latAccel = 0;
  /** 0..1 how much the tyres are sliding (for skid audio/marks). */
  frontSlide = 0;
  rearSlide = 0;
  wheelSpin = 0;
  throttleApplied = 0;
  braking = false;
  /** True from a handbrake pull until the car straightens up again. */
  drifting = false;
  /** Body slip angle in radians (positive: travelling to the right of where the nose points). */
  driftAngle = 0;
  private driftSettle = 0;
  /** 0..1 how far the rear has regained its grip after a drift (1 = fully). */
  private regrip = 1;
  /** Nitro tank 0..1 (starts full). */
  nitro = 1;
  /** Nitro firing this step (for flames, sound and camera). */
  nitroActive = false;
  /** Multiplier the AI/difficulty system can use; 1 = normal. */
  powerScale = 1;
  /** Aerodynamic drag multiplier; < 1 while slipstreaming another car. */
  dragScale = 1;
  /** Driver aid strength 0..1 (yaw stabilisation, smoother traction). */
  stabilityAssist = 0.7;

  constructor(spec: VehicleSpec = SPORTS_CAR) {
    this.spec = spec;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  place(x: number, z: number, heading: number, y = 0): void {
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this.shiftTimer = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.longAccel = 0;
    this.latAccel = 0;
    this.drifting = false;
    this.driftAngle = 0;
    this.regrip = 1;
    this.nitroActive = false;
  }

  /** Top speed the gearing allows (redline in top gear), m/s. */
  get gearedTopSpeed(): number {
    const s = this.spec;
    return ((s.redlineRpm / (s.gearRatios[s.gearRatios.length - 1] * s.finalDrive)) * 2 * Math.PI * s.wheelRadius) / 60;
  }

  /** Maximum steering angle available at the current speed (speed-sensitive steering). */
  steerLimit(speed = Math.abs(this.forwardSpeed)): number {
    return this.spec.maxSteer / (1 + speed / this.spec.steerSpeedHalf);
  }

  engineTorque(rpm: number): number {
    const curve = this.spec.torqueCurve;
    if (rpm <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      if (rpm <= curve[i][0]) {
        const [r0, t0] = curve[i - 1];
        const [r1, t1] = curve[i];
        return lerp(t0, t1, (rpm - r0) / (r1 - r0));
      }
    }
    return curve[curve.length - 1][1];
  }

  /**
   * Advance the simulation by `dt` seconds.
   * @param slope road gradient along the direction of travel (dy/ds); positive is uphill.
   */
  step(input: VehicleControls, dt: number, slope = 0): void {
    const s = this.spec;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    // forward = (sinH, cosH), right = (-cosH, sinH)
    const u = this.vx * sinH + this.vz * cosH;
    const w = -this.vx * cosH + this.vz * sinH;
    const speed = Math.hypot(u, w);

    // ---- Gear selection (automatic, with brake-to-reverse) ----
    let throttle = clamp(input.throttle, 0, 1);
    let brake = clamp(input.brake, 0, 1);
    if (this.gear > 0 && u < 0.6 && brake > 0.1 && throttle < 0.1) {
      this.gear = -1;
    } else if (this.gear < 0 && u > -0.6 && throttle > 0.1 && brake < 0.1) {
      this.gear = 1;
    }
    if (this.gear < 0) {
      // In reverse the pedals swap roles: "brake" drives backwards, "throttle" brakes.
      const t = throttle;
      throttle = brake;
      brake = t;
    }

    // ---- Drift state ----
    const bodySlip = speed > 1 ? Math.atan2(w, Math.max(Math.abs(u), 0.5)) : 0;
    this.driftAngle = bodySlip;
    if (input.handbrake && u > 8) this.drifting = true;
    // Lifting off with the handbrake released means "straighten up": the rear regrips and the
    // slide is reeled in, so a drift ends where you want it to instead of in a spin.
    const recovering = this.drifting && !input.handbrake && throttle < 0.3;
    if (input.handbrake) this.regrip = 0;
    else if (!this.drifting) this.regrip = 1;
    else if (recovering) this.regrip = Math.min(1, this.regrip + DRIFT_REGRIP * dt);
    if (this.drifting) {
      const settled = Math.abs(bodySlip) < (recovering ? 0.16 : 0.1) && !input.handbrake;
      this.driftSettle = settled ? this.driftSettle + dt : 0;
      if (this.driftSettle > (recovering ? 0.15 : 0.35) || u < 4) this.drifting = false;
    }

    // ---- Steering ----
    let limit = this.steerLimit(Math.abs(u));
    let target = clamp(input.steer, -1, 1) * limit;
    // 0 at moderate speed .. 1 flat out: high-speed drifts get more help.
    const fast = smoothstep(22, 55, speed);
    if (this.drifting) {
      // Allow enough lock to countersteer the slide, and do some of it automatically.
      limit = Math.max(limit, Math.min(s.maxSteer, Math.abs(bodySlip) + 0.25));
      const counter = DRIFT_COUNTERSTEER + 0.25 * fast;
      target = clamp(clamp(input.steer, -1, 1) * limit + bodySlip * counter, -limit, limit);
    }
    const returning = Math.abs(target) < Math.abs(this.steerAngle) && Math.sign(target) !== -Math.sign(this.steerAngle);
    // Steering speed shrinks with the available lock, so the wheel takes a similar time to reach
    // full lock at any speed - no twitchy flicks at 200 km/h.
    // (Drift flicks and countersteer keep the quick rack.)
    const quick = this.drifting || input.handbrake;
    const rate = s.steerRate * (quick ? s.maxSteer : lerp(s.maxSteer, limit, 0.7)) * (returning ? 1.6 : 1);
    this.steerAngle = moveTowards(this.steerAngle, target, rate * dt);
    this.steerAngle = clamp(this.steerAngle, -limit * 1.05, limit * 1.05);
    const delta = this.steerAngle;

    // ---- Engine & gearbox ----
    const ratio = this.gear > 0 ? s.gearRatios[this.gear - 1] : s.reverseRatio;
    const wheelRpm = (Math.abs(u) / s.wheelRadius) * (60 / (2 * Math.PI));
    let rpm = wheelRpm * ratio * s.finalDrive;
    // A slipping clutch keeps revs up when launching.
    const clutchRpm = lerp(s.idleRpm, 3800, throttle);
    if (Math.abs(this.gear) === 1 && rpm < clutchRpm) rpm = lerp(rpm, clutchRpm, 1 - smoothstep(0, 4, Math.abs(u)) * 0.3);
    rpm = Math.max(rpm, s.idleRpm);

    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
    } else if (this.gear > 0) {
      if (rpm > s.shiftUpRpm && this.gear < s.gearRatios.length) {
        this.gear++;
        this.shiftTimer = s.shiftTime;
      } else if (this.gear > 1) {
        const lowerRpm = wheelRpm * s.gearRatios[this.gear - 2] * s.finalDrive;
        if (rpm < s.shiftDownRpm && lowerRpm < s.shiftUpRpm - 600) {
          this.gear--;
          this.shiftTimer = s.shiftTime * 0.6;
        }
      }
    }
    this.rpm = lerp(this.rpm, Math.min(rpm, s.redlineRpm + 150), 1 - Math.exp(-25 * dt));

    let driveForce = 0;
    const reverseLimited = this.gear < 0 && u < -9;
    if (this.shiftTimer <= 0 && rpm < s.redlineRpm && !reverseLimited) {
      const torque = this.engineTorque(rpm) * throttle * this.powerScale;
      driveForce = (torque * ratio * s.finalDrive * s.drivetrainEfficiency) / s.wheelRadius;
    }
    const dir = this.gear > 0 ? 1 : -1;
    this.throttleApplied = throttle;

    // ---- Axle loads with longitudinal weight transfer ----
    const L = s.wheelbase;
    const transfer = (s.cgHeight / L) * s.mass * clamp(this.longAccel, -12, 12);
    const staticF = (s.mass * G * s.cgToRear) / L;
    const staticR = (s.mass * G * s.cgToFront) / L;
    const loadF = Math.max(0, staticF - transfer);
    const loadR = Math.max(0, staticR + transfer);
    const latLoadF = lerp(staticF, loadF, LAT_TRANSFER);
    const latLoadR = lerp(staticR, loadR, LAT_TRANSFER);
    const muF = s.tireGrip;
    // A handbrake pull at high speed breaks traction more gently, so it starts a slide, not a spin.
    const handbrakeGrip = lerp(s.handbrakeGrip, (s.handbrakeGrip + 1) / 2, fast * 0.6);
    const muR = s.tireGrip * (input.handbrake ? handbrakeGrip : this.drifting ? lerp(DRIFT_REAR_GRIP, 1, this.regrip) : 1);

    // Traction control: never ask the rear tyres for more than ~85% of their grip (off while drifting).
    const maxDrive = muR * loadR * (this.drifting ? 1 : 0.7 + 0.15 * this.stabilityAssist);
    driveForce = Math.min(driveForce, maxDrive);

    // ---- Brakes (ABS-limited) ----
    const movingSign = Math.abs(u) > 0.05 ? Math.sign(u) : 0;
    const brakeTotal = brake * s.maxBrakeForce;
    const brakeF = Math.min(brakeTotal * s.frontBrakeBias, muF * loadF * 0.95);
    // Electronic brake-force distribution keeps the rear tyres from locking.
    let brakeR = Math.min(brakeTotal * (1 - s.frontBrakeBias), muR * loadR * 0.5);
    // The handbrake locks the rear just enough to break traction without killing all your speed.
    if (input.handbrake) brakeR = Math.max(brakeR, muR * loadR * lerp(0.55, 0.3, fast));
    this.braking = brake > 0.05;

    // ---- Lateral tyre forces ----
    const minU = Math.max(Math.abs(u), 4);
    const a = s.cgToFront;
    const b = s.cgToRear;
    const steerDir = u >= 0 ? 1 : -1;
    const slipF = Math.atan2(w - this.yawRate * a, minU) - delta * steerDir;
    const slipR = Math.atan2(w + this.yawRate * b, minU);

    const capF = muF * latLoadF;
    let fyF = -capF * Math.tanh((s.corneringStiffnessFront * slipF) / Math.max(capF, 1));

    // Softened friction circle on the rear axle (drive + brake eat into lateral grip).
    const longR = driveForce + brakeR;
    const capRTotal = muR * latLoadR;
    const circle = Math.min(1, longR / Math.max(capRTotal, 1));
    const circleWeight = this.drifting ? 0.8 : 0.55 - 0.25 * this.stabilityAssist;
    const capR = capRTotal * Math.sqrt(Math.max(0.05, 1 - circle * circle * circleWeight));
    const fyR = -capR * Math.tanh((s.corneringStiffnessRear * slipR) / Math.max(capR, 1));

    this.frontSlide = clamp(Math.abs(slipF) / 0.2, 0, 1) * smoothstep(3, 8, speed);
    this.rearSlide = clamp(Math.abs(slipR) / 0.15, 0, 1) * smoothstep(3, 8, speed);

    // ---- Nitro: a push on top of the engine, fading out at the gearing's top speed ----
    this.nitroActive = input.nitro && this.nitro > 0 && this.gear > 0 && u > 2;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - dt / s.nitroCapacity);
    else this.nitro = Math.min(1, this.nitro + dt * (this.drifting && Math.abs(bodySlip) > 0.15 ? NITRO_REFILL_DRIFT : NITRO_REFILL));
    const boost = this.nitroActive ? s.nitroForce * (1 - smoothstep(0.9, 1.05, u / this.gearedTopSpeed)) : 0;

    // ---- Longitudinal forces ----
    const drag = -s.dragCoefficient * this.dragScale * u * Math.abs(u);
    const rolling = -s.rollingResistance * u;
    const engineBrake = this.gear > 0 && throttle < 0.05 && !this.nitroActive ? -u * 45 : 0;
    const grade = -s.mass * G * clamp(slope, -0.2, 0.2);
    let fx = driveForce * dir + boost + drag + rolling + engineBrake + grade;
    const brakeForce = brakeF + brakeR;
    if (movingSign !== 0) {
      fx -= movingSign * brakeForce;
    }
    fx -= fyF * Math.sin(delta);
    fyF *= Math.cos(delta);

    const fy = fyF + fyR;
    const torque = -a * fyF + b * fyR;

    // ---- Integrate (semi-implicit Euler in world space) ----
    const ax = fx / s.mass;
    const ay = fy / s.mass;
    let uNew = u + ax * dt;
    // Brakes and rolling resistance must not reverse the direction of travel within a step.
    if (movingSign !== 0 && Math.sign(uNew) !== movingSign && driveForce * dir * movingSign <= 0) uNew = 0;
    if (movingSign === 0 && driveForce === 0) uNew = 0;
    let wNew = w + ay * dt;
    let r = this.yawRate + (torque / s.inertia) * dt;

    // Stability control (ESC): pull the yaw rate back toward what a neutral-steering car
    // would do for the current steering input, and bleed off excessive body slip.
    // Disabled while drifting so deliberate slides aren't cancelled.
    if (!input.handbrake && !this.drifting && this.stabilityAssist > 0 && uNew > 3) {
      const k = this.stabilityAssist;
      const maxYaw = (s.tireGrip * G) / Math.max(speed, 5);
      const refYaw = clamp((-uNew * Math.tan(delta)) / L, -maxYaw, maxYaw);
      const oversteer = Math.abs(r) > Math.abs(refYaw) + 0.05 || (Math.sign(r) !== Math.sign(refYaw) && Math.abs(r) > 0.15);
      if (oversteer) r = lerp(r, refYaw, Math.min(1, ESC_YAW_GAIN * k * dt));
      const bodySlip = Math.atan2(wNew, uNew);
      if (Math.abs(bodySlip) > 0.08) wNew -= wNew * Math.min(1, ESC_SLIP_GAIN * k * dt);
    }

    if (this.drifting && uNew > 5) {
      // Drift limiter: past the maximum angle, stop the car rotating further into a spin.
      const maxAngle = lerp(DRIFT_MAX_ANGLE, DRIFT_MAX_ANGLE_FAST, fast);
      if (Math.abs(bodySlip) > maxAngle && Math.sign(r) === Math.sign(bodySlip)) {
        r *= 1 - Math.min(1, (Math.abs(bodySlip) - maxAngle) * 50 * dt);
      }
      // Carve: swing the velocity toward the heading without changing speed.
      const carve = lerp(DRIFT_CARVE, DRIFT_CARVE_FAST, fast) * (input.handbrake ? 0.5 : 1);
      const v = Math.hypot(uNew, wNew);
      const slip0 = Math.atan2(wNew, uNew);
      const maxTurn = (lerp(DRIFT_CARVE_ACCEL, DRIFT_CARVE_ACCEL_FAST, fast) / v) * dt;
      const slip = slip0 - clamp(slip0 * (1 - Math.exp(-carve * dt)), -maxTurn, maxTurn);
      uNew = v * Math.cos(slip);
      wNew = v * Math.sin(slip);
      if (recovering) {
        // Straighten up: settle the rotation toward what the steering asks for and reel in the slide.
        const k = Math.min(1, DRIFT_RECOVER * (0.6 + 0.6 * this.stabilityAssist) * dt);
        r = lerp(r, (-uNew * Math.tan(delta)) / L, k);
        wNew -= wNew * k;
      }
    }

    // Low-speed kinematic blend.
    const dyn = smoothstep(2, 7, Math.abs(uNew));
    if (dyn < 1) {
      const rKin = (-uNew * Math.tan(delta)) / L;
      r = lerp(rKin, r, dyn);
      wNew = lerp(wNew * Math.exp(-12 * dt), wNew, dyn);
    }

    // Velocity is expressed in the frame the forces were computed in; the body then
    // rotates underneath it, which is what makes the tyres generate slip next step.
    this.vx = uNew * sinH - wNew * cosH;
    this.vz = uNew * cosH + wNew * sinH;
    this.yawRate = r;
    this.heading += r * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.longAccel = lerp(this.longAccel, ax, 1 - Math.exp(-10 * dt));
    this.latAccel = lerp(this.latAccel, ay, 1 - Math.exp(-10 * dt));
    this.syncLocalVelocity();
    this.wheelSpin += (this.forwardSpeed / s.wheelRadius) * dt;
  }

  /** Rebuild forward/lateral telemetry after an external velocity change (collisions). */
  syncLocalVelocity(): void {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    this.forwardSpeed = this.vx * sinH + this.vz * cosH;
    this.lateralSpeed = -this.vx * cosH + this.vz * sinH;
  }

  /** Display gear label. */
  gearLabel(): string {
    if (this.gear < 0) return 'R';
    if (Math.abs(this.forwardSpeed) < 0.3 && this.throttleApplied < 0.05) return 'N';
    return String(this.gear);
  }
}
