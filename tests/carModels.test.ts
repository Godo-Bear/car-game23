/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { PropertyBinding } from 'three';
import { describe, expect, it } from 'vitest';
import { CAR_MODELS } from '../src/vehicles/importedCars';

interface GltfNode {
  name?: string;
  children?: number[];
}

/** The JSON chunk of a .glb file. */
function readGlb(file: string): { materials?: { name?: string }[]; nodes?: GltfNode[] } {
  const buf = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
}

describe('car model files', () => {
  for (const [id, def] of Object.entries(CAR_MODELS)) {
    it(`${id}: ${def.file} matches its config`, () => {
      const gltf = readGlb(def.file);
      // Every role finds a material, so a re-exported file can't silently lose its paint.
      const materials = (gltf.materials ?? []).map((m) => m.name ?? '');
      const missing = def.roles.filter(([re]) => !materials.some((m) => re.test(m))).map(([, role]) => role);
      expect(missing).toEqual([]);
      if (def.wheelCut) return;
      // Four wheel nodes, or three when both rear wheels share one (the loader splits that pair).
      // Outermost matches, named as the loader names them.
      const nodes = gltf.nodes ?? [];
      const parent = new Map<number, number>();
      nodes.forEach((n, i) => {
        for (const c of n.children ?? []) parent.set(c, i);
      });
      const isWheel = (i: number) => def.wheels!.test(PropertyBinding.sanitizeNodeName(nodes[i].name ?? ''));
      const outermost = nodes.filter((_, i) => {
        if (!isWheel(i)) return false;
        for (let p = parent.get(i); p !== undefined; p = parent.get(p)) if (isWheel(p)) return false;
        return true;
      });
      expect([3, 4]).toContain(outermost.length);
    });
  }
});
