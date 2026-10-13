// Hand‑crafted "Pixel Worlds" renderers. They run entirely on the CPU/2D canvas,
// are deterministic (stable across video frames) and need no model download.
import type { Procedural } from '../data/styles';

type RGB = [number, number, number];

// ───────────────────────── colour helpers ─────────────────────────
const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const srgbToLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function toLab([r, g, b]: RGB): RGB {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

class Matcher {
  private labs: RGB[];
  private cache = new Map<number, number>();
  constructor(colors: RGB[], private chromaWeight = 1) {
    this.labs = colors.map(toLab);
  }
  nearest(r: number, g: number, b: number) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const [L, A, B] = toLab([r, g, b]);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.labs.length; i++) {
      const l = this.labs[i];
      const d = (L - l[0]) ** 2 + this.chromaWeight * ((A - l[1]) ** 2 + (B - l[2]) ** 2);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.cache.set(key, best);
    return best;
  }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample the source down to a small grid, with a gentle contrast/saturation lift. */
function sampleGrid(src: CanvasImageSource, sw: number, sh: number, gw: number, gh: number, sat = 1.15, contrast = 1.06) {
  const c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  // Progressive halving gives a much cleaner average than one huge downscale.
  let cur: CanvasImageSource = src, cw = sw, ch = sh;
  while (cw / 2 > gw * 2 && ch / 2 > gh * 2) {
    const t = document.createElement('canvas');
    t.width = Math.round(cw / 2); t.height = Math.round(ch / 2);
    const tctx = t.getContext('2d')!;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(cur, 0, 0, t.width, t.height);
    cur = t; cw = t.width; ch = t.height;
  }
  ctx.drawImage(cur, 0, 0, gw, gh);
  const img = ctx.getImageData(0, 0, gw, gh);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    for (let k = 0; k < 3; k++) {
      const v = l + (d[i + k] - l) * sat;
      d[i + k] = clamp((v - 128) * contrast + 128);
    }
  }
  return img;
}

// ───────────────────────── Blockcraft ─────────────────────────
type Pattern = 'noise' | 'speckle' | 'planks' | 'log' | 'bricks' | 'cobble' | 'wool' | 'smooth' | 'metal' | 'leaves' | 'water' | 'sand' | 'birch' | 'glow';
const BLOCKS: [string, Pattern][] = [
  ['#5f9f35', 'leaves'], ['#7cad4a', 'noise'], ['#3f6b22', 'leaves'], ['#866043', 'noise'], ['#5c4030', 'noise'],
  ['#7d7d7d', 'noise'], ['#7a7a7a', 'cobble'], ['#888888', 'speckle'], ['#9a6b58', 'speckle'], ['#bdbdbd', 'speckle'],
  ['#dbcfa3', 'sand'], ['#d8cb9b', 'sand'], ['#847f7e', 'speckle'], ['#a2834f', 'planks'], ['#735532', 'planks'],
  ['#c0af79', 'planks'], ['#432b14', 'planks'], ['#6d5533', 'log'], ['#d8d7d2', 'birch'], ['#966455', 'bricks'],
  ['#f0fafa', 'smooth'], ['#91b7fd', 'smooth'], ['#3f76e4', 'water'], ['#2b4fa8', 'water'], ['#d45a12', 'glow'],
  ['#1b1529', 'speckle'], ['#6f3534', 'noise'], ['#101010', 'noise'], ['#dcdcdc', 'metal'], ['#f6d03d', 'metal'],
  ['#62ede4', 'metal'], ['#2acb57', 'metal'], ['#1f43a3', 'speckle'], ['#a81205', 'speckle'], ['#f9d49c', 'glow'],
  ['#63a196', 'cobble'], ['#ebe5de', 'smooth'], ['#a97ea9', 'bricks'], ['#dbde9e', 'speckle'], ['#a0a6b3', 'smooth'],
  ['#6e7c5b', 'cobble'], ['#c07615', 'noise'], ['#a68b0c', 'log'],
  // wool
  ['#e9ecec', 'wool'], ['#f07613', 'wool'], ['#bd44b3', 'wool'], ['#3aafd9', 'wool'], ['#f8c627', 'wool'], ['#70b919', 'wool'],
  ['#ed8dac', 'wool'], ['#3e4447', 'wool'], ['#8e8e86', 'wool'], ['#158991', 'wool'], ['#792aac', 'wool'], ['#35399d', 'wool'],
  ['#724728', 'wool'], ['#546d1b', 'wool'], ['#a12722', 'wool'], ['#141519', 'wool'],
  // terracotta
  ['#985e43', 'smooth'], ['#d1b2a1', 'smooth'], ['#a15325', 'smooth'], ['#ba8523', 'smooth'], ['#8f3d2e', 'smooth'],
  ['#876a61', 'smooth'], ['#4d3323', 'smooth'], ['#575b5b', 'smooth'], ['#251610', 'smooth'], ['#764656', 'smooth'],
  ['#4a3b5b', 'smooth'], ['#677534', 'smooth'],
  // concrete
  ['#cfd5d6', 'smooth'], ['#2389c6', 'smooth'], ['#d5658e', 'smooth'], ['#f0af15', 'smooth'], ['#8e2020', 'smooth'],
  ['#080a0f', 'smooth'], ['#36393d', 'smooth'], ['#e06100', 'smooth'], ['#495b24', 'smooth'], ['#64209c', 'smooth'],
  ['#2c2e8f', 'smooth'], ['#157788', 'smooth'], ['#5ea818', 'smooth'], ['#a9309f', 'smooth'], ['#603b1f', 'smooth'],
  ['#7d7d73', 'smooth'],
];

