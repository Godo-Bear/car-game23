import * as THREE from 'three';
import type { TimeOfDay } from '../../shared/api';
import { gridSlot } from '../race/RaceSimulation';
import { tokyoCircuitLandmarks } from '../track/tokyoCircuit';
import { buildTrackVisual, type TrackVisual } from '../track/TrackMesh';
import type { TrackPath } from '../track/TrackPath';
import type { TrackDef } from '../track/tracks';
import { City, placeLamps } from './City';
import { NatureWorld } from './Nature';

/** Everything static around a circuit: the track furniture plus the city or countryside. */
export interface World {
  readonly def: TrackDef;
  readonly group: THREE.Group;
  readonly trackVisual: TrackVisual;
  setTimeOfDay(tod: TimeOfDay): void;
  update(time: number, dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function buildWorld(def: TrackDef, track: TrackPath, rng: () => number): World {
  const group = new THREE.Group();
  group.name = `world-${def.id}`;
  const gridSlots = Array.from({ length: 12 }, (_, i) => gridSlot(track, i));

  if (def.theme === 'city') {
    const lamps = placeLamps(track);
    const trackVisual = buildTrackVisual(track, rng, {
      theme: 'city',
      gridSlots,
      lamps,
      crossings: tokyoCircuitLandmarks(track).crossings,
    });
    const city = new City(track, lamps, rng);
    group.add(trackVisual.group, city.group);
    return {
      def,
      group,
      trackVisual,
      setTimeOfDay(tod) {
        city.setTimeOfDay(tod);
        trackVisual.setTimeOfDay(tod);
      },
      update(time) {
        city.update(time);
      },
      dispose: () => disposeTree(group),
    };
  }

  const trackVisual = buildTrackVisual(track, rng, { theme: def.theme, gridSlots, lamps: [], crossings: [] });
  const nature = new NatureWorld(def.theme, track, rng);
  group.add(trackVisual.group, nature.group);
  return {
    def,
    group,
    trackVisual,
    setTimeOfDay(tod) {
      nature.setTimeOfDay(tod);
      trackVisual.setTimeOfDay(tod);
    },
    update(_time, dt, camera) {
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
  for (const t of textures) t.dispose();
  root.removeFromParent();
}
