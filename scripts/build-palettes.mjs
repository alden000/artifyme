// Measures each reference artwork's colour distribution (Lab mean & std) so the
// Atelier finish can re‑grade renders toward the painter's actual palette.
//   node scripts/build-palettes.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const artDir = path.join(root, 'scripts/assets/art');
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const out = {};
for (const file of (await fs.readdir(artDir)).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)).sort()) {
  const { data } = await sharp(path.join(artDir, file)).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0], sq = [0, 0, 0];
  const n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const v = lab(data[i], data[i + 1], data[i + 2]);
    for (let j = 0; j < 3; j++) { sum[j] += v[j]; sq[j] += v[j] * v[j]; }
  }
  const mean = sum.map((s) => s / n);
  const std = sq.map((s, j) => Math.sqrt(Math.max(0, s / n - mean[j] ** 2)));
  // Key pigments: k‑means (k=10) in Lab, chroma weighted so accents aren't swallowed.
  const px = [];
  for (let i = 0; i < data.length; i += 3) px.push(lab(data[i], data[i + 1], data[i + 2]));
  const K = 10;
  const d2 = (p, q) => (p[0] - q[0]) ** 2 * 0.5 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const cents = [px[Math.floor(px.length / 2)]];
  while (cents.length < K) {
    let best = null, bd = -1;
    for (const p of px) {
      const d = Math.min(...cents.map((c) => d2(p, c)));
      if (d > bd) { bd = d; best = p; }
    }
    cents.push(best);
  }
  for (let it = 0; it < 25; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, i) => { const d = d2(p, c); if (d < bd) { bd = d; bi = i; } });
      acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; acc[bi][3]++;
    }
    acc.forEach((a, i) => { if (a[3]) cents[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  out[path.parse(file).name] = { stats: [...mean, ...std].map((v) => +v.toFixed(2)), colors: cents.map((c) => c.map((v) => +v.toFixed(1))) };
}
await fs.writeFile(path.join(root, 'src/data/palettes.json'), JSON.stringify(out));
console.log('palettes:', Object.keys(out).length);