const TEX = 16;
let blockAtlas: { canvas: HTMLCanvasElement; matcher: Matcher } | null = null;

function makeBlockTexture(base: RGB, pattern: Pattern, seed: number): Uint8ClampedArray<ArrayBuffer> {
  const rnd = mulberry32(seed);
  const px = new Uint8ClampedArray(TEX * TEX * 4);
  const shade = (i: number, f: number) => {
    px[i * 4] = clamp(base[0] * f); px[i * 4 + 1] = clamp(base[1] * f); px[i * 4 + 2] = clamp(base[2] * f); px[i * 4 + 3] = 255;
  };
  // Cell noise for cobble
  const pts = Array.from({ length: 7 }, () => [rnd() * TEX, rnd() * TEX, 0.85 + rnd() * 0.3]);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const n = rnd();
      let f = 1;
      switch (pattern) {
        case 'noise': f = 0.86 + n * 0.28; break;
        case 'sand': f = 0.93 + n * 0.12 + (rnd() < 0.05 ? -0.12 : 0); break;
        case 'speckle': f = 0.88 + n * 0.22 + (rnd() < 0.1 ? (rnd() < 0.5 ? -0.25 : 0.22) : 0); break;
        case 'smooth': f = 0.97 + n * 0.06; break;
        case 'wool': f = 0.9 + n * 0.12 + (((x + y) & 3) === 0 ? -0.06 : 0) + (((x - y) & 3) === 0 ? 0.04 : 0); break;
        case 'leaves': f = n < 0.18 ? 0.6 : n > 0.85 ? 1.22 : 0.85 + n * 0.25; break;
        case 'glow': f = 0.9 + n * 0.25 + Math.sin((x + y * 0.6) * 0.9) * 0.08; break;
        case 'water': f = 0.92 + Math.sin(x * 0.7 + Math.sin(y * 0.9) * 2) * 0.07 + n * 0.06; break;
        case 'planks': {
          const row = y & 3;
          const board = y >> 2;
          const seam = (x + board * 5) % 16 === 0;
          f = row === 3 || seam ? 0.66 : 0.93 + Math.sin(x * 0.9 + board * 3) * 0.05 + n * 0.08;
          break;
        }
        case 'log': f = 0.8 + ((x * 7 + (x % 3) * 11) % 5) * 0.06 + n * 0.1 + (x % 4 === 0 ? -0.12 : 0); break;
        case 'birch': f = rnd() < 0.06 || (y % 5 === 0 && x % 7 < 3) ? 0.18 : 0.92 + n * 0.1; break;
        case 'bricks': {
          const row = y >> 2;
          const off = row & 1 ? 4 : 0;
          const mortar = (y & 3) === 3 || (x + off) % 8 === 7;
          if (mortar) {
            px[i * 4] = 170; px[i * 4 + 1] = 160; px[i * 4 + 2] = 150; px[i * 4 + 3] = 255;
            continue;
          }
          f = 0.88 + n * 0.2;
          break;
        }
        case 'cobble': {
          let d1 = 99, d2 = 99, which = 0;
          for (let k = 0; k < pts.length; k++) {
            for (const ox of [-TEX, 0, TEX]) for (const oy of [-TEX, 0, TEX]) {
              const d = Math.hypot(x + 0.5 - pts[k][0] - ox, y + 0.5 - pts[k][1] - oy);
              if (d < d1) { d2 = d1; d1 = d; which = k; } else if (d < d2) d2 = d;
            }
          }
          f = d2 - d1 < 1.1 ? 0.55 : pts[which][2] + n * 0.08 - d1 * 0.015;
          break;
        }
        case 'metal': {
          const edge = x === 0 || y === 0 ? 1.25 : x === TEX - 1 || y === TEX - 1 ? 0.7 : x === 1 || y === 1 ? 1.1 : 1;
          f = edge * (0.98 + n * 0.04) + (x + y === 6 || x + y === 7 ? 0.12 : 0);
          break;
        }
      }
      shade(i, f);
    }
  }
  return px;
}

