import { clamp, lerp, moveTowards, smoothstep } from '../core/math';

/**
 * Semi-arcade "bicycle model" vehicle simulation running in the world XZ plane.
 *
 * - Front/rear axles each produce a lateral tyre force from their slip angle (smoothly saturating at mu * load).
 * - Longitudinal weight transfer changes axle loads under braking/acceleration (lift-off/trail-braking rotation).
 * - Rear-wheel drive through a 6-speed automatic gearbox and an engine torque curve.
 * - Rear tyres obey a (softened) friction circle so the handbrake and power oversteer can break traction.
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
  handbrakeGrip: 0.5,
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
};

export interface VehicleControls {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverses when stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export function neutralControls(): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false };
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

    // ---- Steering ----
    const limit = this.steerLimit(Math.abs(u));
    const target = clamp(input.steer, -1, 1) * limit;
    const returning = Math.abs(target) < Math.abs(this.steerAngle) && Math.sign(target) !== -Math.sign(this.steerAngle);
    const rate = s.steerRate * s.maxSteer * (returning ? 1.6 : 1);
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
    const muR = s.tireGrip * (input.handbrake ? s.handbrakeGrip : 1);

    // Traction control: never ask the rear tyres for more than ~85% of their grip.
    const maxDrive = muR * loadR * (0.7 + 0.15 * this.stabilityAssist);
    driveForce = Math.min(driveForce, maxDrive);

    // ---- Brakes (ABS-limited) ----
    const movingSign = Math.abs(u) > 0.05 ? Math.sign(u) : 0;
    const brakeTotal = brake * s.maxBrakeForce;
    const brakeF = Math.min(brakeTotal * s.frontBrakeBias, muF * loadF * 0.95);
    // Electronic brake-force distribution keeps the rear tyres from locking.
    let brakeR = Math.min(brakeTotal * (1 - s.frontBrakeBias), muR * loadR * 0.5);
    if (input.handbrake) brakeR = Math.max(brakeR, muR * loadR * 0.9);
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
    const capR = capRTotal * Math.sqrt(Math.max(0.05, 1 - circle * circle * (0.55 - 0.25 * this.stabilityAssist)));
    const fyR = -capR * Math.tanh((s.corneringStiffnessRear * slipR) / Math.max(capR, 1));

    this.frontSlide = clamp(Math.abs(slipF) / 0.2, 0, 1) * smoothstep(3, 8, speed);
    this.rearSlide = clamp(Math.abs(slipR) / 0.15, 0, 1) * smoothstep(3, 8, speed);

    // ---- Longitudinal forces ----
    const drag = -s.dragCoefficient * this.dragScale * u * Math.abs(u);
    const rolling = -s.rollingResistance * u;
    const engineBrake = this.gear > 0 && throttle < 0.05 ? -u * 45 : 0;
    const grade = -s.mass * G * clamp(slope, -0.2, 0.2);
    let fx = driveForce * dir + drag + rolling + engineBrake + grade;
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
    // Disabled while the handbrake is held so deliberate drifts still work.
    if (!input.handbrake && this.stabilityAssist > 0 && uNew > 3) {
      const k = this.stabilityAssist;
      const maxYaw = (s.tireGrip * G) / Math.max(speed, 5);
      const refYaw = clamp((-uNew * Math.tan(delta)) / L, -maxYaw, maxYaw);
      const oversteer =
        Math.abs(r) > Math.abs(refYaw) + 0.05 || (Math.sign(r) !== Math.sign(refYaw) && Math.abs(r) > 0.15);
      if (oversteer) r = lerp(r, refYaw, Math.min(1, ESC_YAW_GAIN * k * dt));
      const bodySlip = Math.atan2(wNew, uNew);
      if (Math.abs(bodySlip) > 0.08) wNew -= wNew * Math.min(1, ESC_SLIP_GAIN * k * dt);
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
