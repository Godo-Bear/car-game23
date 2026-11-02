import * as THREE from 'three';

/**
 * Textures for the free drive city's streets. Roads and pavements are mapped with u running
 * along the street (in metres / the tile length) and v across it, so wheel tracks, kerb stones
 * and tactile strips sit where they belong across the width.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Metres of street one road tile covers (along). */
export const ROAD_TILE = 12;
/** Metres of pavement one paving tile covers (along). */
export const PAVING_TILE = 4;

/**
 * Asphalt: dark aggregate, a few sealed cracks and patches, and darker, smoother wheel tracks
 * worn into each lane. The tile spans a street `width` metres wide; `lanes` are the lane centres
 * (metres from the middle, each mirrored to the other side). No lanes: plain asphalt (junctions).
 */
export function streetAsphalt(width: number, lanes: readonly number[], rng: () => number): THREE.Texture {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#3a3b40';
  g.fillRect(0, 0, W, H);
  // Aggregate.
  for (let i = 0; i < 28000; i++) {
    const v = 38 + rng() * 52;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rng() * 0.45})`;
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  // Wheel tracks: one under each side of a car in every lane, a little darker and smoother
  // (y is across the road).
  const px = H / width;
  for (const lane of lanes) {
    for (const side of [-1, 1]) {
      const centre = H / 2 + side * lane * px;
      for (const off of [-0.8, 0.8]) {
        const y = centre + off * px;
        const half = 0.35 * px;
        const grad = g.createLinearGradient(0, y - half, 0, y + half);
        grad.addColorStop(0, 'rgba(10,10,12,0)');
        grad.addColorStop(0.5, 'rgba(10,10,12,0.26)');
        grad.addColorStop(1, 'rgba(10,10,12,0)');
        g.fillStyle = grad;
        g.fillRect(0, y - half, W, half * 2);
      }
      // Oil drips down the middle of the lane.
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(8,8,10,${0.12 + rng() * 0.15})`;
        g.beginPath();
        g.ellipse(rng() * W, centre + (rng() - 0.5) * 0.4 * px, 6 + rng() * 10, 2 + rng() * 3, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Sealed cracks: thin, black, wandering.
  g.strokeStyle = 'rgba(12,12,14,0.55)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 10; i++) {
    let x = rng() * W;
    let y = rng() * H;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      x += (rng() - 0.3) * 26;
      y += (rng() - 0.5) * 16;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // A repaired trench: a smoother, darker strip across part of the road.
  g.fillStyle = 'rgba(20,20,24,0.35)';
  g.fillRect(W * (0.3 + rng() * 0.4), 0, 18, H * (0.4 + rng() * 0.5));
  return texture(c);
}

/**
 * Pavement: a kerb stone along the road edge (v = 0 at the road), then interlocking paving -
 * warm greys and a few brick-red ones - and, on the main roads, a yellow tactile strip (the
 * raised lines that guide blind pedestrians) down the middle.
 */
