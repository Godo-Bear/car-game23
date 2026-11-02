import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math';
import { neutralControls, type VehicleControls } from '../src/physics/VehiclePhysics';
import { ITEM_IDS, type ItemId, placeItemBoxes, ROLL_TIME, rollItem, SPIN_TIME } from '../src/race/Items';
import type { RaceEvent } from '../src/race/RaceManager';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { TrackPath } from '../src/track/TrackPath';
import { TRACKS } from '../src/track/tracks';

const drive = (o: Partial<VehicleControls>): VehicleControls => ({ ...neutralControls(), ...o });
const STEP = RaceSimulation.STEP;

/** A race on the Tokyo circuit with items, started, with every car parked. */
function itemRace(opponents = 3): RaceSimulation {
  const sim = new RaceSimulation(TRACKS.tokyo.layout, { opponents, items: true, seed: 7 });
  sim.startRace();
  return sim;
}

/** Put car `id` on the road at lap distance `d`, `lateral` across, moving at `speed`. */
function put(sim: RaceSimulation, id: number, d: number, lateral = 0, speed = 0): void {
  const car = sim.cars[id];
  const p = sim.track.pointAt(d, lateral);
  car.physics.place(p.x, p.z, p.heading, p.y);
  car.physics.vx = Math.sin(p.heading) * speed;
  car.physics.vz = Math.cos(p.heading) * speed;
  car.physics.gear = speed > 20 ? 3 : 1;
  sim.track.project(p.x, p.z, -1, car.proj, p.y);
}

/** Give car `id` an item, ready to use. */
function give(sim: RaceSimulation, id: number, item: ItemId): void {
  const s = sim.items!.state[id];
  s.held = item;
  s.uses = item === 'ramune3' ? 3 : 1;
  s.rolling = 0;
  s.think = 99;
}

function run(sim: RaceSimulation, seconds: number, input: Partial<VehicleControls> = {}): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) events.push(...sim.step(drive(input)));
  return events;
}

