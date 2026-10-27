import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../core/Settings';
import type { BloomSettings } from '../world/Lighting';

/** What each quality level turns on. */
export interface QualityProfile {
  pixelRatio: number;
  msaa: number;
  fxaa: boolean;
  shadows: boolean;
  shadowMapSize: number;
  ambientOcclusion: boolean;
  /** Multiplier for trees / particles when a world is built. */
  detail: number;
  /** Grass around the camera: 0 none, 1 normal, 2 dense (+ tree shadows). */
  grass: 0 | 1 | 2;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = window.devicePixelRatio || 1;
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1), msaa: 0, fxaa: true, shadows: false, shadowMapSize: 1024, ambientOcclusion: false, detail: 0.55, grass: 0 };
    case 'medium':
      return { pixelRatio: Math.min(dpr, 1.5), msaa: 4, fxaa: false, shadows: true, shadowMapSize: 1024, ambientOcclusion: false, detail: 1, grass: 1 };
    case 'high':
      return { pixelRatio: Math.min(dpr, 2), msaa: 4, fxaa: false, shadows: true, shadowMapSize: 2048, ambientOcclusion: true, detail: 1, grass: 2 };
  }
}

/**
 * Real-time ambient occlusion that ignores see-through effects (headlight pools, blob shadows,
 * fences, decals) so they don't cast dark halos. Runs at half resolution.
 */
class SceneAOPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super(scene, camera, width, height);
    // GTAOPass hides points/lines while it renders normals; extend that to transparent meshes.
    // (The hook is private in the typings, so it is patched on the instance.)
    const self = this as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
    const base = self._overrideVisibility.bind(this);
    self._overrideVisibility = () => {
      base();
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (o.visible && m && !Array.isArray(m) && (m.transparent || o.userData.noAO)) {
          o.visible = false;
          self._visibilityCache.push(o);
        }
      });
    };
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
  }
}

