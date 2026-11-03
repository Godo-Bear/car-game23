import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { CityPeople } from '../src/world/CityPeople';
import { CityTraffic } from '../src/world/CityTraffic';
import { PAVEMENT, StreetField, streetApproaches, streetJunctions } from '../src/world/cityPlan';
import { SCENES } from '../src/world/scenes';
import { cityStreets } from '../src/world/World';

const scene = SCENES.freeroam;
if (scene.kind !== 'rural' || !scene.city || !scene.cityRadius) throw new Error('no city');
const streets = cityStreets(scene.cityRadius, scene.city).streets;
const field = new StreetField(streets);
const DT = 1 / 30;
const junctions = streetJunctions(streets, field);
/** Traffic lights at every main-road junction (as StreetFurniture puts them). */
const signals: { x: number; z: number; a: number; b: number }[] = [];
junctions.forEach((J, k) =>
  J.forEach((j) => {
    if (j.kind !== 'signal' || k > j.j) return;
    const p = field.at(k, (j.a + j.b) / 2);
    signals.push({ x: p.x, z: p.z, a: k, b: j.j });
  }),
);
interface CarState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  k: number;
  s: number;
  dir: number;
  model: number;
  turn: unknown;
  served: number;
  off: number;
}
const carsOf = (t: CityTraffic) => (t as unknown as { cars: CarState[] }).cars;

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

describe('city traffic, driving properly', () => {
  it('turns at junctions on smooth curves: no jumps, no snapping round, never off the road', () => {
    const traffic = new CityTraffic(streets, signals, 50, createRng(31));
    const cars = carsOf(traffic);
    const me = { x: 300, z: -100 };
    let prev = cars.map((c) => ({ x: c.x, z: c.z, h: c.heading, k: c.k }));
    let turns = 0;
    let respawns = 0;
    for (let t = 0; t < 90; t += DT) {
      traffic.update(DT, me, t);
      cars.forEach((c, i) => {
        const p = prev[i];
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        // (Far-off cars come back near you: a big jump that isn't driving.)
        if (d > 60) {
          respawns++;
          return;
        }
        expect(d).toBeLessThan(c.speed * DT + 0.6);
        let dh = Math.abs(c.heading - p.h);
        if (dh > Math.PI) dh = Math.PI * 2 - dh;
        expect(dh).toBeLessThan(0.45);
        if (c.k !== p.k) turns++;
        expect(field.edge(c.x, c.z, 5)).toBeLessThan(0.8);
      });
      prev = cars.map((c) => ({ x: c.x, z: c.z, h: c.heading, k: c.k }));
    }
    expect(turns).toBeGreaterThan(40);
    expect(respawns).toBeLessThan(200);
  });

  it('stops for someone crossing in front of it', () => {
    const traffic = new CityTraffic(streets, [], 1, createRng(9));
    traffic.update(DT, { x: 9999, z: 9999 }, 0);
    const c = carsOf(traffic)[0];
    // Someone standing in its lane 25 m ahead.
    const walker = { x: c.x + Math.sin(c.heading) * 25, z: c.z + Math.cos(c.heading) * 25 };
    for (let t = 0; t < 8; t += DT) traffic.update(DT, { x: 9999, z: 9999 }, t, [walker]);
    expect(Math.hypot(c.x - walker.x, c.z - walker.z)).toBeGreaterThan(3);
    expect(c.speed).toBeLessThan(0.5);
  });

  it('gives way at the 止まれ lines: a stop, then on', () => {
    const traffic = new CityTraffic(streets, signals, 60, createRng(5));
    const cars = carsOf(traffic);
    const served = new Set<string>();
    for (let t = 0; t < 120; t += DT) {
      traffic.update(DT, { x: 400, z: 300 }, t);
      cars.forEach((c, i) => {
        if (!Number.isNaN(c.served)) served.add(`${i}:${c.served}`);
      });
    }
    expect(served.size).toBeGreaterThan(5);
  });

  it('runs buses that stop at the bus stops', () => {
    const stops = [0, 1, 2, 3, 4, 5, 6, 8, 9].flatMap((k) =>
      [100, 250, 400, 550, 700, 850, 1000].flatMap((s) => [
        { k, s, side: -1 as const },
        { k, s: s + 40, side: 1 as const },
      ]),
    );
    const traffic = new CityTraffic(streets, signals, 200, createRng(12), stops);
    const buses = carsOf(traffic).filter((c) => c.model === 7);
    expect(buses.length).toBeGreaterThan(0);
    // Buses keep to the main roads.
    for (const b of buses) expect(streets[b.k].width).toBeGreaterThanOrEqual(14);
    let stopped = 0;
    for (let t = 0; t < 120; t += DT) {
      traffic.update(DT, { x: 0, z: 0 }, t);
      stopped += traffic.busesAt.size;
    }
    expect(stopped).toBeGreaterThan(60);
    for (const b of buses) expect(streets[b.k].width).toBeGreaterThanOrEqual(12);
  });

  it('honks when you sit in its way', () => {
    const traffic = new CityTraffic(streets, [], 1, createRng(9));
    traffic.update(DT, { x: 9999, z: 9999 }, 0);
    const c = carsOf(traffic)[0];
    const me = { x: c.x + Math.sin(c.heading) * 12, z: c.z + Math.cos(c.heading) * 12 };
    let horns = 0;
    for (let t = 0; t < 10; t += DT) {
      traffic.update(DT, me, t);
      horns += traffic.horns.length;
    }
    expect(horns).toBeGreaterThan(0);
  });
});