describe('items', () => {
  it('hand the stronger items to the back of the field', () => {
    const rng = createRng(3);
    const count = (pos: number) => {
      const seen = new Map<ItemId, number>();
      for (let i = 0; i < 4000; i++) {
        const id = rollItem(pos, 8, rng);
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      return seen;
    };
    const leader = count(1);
    const last = count(8);
    expect(leader.get('thunder') ?? 0).toBe(0);
    expect(leader.get('lantern') ?? 0).toBe(0);
    expect(leader.get('ramune3') ?? 0).toBe(0);
    expect(last.get('thunder') ?? 0).toBeGreaterThan(200);
    expect((last.get('ramune3') ?? 0) + (last.get('lantern') ?? 0)).toBeGreaterThan(1800);
    // Every item turns up somewhere.
    const all = new Set([...leader.keys(), ...count(4).keys(), ...last.keys()]);
    for (const id of ITEM_IDS) expect(all.has(id)).toBe(true);
  });

  it('puts rows of boxes across the road round every circuit', () => {
    for (const def of Object.values(TRACKS)) {
      const track = new TrackPath(def.layout);
      const boxes = placeItemBoxes(track);
      expect(boxes.length % 5).toBe(0);
      expect(boxes.length).toBeGreaterThanOrEqual(15);
      for (const b of boxes) expect(b.distance).toBeGreaterThan(100);
    }
  });

  it('gives an item for driving through a box, after the roulette', () => {
    const sim = itemRace(0);
    const box = sim.items!.boxes[2];
    put(sim, 0, box.distance - 12, 0, 20);
    const events = run(sim, 0.6 + ROLL_TIME + 0.3, { throttle: 0.3 });
    const s = sim.items!.state[0];
    expect(s.held).not.toBeNull();
    expect(events.some((e) => e.type === 'itemReady')).toBe(true);
    expect(box.backAt).toBeGreaterThan(0);
  });

  it('Ramune Rocket boosts the car', () => {
    const plain = itemRace(0);
    put(plain, 0, 300, 0, 25);
    run(plain, 1.2, { throttle: 1 });
    const sim = itemRace(0);
    put(sim, 0, 300, 0, 25);
    give(sim, 0, 'ramune');
    expect(sim.useItem(sim.player)).toBe(true);
    run(sim, 1.2, { throttle: 1 });
    expect(sim.player.physics.forwardSpeed).toBeGreaterThan(plain.player.physics.forwardSpeed + 3);
    expect(sim.items!.state[0].held).toBeNull();
  });

  it('a Shuriken spins out the car ahead', () => {
    const sim = itemRace(1);
    const [me, rival] = [sim.player, sim.cars.find((c) => !c.isPlayer)!];
    put(sim, me.id, 300, 0, 20);
    put(sim, rival.id, 345, 0, 20);
    rival.autopilot = true;
    give(sim, me.id, 'shuriken');
    sim.useItem(me);
    const events = run(sim, 1.5, { throttle: 0.5 });
    expect(events).toContainEqual({ type: 'itemHit', racerId: rival.id, by: me.id, item: 'shuriken' });
    expect(sim.items!.shots.length).toBe(0);
  });

  it('an Oil Slick dropped behind spins out the car that follows', () => {
    const sim = itemRace(1);
    const [me, rival] = [sim.player, sim.cars.find((c) => !c.isPlayer)!];
    put(sim, me.id, 400, 0, 0);
    give(sim, me.id, 'oil');
    sim.useItem(me);
    expect(sim.items!.slicks.length).toBe(1);
    // The rival comes up from behind, on the same line, and drives over it.
    put(sim, rival.id, 380, 0, 25);
    put(sim, me.id, 470, 3, 0);
    rival.autopilot = true;
    const events = run(sim, 2);
    expect(events.some((e) => e.type === 'itemHit' && e.racerId === rival.id && e.item === 'oil')).toBe(true);
    expect(sim.items!.slicks.length).toBe(0);
  });

  it('a spin-out slows the car right down, then it drives on', () => {
    const sim = itemRace(0);
    put(sim, 0, 300, 0, 40);
    sim.items!.state[0].spin = SPIN_TIME;
    run(sim, SPIN_TIME, { throttle: 1 });
    expect(sim.player.physics.forwardSpeed).toBeLessThan(20);
    expect(sim.items!.state[0].spin).toBe(0);
    const before = sim.player.physics.forwardSpeed;
    run(sim, 1, { throttle: 1 });
    expect(sim.player.physics.forwardSpeed).toBeGreaterThan(before);
  });

  it('a Lucky Cat soaks up one hit', () => {
    const sim = itemRace(1);
    const [me, rival] = [sim.player, sim.cars.find((c) => !c.isPlayer)!];
    put(sim, rival.id, 300, 0, 20);
    put(sim, me.id, 345, 0, 20);
    rival.autopilot = true;
    give(sim, me.id, 'luckycat');
    sim.useItem(me);
    expect(sim.items!.state[me.id].shield).toBeGreaterThan(0);
    give(sim, rival.id, 'shuriken');
    sim.useItem(rival);
    const events = run(sim, 1.5, { throttle: 0.5 });
    expect(events).toContainEqual({ type: 'itemBlocked', racerId: me.id, item: 'shuriken' });
    expect(sim.items!.state[me.id].spin).toBe(0);
    expect(sim.items!.state[me.id].shield).toBe(0);
  });

  it('a Thunder Drum stuns only the cars ahead', () => {
    const sim = itemRace(3);
    const me = sim.player;
    const others = sim.cars.filter((c) => c !== me);
    put(sim, others[0].id, 600, -3, 30);
    put(sim, others[1].id, 560, 3, 30);
    put(sim, me.id, 500, 0, 30);
    put(sim, others[2].id, 450, 0, 30);
    run(sim, STEP);
    give(sim, me.id, 'thunder');
    sim.useItem(me);
    const st = sim.items!.state;
    expect(st[others[0].id].stun).toBeGreaterThan(0);
    expect(st[others[1].id].stun).toBeGreaterThan(0);
    expect(st[others[2].id].stun).toBe(0);
    expect(st[me.id].stun).toBe(0);
  });

  it('a Paper Lantern chases down the car one place ahead', () => {
    const sim = itemRace(2);
    const me = sim.player;
    const [a, b] = sim.cars.filter((c) => c !== me);
    // b leads, a is one place ahead of us, off to the side.
    put(sim, b.id, 700, 0, 30);
    put(sim, a.id, 420, -4, 30);
    put(sim, me.id, 330, 3, 30);
    a.autopilot = true;
    b.autopilot = true;
    run(sim, STEP);
    give(sim, me.id, 'lantern');
    sim.useItem(me);
    expect(sim.items!.shots[0].target).toBe(a.id);
    const events = run(sim, 4, { throttle: 0.6 });
    expect(events.some((e) => e.type === 'itemHit' && e.racerId === a.id && e.item === 'lantern')).toBe(true);
  });

  it('only races set up with items have them (career events and free drive have none)', () => {
    const plain = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 3, seed: 7 });
    plain.startRace();
    expect(plain.items).toBeNull();
    expect(plain.useItem(plain.player)).toBe(false);
    // Not before the start either.
    const sim = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 1, items: true, seed: 7 });
    give(sim, sim.player.id, 'ramune');
    expect(sim.useItem(sim.player)).toBe(false);
    sim.startRace();
    expect(sim.useItem(sim.player)).toBe(true);
  });

  it('a whole race with items runs to the finish, with the AI using them', () => {
    const sim = new RaceSimulation(TRACKS.tokyo.layout, { opponents: 7, items: true, laps: 1, seed: 11 });
    for (const c of sim.cars) c.autopilot = true;
    sim.startRace();
    let used = 0;
    let hits = 0;
    for (let t = 0; t < 240 && !sim.race.racers.every((r) => r.finished); t += STEP) {
      for (const e of sim.step(neutralControls())) {
        if (e.type === 'itemUse') used++;
        if (e.type === 'itemHit') hits++;
      }
    }
    expect(sim.race.racers.every((r) => r.finished)).toBe(true);
    expect(used).toBeGreaterThan(8);
    expect(hits).toBeGreaterThan(0);
  }, 60_000);
});