export function pavementTexture(tactile: boolean, rng: () => number): THREE.Texture {
  const W = 256;
  const H = 128;
  const [c, g] = canvas(W, H);
  // Pavers (H = 2.4 m across, so ~0.2 m bricks).
  const bw = 22;
  const bh = 11;
  for (let y = 12; y < H; y += bh) {
    const shift = (Math.floor(y / bh) % 2) * (bw / 2);
    for (let x = -bw; x < W + bw; x += bw) {
      const red = rng() < 0.12;
      const v = 150 + Math.floor(rng() * 34);
      g.fillStyle = red ? `rgb(${v - 10},${v - 60},${v - 70})` : `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x + shift + 1, y + 1, bw - 2, bh - 2);
    }
  }
  g.fillStyle = 'rgba(60,58,54,0.5)';
  for (let y = 12; y < H; y += bh) g.fillRect(0, y, W, 1);
  // Kerb stone: light concrete in 1 m blocks.
  g.fillStyle = '#c8c6be';
  g.fillRect(0, 0, W, 12);
  g.fillStyle = 'rgba(70,70,70,0.6)';
  for (let x = 0; x < W; x += W / 4) g.fillRect(x, 0, 2, 12);
  g.fillRect(0, 11, W, 1);
  if (tactile) {
    // A strip of yellow guide blocks with raised lines along it.
    const y0 = H * 0.55;
    g.fillStyle = '#e8b81e';
    g.fillRect(0, y0, W, 16);
    g.fillStyle = 'rgba(255,240,170,0.8)';
    for (let k = 0; k < 4; k++) g.fillRect(0, y0 + 2 + k * 4, W, 1.5);
    g.fillStyle = 'rgba(120,90,10,0.5)';
    for (let x = 0; x < W; x += 16) g.fillRect(x, y0, 1, 16);
  }
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.08})`;
    g.fillRect(rng() * W, rng() * H, 2, 2);
  }
  return texture(c);
}

/** Paint, a little worn: white with gaps where it's scuffed through (alpha-tested; tinted per line). */
export function wornPaint(rng: () => number): THREE.Texture {
  const W = 256;
  const H = 32;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  // A slightly grubby white, then scuffs worn right through it.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(90,90,90,${rng() * 0.18})`;
    g.fillRect(rng() * W, rng() * H, 2 + rng() * 6, 1 + rng() * 3);
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(0,0,0,${0.6 + rng() * 0.4})`;
    g.beginPath();
    g.ellipse(rng() * W, rng() * H, 1 + rng() * 3, 0.6 + rng() * 1.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return texture(c);
}

/** Slots in the road-marking atlas (in atlas pixels: x, y, w, h). */
export const DECAL = {
  arrowRight: [0, 0, 128, 384],
  arrowLeft: [128, 0, 128, 384],
  arrowStraight: [256, 0, 128, 384],
  stop: [384, 0, 128, 384],
  speed40: [512, 0, 128, 384],
  speed50: [640, 0, 128, 384],
  diamond: [768, 0, 128, 384],
  bike: [896, 0, 128, 384],
  manhole: [0, 384, 128, 128],
  drain: [128, 384, 128, 128],
  stopLine: [256, 384, 128, 128],
} as const;
export type DecalKind = keyof typeof DECAL;
export const ATLAS_W = 1024;
export const ATLAS_H = 512;

/**
 * Road markings and fittings, drawn once into an atlas: lane arrows, 止まれ ("stop"), speed
 * limits, the ◇ "crossing ahead" diamond, the blue bicycle arrow, a manhole cover, a drain
 * grate and a stop line. Each tall slot reads from the bottom (near the driver) to the top (far).
 */
export function markingAtlas(rng: () => number): THREE.Texture {
  const [c, g] = canvas(ATLAS_W, ATLAS_H);
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const white = '#f4f4f0';
  const slot = (k: DecalKind) => DECAL[k];
  const arrow = (k: DecalKind, turn: -1 | 0 | 1) => {
    const [x, y, w, h] = slot(k);
    g.fillStyle = white;
    const cx = x + w / 2;
    // Shaft and head straight on.
    g.fillRect(cx - 9, y + 120, 18, h - 140);
    g.beginPath();
    g.moveTo(cx, y + 30);
    g.lineTo(cx + 38, y + 130);
    g.lineTo(cx - 38, y + 130);
    g.closePath();
    g.fill();
    if (turn) {
      // A branch curving off to the side, with its own head.
      g.strokeStyle = white;
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(cx, y + 300);
      g.quadraticCurveTo(cx, y + 220, cx + turn * 40, y + 210);
      g.stroke();
      g.beginPath();
      g.moveTo(cx + turn * 62, y + 210);
      g.lineTo(cx + turn * 32, y + 182);
      g.lineTo(cx + turn * 32, y + 238);
      g.closePath();
      g.fill();
    }
  };
  arrow('arrowRight', 1);
  arrow('arrowLeft', -1);
  arrow('arrowStraight', 0);
  // 止まれ, stretched long (they're painted to read from a car).
  {
    const [x, y, w] = slot('stop');
    g.fillStyle = white;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 108px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    g.save();
    g.translate(x + w / 2, y);
    g.scale(1, 1.15);
    ['止', 'ま', 'れ'].forEach((ch, i) => g.fillText(ch, 0, 60 + i * 108));
    g.restore();
  }
  for (const [k, n] of [
    ['speed40', '40'],
    ['speed50', '50'],
  ] as const) {
    const [x, y, w, h] = slot(k);
    g.fillStyle = white;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(1, 2.6);
    g.font = 'bold 110px system-ui, sans-serif';
    g.fillText(n, 0, 4);
    g.restore();
  }
  {
    // ◇: a crossing ahead.
    const [x, y, w, h] = slot('diamond');
    g.strokeStyle = white;
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(x + w / 2, y + 20);
    g.lineTo(x + w - 18, y + h / 2);
    g.lineTo(x + w / 2, y + h - 20);
    g.lineTo(x + 18, y + h / 2);
    g.closePath();
    g.stroke();
  }
  {
    // The blue bicycle arrow (a bike over a chevron).
    const [x, y, w] = slot('bike');
    g.fillStyle = '#2f73d8';
    g.beginPath();
    g.moveTo(x + w / 2, y + 30);
    g.lineTo(x + w - 14, y + 120);
    g.lineTo(x + w - 40, y + 120);
    g.lineTo(x + w / 2, y + 70);
    g.lineTo(x + 40, y + 120);
    g.lineTo(x + 14, y + 120);
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(x + w / 2, y + 170, 26, 0, Math.PI * 2);
    g.arc(x + w / 2, y + 260, 26, 0, Math.PI * 2);
    g.moveTo(x + w / 2, y + 170);
    g.lineTo(x + w / 2 + 20, y + 215);
    g.lineTo(x + w / 2, y + 260);
    g.stroke();
  }
  {
    // A cast-iron manhole cover with a pattern.
    const [x, y, w] = slot('manhole');
    const cx = x + w / 2;
    const cy = y + w / 2;
    g.fillStyle = '#2c2a28';
    g.beginPath();
    g.arc(cx, cy, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4c4842';
    g.lineWidth = 3;
    for (const r of [56, 40, 22]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22);
      g.lineTo(cx + Math.cos(a) * 56, cy + Math.sin(a) * 56);
      g.stroke();
    }
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(120,100,70,${rng() * 0.3})`;
      g.fillRect(cx + (rng() - 0.5) * 100, cy + (rng() - 0.5) * 100, 2, 2);
    }
  }
  {
    // A drain grate: a steel frame with slots.
    const [x, y] = slot('drain');
    g.fillStyle = '#3a3a3a';
    g.fillRect(x + 34, y + 8, 60, 112);
    g.fillStyle = '#0d0d0d';
    for (let k = 0; k < 9; k++) g.fillRect(x + 40, y + 14 + k * 11.5, 48, 6);
  }
  {
    // A stop line: a solid white bar (stretched to the lanes' width).
    const [x, y, w, h] = slot('stopLine');
    g.fillStyle = white;
    g.fillRect(x + 4, y + h / 2 - 24, w - 8, 48);
  }
  // Wear on all the paint.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + rng() * 0.6})`;
    g.beginPath();
    g.arc(rng() * ATLAS_W, rng() * 384, 0.8 + rng() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const t = texture(c, false);
  t.generateMipmaps = true;
  return t;
}
