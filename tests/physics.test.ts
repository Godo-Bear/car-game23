import { describe, expect, it } from 'vitest';
import { collideCars, collideWithWalls } from '../src/physics/Collisions';
import { type VehicleControls, VehiclePhysics } from '../src/physics/VehiclePhysics';
import { createProjection } from '../src/track/TrackPath';

const DT = 1 / 120;
const input = (o: Partial<VehicleControls>): VehicleControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...o });

function simulate(car: VehiclePhysics, seconds: number, controls: (t: number) => VehicleControls): void {
  for (let t = 0; t < seconds; t += DT) car.step(controls(t), DT);
}

function cruising(speed: number): VehiclePhysics {
  const car = new VehiclePhysics();
  car.place(0, 0, 0);
  car.vz = speed;
  car.gear = speed > 40 ? 5 : 3;
  return car;
}

describe('VehiclePhysics', () => {
  it('launches to 100 km/h in a sports-car time and tops out around 270 km/h', () => {
    const car = new VehiclePhysics();
    car.place(0, 0, 0);
    let t100 = 0;
    for (let t = 0; t < 45; t += DT) {
      car.step(input({ throttle: 1 }), DT);
      if (!t100 && car.speedKmh >= 100) t100 = t;
    }
    expect(t100).toBeGreaterThan(3);
    expect(t100).toBeLessThan(6);
    expect(car.speedKmh).toBeGreaterThan(240);
    expect(car.speedKmh).toBeLessThan(300);
    expect(car.gear).toBe(6);
  });

  it('steers in the requested direction (positive steer = right = decreasing heading)', () => {
    const right = cruising(20);
    simulate(right, 1, () => input({ steer: 1, throttle: 0.3 }));
    expect(right.heading).toBeLessThan(-0.3);
    const left = cruising(20);
    simulate(left, 1, () => input({ steer: -1, throttle: 0.3 }));
    expect(left.heading).toBeGreaterThan(0.3);
  });

  it('stays composed when braking hard with full lock from 160 km/h', () => {
    const car = cruising(45);
    let maxSlip = 0;
    simulate(car, 2.5, (t) => {
      maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(car.lateralSpeed, Math.abs(car.forwardSpeed))));
      return input({ brake: t < 1.5 ? 1 : 0, steer: t > 0.5 ? 1 : 0 });
    });
    expect(maxSlip).toBeLessThan(0.2);
  });

  it('rotates much more with the handbrake pulled', () => {
    const plain = cruising(20);
    simulate(plain, 0.5, () => input({ steer: 0.7 }));
    const drift = cruising(20);
    simulate(drift, 0.5, () => input({ steer: 0.7, handbrake: true }));
    expect(Math.abs(drift.heading)).toBeGreaterThan(Math.abs(plain.heading) * 1.3);
  });

  it('holds a handbrake-initiated drift on throttle without spinning', () => {
    const car = cruising(21);
    car.gear = 2;
    let maxSlip = 0;
    let drifting = 0;
    simulate(car, 4, (t) => {
      maxSlip = Math.max(maxSlip, Math.abs(car.driftAngle));
      if (t > 1 && Math.abs(car.driftAngle) > 0.35) drifting += DT;
      return input({ throttle: t > 0.5 ? 1 : 0.3, steer: t < 0.5 ? -0.8 : 0, handbrake: t > 0.1 && t < 0.5 });
    });
    expect(car.drifting).toBe(true);
    expect(drifting).toBeGreaterThan(2.5); // slide sustained for most of the 3 s after the flick
    expect(maxSlip).toBeLessThan(0.95); // the limiter stops it becoming a spin
    expect(car.speedKmh).toBeGreaterThan(40);
  });

  it('carves a high-speed drift round the corner instead of sliding wide or spinning', () => {
    const car = cruising(58); // ~210 km/h
    let maxSlip = 0;
    simulate(car, 3, (t) => {
      maxSlip = Math.max(maxSlip, Math.abs(car.driftAngle));
      return input({ throttle: t < 0.35 ? 0.3 : 0.8, steer: t < 0.35 ? -1 : -0.6, handbrake: t < 0.35 });
    });
    const pathTurn = Math.abs(Math.atan2(car.vx, car.vz));
    expect(maxSlip).toBeLessThan(0.75); // a slide, not a spin
    expect(pathTurn).toBeGreaterThan(0.85); // ~50 degrees of corner in 3 s, not a slide into the wall
    expect(Math.hypot(car.vx, car.vz) * 3.6).toBeGreaterThan(160); // and it keeps its speed
  });

  it('straightens up and leaves drift mode when you lift off', () => {
    const car = cruising(21);
    car.gear = 2;
    simulate(car, 4.5, (t) => input({ throttle: t > 0.5 && t < 1.5 ? 1 : 0, steer: t < 0.5 ? -0.8 : 0, handbrake: t > 0.1 && t < 0.5 }));
    expect(Math.abs(car.driftAngle)).toBeLessThan(0.05);
    expect(car.drifting).toBe(false);
  });

  it('brakes to a stop, then reverses at a limited speed when brake is held', () => {
    const car = cruising(15);
    simulate(car, 6, () => input({ brake: 1 }));
    expect(car.gear).toBe(-1);
    expect(car.forwardSpeed).toBeLessThan(-3);
    expect(car.forwardSpeed).toBeGreaterThan(-10);
    expect(car.gearLabel()).toBe('R');
  });

  it('never produces NaN under random abuse', () => {
    const car = new VehiclePhysics();
    car.place(0, 0, 0);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    simulate(car, 30, () => input({ throttle: rnd(), brake: rnd() > 0.8 ? 1 : 0, steer: rnd() * 2 - 1, handbrake: rnd() > 0.9 }));
    for (const v of [car.x, car.z, car.vx, car.vz, car.heading, car.yawRate, car.rpm]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('Collisions', () => {
  it('pushes a car out of the barrier and makes the crash cost speed', () => {
    const car = new VehiclePhysics();
    // Track runs along +z; its right-hand side is -x. Car drives diagonally into the right barrier.
    car.place(-7.5, 0, -0.5);
    car.vx = -10;
    car.vz = 20;
    const proj = { ...createProjection(), lateral: 7.5, rx: -1, rz: 0, tx: 0, tz: 1 };
    const before = car.speed;
    const impact = collideWithWalls(car, proj, 7.6);
    expect(impact).toBeGreaterThan(5);
    expect(car.x).toBeGreaterThan(-7.5);
    expect(car.vx).toBeGreaterThan(-6);
    expect(car.speed).toBeLessThan(before * 0.8);
    expect(car.vz).toBeGreaterThan(8);
  });

  it('bounces two overlapping cars apart and transfers momentum', () => {
    const a = new VehiclePhysics();
    const b = new VehiclePhysics();
    a.place(0, 0, 0);
    b.place(0, 3.5, 0);
    a.vz = 30;
    b.vz = 20;
    expect(collideCars(a, b)).toBeCloseTo(10, 0);
    // Momentum is shared (the faster car is slowed, the slower one pushed) minus crash losses.
    expect(a.vz).toBeLessThan(30);
    expect(b.vz).toBeGreaterThan(a.vz);
    expect(b.z - a.z).toBeGreaterThan(3.5);
  });
});
