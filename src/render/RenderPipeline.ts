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
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = window.devicePixelRatio || 1;
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1), msaa: 0, fxaa: true, shadows: false, shadowMapSize: 1024, ambientOcclusion: false, detail: 0.55 };
    case 'medium':
      return { pixelRatio: Math.min(dpr, 1.5), msaa: 4, fxaa: false, shadows: true, shadowMapSize: 1024, ambientOcclusion: false, detail: 1 };
    case 'high':
      return { pixelRatio: Math.min(dpr, 2), msaa: 4, fxaa: false, shadows: true, shadowMapSize: 2048, ambientOcclusion: true, detail: 1 };
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

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly ao: SceneAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly speed: ShaderPass;
  private readonly fxaa: FXAAPass;
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

  /** 0..1 speed-effect intensity (0 disables the pass entirely). */
  setSpeedEffect(amount: number, time: number): void {
    this.speed.enabled = amount > 0.01;
    this.speed.uniforms.blur.value = amount * 0.06;
    this.speed.uniforms.lines.value = amount;
    this.speed.uniforms.time.value = time;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.speed.uniforms.aspect.value = width / height;
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
