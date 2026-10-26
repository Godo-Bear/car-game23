import * as THREE from 'three';

/** Canvas-generated textures, so the game ships with zero image assets. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export const ROAD_TEXTURE_LENGTH = 12;

/** Asphalt for the 14 m wide road: u spans the drivable width, v spans ROAD_TEXTURE_LENGTH metres. */
export function asphaltTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#2b2c31';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + rng() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rng() * 0.35})`;
    g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 2, 1 + rng() * 2);
  }
  // Rubbered-in racing line (slightly darker, wide and soft).
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const px = 512 / 14;
  // Solid edge lines.
  g.fillStyle = '#d9d9d2';
  g.fillRect(0.35 * px, 0, 0.18 * px, 512);
  g.fillRect(512 - 0.53 * px, 0, 0.18 * px, 512);
  // Faded city lane dashes (the circuit runs over normal streets).
  g.fillStyle = 'rgba(220,220,210,0.55)';
  const dash = (512 / ROAD_TEXTURE_LENGTH) * 4;
  for (const lane of [14 / 3, (14 * 2) / 3]) g.fillRect(lane * px - 0.06 * px, 0, 0.12 * px, dash);
  return toTexture(c, true, true);
}

export function checkerTexture(): THREE.Texture {
  const [c, g] = canvas(256, 32);
  const cols = 28;
  const size = 256 / cols;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      g.fillRect(x * size, y * 8, size, 8);
    }
  }
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function sidewalkTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#4a4b52';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1200; i++) {
    const v = 60 + rng() * 30;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.4)`;
    g.fillRect(rng() * 128, rng() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(20,20,26,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  return toTexture(c, true, true);
}

export function fenceTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  g.strokeStyle = 'rgba(200,205,215,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  return toTexture(c, true, true);
}

export interface FacadeTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
}

/**
 * One tile = 4 window columns x 4 floors (12 m x 14 m). The emissive map only contains the lit
 * windows so buildings glow at night while the walls stay dark.
 */
export function facadeTexture(rng: () => number, style: 'office' | 'residential' | 'glass' | 'old'): FacadeTextures {
  const [c, g] = canvas(256, 256);
  const [ec, eg] = canvas(256, 256);
  const wall = { office: '#3a3f4a', residential: '#4a4440', glass: '#1c2433', old: '#4b4038' }[style];
  g.fillStyle = wall;
  g.fillRect(0, 0, 256, 256);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, 256, 256);
  const lit = ['#ffd9a0', '#ffe8c4', '#cfe6ff', '#e8fff4', '#fff4d6', '#ffc6e0'];
  const cols = 4;
  const rows = 4;
  const cw = 256 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw;
      const y = r * rh;
      const [mx, my, w, h] = style === 'glass' ? [2, 6, cw - 4, rh - 12] : style === 'residential' ? [10, 14, cw - 20, rh - 30] : [8, 10, cw - 16, rh - 22];
      g.fillStyle = style === 'glass' ? '#253350' : '#141a24';
      g.fillRect(x + mx, y + my, w, h);
      if (rng() < (style === 'glass' ? 0.45 : 0.38)) {
        const color = lit[Math.floor(rng() * lit.length)];
        const strength = 0.55 + rng() * 0.45;
        eg.globalAlpha = strength;
        eg.fillStyle = color;
        eg.fillRect(x + mx, y + my, w, h);
        // Blinds / curtains break up the light a little.
        if (rng() < 0.4) {
          eg.fillStyle = 'rgba(0,0,0,0.5)';
          eg.fillRect(x + mx, y + my, w, h * (0.2 + rng() * 0.5));
        }
        eg.globalAlpha = 1;
        g.fillStyle = color;
        g.globalAlpha = 0.5;
        g.fillRect(x + mx, y + my, w, h);
        g.globalAlpha = 1;
      }
      if (style === 'residential') {
        // Balcony rail.
        g.fillStyle = '#6a625a';
        g.fillRect(x + 4, y + rh - 14, cw - 8, 4);
      }
    }
  }
  if (style === 'glass') {
    g.fillStyle = 'rgba(120,150,200,0.25)';
    for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 2, 256, 4);
  }
  return { map: toTexture(c, true, true), emissive: toTexture(ec, true, true) };
}

export function shopfrontTexture(rng: () => number): THREE.Texture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#111';
  g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = `hsl(${30 + rng() * 30}, 60%, ${55 + rng() * 25}%)`;
    g.fillRect(x + 4, 16, 56, 44);
    g.fillStyle = '#222';
    g.fillRect(x + 30, 16, 3, 44);
    // Awning / name board.
    g.fillStyle = `hsl(${Math.floor(rng() * 360)}, 80%, 55%)`;
    g.fillRect(x + 2, 2, 60, 11);
  }
  return toTexture(c, true, true);
}

const SIGN_WORDS = [
  '東京',
  'ラーメン',
  'カラオケ',
  '居酒屋',
  '寿司',
  'ゲーム',
  'ホテル',
  '焼肉',
  '新宿',
  '渋谷',
  '薬',
  '24時間',
  'コーヒー',
  '銀座',
  '秋葉原',
  '本屋',
];
export const SIGN_COLORS = ['#ff2d95', '#00e5ff', '#ffe600', '#ff6a00', '#7dff4d', '#b14dff', '#ff3b3b', '#ffffff'];
const SIGN_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

/** Glowing vertical Japanese shop sign. */
export function neonSignTexture(index: number): THREE.Texture {
  const word = SIGN_WORDS[index % SIGN_WORDS.length];
  const color = SIGN_COLORS[(index * 3) % SIGN_COLORS.length];
  const chars = [...word];
  const [c, g] = canvas(128, 512);
  g.fillStyle = '#07060c';
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(8, 8, 112, 496);
  g.fillStyle = color;
  const size = Math.min(96, 460 / chars.length);
  g.font = `900 ${size}px ${SIGN_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const step = 470 / chars.length;
  chars.forEach((ch, i) => {
    g.fillText(ch, 64, 22 + step * (i + 0.5));
    g.fillStyle = '#ffffff';
    g.shadowBlur = 0;
    g.globalAlpha = 0.55;
    g.fillText(ch, 64, 22 + step * (i + 0.5));
    g.globalAlpha = 1;
    g.fillStyle = color;
    g.shadowBlur = 18;
  });
  return toTexture(c);
}

