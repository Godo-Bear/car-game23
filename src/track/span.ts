import { mod } from '../core/math';

/** Is lap distance `d` within the stretch from `a` going forward round the lap to `b`? */
export function inSpan(d: number, a: number, b: number, L: number): boolean {
  return mod(d - a, L) <= mod(b - a, L);
}
