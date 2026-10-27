import * as THREE from 'three';

/**
 * Surface detail shared by the terrain and the road: a tiling noise texture sampled in world
 * space at several scales (so nothing visibly repeats), grass/rock blending by slope, and the
 * wet-asphalt look with puddles and light reflections used for Tokyo at night.
 */

let detail: THREE.DataTexture | null = null;

/**
 * 256x256 tileable noise. R: fine grain (grass blades / gravel), G: medium blotches (patches,
 * puddles), B: large-scale variation, A: ridged cracks (rock).
 */
const hash = (x: number, y: number, seed: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Periodic value noise: the lattice wraps every `period` cells so textures tile. */
function noise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fBm over an N x N texture: `base` lattice cells across, doubling per octave. */
function fbm(x: number, y: number, N: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o;
    sum += noise((x / N) * f, (y / N) * f, f, seed + o) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Tangent-space normal map from a tileable height function (heights in texels). */
function normalMap(N: number, height: (x: number, y: number) => number, strength: number): THREE.DataTexture {
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = height(x, y);
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const k = (y * N + x) * 4;
      data[k] = ((nx / len) * 0.5 + 0.5) * 255;
      data[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[k + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  return tex;
}

let asphaltNormals: THREE.DataTexture | null = null;
let concreteNormals: THREE.DataTexture | null = null;

/** Asphalt relief: coarse aggregate stones, fine grain and hairline cracks (tiles every ~1.5 m). */
export function asphaltNormalMap(): THREE.DataTexture {
  asphaltNormals ??= normalMap(
    256,
    (x, y) => {
      const stones = Math.max(0, fbm(x, y, 256, 48, 2, 11) - 0.45) * 3;
      const grain = hash(x, y, 5) * 0.35;
      const crack = (1 - Math.abs(fbm(x, y, 256, 4, 3, 21) * 2 - 1)) ** 24;
      return stones + grain - crack * 1.2;
    },
    1.2,
  );
  return asphaltNormals;
}

/** Cast concrete: soft unevenness and small air pockets. */
export function concreteNormalMap(): THREE.DataTexture {
  concreteNormals ??= normalMap(128, (x, y) => fbm(x, y, 128, 6, 4, 31) * 2 - (hash(x, y, 9) > 0.985 ? 1.5 : 0), 1.2);
  return concreteNormals;
}

export function detailTexture(): THREE.DataTexture {
  if (detail) return detail;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      const fine = fbm(x, y, N, 32, 3, 1) * 0.6 + hash(x, y, 9) * 0.4;
      const mid = fbm(x, y, N, 6, 4, 2);
      const macro = fbm(x, y, N, 2, 3, 3);
      const ridge = 1 - Math.abs(fbm(x, y, N, 8, 4, 4) * 2 - 1);
      data[k] = fine * 255;
      data[k + 1] = mid * 255;
      data[k + 2] = macro * 255;
      data[k + 3] = (1 - ridge ** 6) * 255;
    }
  }
  detail = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 8;
  detail.needsUpdate = true;
  // Shared by every world, so it must survive a world being disposed.
  detail.userData.shared = true;
  return detail;
}

const WORLD_POS_VERTEX = /* glsl */ `#include <begin_vertex>
  vSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSurfUp = normalize(mat3(modelMatrix) * objectNormal).y;`;

/**
 * Terrain material: vertex colours (the painted landscape) broken up by world-space detail at
 * three scales, with rock showing through on steep slopes.
 */
export function groundMaterial(params: THREE.MeshLambertMaterialParameters, kind: 'rocky' | 'meadow'): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTexture() };
    shader.uniforms.uRock = { value: kind === 'rocky' ? 1 : 0.6 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfPos;\nvarying float vSurfUp;')
      .replace('#include <begin_vertex>', WORLD_POS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform float uRock;\nvarying vec3 vSurfPos;\nvarying float vSurfUp;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 gp = vSurfPos.xz;
        float fine = texture2D(uDetail, gp * 0.31).r;
        float fine2 = texture2D(uDetail, gp * 0.083 + 0.5).r;
        float mid = texture2D(uDetail, gp * 0.021 + 0.37).g;
        float macro = texture2D(uDetail, gp * 0.0042 + 0.11).b;
        vec3 soil = diffuseColor.rgb * (0.74 + 0.5 * fine * fine2 + 0.0) * (0.84 + 0.32 * mid) * (0.86 + 0.28 * macro);
        // Dry, yellower patches in the grass.
        soil = mix(soil, soil * vec3(1.12, 1.06, 0.78), smoothstep(0.55, 0.75, mid) * 0.5);
        float crack = texture2D(uDetail, gp * 0.12).a;
        vec3 stone = mix(vec3(0.43, 0.42, 0.39), diffuseColor.rgb, 0.25) * (0.62 + 0.5 * crack) * (0.85 + 0.3 * fine);
        float rock = (1.0 - smoothstep(0.7, 0.88, vSurfUp)) * uRock;
        diffuseColor.rgb = mix(soil, stone, rock);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Relief from the same detail texture: tufts in the grass, cracked faces on rock.
          vec2 q = vSurfPos.xz;
          float e = 0.25;
          float h0 = texture2D(uDetail, q * 0.31).r + texture2D(uDetail, q * 0.12).a * 1.5 * rock;
          float hx = texture2D(uDetail, (q + vec2(e, 0.0)) * 0.31).r + texture2D(uDetail, (q + vec2(e, 0.0)) * 0.12).a * 1.5 * rock;
          float hz = texture2D(uDetail, (q + vec2(0.0, e)) * 0.31).r + texture2D(uDetail, (q + vec2(0.0, e)) * 0.12).a * 1.5 * rock;
          vec3 tilt = vec3(h0 - hx, 0.0, h0 - hz) * 1.4;
          normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ground';
  return mat;
}

/**
 * Baked contact shading for things standing on flat ground (city buildings): the bottom few
 * metres darken toward the street, like ambient occlusion where wall meets pavement.
 */
export function applyContactShading(mat: THREE.MeshLambertMaterial, groundY = 0, height = 4, strength = 0.5): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vContactY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvContactY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vContactY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= mix(${(1 - strength).toFixed(3)}, 1.0, smoothstep(${groundY.toFixed(2)}, ${(groundY + height).toFixed(2)}, vContactY));`,
      );
  };
  mat.customProgramCacheKey = () => `contact-${groundY}-${height}-${strength}`;
}

/** Wetness for every road that should look rain-soaked (0 dry .. 1 soaked). */
export const roadWetness = { value: 0 };

/**
 * Road detail: large-scale tone variation and repaired patches so the tiled asphalt doesn't
 * repeat, plus (when wet) darker, glossy asphalt with mirror-like puddles that pick up the
 * environment's neon reflections.
 */
export function applyRoadDetail(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTexture() };
    shader.uniforms.uWet = roadWetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfPos;\nvarying float vSurfUp;')
      .replace('#include <begin_vertex>', WORLD_POS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uDetail;\nuniform float uWet;\nvarying vec3 vSurfPos;\nvarying float vSurfUp;\nfloat surfPuddle;',
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 rp = vSurfPos.xz;
        float tone = texture2D(uDetail, rp * 0.011 + 0.21).b;
        float patchy = texture2D(uDetail, rp * 0.043).g;
        diffuseColor.rgb *= 0.86 + 0.28 * tone;
        // Patches of newer, darker asphalt.
        diffuseColor.rgb *= 1.0 - 0.12 * smoothstep(0.66, 0.69, patchy);
        surfPuddle = smoothstep(0.52, 0.62, texture2D(uDetail, rp * 0.019 + 0.63).g) * smoothstep(0.25, 0.6, tone);
        diffuseColor.rgb *= mix(1.0, mix(0.62, 0.4, surfPuddle), uWet);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.5, 0.08, surfPuddle), uWet);`,
      );
  };
  mat.customProgramCacheKey = () => 'road';
}

