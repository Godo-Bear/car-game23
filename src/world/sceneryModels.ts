import * as THREE from 'three';

/**
 * Scenery loaded from glTF files: the City Kit buildings (public/models/city) and Tokyo Tower
 * (public/models/landmarks). Worlds are built synchronously, so these are loaded first; if any
 * fail, the procedural buildings and tower are used instead.
 */

const BUILDING_FILES = [
  ...Array.from({ length: 7 }, (_, i) => `large-building-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `low-building-${String(i + 8).padStart(2, '0')}`),
  'low-wide-17',
  'low-wide-18',
  ...Array.from({ length: 6 }, (_, i) => `skyscraper-${i + 19}`),
  ...Array.from({ length: 6 }, (_, i) => `small-building-${i + 25}`),
];

/** The tower stands in the middle of a little diorama in its file; this is the part we keep. */
const TOWER = { file: 'landmarks/tokyo-tower.glb', x: -0.5, z: 1.5, radius: 14.5, minY: 1 };

export interface BuildingPart {
  /** Kit material name: _defaultMat (walls), border, window, door, roof, trim. */
  name: string;
  /** Position + normal, base on y = 0, centred on x/z, model units. */
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
}

export interface BuildingTemplate {
  size: THREE.Vector3;
  parts: BuildingPart[];
}

export interface TowerAsset {
  /** Position, normal, uv; base on y = 0, centred; height 1. */
  geometry: THREE.BufferGeometry;
  map: THREE.Texture;
}

let buildings: BuildingTemplate[] | null = null;
let tower: TowerAsset | null = null;
let loading: Promise<void> | null = null;

export const cityKit = (): BuildingTemplate[] | null => buildings;
export const tokyoTowerAsset = (): TowerAsset | null => tower;

/** Load (once) the scenery models. Never rejects: whatever fails just isn't used. */
export function loadScenery(): Promise<void> {
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const url = (file: string) => new URL(`models/${file}`, document.baseURI).href;
    const [kit, towerGltf] = await Promise.all([
      Promise.all(BUILDING_FILES.map((f) => loader.loadAsync(url(`city/${f}.glb`)).then(building))).catch((e) => {
        console.warn('City Kit buildings could not be loaded; using the built-in ones.', e);
        return null;
      }),
      loader.loadAsync(url(TOWER.file)).catch((e) => {
        console.warn('Tokyo Tower model could not be loaded; using the built-in one.', e);
        return null;
      }),
    ]);
    buildings = kit;
    if (towerGltf) tower = cropTower(towerGltf.scene);
  })();
  return loading;
}

/** Each mesh baked into the building's space, base on the ground and centred. */
function building(gltf: { scene: THREE.Object3D }): BuildingTemplate {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  const parts: BuildingPart[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = o.material as THREE.MeshStandardMaterial;
    const geometry = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.translate(-centre.x, -box.min.y, -centre.z);
    parts.push({ name: material.name, geometry, color: material.color.clone() });
  });
  return { size: box.getSize(new THREE.Vector3()), parts };
}

/** Keep only the tower's triangles, standing on y = 0, one unit tall. */
function cropTower(root: THREE.Object3D): TowerAsset | null {
  root.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!mesh && o instanceof THREE.Mesh) mesh = o;
  });
  if (!mesh) return null;
  const src = mesh as THREE.Mesh;
  const material = src.material as THREE.MeshStandardMaterial;
  if (!material.map) return null;
  const geo = (src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone()).applyMatrix4(src.matrixWorld);
  const pos = geo.getAttribute('position');
  const keep: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    if (cy > TOWER.minY && Math.max(Math.abs(cx - TOWER.x), Math.abs(cz - TOWER.z)) < TOWER.radius) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const data = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((t, k) => {
      for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) data[(k * 3 + v) * a.itemSize + c] = a.getComponent(t + v, c);
    });
    out.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize));
  }
  geo.dispose();
  out.computeBoundingBox();
  const b = out.boundingBox!;
  const h = b.max.y - b.min.y;
  out.translate(-TOWER.x, -b.min.y, -TOWER.z);
  out.scale(1 / h, 1 / h, 1 / h);
  return { geometry: out, map: material.map };
}

/**
 * Tokyo Tower `height` metres tall at (x, y, z). Painted by day and lit up orange at night, so
 * it reads from anywhere on the circuit.
 */
export function tokyoTowerMesh(
  height: number,
  x: number,
  y: number,
  z: number,
): { mesh: THREE.Mesh; setTimeOfDay(night: boolean, sunset: boolean): void } | null {
  if (!tower) return null;
  // The texture outlives worlds; each world gets its own copy of the geometry to dispose.
  tower.map.userData.shared = true;
  const material = new THREE.MeshBasicMaterial({ map: tower.map, fog: false });
  const mesh = new THREE.Mesh(tower.geometry.clone(), material);
  mesh.scale.setScalar(height);
  mesh.position.set(x, y, z);
  mesh.name = 'tokyo-tower';
  mesh.userData.noAO = true;
  return {
    mesh,
    setTimeOfDay(night, sunset) {
      material.color.setRGB(night ? 2.4 : sunset ? 1.25 : 0.95, night ? 1.35 : sunset ? 1.0 : 0.95, night ? 0.75 : sunset ? 0.85 : 0.95);
    },
  };
}
