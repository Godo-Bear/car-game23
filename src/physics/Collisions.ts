import type { TrackProjection } from '../track/TrackPath';
import type { VehiclePhysics } from './VehiclePhysics';

const WALL_RESTITUTION = 0.2;
const WALL_FRICTION = 0.3;
const CAR_RESTITUTION = 0.3;
const CAR_FRICTION = 0.15;

/**
 * Crashing costs speed on top of the impulse response (crumpling bodywork, scrubbing tyres):
 * a 5 m/s barrier hit loses ~12% of the car's speed, a 15 m/s hit about half.
 */
function crashScrub(car: VehiclePhysics, impact: number, threshold: number, perMs: number, maxLoss: number): void {
  if (impact <= threshold) return;
  const keep = 1 - Math.min(maxLoss, (impact - threshold) * perMs);
  car.vx *= keep;
  car.vz *= keep;
  car.yawRate *= 0.5 + 0.5 * keep;
}

/**
 * Keep a car inside the circuit barriers. The barrier is treated as a line at `wallOffset`
 * metres either side of the centre line; the car's four corners are tested against it and the
 * deepest one receives a rigid-body impulse (so glancing blows also spin the car a little).
 * Returns the impact speed along the barrier normal (0 when there was no hit).
 */
/** Where a car touched the barrier this step (for sparks and scrape sounds). */
export interface WallContact {
  /** Touching during the latest step. */
  active: boolean;
  /** Steps with contact so far (never reset), so effects can tell if any step of a frame touched. */
  count: number;
  x: number;
  z: number;
}

export function collideWithWalls(car: VehiclePhysics, proj: TrackProjection, wallOffset: number, contact?: WallContact): number {
  const { halfLength, halfWidth, mass, inertia } = car.spec;
  const sinH = Math.sin(car.heading);
  const cosH = Math.cos(car.heading);
  const fx = sinH;
  const fz = cosH;
  const rx = -cosH;
  const rz = sinH;

  let worst = 0;
  let side = 0;
  let ox = 0;
  let oz = 0;
  for (let sl = -1; sl <= 1; sl += 2) {
    for (let sw = -1; sw <= 1; sw += 2) {
      const cx = fx * halfLength * sl + rx * halfWidth * sw;
      const cz = fz * halfLength * sl + rz * halfWidth * sw;
      const lat = proj.lateral + cx * proj.rx + cz * proj.rz;
      const pen = Math.abs(lat) - wallOffset;
      if (pen > worst) {
        worst = pen;
        side = Math.sign(lat);
        ox = cx;
        oz = cz;
      }
    }
  }
  if (worst <= 0) return 0;

  // Normal pointing from the barrier back into the track.
  const nx = -side * proj.rx;
  const nz = -side * proj.rz;
  car.x += nx * worst;
  car.z += nz * worst;
  if (contact) {
    contact.active = true;
    contact.count++;
    contact.x = car.x + ox;
    contact.z = car.z + oz;
  }

  const impact = applyImpulse(car, null, ox, oz, 0, 0, nx, nz, mass, inertia, WALL_RESTITUTION, WALL_FRICTION);
  crashScrub(car, impact, 1.5, 0.035, 0.65);
  car.syncLocalVelocity();
  return impact;
}

const CIRCLE_OFFSET = 1.25;

/**
 * Car-to-car contact. Each car is approximated by two circles (front and rear axle) which is
 * cheap, stable and close enough to a rounded-rectangle footprint for racing contact.
 * Returns the closing speed at the contact point (0 when the cars did not touch).
 */
