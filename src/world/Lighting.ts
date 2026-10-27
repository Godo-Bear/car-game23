import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { TimeOfDay } from '../../shared/api';
import { createRng } from '../core/math';
import type { LensGrade } from '../render/RenderPipeline';
import type { TrackTheme } from '../track/tracks';

/**
 * Sky, sun/moon, ambient light, fog, reflections and post-processing for each time of day.
 * Everything is generated (no HDRI files). By day and at sunset the sky is a physically based
 * atmosphere (Rayleigh/Mie scattering with drifting clouds); at night it is painted (stars,
 * moon). The same sky is prefiltered into the reflection map, so paint and wet roads reflect it.
 */

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

interface SkyPreset {
  gradient: [number, string][];
  stars: number;
  clouds: string | null;
  /** Direction toward the sun (or moon at night). */
  sunDir: [number, number, number];
  disc: string;
  discSize: number;
  glow: string;
  fuji: string;
  fujiSnow: string;
}

/** Physical-sky settings (day and sunset). */
interface Atmosphere {
  /** Brightness of the sky (the scattering model is in physical units; this calibrates it). */
  gain: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  clouds: number;
  cloudDensity: number;
}

interface Preset {
  sky: SkyPreset;
  atmosphere: Atmosphere | null;
  grade: LensGrade;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  exposure: number;
  bloom: BloomSettings;
  shadows: boolean;
  fog: Record<TrackTheme, [number, number]>;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    sky: {
      gradient: [
        [0, '#2f6fca'],
        [0.35, '#5b9be0'],
        [0.48, '#a9d0f2'],
        [0.5, '#dcecf8'],
        [0.52, '#8a9a8a'],
        [1, '#4a5a48'],
      ],
      stars: 0,
      clouds: 'rgba(255,255,255,0.75)',
      sunDir: [-0.42, 0.78, 0.46],
      disc: '#fffbe8',
      discSize: 18,
      glow: 'rgba(255,250,225,0.55)',
      fuji: '#7f93b4',
      fujiSnow: 'rgba(250,252,255,0.95)',
    },
    grade: { contrast: 1.06, saturation: 1.08, tint: [1, 1, 0.98], glare: 1 },
    atmosphere: { gain: 0.36, turbidity: 3.5, rayleigh: 1.1, mie: 0.004, mieG: 0.8, clouds: 0.38, cloudDensity: 0.55 },
    sunColor: 0xfff2dc,
    sunIntensity: 2.4,
    hemiSky: 0xcfe4ff,
    hemiGround: 0x6b7a55,
    hemiIntensity: 1.35,
    exposure: 0.84,
    bloom: { strength: 0.14, radius: 0.4, threshold: 2.5 },
    shadows: true,
    fog: { city: [0xb4c8dc, 0.0007], mountain: [0xb9cfe0, 0.0008], countryside: [0xcfe3f2, 0.0006] },
  },
  sunset: {
    sky: {
      gradient: [
        [0, '#1c2350'],
        [0.3, '#4a3a78'],
        [0.42, '#c45a72'],
        [0.48, '#ff9a5c'],
        [0.5, '#ffd08a'],
        [0.52, '#5a3a40'],
        [1, '#2a1e26'],
      ],
      stars: 60,
      clouds: 'rgba(255,170,150,0.55)',
      // Setting just beside Mt. Fuji (which sits at azimuth 135 degrees).
      sunDir: [-0.86, 0.07, 0.5],
      disc: '#fff0c8',
      discSize: 26,
      glow: 'rgba(255,170,90,0.6)',
      fuji: '#3b2a4a',
      fujiSnow: 'rgba(255,200,190,0.75)',
    },
    grade: { contrast: 1.08, saturation: 1.06, tint: [1.05, 0.98, 0.9], glare: 0.5 },
    atmosphere: { gain: 0.62, turbidity: 7, rayleigh: 2.4, mie: 0.006, mieG: 0.86, clouds: 0.42, cloudDensity: 0.5 },
    sunColor: 0xff9a5a,
    sunIntensity: 2.0,
    hemiSky: 0xffb48a,
    hemiGround: 0x4a3a48,
    hemiIntensity: 1.05,
    exposure: 1.0,
    bloom: { strength: 0.4, radius: 0.5, threshold: 1.4 },
    shadows: true,
    fog: { city: [0x9a6a78, 0.0009], mountain: [0xc98a6a, 0.001], countryside: [0xe0a07a, 0.0008] },
  },
  night: {
    sky: {
      gradient: [
        [0, '#020309'],
        [0.32, '#0a0c22'],
        [0.44, '#241a44'],
        [0.5, '#5a2c5c'],
        [0.52, '#1a1224'],
        [1, '#07060b'],
      ],
      stars: 900,
      clouds: null,
      sunDir: [0.115, 0.39, 0.913],
      disc: '#eef2ff',
      discSize: 16,
      glow: 'rgba(220,230,255,0.35)',
      fuji: '#1d1630',
      fujiSnow: 'rgba(200,205,230,0.45)',
    },
    grade: { contrast: 1.1, saturation: 1.05, tint: [0.95, 0.98, 1.06], glare: 0 },
    atmosphere: null,
    sunColor: 0xaab8ff,
    sunIntensity: 0.8,
    hemiSky: 0x7d84c4,
    hemiGround: 0x2b2030,
    hemiIntensity: 1.5,
    exposure: 1.05,
    bloom: { strength: 0.7, radius: 0.5, threshold: 0.92 },
    shadows: false,
    fog: { city: [0x1c1530, 0.0011], mountain: [0x0e1222, 0.0013], countryside: [0x111530, 0.0011] },
  },
};