function getBlockAtlas() {
  if (blockAtlas) return blockAtlas;
  const canvas = document.createElement('canvas');
  canvas.width = TEX * BLOCKS.length;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  const avgs: RGB[] = [];
  BLOCKS.forEach(([h, p], idx) => {
    const px = makeBlockTexture(hex(h), p, idx * 977 + 13);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const n = px.length / 4;
    avgs.push([r / n, g / n, b / n]);
    ctx.putImageData(new ImageData(px, TEX, TEX), idx * TEX, 0);
  });
  blockAtlas = { canvas, matcher: new Matcher(avgs, 1.15) };
  return blockAtlas;
}

function renderBlockcraft(src: CanvasImageSource, sw: number, sh: number, detail: number) {
  const { canvas: atlas, matcher } = getBlockAtlas();
  const gw = Math.round(28 + detail * 84);
  const gh = Math.max(1, Math.round((gw * sh) / sw));
  const grid = sampleGrid(src, sw, sh, gw, gh, 1.2, 1.08);
  const cell = Math.max(6, Math.min(TEX, Math.floor(2048 / Math.max(gw, gh))));
  const out = document.createElement('canvas');
  out.width = gw * cell; out.height = gh * cell;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const d = grid.data;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      const b = matcher.nearest(d[i], d[i + 1], d[i + 2]);
      ctx.drawImage(atlas, b * TEX, 0, TEX, TEX, x * cell, y * cell, cell, cell);
    }
  }
  // Voxel depth: soft highlight on top/left edges and shadow bottom/right.
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#ffffff';
  for (let y = 0; y < gh; y++) ctx.fillRect(0, y * cell, out.width, Math.max(1, cell / 16));
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.12;
  for (let y = 1; y <= gh; y++) ctx.fillRect(0, y * cell - Math.max(1, cell / 16), out.width, Math.max(1, cell / 16));
  for (let x = 1; x <= gw; x++) ctx.fillRect(x * cell - Math.max(1, cell / 16), 0, Math.max(1, cell / 16), out.height);
  ctx.globalAlpha = 1;
  return out;
}

// ───────────────────────── 8‑Bit Arcade ─────────────────────────
const ARCADE = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'].map(hex);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
let arcadeMatcher: Matcher | null = null;

