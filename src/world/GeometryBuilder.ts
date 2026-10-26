import * as THREE from 'three';

type V3 = [number, number, number];

/**
 * Accumulates many primitives into a single BufferGeometry so a whole city's worth of boxes,
 * poles and signs renders in a handful of draw calls.
 */
export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];
  private count = 0;

  constructor(private readonly withColor = false) {}

  get isEmpty(): boolean {
    return this.count === 0;
  }

  vertex(p: V3, n: V3, u: number, v: number, color?: THREE.Color): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(u, v);
    if (this.withColor) {
      const c = color ?? WHITE;
      this.colors.push(c.r, c.g, c.b);
    }
    return this.count++;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /**
   * Quad from four corners given counter-clockwise as seen from the front.
   * UVs: a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1). `flip` reverses the facing without touching UVs.
   */
  quad(a: V3, b: V3, c: V3, d: V3, u0 = 0, v0 = 0, u1 = 1, v1 = 1, color?: THREE.Color, flip = false): void {
    const n = faceNormal(a, b, c);
    if (flip) {
      n[0] = -n[0];
      n[1] = -n[1];
      n[2] = -n[2];
    }
    const i0 = this.vertex(a, n, u0, v0, color);
    const i1 = this.vertex(b, n, u1, v0, color);
    const i2 = this.vertex(c, n, u1, v1, color);
    const i3 = this.vertex(d, n, u0, v1, color);
    if (flip) this.indices.push(i0, i2, i1, i0, i3, i2);
    else this.indices.push(i0, i1, i2, i0, i2, i3);
  }

  /**
   * Box centred on (cx, cz) resting on y = baseY, rotated by `rotY` about the vertical axis.
   * Side UVs are in metres divided by (tileU, tileV) so tiled facade textures keep a constant scale.
   * The roof goes to `roof` when given (different material), otherwise into this builder.
   */
  box(
    cx: number,
    baseY: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    rotY = 0,
    opts: { tileU?: number; tileV?: number; roof?: GeometryBuilder | null; bottom?: boolean; color?: THREE.Color; uOffset?: number; vOffset?: number } = {},
  ): void {
    const { tileU = 1, tileV = 1, roof, bottom = false, color, uOffset = 0, vOffset = 0 } = opts;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const corner = (lx: number, lz: number, y: number): V3 => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const hw = w / 2;
    const hd = d / 2;
    const y0 = baseY;
    const y1 = baseY + h;
    // Corners counter-clockwise when viewed from above (+y): (-,-) (+,-) (+,+) (-,+) in local x/z
    const p = [
      [-hw, -hd],
      [-hw, hd],
      [hw, hd],
      [hw, -hd],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      this.quad(
        corner(ax, az, y0),
        corner(bx, bz, y0),
        corner(bx, bz, y1),
        corner(ax, az, y1),
        uOffset,
        vOffset,
        uOffset + len / tileU,
        vOffset + h / tileV,
        color,
      );
    }
    const top = roof === undefined ? this : roof;
    if (top) {
      top.quad(corner(-hw, -hd, y1), corner(-hw, hd, y1), corner(hw, hd, y1), corner(hw, -hd, y1), 0, 0, w / tileU, d / tileU, color);
    }
    if (bottom) {
      this.quad(corner(-hw, -hd, y0), corner(hw, -hd, y0), corner(hw, hd, y0), corner(-hw, hd, y0), 0, 0, 1, 1, color);
    }
  }

  /** Vertical cylinder (no caps) - poles, pillars, tower legs. */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, segments = 8, color?: THREE.Color): void {
    const base = this.count;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      this.vertex([cx + nx * r0, y0, cz + nz * r0], [nx, 0, nz], i / segments, 0, color);
      this.vertex([cx + nx * r1, y0 + h, cz + nz * r1], [nx, 0, nz], i / segments, 1, color);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      this.indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = new THREE.Color(1, 1, 1);

function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
