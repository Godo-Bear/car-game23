import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Tree and bush shapes, a wind-sway material shared by all vegetation, and the soft contact
 * shadow drawn under every tree (cheap ambient occlusion that works on every quality level).
 */

/** Seconds, advanced by the world every frame; drives the sway of every plant. */
export const windTime = { value: 0 };

export interface TreeShape {
  /** May be null for plants without a visible trunk (bushes). */
  trunk: THREE.BufferGeometry | null;
  crown: THREE.BufferGeometry;
  trunkColor: number;
  palette: number[];
  /** Sway strength (m per m^2 of height above the base). */
  sway: number;
  /** Radius of the contact shadow on the ground. */
  shadow: number;
}

/**
 * Lambert material that bends with the wind: displacement grows with height so the base stays
 * planted, and each instance gets its own phase from its position. Trunk and crown use the same
 * function of local height, so they never separate.
 */
export function swayMaterial(params: THREE.MeshLambertMaterialParameters, sway: number, flutter: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uSway = { value: sway };
    shader.uniforms.uFlutter = { value: flutter };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uSway;\nuniform float uFlutter;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayOrigin = instanceMatrix[3].xyz;
        #else
          vec3 swayOrigin = vec3(0.0);
        #endif
        float swayH = max(transformed.y - 1.0, 0.0);
        float swayPhase = uWindTime * 1.3 + swayOrigin.x * 0.045 + swayOrigin.z * 0.06;
        float gust = 0.65 + 0.35 * sin(uWindTime * 0.37 + swayOrigin.x * 0.004);
        float bend = swayH * swayH * uSway * gust;
        transformed.x += (sin(swayPhase) + 0.35 * sin(swayPhase * 2.3 + 1.0)) * bend;
        transformed.z += cos(swayPhase * 0.8 + 0.5) * 0.6 * bend;
        transformed += objectNormal * sin(uWindTime * 5.0 + position.x * 2.1 + position.y * 1.7 + position.z * 2.9) * uFlutter * min(swayH, 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'sway';
  return mat;
}

function blob(r: number, x: number, y: number, z: number, squash = 0.8, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(1, squash, 1);
  g.translate(x, y, z);
  return g;
}

function trunk(height: number, r0: number, r1: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, 6);
  g.translate(0, height / 2, 0);
  if (lean) g.rotateZ(lean);
  return g;
}

function cone(r: number, h: number, y: number, segments = 8): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segments);
  g.translate(0, y, 0);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  for (const p of parts) p.dispose();
  return geo;
}

/** Hakone's dark conical cedars. */
export function cedar(): TreeShape {
  return {
    trunk: trunk(4, 0.35, 0.22),
    crown: merge([cone(2.4, 7.5, 6.5), cone(1.7, 5.5, 10)]),
    trunkColor: 0x4a3526,
    palette: [0x24452a, 0x2c5230, 0x1f3d26, 0x35592f],
    sway: 0.0025,
    shadow: 3.2,
  };
}

/** Tall, narrow Japanese cedar (sugi) - the giants lining old mountain roads. */
export function sugi(): TreeShape {
  return {
    trunk: trunk(7, 0.45, 0.28),
    crown: merge([cone(2.0, 6, 7.5, 7), cone(1.6, 5.5, 11.5, 7), cone(1.1, 4.5, 15, 7)]),
    trunkColor: 0x5a3a28,
    palette: [0x1d3a24, 0x23422a, 0x2a4a2c],
    sway: 0.0016,
    shadow: 2.8,
  };
}

/** Round-crowned broadleaf. */
export function broadleaf(): TreeShape {
  return {
    trunk: trunk(3.2, 0.32, 0.2),
    crown: merge([blob(3, 0, 5, 0, 0.85), blob(1.9, 1.6, 4.4, 0.7, 0.8, 0), blob(1.8, -1.4, 4.6, -0.9, 0.8, 0)]),
    trunkColor: 0x4b3428,
    palette: [0x3f6e2c, 0x4d7f33, 0x5c8a3a, 0x355f28],
    sway: 0.004,
    shadow: 3.4,
  };
}

