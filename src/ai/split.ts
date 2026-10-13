// "Protect people" geometry for Masterpiece+, DOM‑free so it can be tested in Node.
//
// Whole‑image img2img at 640 px gives a small subject (a child in a wide shot) only a
// few dozen latent pixels, so the painter invents a new person. Instead we find people
// & pets, repaint an enlarged crop around them at a faithful strength, and blend that
// back over the painted scene with a feathered mask.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Larger side of the tight subject box (before margin), in scene pixels. */
  size: number;
}

/**
 * Boxes (with margin) around each group of people/pets (mask > 0.5) in a W×H scene,
 * largest first. Nearby subjects share a box. Specks are skipped, and so are boxes
 * longer than `maxSide` scene pixels: painting those as a crop would gain little or
 * no resolution over the scene pass.
 */
export function subjectBoxes(mask: Float32Array, W: number, H: number, maxSide: number, max = 3): Box[] {
  // Connected components on an 8 px grid.
  const C = 8, gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const cnt = new Int32Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 0.5) cnt[((y / C) | 0) * gw + ((x / C) | 0)]++;
  const label = new Int32Array(gw * gh).fill(-1);
  type Raw = { x0: number; y0: number; x1: number; y1: number; n: number };
  let boxes: Raw[] = [];
  for (let i = 0; i < gw * gh; i++) {
    if (!cnt[i] || label[i] >= 0) continue;
    const r: Raw = { x0: W, y0: H, x1: 0, y1: 0, n: 0 };
    const stack = [i];
    label[i] = boxes.length;
    while (stack.length) {
      const j = stack.pop()!;
      const gx = j % gw, gy = (j / gw) | 0;
      r.n += cnt[j];
      r.x0 = Math.min(r.x0, gx * C);
      r.y0 = Math.min(r.y0, gy * C);
      r.x1 = Math.max(r.x1, Math.min(W, gx * C + C));
      r.y1 = Math.max(r.y1, Math.min(H, gy * C + C));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (cnt[k] && label[k] < 0) {
          label[k] = boxes.length;
          stack.push(k);
        }
      }
    }
    boxes.push(r);
  }
  // Ignore specks (< 0.3% of the frame): usually false positives.
  boxes = boxes.filter((b) => b.n >= W * H * 0.003);
  const grow = (b: Raw): Box => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0, size = Math.max(bw, bh);
    // Margin for context, capped for long thin groups so it doesn't swallow the frame.
    const mg = 0.35 * Math.min(size, 1.5 * Math.min(bw, bh));
    return { x0: Math.max(0, Math.floor(b.x0 - mg)), y0: Math.max(0, Math.floor(b.y0 - mg)), x1: Math.min(W, Math.ceil(b.x1 + mg)), y1: Math.min(H, Math.ceil(b.y1 + mg)), size };
  };
  const long = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
  // Merge groups whose crops would overlap, unless that makes the crop too big.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = grow(boxes[i]), b = grow(boxes[j]);
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          const p = boxes[i], q = boxes[j];
          const m = { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1), n: p.n + q.n };
          if (long(grow(m)) > maxSide) continue;
          boxes[i] = m;
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  return boxes
    .sort((a, b) => b.n - a.n)
    .map(grow)
    .filter((b) => long(b) <= maxSide)
    .slice(0, max);
}

/** The part of `mask` inside `box` (zero elsewhere). */
export function maskIn(mask: Float32Array, W: number, box: Box) {
  const out = new Float32Array(mask.length);
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) out[y * W + x] = mask[y * W + x];
  return out;
}

/** `mask` with everything inside `boxes` cleared. */
export function maskOutside(mask: Float32Array, W: number, boxes: Box[]) {
  const out = mask.slice();
  for (const b of boxes) for (let y = b.y0; y < b.y1; y++) out.fill(0, y * W + b.x0, y * W + b.x1);
  return out;
}

/** Tight box of mask > 0.5 (size = its longer side), or null if under 0.3% of the frame. */
export function maskBox(mask: Float32Array, W: number, H: number): Box | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x] > 0.5) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (n < W * H * 0.003) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, size: Math.max(x1 - x0, y1 - y0) };
}

/** Crop size (multiples of 64, long side ≈ side) for painting a w×h region. */
export function fitSize(w: number, h: number, side = 512) {
  const s = side / Math.max(w, h);
  return { w: Math.max(128, Math.round((w * s) / 64) * 64), h: Math.max(128, Math.round((h * s) / 64) * 64) };
}

/** Bilinear resize of a single‑channel map. */
export function resizeMap(src: Float32Array, sw: number, sh: number, dw: number, dh: number) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, ((y + 0.5) * sh) / dh - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, ((x + 0.5) * sw) / dw - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * tx;
      const b = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * tx;
      out[y * dw + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function maxFilter1D(src: Float32Array, W: number, H: number, r: number, horiz: boolean) {
  const out = new Float32Array(src.length);
  const [len, lines] = horiz ? [W, H] : [H, W];
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (horiz ? l * W + i : i * W + l);
    for (let i = 0; i < len; i++) {
      let m = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(len - 1, i + r); k++) m = Math.max(m, src[at(k)]);
      out[at(i)] = m;
    }
  }
  return out;
}

function boxBlur1D(src: Float32Array, W: number, H: number, r: number, horiz: boolean) {
  const out = new Float32Array(src.length);
  const [len, lines] = horiz ? [W, H] : [H, W];
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (horiz ? l * W + i : i * W + l);
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[at(Math.min(len - 1, Math.max(0, k)))];
    for (let i = 0; i < len; i++) {
      out[at(i)] = acc / (2 * r + 1);
      acc += src[at(Math.min(len - 1, i + r + 1))] - src[at(Math.max(0, i - r))];
    }
  }
  return out;
}

/** Soft blend mask: grow the subject a little, then feather (≈ Gaussian via 3 box blurs). */
export function featherMask(mask: Float32Array, W: number, H: number, subjectSize: number) {
  const grow = Math.min(61, Math.floor(subjectSize * 0.18) | 1);
  const r = grow >> 1;
  let m = maxFilter1D(maxFilter1D(mask, W, H, r, true), W, H, r, false);
  const sigma = Math.max(3, grow / 3);
  const br = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  for (let i = 0; i < 3; i++) m = boxBlur1D(boxBlur1D(m, W, H, br, true), W, H, br, false);
  return m;
}

/**
 * Blend `patch` (RGBA, box‑sized) over `scene` (RGBA, W wide) inside `box` using `alpha` (W×H).
 */
export function blendPatch(scene: Uint8ClampedArray, W: number, patch: Uint8ClampedArray, box: Box, alpha: Float32Array) {
  const bw = box.x1 - box.x0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const a = Math.min(1, Math.max(0, alpha[y * W + x]));
      if (a <= 0) continue;
      const si = (y * W + x) * 4, pi = ((y - box.y0) * bw + (x - box.x0)) * 4;
      for (let k = 0; k < 3; k++) scene[si + k] = scene[si + k] + (patch[pi + k] - scene[si + k]) * a;
    }
}
