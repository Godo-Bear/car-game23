import * as THREE from 'three';
import type { CarId, CarSetup } from '../../shared/api';
import { type BodyDef, CARS } from './cars';
import { flipWinding, mergeAll } from './meshUtils';

/**
 * Car bodies loaded from glTF files (public/models/<car>/car.glb) in place of the built-in
 * ones. Each model is normalised to the car's frame (+z forward, +y up, tyres on y = 0, axles
 * where the physics has them, scaled to the built-in body's length) and split into parts by
 * role, so the paint, rims, liveries and number plates stay customisable whatever the file.
 * A model that fails to load just leaves the built-in body in place.
 */

export type PartRole = 'paint' | 'glass' | 'light' | 'brake' | 'trim' | 'chrome' | 'rims' | 'other';

interface WheelCut {
  /** |x| of the inner and outer faces of the tyres. */
  inner: number;
  outer: number;
  /** Hub height, front and rear hub z, and tyre radius. */
  y: number;
  z: [front: number, rear: number];
  radius: number;
}

interface ModelDef {
  /** Under public/models/. */
  file: string;
  /** Shown in the garage (most free models ask for a credit). */
  credit: string;
  /** Material name -> role; the first match wins and anything unmatched keeps its own colours. */
  roles: [RegExp, PartRole][];
  /** Nodes to leave out: brand badges and the model's own number plates. */
  hide?: RegExp;
  /** Turn the model to face +z (radians about y). */
  turn?: number;
  /** Nodes holding the four wheels (they spin and steer). */
  wheels?: RegExp;
  /** Wheels moulded into the body mesh (model units): cut out and replaced by the game's own. */
  wheelCut?: WheelCut;
  /** Use the game's own wheels (so the rim colour can change) instead of the model's. */
  ownWheels?: boolean;
  /** The paint colour baked into the texture, so it can be swapped for the player's. */
  paintKey?: string;
  /** Number plate heights in metres, where the automatic guess is off. */
  plateY?: [front: number, rear: number];
}

/** The model files. Cars without one use their built-in body. */
export const CAR_MODELS: Partial<Record<CarId, ModelDef>> = {
  gt: {
    file: 'gt/car.glb',
    credit: 'Model: "Chevrolet Camaro" by PuKkBuMXDD (Poly Pizza)',
    roles: [
      [/^bodywork$/, 'paint'],
      [/^glass$/, 'glass'],
      [/^lights$/, 'light'],
      [/^back_lights$/, 'brake'],
      [/^kidney$/, 'rims'],
      [/^(rubber|black|bottom|mesh|plastic|back_plate)$/, 'trim'],
    ],
    hide: /logo|front_plate/,
    wheels: /^wheel_/,
  },
  hatch: {
    file: 'hatch/car.glb',
    credit: 'Model: "Convertible" by Poly by Google (CC-BY)',
    roles: [[/^Convertible_mat1$/, 'paint']],
    wheelCut: { inner: 1.45, outer: 1.86, y: 0.86, z: [3.308, -3.185], radius: 0.9 },
    paintKey: '#053563',
  },
  drift: {
    file: 'drift/car.glb',
    credit: 'Model: "Mazda RX-7" by IvOfficial (Poly Pizza)',
    roles: [
      [/^Body_paint$/, 'paint'],
      [/^Glass$/, 'glass'],
      [/^Emission/, 'light'],
      [/^Rims$/, 'rims'],
      [/^Black_matte$/, 'trim'],
    ],
    hide: /^Logos$/,
    wheels: /_WHEEL$/,
  },
  super: {
    file: 'super/car.glb',
    credit: 'Model: "Lamborghini Aventador" by Ignition Labs (Poly Pizza)',
    roles: [
      [/BodySG$/, 'paint'],
      [/GlassSG$/, 'glass'],
    ],
    wheels: /_Wheel_/,
    ownWheels: true,
    paintKey: '#ffc302',
  },
};

export interface AssetPart {
  geometry: THREE.BufferGeometry;
  role: PartRole;
  /** The part's own material (role 'other' only). */
  material?: THREE.Material;
}

export interface AssetWheel {
  /** Hub position in the car's frame. */
  centre: THREE.Vector3;
  radius: number;
  front: boolean;
  /** Tyre and rim around the hub; empty means "use the game's own wheel". */
  parts: AssetPart[];
}