/** Wide billboard with a fictional brand. */
export function billboardTexture(index: number): THREE.Texture {
  const ads = [
    { bg: '#e6005c', fg: '#fff', title: 'SAKURA MOTORS', sub: '桜モーターズ' },
    { bg: '#00a3e0', fg: '#fff', title: 'KAIJU ENERGY', sub: '怪獣エナジー' },
    { bg: '#ffd400', fg: '#111', title: 'NEON RAMEN', sub: 'ネオンラーメン' },
    { bg: '#121212', fg: '#00ffb3', title: 'TOKYO GP', sub: '東京グランプリ' },
    { bg: '#7a2cff', fg: '#fff', title: 'PIXEL ARCADE', sub: 'ピクセル' },
  ];
  const ad = ads[index % ads.length];
  const [c, g] = canvas(512, 192);
  g.fillStyle = ad.bg;
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = ad.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 italic 64px system-ui, sans-serif`;
  g.fillText(ad.title, 256, 78);
  g.font = `700 40px ${SIGN_FONT}`;
  g.fillText(ad.sub, 256, 148);
  return toTexture(c);
}

/**
 * Two-lane rural road: solid white edge lines and either a yellow no-overtaking centre line
 * (mountain pass) or a dashed white one (countryside).
 */
export function ruralAsphaltTexture(rng: () => number, centre: 'yellow' | 'dashed'): THREE.Texture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#34353a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 36 + rng() * 44;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rng() * 0.35})`;
    g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 2, 1 + rng() * 2);
  }
  // Patched/repaired strips give it a lived-in look.
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(20,20,22,${0.15 + rng() * 0.15})`;
    g.fillRect(rng() * 400, rng() * 512, 40 + rng() * 120, 6 + rng() * 30);
  }
  const px = 512 / 14;
  g.fillStyle = '#e6e6de';
  g.fillRect(0.3 * px, 0, 0.16 * px, 512);
  g.fillRect(512 - 0.46 * px, 0, 0.16 * px, 512);
  if (centre === 'yellow') {
    g.fillStyle = '#e8b417';
    g.fillRect(256 - 0.22 * px, 0, 0.14 * px, 512);
    g.fillRect(256 + 0.08 * px, 0, 0.14 * px, 512);
  } else {
    g.fillStyle = '#e6e6de';
    g.fillRect(256 - 0.07 * px, 0, 0.14 * px, (512 / ROAD_TEXTURE_LENGTH) * 5);
  }
  return toTexture(c, true, true);
}

export function bannerTexture(subtitle = '東京 ストリート サーキット'): THREE.Texture {
  const [c, g] = canvas(1024, 160);
  g.fillStyle = '#0b0b12';
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#e8102a';
  g.fillRect(0, 0, 1024, 14);
  g.fillRect(0, 146, 1024, 14);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 italic 76px system-ui, sans-serif';
  g.fillText('START  ·  FINISH', 512, 70);
  g.font = `700 30px ${SIGN_FONT}`;
  g.fillStyle = '#ffccd2';
  g.fillText(subtitle, 512, 128);
  return toTexture(c);
}

export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}
