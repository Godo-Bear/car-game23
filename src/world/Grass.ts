import * as THREE from 'three';
import { windTime } from './foliage';

/**
 * Terrain data the grass is planted on: per terrain vertex the height, the distance to the
 * road and a 0..1 "grassiness" (no grass on rock, sand, snow or under water).
 */
export interface GroundField {
  originX: number;
  originZ: number;
  /** Metres between terrain vertices. */
  res: number;
  /** Vertices per side. */
  verts: number;
  /** RGBA per vertex: height, road distance, grassiness, unused. */
  data: Float32Array;
  /** Grass stops this far from the road's centre line. */
  roadClear: number;
}

export interface GrassStyle {
  base: THREE.ColorRepresentation;
  tip: THREE.ColorRepresentation;
  /** Wildflower colours (some tufts get a coloured tip). */
  flowers: THREE.ColorRepresentation[];
  height: number;
}

const BLADES = 3;

/** One tuft: three curved blades fanned around the root (9 triangles). */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const t: number[] = [];
  const index: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Blade cross-section points along (ca, sa); it leans outward as it rises.
    const row = (y: number, w: number, lean: number) => {
      for (const side of [-1, 1]) pos.push(-sa * w * side + ca * lean, y, ca * w * side + sa * lean);
      t.push(y, y);
    };
    const base = pos.length / 3;
    row(0, 0.045, 0);
    row(0.5, 0.032, 0.06);
    pos.push(ca * 0.2, 1, sa * 0.2);
    t.push(1);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  geo.setIndex(index);
  return geo;
}

/**
 * A field of grass that travels with the camera: a fixed grid of tufts wrapped around the
 * camera's cell, so every patch of ground always gets the same tuft (no popping or swimming).
 * Placement, height, wind and colour all happen on the GPU in one draw call.
 */
export class GrassField {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private n = 0;

  constructor(field: GroundField, style: GrassStyle) {
    const base = tuftGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    this.geometry.setAttribute('aT', base.getAttribute('aT'));
    const tex = new THREE.DataTexture(field.data, field.verts, field.verts, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const flowers = style.flowers.map((c) => new THREE.Color(c));
    while (flowers.length < 3) flowers.push(new THREE.Color(style.tip));
    this.uniforms = {
      uField: { value: tex },
      uFieldInfo: { value: new THREE.Vector4(field.originX, field.originZ, field.res, field.verts) },
      uRoadClear: { value: field.roadClear },
      uCamCell: { value: new THREE.Vector2() },
      uSpacing: { value: 0.5 },
      uN: { value: 1 },
      uRadius: { value: 40 },
      uHeight: { value: style.height },
      uWindTime: windTime,
      uBase: { value: new THREE.Color(style.base) },
      uTip: { value: new THREE.Color(style.tip) },
      uFlower0: { value: flowers[0] },
      uFlower1: { value: flowers[1] },
      uFlower2: { value: flowers[2] },
      uFlowerRate: { value: style.flowers.length ? 0.07 : 0 },
    };
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D uField;
          uniform vec4 uFieldInfo;
          uniform float uRoadClear;
          uniform vec2 uCamCell;
          uniform float uSpacing;
          uniform float uN;
          uniform float uRadius;
          uniform float uHeight;
          uniform float uWindTime;
          uniform vec3 uBase;
          uniform vec3 uTip;
          uniform vec3 uFlower0;
          uniform vec3 uFlower1;
          uniform vec3 uFlower2;
          uniform float uFlowerRate;
          attribute vec2 aCell;
          attribute float aT;
          varying vec3 vGrass;
          float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          // Terrain data at a world position, interpolated exactly like the terrain triangles.
          vec4 fieldAt(vec2 xz) {
            vec2 g = (xz - uFieldInfo.xy) / uFieldInfo.z;
            float maxI = uFieldInfo.w - 2.0;
            vec2 c = clamp(floor(g), vec2(0.0), vec2(maxI));
            vec2 f = clamp(g - c, 0.0, 1.0);
            ivec2 i = ivec2(c);
            vec4 h00 = texelFetch(uField, i, 0);
            vec4 h10 = texelFetch(uField, i + ivec2(1, 0), 0);
            vec4 h01 = texelFetch(uField, i + ivec2(0, 1), 0);
            vec4 h11 = texelFetch(uField, i + ivec2(1, 1), 0);
            return f.x + f.y <= 1.0 ? h00 + (h10 - h00) * f.x + (h01 - h00) * f.y : h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
          }`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          vec2 gridBase = uCamCell - floor(uN * 0.5);
          vec2 cell = gridBase + mod(aCell - gridBase, uN);
          float r1 = gHash(cell);
          float r2 = gHash(cell + 17.3);
          float r3 = gHash(cell + 41.9);
          vec2 xz = (cell + vec2(r1, r2)) * uSpacing;
          vec4 fd = fieldAt(xz);
          float dist = length(xz - cameraPosition.xz);
          float keep = fd.z * smoothstep(uRoadClear, uRoadClear + 1.5, fd.y) * (1.0 - smoothstep(uRadius * 0.6, uRadius, dist));
          // Patchy: thicker in some places, thin in others.
          keep *= smoothstep(0.15, 0.55, gHash(floor(cell / 9.0)) * 0.6 + r3 * 0.6);
          float size = keep > 0.05 ? uHeight * (0.55 + 0.9 * r3) * keep : 0.0;
          float ang = r1 * 6.2832;
          vec3 local = position;
          local.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * local.xz;
          // Wind: gusts roll across the field; tips move most.
          float gust = sin(uWindTime * 1.7 + xz.x * 0.21 + xz.y * 0.13) * 0.5 + sin(uWindTime * 3.1 + xz.x * 0.7) * 0.2;
          vec2 bend = vec2(0.8, 0.35) * (gust + 0.35) * aT * aT * 0.35;
          vec3 transformed = vec3(xz.x, fd.x - 0.05, xz.y) + local * vec3(size * 0.9, size, size * 0.9) + vec3(bend.x, 0.0, bend.y) * size;
          float flower = step(1.0 - uFlowerRate, gHash(cell + 7.7));
          vec3 tip = mix(uTip * (0.85 + 0.3 * r2), r3 < 0.33 ? uFlower0 : r3 < 0.66 ? uFlower1 : uFlower2, flower * step(0.85, aT));
          vGrass = mix(uBase * (0.8 + 0.3 * r1), tip, aT);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrass;')
        // Light both faces like the ground beneath (no back-face flip for these thin blades).
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif');
    };
    material.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.name = 'grass';
  }

  /** Grid size by graphics detail: 0 hides the grass. */
  setDensity(level: 0 | 1 | 2): void {
    this.mesh.visible = level > 0;
    if (level === 0) return;
    const n = level === 2 ? 190 : 130;
    const spacing = level === 2 ? 0.48 : 0.56;
    this.uniforms.uSpacing.value = spacing;
    this.uniforms.uN.value = n;
    this.uniforms.uRadius.value = n * spacing * 0.48;
    if (n === this.n) return;
    this.n = n;
    const cells = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.set([i, j], (j * n + i) * 2);
    this.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    this.geometry.instanceCount = n * n;
  }

  update(camera: THREE.Camera): void {
    const s = this.uniforms.uSpacing.value as number;
    (this.uniforms.uCamCell.value as THREE.Vector2).set(Math.floor(camera.position.x / s), Math.floor(camera.position.z / s));
  }
}