/** Radial speed blur plus streaking speed lines, faded in with speed. */
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    blur: { value: 0 },
    lines: { value: 0 },
    time: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float blur;
    uniform float lines;
    uniform float time;
    uniform float aspect;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(aspect, 1.0));
      float k = blur * smoothstep(0.18, 0.75, r);
      vec4 col = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        float t = float(i) / 7.0;
        col += texture2D(tDiffuse, 0.5 + c * (1.0 - k * t));
      }
      col /= 8.0;
      // Thin radial streaks towards the screen edges.
      float ang = atan(c.y, c.x * aspect);
      float id = floor(ang * 70.0);
      float on = step(0.93, hash(id * 7.13 + floor(time * 9.0) * 3.7));
      float fade = smoothstep(0.32, 0.8, r);
      float along = fract(r * 3.0 - time * 6.0 + hash(id) * 4.0);
      col.rgb += on * fade * lines * smoothstep(0.0, 0.25, along) * (1.0 - along) * 0.35;
      gl_FragColor = col;
    }`,
};

/**
 * The camera's "lens" (runs last, on the display image): filmic grade per time of day, vignette,
 * slight colour fringing toward the edges, fine grain, and sun glare - a soft bloom, an
 * anamorphic streak and ghosts - that only appears when the sun itself is unobstructed.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    aspect: { value: 1 },
    time: { value: 0 },
    contrast: { value: 1.05 },
    saturation: { value: 1.05 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0.28 },
    aberration: { value: 0.0016 },
    sunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    sunColor: { value: new THREE.Vector3(1, 0.9, 0.75) },
    flare: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float aspect;
    uniform float time;
    uniform float contrast;
    uniform float saturation;
    uniform vec3 tint;
    uniform float vignette;
    uniform float aberration;
    uniform vec2 sunScreen;
    uniform vec3 sunColor;
    uniform float flare;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 c = vUv - 0.5;
      vec2 off = c * aberration * dot(c, c) * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);

      if (flare > 0.0) {
        // Is the sun itself visible? (Bright pixels where it is = open sky, not a tree or hill.)
        float vis = 0.0;
        for (int i = 0; i < 5; i++) {
          float a = float(i) * 1.2566;
          vec2 p = sunScreen + (i == 0 ? vec2(0.0) : vec2(cos(a), sin(a)) * 0.008);
          vis += smoothstep(0.78, 0.97, luma(texture2D(tDiffuse, clamp(p, 0.001, 0.999)).rgb));
        }
        vis *= 0.2 * flare;
        vec2 d = (vUv - sunScreen) * vec2(aspect, 1.0);
        float r = length(d);
        vec3 glare = sunColor * (exp(-r * 6.0) * 0.16 + exp(-r * 24.0) * 0.4);
        glare += sunColor * exp(-abs(d.y) * 220.0) * exp(-abs(d.x) * 2.5) * 0.28;
        // Ghosts mirrored through the centre of the image.
        vec2 axis = vec2(0.5) - sunScreen;
        for (int i = 1; i < 5; i++) {
          vec2 gp = sunScreen + axis * (float(i) * 0.48);
          float gr = length((vUv - gp) * vec2(aspect, 1.0));
          float size = 0.025 + 0.02 * float(i);
          vec3 tintG = mix(vec3(0.4, 0.7, 1.0), vec3(1.0, 0.6, 0.35), fract(float(i) * 0.37));
          glare += tintG * smoothstep(size, size * 0.6, gr) * 0.06;
        }
        col += glare * vis;
      }

      col = (col - 0.5) * contrast + 0.5;
      col = mix(vec3(luma(col)), col, saturation) * tint;
      float v = smoothstep(0.95, 0.3, length(c * vec2(aspect * 0.8, 1.0)));
      col *= mix(1.0 - vignette, 1.0, v);
      col += (hash(vUv * 1000.0 + time) - 0.5) * 0.014;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export interface LensGrade {
  contrast: number;
  saturation: number;
  tint: [number, number, number];
}

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly ao: SceneAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly speed: ShaderPass;
  private readonly fxaa: FXAAPass;
  private readonly lens: ShaderPass;
  private profile: QualityProfile;
  /** Extra resolution scale on top of the quality level (dynamic resolution on slow GPUs). */
  private renderScale = 1;
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    this.profile = qualityProfile(quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // The post-processing chain renders into its own target, so anti-aliasing has to be
    // multisampled there - the canvas' own `antialias` flag has no effect on it.
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: this.profile.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new SceneAOPass(scene, camera, this.width, this.height);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width / 2, this.height / 2), 0.7, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.speed = new ShaderPass(SpeedShader);
    this.composer.addPass(this.speed);
    this.composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
    this.setQuality(quality);
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  setQuality(quality: Quality): void {
    this.profile = qualityProfile(quality);
    const p = this.profile;
    this.applyPixelRatio();
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== p.msaa) {
        rt.samples = p.msaa;
        rt.dispose();
      }
    }
    this.ao.enabled = p.ambientOcclusion;
    this.fxaa.enabled = p.fxaa;
    this.renderer.shadowMap.enabled = p.shadows;
    this.resize(this.width, this.height);
  }

  get scale(): number {
    return this.renderScale;
  }

  /** Render below native resolution (1 = full) when even Low quality can't keep up. */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.applyPixelRatio();
    this.resize(this.width, this.height);
  }

  private applyPixelRatio(): void {
    const ratio = this.profile.pixelRatio * this.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
  }

  /** Draw calls and triangles of the last frame (all passes, shadows included). */
  get stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  setBloom(b: BloomSettings): void {
    this.bloom.strength = b.strength;
    this.bloom.radius = b.radius;
    this.bloom.threshold = b.threshold;
  }

  setGrade(g: LensGrade): void {
    const u = this.lens.uniforms;
    u.contrast.value = g.contrast;
    u.saturation.value = g.saturation;
    u.tint.value.set(...g.tint);
  }

  /** Sun glare: screen position (0..1) of the sun and its strength (0 = none). */
  setSun(x: number, y: number, strength: number, color: THREE.Color): void {
    const u = this.lens.uniforms;
    u.sunScreen.value.set(x, y);
    u.flare.value = strength;
    u.sunColor.value.set(color.r, color.g, color.b);
  }

  /** 0..1 speed-effect intensity (0 disables the pass entirely). */
  setSpeedEffect(amount: number, time: number): void {
    this.speed.enabled = amount > 0.01;
    this.speed.uniforms.blur.value = amount * 0.06;
    this.speed.uniforms.lines.value = amount;
    this.speed.uniforms.time.value = time;
    this.lens.uniforms.time.value = time % 100;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.speed.uniforms.aspect.value = width / height;
    this.lens.uniforms.aspect.value = width / height;
  }

  render(dt: number): void {
    // Count every pass of the frame, not just the last one.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  compile(): void {
    this.renderer.compile(this.scene, this.camera);
  }
}