/** Where the livery goes on this body (car frame, metres). */
export interface LiveryFrame {
  /** |x| range of the twin bonnet-to-boot stripes. */
  stripe: [number, number];
  /** Centre height of the side stripe. */
  belt: number;
  /** Centre height and z range of the sill band. */
  sill: [y: number, from: number, to: number];
  /** Door numbers: z, centre height, size. */
  door: [z: number, y: number, size: number];
  /** Bonnet number: z and size. */
  bonnet: [z: number, size: number];
}

export interface CarAsset {
  body: AssetPart[];
  wheels: AssetWheel[];
  /** Texture the paint is baked into (recoloured in the shader), if any. */
  paintMap: THREE.Texture | null;
  /** Hue and value (HSV, sRGB) of the baked-in paint. */
  paintKey: [hue: number, value: number] | null;
  front: number;
  rear: number;
  width: number;
  /** Front and rear plate centres (the rear one faces backwards). */
  plates: [THREE.Vector3, THREE.Vector3];
  livery: LiveryFrame;
  credit: string;
}

const pending = new Map<CarId, Promise<CarAsset | null>>();
const assets = new Map<CarId, CarAsset | null>();
const listeners: ((id: CarId) => void)[] = [];

/** The car's loaded model, or null (not loaded yet, failed, or the car has none). */
export function carAsset(id: CarId): CarAsset | null {
  return assets.get(id) ?? null;
}

/** Called whenever a model finishes loading (cars already on screen can swap their body). */
export function onCarAssetLoaded(fn: (id: CarId) => void): void {
  listeners.push(fn);
}

export function loadCarAsset(id: CarId): Promise<CarAsset | null> {
  const def = CAR_MODELS[id];
  if (!def) return Promise.resolve(null);
  let promise = pending.get(id);
  if (!promise) {
    promise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(new URL(`models/${def.file}`, document.baseURI).href);
        return prepare(gltf.scene, def, CARS[id].body);
      } catch (e) {
        console.warn(`Car model ${def.file} could not be used; keeping the built-in body.`, e);
        return null;
      }
    })().then((asset) => {
      assets.set(id, asset);
      if (asset) for (const fn of listeners) fn(id);
      return asset;
    });
    pending.set(id, promise);
  }
  return promise;
}

/** Start loading every car model in the background. */
export function preloadCarAssets(): void {
  for (const id of Object.keys(CAR_MODELS) as CarId[]) void loadCarAsset(id);
}

interface Piece {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  role: PartRole;
  /** The wheel node this piece belongs to, if any. */
  wheel: THREE.Object3D | null;
}

/** A non-indexed copy with plain float attributes (only `names`), ready to cut, bake and merge. */
function plain(geo: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  const index = geo.index;
  const count = index ? index.count : geo.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const data = new Float32Array(count * a.itemSize);
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      data[i * a.itemSize] = a.getX(v);
      if (a.itemSize > 1) data[i * a.itemSize + 1] = a.getY(v);
      if (a.itemSize > 2) data[i * a.itemSize + 2] = a.getZ(v);
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize));
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** Drop the triangles of wheels moulded into the body (every corner inside a tyre). */
function cutWheels(geo: THREE.BufferGeometry, cut: WheelCut): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const inside = (i: number) => {
    const x = Math.abs(pos.getX(i));
    return x >= cut.inner && x <= cut.outer && cut.z.some((z) => Math.hypot(pos.getZ(i) - z, pos.getY(i) - cut.y) <= cut.radius);
  };
  const keep: number[] = [];
  for (let t = 0; t < pos.count; t += 3) if (!(inside(t) && inside(t + 1) && inside(t + 2))) keep.push(t);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize;
    const src = attr.array as Float32Array;
    const data = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, k) => data.set(src.subarray(t * n, (t + 3) * n), k * 3 * n));
    out.setAttribute(name, new THREE.BufferAttribute(data, n));
  }
  geo.dispose();
  return out;
}