export interface StreakLight {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  /** Streak width and length in metres. */
  width: number;
  length: number;
}

/**
 * Reflections of street lamps and neon signs on wet asphalt: soft additive streaks lying on the
 * road, always stretched from the light toward the camera like real reflections on a wet street.
 */
export class ReflectionStreaks {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(lights: StreakLight[]) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const pos = new Float32Array(lights.length * 3);
    const col = new Float32Array(lights.length * 3);
    const size = new Float32Array(lights.length * 2);
    lights.forEach((l, i) => {
      pos.set([l.x, l.y, l.z], i * 3);
      col.set([l.color.r, l.color.g, l.color.b], i * 3);
      size.set([l.width, l.length], i * 2);
    });
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.instanceCount = lights.length;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute vec3 aColor;
        attribute vec2 aSize;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 toCam = cameraPosition.xz - aPos.xz;
          float dist = length(toCam);
          vec2 dir = toCam / max(dist, 0.001);
          vec2 perp = vec2(-dir.y, dir.x);
          float len = aSize.y * clamp(dist / 30.0, 0.35, 1.5);
          vec2 p = aPos.xz + dir * (uv.y * len) + perp * ((uv.x - 0.5) * aSize.x);
          vUv = uv;
          vColor = aColor;
          vFade = smoothstep(240.0, 90.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(p.x, aPos.y + 0.04, p.y, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float a = pow(across, 2.2) * pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.06, vUv.y);
          a *= 0.8 + 0.2 * sin(vUv.y * 46.0 - uTime * 2.0 + vUv.x * 9.0);
          gl_FragColor = vec4(vColor * a * uIntensity * vFade, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'wet-reflections';
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }
}
