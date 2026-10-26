import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import type { RacingLine } from '../ai/RacingLine';
import { gridSlot } from '../race/RaceSimulation';
import { buildRubberLine, buildTrackVisual, type TrackVisual } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import { tokyoCircuitLandmarks } from '../track/tokyoCircuit';
import type { TrackDef } from '../track/tracks';
import { City, placeLamps } from './City';
import { windTime } from './foliage';
import { NatureWorld } from './Nature';
import { ReflectionStreaks, roadWetness } from './surfaces';

/** Everything static around a circuit: the track furniture plus the city or countryside. */
export interface World {
  readonly def: TrackDef;
  readonly group: THREE.Group;
  readonly trackVisual: TrackVisual;
  setTimeOfDay(tod: TimeOfDay): void;
  /** Graphics detail 0..1 (amount of vegetation). */
  setDetail(detail: number): void;
  /** Lay rubber on the racing line once it has been computed (it arrives from a worker). */
  addRacingLine(line: RacingLine): void;
  update(time: number, dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function buildWorld(def: TrackDef, track: TrackPath, rng: () => number, detail = 1): World {
  const group = new THREE.Group();
  group.name = `world-${def.id}`;
  const gridSlots = Array.from({ length: 12 }, (_, i) => gridSlot(track, i));
  let rubber: THREE.Mesh | null = null;
  const addRacingLine = (line: RacingLine) => {
    if (rubber) return;
    rubber = buildRubberLine(track, line);
    group.add(rubber);
  };

  if (def.theme === 'city') {
    const lamps = placeLamps(track);
    const trackVisual = buildTrackVisual(track, rng, {
      theme: 'city',
      gridSlots,
      lamps,
      crossings: tokyoCircuitLandmarks(track).crossings,
    });
    const city = new City(track, lamps, rng);
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
        // Tokyo at night has just had rain: glossy asphalt, puddles and neon reflections.
        roadWetness.value = tod === 'night' ? 1 : 0;
        streaks.mesh.visible = tod === 'night';
      },
      setDetail() {},
      addRacingLine,
      update(time) {
        city.update(time);
        streaks.update(time);
      },
      dispose: () => disposeTree(group),
    };
  }

  const trackVisual = buildTrackVisual(track, rng, { theme: def.theme, gridSlots, lamps: [], crossings: [] });
  const nature = new NatureWorld(def.theme, track, rng, detail);
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
    setDetail: (d) => nature.setDetail(d),
    addRacingLine,
    update(time, dt, camera) {
      windTime.value = time;
      nature.update(dt, camera);
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