/** Merge pieces that share a material; `uv` keeps (or pads) texture coordinates. */
function mergeParts(list: THREE.BufferGeometry[], uv: boolean): THREE.BufferGeometry {
  for (const g of list) {
    if (!uv) g.deleteAttribute('uv');
    else if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  return list.length === 1 ? list[0] : mergeAll(list);
}

function hsvKey(hex: string): [number, number] {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  const rgb = c.clone().convertLinearToSRGB();
  return [hsl.h, Math.max(rgb.r, rgb.g, rgb.b)];
}

function prepare(root: THREE.Object3D, def: ModelDef, body: BodyDef): CarAsset {
  const hidden: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && def.hide?.test(o.name)) hidden.push(o);
  });
  for (const o of hidden) o.removeFromParent();
  if (def.turn) root.rotation.y += def.turn;
  root.updateMatrixWorld(true);

  // Every mesh baked into model space, tagged with its role and wheel.
  const pieces: Piece[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // The outermost match: a wheel node's meshes and primitives often repeat its name.
    let wheel: THREE.Object3D | null = null;
    for (let p: THREE.Object3D | null = o; p && def.wheels; p = p.parent) if (def.wheels.test(p.name)) wheel = p;
    const material = o.material as THREE.MeshStandardMaterial;
    let geometry = plain(o.geometry, ['position', 'normal', 'uv']).applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) flipWinding(geometry);
    if (def.wheelCut) geometry = cutWheels(geometry, def.wheelCut);
    let role = def.roles.find(([re]) => re.test(material.name))?.[1] ?? 'other';
    if (role === 'rims' && !wheel) role = 'chrome';
    pieces.push({ geometry, material, role, wheel });
  });

  // Hubs, in model space.
  type Hub = { centre: THREE.Vector3; radius: number; node: THREE.Object3D | null };
  let hubs: Hub[];
  if (def.wheelCut) {
    const c = def.wheelCut;
    const x = (c.inner + c.outer) / 2;
    hubs = c.z.flatMap((z) => [1, -1].map((side) => ({ centre: new THREE.Vector3(side * x, c.y, z), radius: c.radius, node: null })));
  } else {
    const nodes = [...new Set(pieces.map((p) => p.wheel).filter((w) => w !== null))];
    hubs = nodes.map((node) => {
      const box = new THREE.Box3();
      for (const p of pieces) {
        if (p.wheel !== node) continue;
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox!);
      }
      return { centre: box.getCenter(new THREE.Vector3()), radius: (box.max.y - box.min.y) / 2, node };
    });
  }
  if (hubs.length !== 4) throw new Error(`expected 4 wheels, found ${hubs.length}`);

  // Scale to the built-in body's length; put the axles where the physics has them.
  const box = new THREE.Box3();
  for (const p of pieces) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const zs = body.profile.map(([z]) => z);
  const s = (Math.max(...zs) - Math.min(...zs)) / (box.max.z - box.min.z);
  const hubZ = hubs.map((h) => h.centre.z);
  const axleMid = (Math.max(...hubZ) + Math.min(...hubZ)) / 2;
  const xMid = hubs.reduce((sum, h) => sum + h.centre.x, 0) / 4;
  const ground = Math.min(...hubs.map((h) => h.centre.y - h.radius));
  const norm = new THREE.Matrix4()
    .makeTranslation(0, 0, (body.frontAxle + body.rearAxle) / 2)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-xMid, -ground, -axleMid));
  for (const p of pieces) p.geometry.applyMatrix4(norm);
  for (const h of hubs) {
    h.centre.applyMatrix4(norm);
    h.radius *= s;
  }
  box.applyMatrix4(norm);

  const paintPiece = def.paintKey ? pieces.find((p) => p.role === 'paint' && p.material.map) : undefined;
  const paintMap = paintPiece?.material.map ?? null;
  const own = new Map<THREE.Material, THREE.Material>();
  const ownMaterial = (src: THREE.MeshStandardMaterial) => {
    let m = own.get(src);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ name: src.name, color: src.color, map: src.map, roughness: 0.6, metalness: 0.1 });
      own.set(src, m);
    }
    return m;
  };

  /** Merge pieces by material: one draw call per role (and per material for the rest). */
  const group = (list: Piece[], offset?: THREE.Vector3): AssetPart[] => {
    const byKey = new Map<string, Piece[]>();
    for (const p of list) {
      const key = p.role === 'other' ? p.material.uuid : p.role;
      byKey.set(key, [...(byKey.get(key) ?? []), p]);
    }
    return [...byKey.values()].map((same) => {
      const { role, material } = same[0];
      const uv = role === 'paint' ? paintMap !== null : role === 'other' && material.map !== null;
      const geometry = mergeParts(
        same.map((p) => p.geometry),
        uv,
      );
      if (offset) geometry.translate(-offset.x, -offset.y, -offset.z);
      return role === 'other' ? { geometry, role, material: ownMaterial(material) } : { geometry, role };
    });
  };

  const bodyPieces = pieces.filter((p) => !p.wheel);
  const front = box.max.z;
  const rear = box.min.z;
  const frontAxle = Math.max(...hubs.map((h) => h.centre.z));
  const rearAxle = Math.min(...hubs.map((h) => h.centre.z));
  const wheels: AssetWheel[] = hubs.map((h) => ({
    centre: h.centre,
    radius: h.radius,
    front: h.centre.z > (frontAxle + rearAxle) / 2,
    parts:
      def.ownWheels || !h.node
        ? []
        : group(
            pieces.filter((p) => p.wheel === h.node),
            h.centre,
          ),
  }));
  for (const p of pieces) if (p.wheel && (def.ownWheels || !hubs.some((h) => h.node === p.wheel))) p.geometry.dispose();

  // Number plates: on the bumpers, found by casting rays at them.
  const rayMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const solidPieces = bodyPieces.filter((p) => p.role !== 'glass');
  const solid = solidPieces.map((p) => new THREE.Mesh(p.geometry, rayMaterial));
  const ray = new THREE.Raycaster();
  const frontR = wheels.find((w) => w.front)!.radius;
  const [frontY, rearY] = def.plateY ?? [frontR * 1.05, frontR * 1.55];
  const surface = (y: number, dir: 1 | -1, fallback: number) => {
    ray.set(new THREE.Vector3(0, y, fallback - dir * 1), new THREE.Vector3(0, 0, dir));
    return (ray.intersectObjects(solid)[0]?.point.z ?? fallback) - dir * 0.012;
  };
  const plates: [THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(0, frontY, surface(frontY, -1, front)),
    new THREE.Vector3(0, rearY, surface(rearY, 1, rear)),
  ];

  // The flank at the doors, felt for with rays from the side: its top is the shoulder line and
  // its bottom the sill (the middle of three slices, so a mirror can't skew it).
  const width = box.max.x - box.min.x;
  const wheelbase = frontAxle - rearAxle;
  const doorZ = (frontAxle + rearAxle) / 2 + wheelbase * 0.08;
  const paint = new Set<THREE.Object3D>(solid.filter((_, i) => solidPieces[i].role === 'paint'));
  const slices = [-0.2, 0, 0.2].map((dz) => {
    let top = -Infinity;
    let bottom = Infinity;
    for (let y = 0.05; y < box.max.y; y += 0.03) {
      ray.set(new THREE.Vector3(box.max.x + 1, y, doorZ + dz), new THREE.Vector3(-1, 0, 0));
      const hit = ray.intersectObjects(solid)[0];
      if (!hit || !paint.has(hit.object) || hit.point.x < width * 0.38 || Math.abs(hit.face!.normal.x) < 0.5) continue;
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
    }
    return [top, bottom];
  });
  const middle = (k: 0 | 1) => slices.map((sl) => sl[k]).sort((a, b) => a - b)[1];
  let shoulder = middle(0);
  let sill = middle(1);
  if (!Number.isFinite(shoulder) || shoulder - sill < 0.2) [shoulder, sill] = [box.max.y * 0.62, frontR * 0.8];
  rayMaterial.dispose();
  const wheelR = Math.max(...hubs.map((h) => h.radius));
  const livery: LiveryFrame = {
    stripe: [0.06 * (width / 1.88), 0.34 * (width / 1.88)],
    belt: shoulder - 0.12,
    sill: [sill + 0.08, rearAxle + wheelR * 1.2, frontAxle - wheelR * 1.2],
    door: [doorZ, (shoulder + sill) / 2, Math.min(0.58, (shoulder - sill) * 0.95)],
    bonnet: [frontAxle - 0.1, 0.64],
  };

  return {
    body: group(bodyPieces),
    wheels,
    paintMap,
    paintKey: def.paintKey ? hsvKey(def.paintKey) : null,
    front,
    rear,
    width,
    plates,
    livery,
    credit: def.credit,
  };
}