/** Direction toward the sun for the current time of day (read by distant scenery shaders). */
export const SUN_DIRECTION = new THREE.Vector3(0, 1, 0);

/** Nature is much darker than a lit city at night. */
const RURAL_NIGHT = { hemiIntensity: 0.75, sunIntensity: 0.6 };
const SHADOW_EXTENT = 55;

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sunDir = new THREE.Vector3();
  private readonly skies = new Map<TimeOfDay, THREE.Texture>();
  private readonly envs = new Map<string, THREE.Texture>();
  private readonly pmrem: THREE.PMREMGenerator;
  private shadowsAllowed = true;
  private presetShadows = true;
  /** Physical sky shown by day and at sunset (follows the camera; drawn at the far plane). */
  private readonly skyDome = makeSky();
  private tod: TimeOfDay = 'day';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.skyDome.scale.setScalar(10000);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -10;
    this.skyDome.userData.noAO = true;
    scene.add(this.skyDome);
  }

  /** Direction toward the sun (or moon), for lens glare. */
  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  /** Where the sun really is in the sky (lighting uses a raised angle at sunset). */
  readonly skySunDirection = new THREE.Vector3();

  /** Is the sun up and worth a lens flare? */
  get sunVisible(): boolean {
    return this.tod !== 'night';
  }

  get grade(): LensGrade {
    return PRESETS[this.tod].grade;
  }

  /** Graphics quality: whether the sun casts shadows, and how sharp they are. */
  setShadowQuality(enabled: boolean, mapSize: number): void {
    this.shadowsAllowed = enabled;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.castShadow = enabled && this.presetShadows;
  }

  /** Apply a time of day for a track theme. Returns the bloom settings to use. */
  apply(theme: TrackTheme, tod: TimeOfDay): BloomSettings {
    const p = PRESETS[tod];
    this.tod = tod;
    const rural = theme !== 'city' && tod === 'night';
    if (p.atmosphere) {
      configureSky(this.skyDome, p);
      this.skyDome.visible = true;
      this.scene.background = null;
      this.scene.environment = this.atmosphereEnv(tod, p);
    } else {
      const sky = this.sky(tod);
      this.skyDome.visible = false;
      this.scene.background = sky;
      this.scene.environment = this.env(theme, tod, sky);
    }
    // The physical sky is brighter than the painted night sky, so its reflections are scaled down.
    this.scene.environmentIntensity = tod === 'day' ? 0.55 : tod === 'sunset' ? 0.7 : 0.9;
    const [fogColor, density] = p.fog[theme];
    this.scene.fog = new THREE.FogExp2(fogColor, density);

    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = rural ? RURAL_NIGHT.hemiIntensity : p.hemiIntensity;
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = rural ? RURAL_NIGHT.sunIntensity : p.sunIntensity;
    this.sunDir.set(...p.sky.sunDir).normalize();
    this.skySunDirection.copy(this.sunDir);
    SUN_DIRECTION.copy(this.sunDir);
    // Low sunset sun still lights from a usable angle so the road isn't black.
    if (this.sunDir.y < 0.25) this.sunDir.y = 0.25;
    this.sunDir.normalize();
    this.presetShadows = p.shadows;
    this.sun.castShadow = p.shadows && this.shadowsAllowed;
    this.renderer.toneMappingExposure = p.exposure;
    return p.bloom;
  }

  /** Per frame: keep the sky around the camera and let the clouds drift. */
  update(time: number, camera: THREE.Camera): void {
    this.skyDome.position.copy(camera.position);
    (this.skyDome.material as THREE.ShaderMaterial).uniforms.time.value = time;
  }

  /** Keep the shadow-casting area centred on the player. */
  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 200);
  }

  private sky(tod: TimeOfDay): THREE.Texture {
    let tex = this.skies.get(tod);
    if (!tex) {
      tex = paintSky(PRESETS[tod].sky, createRng(77));
      this.skies.set(tod, tex);
    }
    return tex;
  }

  /** Reflections from the physical sky (rendered once per time of day). */
  private atmosphereEnv(tod: TimeOfDay, p: Preset): THREE.Texture {
    const key = `atmosphere-${tod}`;
    let tex = this.envs.get(key);
    if (!tex) {
      const scene = new THREE.Scene();
      const sky = makeSky();
      sky.scale.setScalar(10000);
      configureSky(sky, p);
      scene.add(sky);
      tex = this.pmrem.fromScene(scene, 0.02).texture;
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      this.envs.set(key, tex);
    }
    return tex;
  }

  private env(theme: TrackTheme, tod: TimeOfDay, sky: THREE.Texture): THREE.Texture {
    const key = theme === 'city' && tod === 'night' ? 'neon' : tod;
    let tex = this.envs.get(key);
    if (!tex) {
      tex = key === 'neon' ? this.neonEnvironment() : this.pmrem.fromEquirectangular(sky).texture;
      this.envs.set(key, tex);
    }
    return tex;
  }

  /** A tiny "room" of coloured neon panels, prefiltered into pink/cyan city reflections. */
  private neonEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05050c);
    const panel = new THREE.BoxGeometry(1, 1, 1);
    const panels: [number, number, number, number, number, number, THREE.ColorRepresentation, number][] = [
      [0, 9, 0, 14, 0.4, 14, 0x8090ff, 0.6],
      [-9, 2, 0, 0.4, 5, 10, 0xff2d95, 3],
      [9, 2, 3, 0.4, 4, 7, 0x00e5ff, 3],
      [0, 3, -9, 10, 3, 0.4, 0xffd08a, 2.5],
      [3, 1.5, 9, 6, 2, 0.4, 0xb14dff, 2.5],
      [-5, 4, 8, 3, 6, 0.4, 0xffe600, 1.8],
      [0, -6, 0, 30, 0.4, 30, 0x101018, 1],
    ];
    for (const [x, y, z, sx, sy, sz, color, k] of panels) {
      const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      env.add(m);
    }
    const tex = this.pmrem.fromScene(env, 0.03).texture;
    panel.dispose();
    return tex;
  }
}