describe('the junctions', () => {
  it('puts the zebra crossing between the stop line and the junction', () => {
    let checked = 0;
    junctions.forEach((J, k) => {
      for (const A of streetApproaches(J, field.length(k))) {
        if (A.stop === null) continue;
        // The stop line is before the junction, coming this way.
        expect((A.at - A.stop) * A.g).toBeGreaterThan(2);
        if (A.zebra) {
          const mid = (A.zebra[0] + A.zebra[1]) / 2;
          expect((A.at - mid) * A.g).toBeGreaterThan(0);
          expect((mid - A.stop) * A.g).toBeGreaterThan(0);
        }
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(50);
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

  it('cross at the zebra crossings, waiting for the green man at the lights', () => {
    const people = new CityPeople(streets, 150, createRng(47), { signals });
    const at = (people as unknown as { walkers: { mode: string; light: { road: string } | null; x: number; z: number }[] }).walkers;
    const was = at.map((w) => w.mode);
    let crossed = 0;
    let lit = 0;
    for (let t = 0; t < 120; t += DT) {
      people.update(DT, t, { x: 300, z: -100, speed: 0 });
      at.forEach((w, i) => {
        if (was[i] !== 'cross' && w.mode === 'cross') {
          crossed++;
          if (w.light) {
            lit++;
            // Only while the street's traffic has a red.
            const c = t % 24;
            const green = w.light.road === 'a' ? c < 11 : c >= 12 && c < 23;
            expect(green).toBe(false);
          }
        }
        was[i] = w.mode;
      });
      // Out in the road: the traffic is told.
      for (const p of people.inRoad) expect(field.edge(p.x, p.z, 5)).toBeLessThan(1.5);
    }
    expect(crossed).toBeGreaterThan(20);
    expect(lit).toBeGreaterThan(0);
  });

  it('wait at the bus stops and get on the bus', () => {
    const stops = [0, 1, 2, 8].map((k) => ({ k, s: 300, side: -1 as const }));
    const people = new CityPeople(streets, 120, createRng(8), { busStops: stops });
    const at = (people as unknown as { walkers: { mode: string; stop: number }[] }).walkers;
    expect(at.some((w) => w.mode === 'busWait')).toBe(true);
    const waiting = at.filter((w) => w.mode === 'busWait').map((w) => w.stop);
    let boarded = 0;
    for (let t = 0; t < 6; t += DT) {
      people.update(DT, t, { x: 0, z: 0, speed: 0 }, new Set(waiting));
      boarded = Math.max(boarded, at.filter((w) => w.mode === 'board').length);
    }
    expect(boarded).toBeGreaterThan(0);
  });
});
