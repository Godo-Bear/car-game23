import * as THREE from 'three';
import { skyTexture } from './textures';

/** Night-time Tokyo atmosphere: sky dome, haze, moonlight and a neon reflection map for car paint. */
export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, rng: () => number): void {
  scene.background = skyTexture(rng);
  scene.fog = new THREE.FogExp2(0x1c1530, 0.0011);

  scene.add(new THREE.HemisphereLight(0x7d84c4, 0x2b2030, 1.5));
  const moon = new THREE.DirectionalLight(0xaab8ff, 0.8);
  moon.position.set(-300, 600, 400);
  scene.add(moon);

  // A tiny "room" of coloured neon panels, prefiltered into an environment map. This is what
  // gives the cars' clearcoat those pink/cyan city reflections without any HDR image files.
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05050c);
  const panel = new THREE.BoxGeometry(1, 1, 1);
  const panels: [number, number, number, number, number, number, THREE.ColorRepresentation, number][] = [
    // x, y, z, sx, sy, sz, color, intensity
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
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.03).texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();
  panel.dispose();
}
