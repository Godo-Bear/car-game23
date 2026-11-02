import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { CityPeople } from '../src/world/CityPeople';
import { CityTraffic } from '../src/world/CityTraffic';
import { PAVEMENT, StreetField } from '../src/world/cityPlan';
import { SCENES } from '../src/world/scenes';
import { cityStreets } from '../src/world/World';

const scene = SCENES.freeroam;
if (scene.kind !== 'rural' || !scene.city || !scene.cityRadius) throw new Error('no city');
const streets = cityStreets(scene.cityRadius, scene.city).streets;
const field = new StreetField(streets);
const DT = 1 / 30;

describe('city traffic', () => {
  it('drives on the roads, in the left lane, and gathers round you', () => {
    const traffic = new CityTraffic(streets, [], 40, createRng(3));
    const me = { x: 300, z: -100 };
    for (let t = 0; t < 30; t += DT) traffic.update(DT, me, t);
    let near = 0;
    for (const b of traffic.boxes) {
      // On a road surface (its middle within a street's width).
      expect(field.edge(b.x, b.z, 5)).toBeLessThan(0.5);
      if (Math.hypot(b.x - me.x, b.z - me.z) < 460) near++;
    }
    expect(near).toBeGreaterThan(30);
  });

  it('stops behind your car instead of driving into it', () => {
    const traffic = new CityTraffic(streets, [], 1, createRng(9));
    traffic.update(DT, { x: 9999, z: 9999 }, 0);
    // Park yourself 25 m in front of it.
    const b = traffic.boxes[0];
    const me = { x: b.x + Math.sin(b.angle) * 25, z: b.z + Math.cos(b.angle) * 25 };
    for (let t = 0; t < 8; t += DT) traffic.update(DT, me, t);
    const after = traffic.boxes[0];
    expect(Math.hypot(after.x - me.x, after.z - me.z)).toBeGreaterThan(3);
  });

  it('waits at a red light on a main road', () => {
    // A junction straight ahead on the car's street, its light red (road b only is green).
    const traffic = new CityTraffic(streets, [], 1, createRng(9));
    traffic.update(DT, { x: 9999, z: 9999 }, 0);
    const b = traffic.boxes[0];
    const jx = b.x + Math.sin(b.angle) * 40;
    const jz = b.z + Math.cos(b.angle) * 40;
    const k = field.nearest(b.x, b.z, 10)!.k;
    const red = new CityTraffic(streets, [{ x: jx, z: jz, a: -1, b: k }], 1, createRng(9));
    red.update(DT, { x: 9999, z: 9999 }, 11.5);
    for (let t = 0; t < 4; t += DT) red.update(DT, { x: 9999, z: 9999 }, 11.5 + 0 * t);
    const r = red.boxes[0];
    // Stopped short of the junction.
    expect(Math.hypot(r.x - jx, r.z - jz)).toBeGreaterThan(8);
  });
});

describe('city people', () => {
  it('walk the pavements and step aside for a car', () => {
    const people = new CityPeople(streets, 60, createRng(4));
    const car = { x: 0, z: 0, speed: 0 };
    for (let t = 0; t < 10; t += DT) people.update(DT, t, car);
    const at = (people as unknown as { walkers: { x: number; z: number; dodge: number }[] }).walkers;
    // On the pavements (or stepped back from them a little); only crossing a side street at a
    // junction puts anyone in a road.
    let inRoad = 0;
    for (const w of at) {
      const e = field.edge(w.x, w.z, 6);
      if (e < -0.2) inRoad++;
      expect(e).toBeLessThan(PAVEMENT + 3);
    }
    expect(inRoad).toBeLessThan(at.length * 0.15);
    // A car coming at one of them: they step back.
    const w = at[0];
    const close = { x: w.x + 1, z: w.z, speed: 15 };
    for (let t = 0; t < 0.5; t += DT) people.update(DT, 10 + t, close);
    expect(at[0].dodge).toBeGreaterThan(1.5);
  });
});