/**
 * The paint for a loaded body: the player's colour and finish, with the livery (stripes,
 * bands, two-tone and race numbers) projected onto it in the car's frame. Paint baked into a
 * texture is picked out by its hue and recoloured, leaving the rest of the texture alone.
 */
export function liveryMaterial(
  asset: CarAsset,
  finish: THREE.MeshPhysicalMaterialParameters,
  setup: CarSetup,
  numbers: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: setup.paint, map: asset.paintMap, ...finish });
  const lv = asset.livery;
  const pattern = setup.pattern;
  const uniforms = {
    uAccent: { value: new THREE.Color(setup.accent) },
    uNumbers: { value: numbers },
    uLivery: { value: new THREE.Vector4(+(pattern === 'stripes'), +(pattern === 'side'), +(pattern === 'race'), +(pattern === 'twotone')) },
    uStripe: { value: new THREE.Vector2(...lv.stripe) },
    uBands: { value: new THREE.Vector4(lv.belt, ...lv.sill) },
    uDoor: { value: new THREE.Vector3(...lv.door) },
    uBonnet: { value: new THREE.Vector3(...lv.bonnet, +(pattern === 'race')) },
    uKey: { value: new THREE.Vector2(...(asset.paintKey ?? [0, 1])) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;\nvarying vec3 vCarNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;\nvCarNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vCarPos;
        varying vec3 vCarNormal;
        uniform vec3 uAccent;
        uniform sampler2D uNumbers;
        uniform vec4 uLivery;
        uniform vec2 uStripe;
        uniform vec4 uBands;
        uniform vec3 uDoor;
        uniform vec3 uBonnet;
        uniform vec2 uKey;
        vec3 carHsv( vec3 c ) {
          vec4 K = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
          vec4 p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
          vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
          float d = q.x - min( q.w, q.y );
          return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + 1e-10 ) ), d / ( q.x + 1e-10 ), q.x );
        }
        vec4 carDecal( vec2 uv ) {
          return all( greaterThan( uv, vec2( 0.0 ) ) ) && all( lessThan( uv, vec2( 1.0 ) ) ) ? texture2D( uNumbers, uv ) : vec4( 0.0 );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `float paintMask = 1.0;
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 hsv = carHsv( pow( max( sampledDiffuseColor.rgb, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) ) );
          float hueOff = abs( fract( hsv.x - uKey.x + 0.5 ) - 0.5 );
          paintMask = ( 1.0 - smoothstep( 0.04, 0.07, hueOff ) ) * smoothstep( 0.4, 0.6, hsv.y ) * smoothstep( 0.08, 0.2, hsv.z );
          vec3 painted = diffuseColor.rgb * pow( clamp( hsv.z / uKey.y, 0.0, 1.3 ), 2.2 );
          diffuseColor.rgb = mix( sampledDiffuseColor.rgb, painted, paintMask );
        #endif
        vec3 carN = normalize( vCarNormal );
        vec3 carP = vCarPos;
        float side = step( 0.5, abs( carN.x ) );
        float accent = uLivery.x * step( 0.35, carN.y ) * step( uStripe.x, abs( carP.x ) ) * step( abs( carP.x ), uStripe.y );
        accent = max( accent, uLivery.y * side * step( abs( carP.y - uBands.x ), 0.045 ) );
        accent = max( accent, uLivery.z * side * step( abs( carP.y - uBands.y ), 0.06 ) * step( uBands.z, carP.z ) * step( carP.z, uBands.w ) );
        accent = max( accent, uLivery.w * step( 0.55, carN.y ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, uAccent, accent * paintMask );
        vec4 decal = carDecal( vec2( sign( carP.x ) * ( uDoor.x - carP.z ), carP.y - uDoor.y ) / uDoor.z + 0.5 ) * step( 0.35, abs( carN.x ) );
        decal = max( decal, uBonnet.z * step( 0.4, carN.y ) * carDecal( vec2( carP.x, uBonnet.x - carP.z ) / uBonnet.y + 0.5 ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, decal.rgb, decal.a * paintMask );`,
      )
      // Only the paint gets the paint's finish.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( 0.6, roughnessFactor, paintMask );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( 0.1, metalnessFactor, paintMask );')
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= paintMask;
        #endif
        #ifdef USE_IRIDESCENCE
          material.iridescence *= paintMask;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'car-livery';
  return mat;
}
