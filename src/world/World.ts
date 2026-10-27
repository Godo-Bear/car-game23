import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { RacingLine } from '../ai/RacingLine';
import { gridSlot } from '../race/RaceSimulation';
import { BARRIER_THICKNESS, buildRubberLine, buildTrackVisual, SIDEWALK_WIDTH, type TrackVisual } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import type { TrackDef } from '../track/tracks';
import { City, placeLamps } from './City';
import { windTime } from './foliage';
import { type Feature, MountFuji, powerLines, Railway, trafficSignals, vendingMachines } from './japan';
import { SUN_DIRECTION } from './Lighting';
import { NatureWorld } from './Nature';
import { SCENES } from './scenes';
import { ReflectionStreaks, roadWetness } from './surfaces';

/** Everything static around a circuit: the track furniture plus the city or countryside. */
export interface World {
  readonly def: TrackDef;
  readonly group: THREE.Group;
  readonly trackVisual: TrackVisual;
  setTimeOfDay(tod: TimeOfDay): void;
  /** Graphics detail 0..1 (amount of vegetation) and grass density (0 off .. 2 dense). */
  setDetail(detail: number, grass: 0 | 1 | 2): void;
  /** Lay rubber on the racing line once it has been computed (it arrives from a worker). */
  addRacingLine(line: RacingLine): void;
  update(time: number, dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function buildWorld(def: TrackDef, track: TrackPath, rng: () => number, detail = 1, grass: 0 | 1 | 2 = 1): World {
  const group = new THREE.Group();
  group.name = `world-${def.id}`;
  const gridSlots = Array.from({ length: 12 }, (_, i) => gridSlot(track, i));
  let rubber: THREE.Mesh | null = null;
  const addRacingLine = (line: RacingLine) => {
    if (rubber) return;
    rubber = buildRubberLine(track, line);
    group.add(rubber);
  };

  const scene = SCENES[def.id];
  if (scene.kind === 'city') {
    const lamps = placeLamps(track);
    const crossings = scene.crossings.map(([x, z]) => distanceNear(track, x, z));
    const trackVisual = buildTrackVisual(track, rng, { theme: 'city', banner: def.banner, gridSlots, lamps, crossings });
    // The JR line: a viaduct crossing the circuit north-south (no buildings underneath).
    const rail = scene.rail;
    const city = new City(track, lamps, rng, scene, (x, z, r) => Math.abs(x - rail.x) < r + 9 && z < rail.toZ + 10);
    const proj = { index: 0, lateral: 0, distance: 0, y: 0, heading: 0, slope: 0, tx: 0, tz: 0, rx: 0, rz: 0 };
    const sidewalkEdge = track.wallOffset + BARRIER_THICKNESS + SIDEWALK_WIDTH - 0.5;
    const features: Feature[] = [
      ...(scene.fujiAt ? [new MountFuji(...scene.fujiAt, () => SUN_DIRECTION)] : []),
      new Railway({
        from: [rail.x, -1800],
        to: [rail.x, rail.toZ],
        deckY: 21,
        ground: () => 0,
        kind: 'commuter',
        tunnels: false,
        // Keep piers off the circuit.
        clear: (x, z) => Math.abs(track.project(x, z, -1, proj).lateral) > sidewalkEdge + 2,
      }),
      powerLines(track, { lateral: sidewalkEdge, every: 32, sides: [-1, 1], style: 'concrete', ground: () => 0.14, skip: (i) => track.samples[i].y > 1.2 }),
      vendingMachines(cityVending(track, sidewalkEdge - 0.2), rng),
      trafficSignals(track, crossings, track.wallOffset + BARRIER_THICKNESS + 0.7),
    ];
    for (const f of features) group.add(f.group);
    const lampColor = new THREE.Color(1, 0.8, 0.55).multiplyScalar(0.6);
    const streaks = new ReflectionStreaks([
      ...lamps.map((l) => ({ x: l.x, y: track.samples[l.index].y, z: l.z, color: lampColor, width: 1.6, length: 26 })),
      ...city.streakLights,
    ]);
    group.add(trackVisual.group, city.group, streaks.mesh);
    return {
      def,
      group,
      trackVisual,
      setTimeOfDay(tod) {
        city.setTimeOfDay(tod);
        trackVisual.setTimeOfDay(tod);
        for (const f of features) f.setTimeOfDay?.(tod);
        // Tokyo at night has just had rain: glossy asphalt, puddles and neon reflections.
        roadWetness.value = tod === 'night' ? 1 : 0;
        streaks.mesh.visible = tod === 'night';
      },
      setDetail() {},
      addRacingLine,
      update(time) {
        city.update(time);
        streaks.update(time);
        for (const f of features) f.update?.(time);
      },
      dispose: () => disposeTree(group),
    };
  }

  const trackVisual = buildTrackVisual(track, rng, { theme: def.theme, banner: def.banner, gridSlots, lamps: [], crossings: [] });
  const nature = new NatureWorld(scene, track, rng, detail, grass);
  group.add(trackVisual.group, nature.group);
  return {
    def,
    group,
    trackVisual,
    setTimeOfDay(tod) {
      nature.setTimeOfDay(tod);
      trackVisual.setTimeOfDay(tod);
      roadWetness.value = 0;
    },
    setDetail: (d, g) => nature.setDetail(d, g),
    addRacingLine,
    update(time, dt, camera) {
      windTime.value = time;
      nature.update(time, dt, camera);
    },
    dispose: () => disposeTree(group),
  };
}

/** Free GPU memory for a world that's being replaced. */
function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      if (m instanceof THREE.ShaderMaterial) for (const u of Object.values(m.uniforms)) if (u.value instanceof THREE.Texture) textures.add(u.value);
      m.dispose();
    }
  });
  // Shared textures (detail noise, contact shadows) stay alive for the next world.
  for (const t of textures) if (!t.userData.shared) t.dispose();
  root.removeFromParent();
}

/** Lap distance of the centre-line point nearest (x, z). */
function distanceNear(track: TrackPath, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const s of track.samples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s.dist;
    }
  }
  return best;
}

/** Vending machines in pairs along the sidewalks, facing the road. */
function cityVending(track: TrackPath, lateral: number) {
  const spots = [];
  const S = track.samples;
  let side = 1;
  for (let i = 40; i < S.length; i += 70) {
    const s = S[i];
    if (s.y > 1.2) continue;
    for (const along of [0, 1.05]) {
      spots.push({
        x: s.x + s.rx * side * lateral + s.tx * along,
        y: 0.14,
        z: s.z + s.rz * side * lateral + s.tz * along,
        facing: Math.atan2(-side * s.rx, -side * s.rz),
      });
    }
    side = -side;
  }
  return spots;
}
