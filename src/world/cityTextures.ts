import * as THREE from 'three';

/**
 * Daytime facades for the free drive city, each with an emissive map of its lit windows for
 * night. One tile is 4 bays x 4 floors (12 m x 14 m), like the circuit cities' facades, and the
 * colours are light so a per-building tint (vertex colour) gives every block its own shade.
 */
export type FacadeStyle = 'glass' | 'darkglass' | 'office' | 'tile' | 'apartment' | 'brick' | 'old' | 'warehouse';
export const FACADE_STYLES: FacadeStyle[] = ['glass', 'darkglass', 'office', 'tile', 'apartment', 'brick', 'old', 'warehouse'];

export interface CityFacade {
  map: THREE.Texture;
  emissive: THREE.Texture;
}

const S = 256;
const COLS = 4;
const ROWS = 4;
const BAY = S / COLS;
const FLOOR = S / ROWS;
const LIT = ['#ffe1b0', '#fff1d6', '#d8ecff', '#fff8e8', '#ffd59a', '#f2fbff'];

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Speckle a wall so it isn't flat paint (weathering, tile variation). */
function grain(g: CanvasRenderingContext2D, rng: () => number, amount: number, dark = true): void {
  for (let i = 0; i < 900; i++) {
    const v = dark ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${rng() * amount})`;
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
}

/** Light some of the windows (`rect` per window) on the emissive map, and tint them on the day map. */
function lightWindows(
  g: CanvasRenderingContext2D,
  e: CanvasRenderingContext2D,
  rng: () => number,
  share: number,
  windows: [number, number, number, number][],
  blinds = true,
): void {
  for (const [x, y, w, h] of windows) {
    if (rng() > share) continue;
    const color = LIT[Math.floor(rng() * LIT.length)];
    e.globalAlpha = 0.55 + rng() * 0.45;
    e.fillStyle = color;
    e.fillRect(x, y, w, h);
    if (blinds && rng() < 0.4) {
      e.fillStyle = 'rgba(0,0,0,0.55)';
      e.fillRect(x, y, w, h * (0.2 + rng() * 0.5));
    }
    e.globalAlpha = 1;
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
  }
}

/** A window pane with a soft sky reflection (lighter at the top). */
function pane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, bottom: string): void {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

export function cityFacade(style: FacadeStyle, rng: () => number): CityFacade {
  const [c, g] = canvas();
  const [ec, e] = canvas();
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const windows: [number, number, number, number][] = [];
  switch (style) {
    case 'glass': {
      // Curtain wall: sky-blue glass, thin mullions every 1.5 m, a spandrel at each floor.
      pane(g, 0, 0, S, S, '#b8d3ea', '#5f84a6');
      for (let r = 0; r < ROWS; r++) {
        const y = r * FLOOR;
        pane(g, 0, y, S, FLOOR - 9, '#cfe2f2', '#6d92b4');
        g.fillStyle = '#4a6175';
        g.fillRect(0, y + FLOOR - 9, S, 9);
        for (let k = 0; k < 8; k++) windows.push([k * 32 + 2, y + 2, 28, FLOOR - 13]);
      }
      g.fillStyle = 'rgba(230,240,250,0.85)';
      for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 2, S);
      // A sweep of reflected sky across the glass.
      const sweep = g.createLinearGradient(0, 0, S, S);
      sweep.addColorStop(0, 'rgba(255,255,255,0.18)');
      sweep.addColorStop(0.5, 'rgba(255,255,255,0)');
      sweep.addColorStop(1, 'rgba(255,255,255,0.1)');
      g.fillStyle = sweep;
      g.fillRect(0, 0, S, S);
      lightWindows(g, e, rng, 0.42, windows, false);
      break;
    }
    case 'darkglass': {
      // Dark smoked glass in a fine grid, with a bronze sheen - the sleekest towers.
      pane(g, 0, 0, S, S, '#4a5560', '#151b22');
      for (let r = 0; r < ROWS; r++) {
        const y = r * FLOOR;
        g.fillStyle = 'rgba(160,130,90,0.35)';
        g.fillRect(0, y + FLOOR - 4, S, 4);
        for (let k = 0; k < 8; k++) windows.push([k * 32 + 1, y + 1, 30, FLOOR - 6]);
      }
      g.fillStyle = 'rgba(120,110,95,0.6)';
      for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 1, S);
      const sheen = g.createLinearGradient(0, 0, S, S * 0.6);
      sheen.addColorStop(0, 'rgba(255,230,190,0.16)');
      sheen.addColorStop(0.6, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.fillRect(0, 0, S, S);
      lightWindows(g, e, rng, 0.5, windows, false);
      break;
    }
    case 'office': {
      // White concrete with a dark ribbon window on every floor.
      g.fillStyle = '#ecebe6';
      g.fillRect(0, 0, S, S);
      grain(g, rng, 0.05);
      for (let r = 0; r < ROWS; r++) {
        const y = r * FLOOR + 16;
        pane(g, 0, y, S, 34, '#7c95ab', '#2e3d4c');
        for (let x = 0; x < S; x += 32) {
          g.fillStyle = '#d9dbdc';
          g.fillRect(x, y, 3, 34);
          windows.push([x + 3, y, 29, 34]);
        }
      }
      lightWindows(g, e, rng, 0.4, windows);
      break;
    }
    case 'tile': {
      // Beige tiled walls with punched windows in white frames.
      g.fillStyle = '#e2d5bc';
      g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(120,100,70,0.18)';
      g.lineWidth = 1;
      for (let y = 0; y < S; y += 6) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
      }
      grain(g, rng, 0.06);
      for (let r = 0; r < ROWS; r++) {
        for (let col = 0; col < COLS; col++) {
          const x = col * BAY + 12;
          const y = r * FLOOR + 14;
          g.fillStyle = '#f4f2ec';
          g.fillRect(x - 3, y - 3, BAY - 18, 40);
          pane(g, x, y, BAY - 24, 34, '#8aa2b8', '#33424f');
          g.fillStyle = '#f4f2ec';
          g.fillRect(x + (BAY - 24) / 2 - 1, y, 2, 34);
          windows.push([x, y, BAY - 24, 34]);
        }
      }
      lightWindows(g, e, rng, 0.38, windows);
      break;
    }
    case 'apartment':
    case 'brick': {
      // Apartment block: a balcony slab and railing on every floor, sliding doors behind with
      // curtains, the odd air-conditioner and some washing out to dry.
      const wall = style === 'apartment' ? '#f1f0ea' : '#a2705a';
      g.fillStyle = wall;
      g.fillRect(0, 0, S, S);
      grain(g, rng, style === 'brick' ? 0.12 : 0.05);
      const curtains = ['#e8d9c0', '#d6e4ec', '#f0d6d6', '#e4e8d0', '#ffffff'];
      for (let r = 0; r < ROWS; r++) {
        const y = r * FLOOR;
        for (let col = 0; col < COLS; col++) {
          const x = col * BAY + 6;
          pane(g, x, y + 10, BAY - 12, 40, '#7f96a8', '#3a4652');
          g.fillStyle = curtains[Math.floor(rng() * curtains.length)];
          g.globalAlpha = 0.75;
          g.fillRect(x + 2, y + 12, (BAY - 16) * (0.2 + rng() * 0.3), 36);
          g.globalAlpha = 1;
          windows.push([x, y + 10, BAY - 12, 40]);
          // Air-conditioner unit on the balcony.
          if (rng() < 0.5) {
            g.fillStyle = '#d8dad6';
            g.fillRect(x + BAY - 30, y + 38, 14, 10);
            g.fillStyle = '#9da09d';
            g.fillRect(x + BAY - 27, y + 41, 8, 4);
          }
          // Washing on the rail.
          if (rng() < 0.25) {
            for (let k = 0; k < 3; k++) {
              g.fillStyle = ['#e74c3c', '#3498db', '#f1c40f', '#fff', '#9b59b6'][Math.floor(rng() * 5)];
              g.fillRect(x + 6 + k * 9, y + 44, 7, 9);
            }
          }
        }
        // Slab and railing.
        g.fillStyle = style === 'apartment' ? '#d7d6cf' : '#8a5c48';
        g.fillRect(0, y + FLOOR - 8, S, 8);
        g.fillStyle = 'rgba(200,210,215,0.85)';
        g.fillRect(0, y + 46, S, 10);
        g.fillStyle = '#8f979c';
        for (let x = 0; x < S; x += 8) g.fillRect(x, y + 46, 1, 10);
        // Party walls between the flats.
        g.fillStyle = style === 'apartment' ? '#e2e1da' : '#8f604c';
        for (let col = 0; col <= COLS; col++) g.fillRect(col * BAY - 3, y, 6, FLOOR - 8);
      }
      lightWindows(g, e, rng, 0.45, windows);
      break;
    }
    case 'old': {
      // Weathered grey concrete with windows of all sizes and a few water stains.
      g.fillStyle = '#aaa79f';
      g.fillRect(0, 0, S, S);
      grain(g, rng, 0.12);
      for (let i = 0; i < 6; i++) {
        const x = rng() * S;
        const grad = g.createLinearGradient(0, 0, 0, S);
        grad.addColorStop(0, 'rgba(60,55,50,0.25)');
        grad.addColorStop(1, 'rgba(60,55,50,0)');
        g.fillStyle = grad;
        g.fillRect(x, 0, 4 + rng() * 8, S);
      }
      for (let r = 0; r < ROWS; r++) {
        for (let col = 0; col < COLS; col++) {
          const w = 24 + rng() * 26;
          const h = 22 + rng() * 14;
          const x = col * BAY + (BAY - w) / 2;
          const y = r * FLOOR + 12;
          g.fillStyle = '#6c6a64';
          g.fillRect(x - 2, y - 2, w + 4, h + 4);
          pane(g, x, y, w, h, '#7d8f9c', '#2f3a42');
          windows.push([x, y, w, h]);
        }
      }
      lightWindows(g, e, rng, 0.35, windows);
      break;
    }
    case 'warehouse': {
      // Corrugated cladding, a strip of high windows and a roller door.
      g.fillStyle = '#d4d6d8';
      g.fillRect(0, 0, S, S);
      for (let x = 0; x < S; x += 6) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x, 0, 2, S);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x + 3, 0, 1, S);
      }
      for (let x = 8; x < S; x += 64) {
        pane(g, x, 30, 48, 14, '#9fb4c4', '#55697a');
        windows.push([x, 30, 48, 14]);
      }
      // Roller door and a little office door, at the bottom of the tile (ground level).
      g.fillStyle = '#8c9196';
      g.fillRect(40, S - 92, 80, 92);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = S - 92; y < S; y += 5) g.fillRect(40, y, 80, 1);
      g.fillStyle = '#5a6168';
      g.fillRect(170, S - 52, 24, 52);
      e.fillStyle = '#ffd59a';
      e.fillRect(176, S - 60, 12, 4);
      lightWindows(g, e, rng, 0.2, windows, false);
      break;
    }
  }
  return { map: texture(c), emissive: texture(ec) };
}

/** Flat roofs: light concrete with tar seams. */
export function roofTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas();
  g.fillStyle = '#c9c9c4';
  g.fillRect(0, 0, S, S);
  grain(g, rng, 0.08);
  g.strokeStyle = 'rgba(60,60,60,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= S; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, S);
    g.moveTo(0, i);
    g.lineTo(S, i);
    g.stroke();
  }
  return texture(c);
}

/** The city's ground between the streets: light concrete paving slabs. */
export function paverTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas();
  g.fillStyle = '#a9a69e';
  g.fillRect(0, 0, S, S);
  // 4 x 4 slabs, each a slightly different shade.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const v = 156 + Math.floor(rng() * 24);
      g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
      g.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
    }
  }
  grain(g, rng, 0.08);
  g.fillStyle = 'rgba(70,68,64,0.6)';
  for (let i = 0; i <= S; i += 64) {
    g.fillRect(i - 1, 0, 2, S);
    g.fillRect(0, i - 1, S, 2);
  }
  return texture(c);
}

/** Park lawn. */
export function grassTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas();
  g.fillStyle = '#5f8f3a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    const v = rng();
    g.fillStyle = v < 0.5 ? `rgba(40,80,25,${0.3 * rng()})` : `rgba(150,190,90,${0.3 * rng()})`;
    g.fillRect(rng() * S, rng() * S, 1, 2 + rng() * 3);
  }
  return texture(c);
}

/** A helipad: an H in a circle. */
export function helipadTexture(): THREE.Texture {
  const [c, g] = canvas();
  g.fillStyle = '#3b3f45';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#f2c200';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#fff';
  g.fillRect(84, 70, 22, 116);
  g.fillRect(150, 70, 22, 116);
  g.fillRect(84, 117, 88, 22);
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