function renderArcade(src: CanvasImageSource, sw: number, sh: number, detail: number) {
  arcadeMatcher ??= new Matcher(ARCADE, 0.9);
  const gw = Math.round(96 + detail * 128);
  const gh = Math.max(1, Math.round((gw * sh) / sw));
  const grid = sampleGrid(src, sw, sh, gw, gh, 1.35, 1.12);
  const d = grid.data;
  const spread = 34;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      const t = BAYER[(y & 3) * 4 + (x & 3)] * spread;
      const c = ARCADE[arcadeMatcher.nearest(clamp(d[i] + t), clamp(d[i + 1] + t), clamp(d[i + 2] + t))];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
  }
  const small = document.createElement('canvas');
  small.width = gw; small.height = gh;
  small.getContext('2d')!.putImageData(grid, 0, 0);
  const scale = Math.max(3, Math.floor(1600 / Math.max(gw, gh)));
  const out = document.createElement('canvas');
  out.width = gw * scale; out.height = gh * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, out.width, out.height);
  // CRT scanlines + bloom‑ish vignette
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < gh; y++) ctx.fillRect(0, y * scale + scale - Math.max(1, Math.floor(scale / 3)), out.width, Math.max(1, Math.floor(scale / 3)));
  const g = ctx.createRadialGradient(out.width / 2, out.height / 2, Math.min(out.width, out.height) * 0.35, out.width / 2, out.height / 2, Math.max(out.width, out.height) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

// ───────────────────────── Brick Builder ─────────────────────────
const BRICKS = ['#f4f4f4', '#a0a5a9', '#6c6e68', '#212121', '#c91a09', '#720e0f', '#fe8a18', '#f2cd37', '#f8bb3d', '#e4cd9e', '#958a73', '#582a12', '#aa7d55', '#d09168', '#fcc39e', '#bbe90b', '#237841', '#184632', '#a0bcac', '#0055bf', '#0a3463', '#36aebf', '#9fc3e9', '#6074a1', '#923978', '#c870a0', '#e4adc8', '#e1d5ed'].map(hex);
let brickAtlas: { canvas: HTMLCanvasElement; matcher: Matcher; size: number } | null = null;

function getBrickAtlas(size: number) {
  if (brickAtlas && brickAtlas.size === size) return brickAtlas;
  const canvas = document.createElement('canvas');
  canvas.width = size * BRICKS.length;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const css = (c: RGB, f: number, a = 1) => `rgba(${clamp(c[0] * f)},${clamp(c[1] * f)},${clamp(c[2] * f)},${a})`;
  BRICKS.forEach((c, i) => {
    const x0 = i * size;
    ctx.fillStyle = css(c, 1);
    ctx.fillRect(x0, 0, size, size);
    // plate bevel
    ctx.fillStyle = css(c, 1.18, 0.9);
    ctx.fillRect(x0, 0, size, 1);
    ctx.fillRect(x0, 0, 1, size);
    ctx.fillStyle = css(c, 0.62, 0.9);
    ctx.fillRect(x0, size - 1, size, 1);
    ctx.fillRect(x0 + size - 1, 0, 1, size);
    const cx = x0 + size / 2, cy = size / 2, r = size * 0.33;
    // stud shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx + size * 0.06, cy + size * 0.08, r, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // stud body
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, css(c, 1.35));
    g.addColorStop(0.55, css(c, 1));
    g.addColorStop(1, css(c, 0.72));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // specular
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
  });
  brickAtlas = { canvas, matcher: new Matcher(BRICKS, 1.1), size };
  return brickAtlas;
}

function renderBricks(src: CanvasImageSource, sw: number, sh: number, detail: number) {
  const gw = Math.round(32 + detail * 64);
  const gh = Math.max(1, Math.round((gw * sh) / sw));
  const cell = Math.max(10, Math.min(28, Math.floor(1800 / Math.max(gw, gh))));
  const { canvas: atlas, matcher } = getBrickAtlas(cell);
  const grid = sampleGrid(src, sw, sh, gw, gh, 1.25, 1.05);
  const out = document.createElement('canvas');
  out.width = gw * cell; out.height = gh * cell;
  const ctx = out.getContext('2d')!;
  const d = grid.data;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      const b = matcher.nearest(d[i], d[i + 1], d[i + 2]);
      ctx.drawImage(atlas, b * cell, 0, cell, cell, x * cell, y * cell, cell, cell);
    }
  }
  return out;
}

export function renderProcedural(kind: Procedural, src: CanvasImageSource, sw: number, sh: number, detail = 0.5): HTMLCanvasElement {
  switch (kind) {
    case 'minecraft': return renderBlockcraft(src, sw, sh, detail);
    case 'arcade': return renderArcade(src, sw, sh, detail);
    case 'bricks': return renderBricks(src, sw, sh, detail);
  }
}