/** Japanese maple in autumn colour: wide, layered and low. */
export function maple(): TreeShape {
  return {
    trunk: trunk(2.6, 0.26, 0.16, 0.08),
    crown: merge([blob(2.4, 0.2, 3.6, 0, 0.55), blob(1.9, 1.7, 3.1, 0.6, 0.5, 0), blob(1.8, -1.5, 3.3, -0.6, 0.5, 0), blob(1.5, 0.3, 4.6, -0.4, 0.55, 0)]),
    trunkColor: 0x3d2a22,
    palette: [0xc8321e, 0xd9481f, 0xe0702a, 0xb52418, 0xe8a23a],
    sway: 0.006,
    shadow: 3,
  };
}

export function sakura(): TreeShape {
  const crown = merge([blob(2.6, 0, 4.3, 0, 0.78), blob(1.8, 1.5, 3.9, 0.6, 0.78), blob(1.9, -1.3, 4.0, -0.8, 0.78), blob(1.6, 0.3, 5.2, -0.6, 0.78)]);
  return {
    trunk: trunk(3.2, 0.32, 0.2),
    crown,
    trunkColor: 0x4b3428,
    palette: [0xf7c6d9, 0xf4b3cb, 0xfbe0ea, 0xeea6c0, 0xfad1e0],
    sway: 0.0045,
    shadow: 3.4,
  };
}

/** Japanese black pine: a leaning trunk with flat, cloud-like layers. */
export function pine(): TreeShape {
  return {
    trunk: trunk(6, 0.3, 0.18, 0.18),
    crown: merge([blob(2.2, -0.4, 4.2, 0.3, 0.32, 0), blob(1.9, 0.6, 5.4, -0.5, 0.3, 0), blob(1.6, -0.9, 6.3, 0, 0.32, 0), blob(1.2, -1.2, 7.1, 0.4, 0.35, 0)]),
    trunkColor: 0x4a3a30,
    palette: [0x2b4a2a, 0x335530, 0x26432a],
    sway: 0.002,
    shadow: 2.6,
  };
}

/** Bamboo clump: thin stalks with feathery tops. */
export function bamboo(): TreeShape {
  const stalks: THREE.BufferGeometry[] = [];
  const tops: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const r = 0.35 + (i % 3) * 0.35;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 7 + ((i * 37) % 5);
    const s = new THREE.CylinderGeometry(0.06, 0.08, h, 5);
    s.translate(x, h / 2, z);
    stalks.push(s);
    tops.push(blob(1.1, x * 1.6, h - 0.6, z * 1.6, 1.4, 0));
  }
  return {
    trunk: merge(stalks),
    crown: merge(tops),
    trunkColor: 0x8a9a4a,
    palette: [0x6f9a3e, 0x7aa848, 0x5f8a35],
    sway: 0.006,
    shadow: 2.2,
  };
}

/** Low shrub with no visible trunk. */
export function bush(): TreeShape {
  return {
    trunk: null,
    crown: merge([blob(1.1, 0, 0.6, 0, 0.7, 1), blob(0.8, 0.8, 0.5, 0.3, 0.7, 0), blob(0.75, -0.7, 0.5, -0.3, 0.7, 0)]),
    trunkColor: 0,
    palette: [0x3d6a2a, 0x47772f, 0x355d27],
    sway: 0.02,
    shadow: 1.6,
  };
}

let shadowTex: THREE.Texture | null = null;

/** Soft dark disc for under trees (and anything else that should look grounded). */
export function contactShadowMaterial(opacity = 0.55): THREE.MeshBasicMaterial {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
    shadowTex.userData.shared = true;
  }
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: shadowTex,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
