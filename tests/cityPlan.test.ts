import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { corners, overlaps, PAVEMENT, planCity, StreetField } from '../src/world/cityPlan';
import { SCENES } from '../src/world/scenes';
import { cityStreets } from '../src/world/World';

describe('the free drive city plan', () => {
  const scene = SCENES.freeroam;
  if (scene.kind !== 'rural' || !scene.city || !scene.cityRadius) throw new Error('no city');
  const R = scene.cityRadius;
  const streets = cityStreets(R, scene.city).streets;
  const reserved = [{ ...scene.city.tower, r: 52 }];
  const t0 = performance.now();
  const plan = planCity(streets, R, reserved, createRng(5));
  const ms = performance.now() - t0;
  const field = new StreetField(streets);

  it('fills every district, quickly', () => {
    const count = (d: string) => plan.lots.filter((l) => l.district === d).length;
    console.log(
      `lots ${plan.lots.length} (downtown ${count('downtown')}, commercial ${count('commercial')}, residential ${count('residential')}, outer ${count('outer')}, houses ${plan.lots.filter((l) => l.house).length}) parks ${plan.parks.length} in ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(8000);
    expect(plan.parks.length).toBeGreaterThanOrEqual(6);
    for (const d of ['downtown', 'commercial', 'residential', 'outer']) expect(count(d)).toBeGreaterThan(50);
  });

  it('keeps buildings off the streets, the parks, the landmarks and each other', () => {
    for (const l of plan.lots) {
      for (const [x, z] of corners(l)) expect(field.edge(x, z, 10)).toBeGreaterThan(PAVEMENT);
      for (const p of plan.parks) expect(Math.hypot(l.x - p.x, l.z - p.z)).toBeGreaterThan(p.r);
      expect(Math.hypot(l.x - reserved[0].x, l.z - reserved[0].z)).toBeGreaterThan(reserved[0].r);
    }
    // (A sample of pairs: every lot against its neighbours.)
    for (let i = 0; i < plan.lots.length; i += 7) {
      const a = plan.lots[i];
      for (const b of plan.lots) if (b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 80) expect(overlaps(a, b, 0)).toBe(false);
    }
  });

  it('faces every lot to its street and sizes towers by district', () => {
    for (const l of plan.lots) {
      // The street is just in front.
      const fx = l.x + l.fx * (l.d / 2 + PAVEMENT + 1.5 + l.layer * 40);
      const fz = l.z + l.fz * (l.d / 2 + PAVEMENT + 1.5 + l.layer * 40);
      if (l.layer === 0) expect(field.edge(fx, fz, 10)).toBeLessThan(1);
    }
    const tallest = Math.max(...plan.lots.map((l) => l.h));
    expect(tallest).toBeGreaterThan(150);
    // Further out they're medium-sized: well below downtown, but proper blocks, not huts.
    const median = (d: string) => {
      const hs = plan.lots
        .filter((l) => l.district === d && !l.house)
        .map((l) => l.h)
        .sort((a, b) => a - b);
      return hs[hs.length >> 1];
    };
    console.log(
      `median heights: downtown ${median('downtown')}, commercial ${median('commercial')}, residential ${median('residential')}, outer ${median('outer')}`,
    );
    for (const d of ['commercial', 'residential', 'outer']) {
      expect(median(d)).toBeGreaterThanOrEqual(20);
      expect(median(d)).toBeLessThan(median('downtown') * 0.6);
    }
    expect(Math.max(...plan.lots.filter((l) => l.district === 'outer').map((l) => l.h))).toBeLessThan(50);
    expect(plan.lots.filter((l) => l.house).length).toBeLessThan(plan.lots.length * 0.05);
  });
});