/** Three's physical sky, with a brightness control added. */
function makeSky(): Sky {
  const sky = new Sky();
  const material = sky.material as THREE.ShaderMaterial;
  material.uniforms.skyGain = { value: 1 };
  material.fragmentShader = material.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform float skyGain;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );');
  return sky;
}

function configureSky(sky: Sky, p: Preset): void {
  const a = p.atmosphere!;
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.skyGain.value = a.gain;
  u.turbidity.value = a.turbidity;
  u.rayleigh.value = a.rayleigh;
  u.mieCoefficient.value = a.mie;
  u.mieDirectionalG.value = a.mieG;
  u.cloudCoverage.value = a.clouds;
  u.cloudDensity.value = a.cloudDensity;
  u.cloudScale.value = 0.00022;
  u.cloudSpeed.value = 0.000015;
  u.cloudElevation.value = 0.55;
  u.sunPosition.value.set(...p.sky.sunDir).normalize();
}

/** Direction -> equirectangular pixel (three.js convention: u = atan2(z, x) / 2PI + 0.5). */
function toPixel(dir: [number, number, number], w: number, h: number): [number, number] {
  const [x, y, z] = dir;
  const len = Math.hypot(x, y, z);
  const u = Math.atan2(z / len, x / len) / (2 * Math.PI) + 0.5;
  const v = Math.asin(y / len) / Math.PI + 0.5;
  return [u * w, (1 - v) * h];
}

function paintSky(p: SkyPreset, rng: () => number): THREE.Texture {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  for (const [stop, color] of p.gradient) grad.addColorStop(stop, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  for (let i = 0; i < p.stars; i++) {
    const y = rng() * 420;
    g.fillStyle = `rgba(255,255,255,${(1 - y / 420) * (0.3 + rng() * 0.7)})`;
    const s = rng() < 0.05 ? 2 : 1;
    g.fillRect(rng() * W, y, s, s);
  }

  if (p.clouds) {
    // Soft streaky clouds in the band above the horizon.
    for (let i = 0; i < 70; i++) {
      const cx = rng() * W;
      const cy = 300 + rng() * 190;
      const rx = 60 + rng() * 160;
      const ry = 8 + rng() * 18;
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      cg.addColorStop(0, p.clouds);
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      g.translate(cx, cy);
      g.scale(1, ry / rx);
      g.translate(-cx, -cy);
      g.fillStyle = cg;
      g.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
      g.restore();
    }
  }

  // Sun / moon with a glow.
  const [sx, sy] = toPixel(p.sunDir, W, H);
  const glowR = p.discSize * 7;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, glowR);
  halo.addColorStop(0, p.glow);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
  g.fillStyle = p.disc;
  g.beginPath();
  g.arc(sx, sy, p.discSize, 0, Math.PI * 2);
  g.fill();

  // Mt. Fuji on the south-western horizon (u = 0.875).
  const fx = W * 0.875;
  const base = H / 2;
  g.fillStyle = p.fuji;
  g.beginPath();
  g.moveTo(fx - 300, base);
  g.lineTo(fx - 42, base - 78);
  g.lineTo(fx + 42, base - 78);
  g.lineTo(fx + 300, base);
  g.closePath();
  g.fill();
  g.fillStyle = p.fujiSnow;
  g.beginPath();
  g.moveTo(fx - 78, base - 56);
  g.lineTo(fx - 42, base - 78);
  g.lineTo(fx + 42, base - 78);
  g.lineTo(fx + 78, base - 56);
  g.lineTo(fx + 36, base - 63);
  g.lineTo(fx, base - 54);
  g.lineTo(fx - 36, base - 63);
  g.closePath();
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