export function collideCars(a: VehiclePhysics, b: VehiclePhysics): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const reach = a.spec.halfLength + b.spec.halfLength;
  if (dx * dx + dz * dz > reach * reach) return 0;

  const ra = a.spec.halfWidth;
  const rb = b.spec.halfWidth;
  const afx = Math.sin(a.heading);
  const afz = Math.cos(a.heading);
  const bfx = Math.sin(b.heading);
  const bfz = Math.cos(b.heading);

  let bestPen = 0;
  let nx = 0;
  let nz = 0;
  let cax = 0;
  let caz = 0;
  for (let i = -1; i <= 1; i += 2) {
    const pax = a.x + afx * CIRCLE_OFFSET * i;
    const paz = a.z + afz * CIRCLE_OFFSET * i;
    for (let j = -1; j <= 1; j += 2) {
      const pbx = b.x + bfx * CIRCLE_OFFSET * j;
      const pbz = b.z + bfz * CIRCLE_OFFSET * j;
      const ddx = pbx - pax;
      const ddz = pbz - paz;
      const d = Math.hypot(ddx, ddz);
      const pen = ra + rb - d;
      if (pen > bestPen) {
        bestPen = pen;
        if (d > 1e-6) {
          nx = ddx / d;
          nz = ddz / d;
        } else {
          nx = 1;
          nz = 0;
        }
        cax = pax + nx * (ra - pen / 2);
        caz = paz + nz * (ra - pen / 2);
      }
    }
  }
  if (bestPen <= 0) return 0;

  // Separate the cars equally along the contact normal (n points from a to b).
  const half = bestPen / 2;
  a.x -= nx * half;
  a.z -= nz * half;
  b.x += nx * half;
  b.z += nz * half;

  const impact = applyImpulse(b, a, cax - b.x, caz - b.z, cax - a.x, caz - a.z, nx, nz, a.spec.mass, a.spec.inertia, CAR_RESTITUTION, CAR_FRICTION);
  crashScrub(a, impact, 2, 0.02, 0.4);
  crashScrub(b, impact, 2, 0.02, 0.4);
  a.syncLocalVelocity();
  b.syncLocalVelocity();
  return impact;
}

/**
 * Sequential impulse between body `p` (pushed along +n) and optional body `q` (pushed along -n,
 * null = immovable barrier). Offsets are contact point minus centre of mass. Returns the
 * closing speed before the impulse.
 */
function applyImpulse(
  p: VehiclePhysics,
  q: VehiclePhysics | null,
  prx: number,
  prz: number,
  qrx: number,
  qrz: number,
  nx: number,
  nz: number,
  qMass: number,
  qInertia: number,
  restitution: number,
  friction: number,
): number {
  const pInvM = 1 / p.spec.mass;
  const pInvI = 1 / p.spec.inertia;
  const qInvM = q ? 1 / qMass : 0;
  const qInvI = q ? 1 / qInertia : 0;

  // Point velocities: v + yaw * (rz, -rx)
  const pvx = p.vx + p.yawRate * prz;
  const pvz = p.vz - p.yawRate * prx;
  const qvx = q ? q.vx + q.yawRate * qrz : 0;
  const qvz = q ? q.vz - q.yawRate * qrx : 0;
  const relX = pvx - qvx;
  const relZ = pvz - qvz;
  const vn = relX * nx + relZ * nz;
  if (vn >= 0) return 0;

  const pRn = prz * nx - prx * nz;
  const qRn = qrz * nx - qrx * nz;
  const jn = (-(1 + restitution) * vn) / (pInvM + qInvM + pRn * pRn * pInvI + qRn * qRn * qInvI);
  push(p, nx * jn, nz * jn, prx, prz);
  if (q) push(q, -nx * jn, -nz * jn, qrx, qrz);

  // Coulomb friction along the contact tangent.
  const tx = -nz;
  const tz = nx;
  const vt = relX * tx + relZ * tz;
  const pRt = prz * tx - prx * tz;
  const qRt = qrz * tx - qrx * tz;
  let jt = -vt / (pInvM + qInvM + pRt * pRt * pInvI + qRt * qRt * qInvI);
  const maxJt = friction * jn;
  jt = Math.max(-maxJt, Math.min(maxJt, jt));
  push(p, tx * jt, tz * jt, prx, prz);
  if (q) push(q, -tx * jt, -tz * jt, qrx, qrz);

  return -vn;
}

function push(body: VehiclePhysics, jx: number, jz: number, rx: number, rz: number): void {
  body.vx += jx / body.spec.mass;
  body.vz += jz / body.spec.mass;
  body.yawRate += (rz * jx - rx * jz) / body.spec.inertia;
}
