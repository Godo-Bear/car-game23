import type * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** After mirroring a non-indexed geometry (negative scale), restore its triangles' facing. */
export function flipWinding(geo: THREE.BufferGeometry): void {
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name);
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < attr.itemSize; k++) {
        const a = attr.getComponent(i + 1, k);
        attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
        attr.setComponent(i + 2, k, a);
      }
    }
    attr.needsUpdate = true;
  }
}

/** Merge geometries into one and free the pieces. */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  return out;
}
