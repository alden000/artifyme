// Photo → ink drawing (black lines on white), the structural guide Masterpiece+
// repaints. XDoG after local contrast normalisation so dark or low‑contrast
// subjects (a black dog, a backlit face) still yield clean lines.
// Mirrors scripts/masterpiece/cn_lines.py.

function gaussKernel(sigma: number) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}

function blur(src: Float32Array, w: number, h: number, sigma: number) {
  const { k, r } = gaussKernel(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += src[row + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
      out[y * w + x] = a;
    }
  }
  return out;
}

/** Returns a Float32Array in [0,1]: 1 = paper, 0 = ink. */
export function inkLines(img: ImageData, sigma = 1.3, kk = 1.6, p = 20, eps = 0.02, phi = 60) {
  const { width: w, height: h, data } = img;
  let g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  // Local contrast normalisation.
  const mu = blur(g, w, h, 24);
  const d2 = new Float32Array(w * h);
  for (let i = 0; i < d2.length; i++) d2[i] = Math.min(1, (g[i] - mu[i]) ** 2 * 4);
  const v = blur(d2, w, h, 24);
  const n = new Float32Array(w * h);
  for (let i = 0; i < n.length; i++) n[i] = Math.min(1, Math.max(0, 0.5 + ((g[i] - mu[i]) / (4 * Math.sqrt(v[i] / 4) + 0.04)) * 0.5));
  g = n;
  // XDoG
  const a = blur(g, w, h, sigma);
  const b = blur(g, w, h, sigma * kk);
  const e = new Float32Array(w * h);
  for (let i = 0; i < e.length; i++) {
    const d = (1 + p) * a[i] - p * b[i];
    e[i] = d >= eps ? 1 : Math.max(0, 1 + Math.tanh(phi * (d - eps)));
  }
  // 3×3 median removes speckle.
  const out = new Float32Array(w * h);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[c++] = e[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      win.sort();
      out[y * w + x] = win[4];
    }
  }
  return out;
}
