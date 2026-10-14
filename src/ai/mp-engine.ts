// Masterpiece+ engine — runs inside a Web Worker (see mp-engine.worker.ts) so that
// terminating the worker hands all of its memory (1.7 GB of weights on the GPU, plus
// WebAssembly memory a page can never shrink) back to the phone. It falls back to the
// main thread on browsers without WebGPU in workers.
//
// Image‑to‑image with a Latent Consistency Model (LCM‑DreamShaper‑v7): the photo
// itself is encoded, partly re‑noised and repainted in 4 steps, so the result keeps
// your scene — layout, pose, lighting, colours — while the brushwork, forms and
// palette move toward the chosen style. Nothing is uploaded.
import type * as ORT from 'onnxruntime-web';
import { lcmImg2Img } from './lcm';
import { blendPatch, featherMask, fitSize, maskBox, maskIn, maskOutside, resizeMap, subjectBoxes, type Box } from './split';
import { loadWeights } from './weights';

// Up to 640 px: small subjects (a child in a wide shot) survive far better than at 512.
// The real size is capped by the GPU, see sizeFor().
const SIDE = 640;
const STEPS = 4;
/** People are repainted from a crop this big. */
const PEOPLE_SIDE = 512;

export interface EngineConfig {
  base: string;
  cacheName: string;
  chunks: number;
}
export type LoadProgress = (phase: 'download' | 'unpack' | 'compile', p: number) => void;

export interface PaintOptions {
  style: string;
  /** Scene strength: 0.25 (faithful to the photo) … 0.75 (artistic freedom). */
  strength: number;
  keepColors: boolean;
  /** Repaint people & pets more faithfully so they stay recognisable. */
  protectPeople?: boolean;
  seed: number;
}
export interface PaintCallbacks {
  onStep?: (i: number, n: number) => void;
  onPhase?: (phase: 'scene' | 'people') => void;
}

/** People follow the slider, a notch more faithful than the scene. */
export const peopleStrength = (scene: number) => Math.min(0.5, Math.max(0.25, scene - 0.12));

let BASE = '';
let CACHE = '';

let ortP: Promise<typeof ORT> | null = null;
async function getOrt() {
  ortP ??= (async () => {
    const ort = await import('onnxruntime-web/webgpu');
    const wasm = (await import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url')).default;
    ort.env.wasm.wasmPaths = { wasm };
    ort.env.wasm.numThreads = 1; // GitHub Pages can't send COOP/COEP headers
    ort.env.logLevel = 'error';
    return ort as unknown as typeof ORT;
  })();
  return ortP;
}

async function cachedBytes(file: string) {
  const url = BASE + file;
  try {
    const c = await caches.open(CACHE);
    const hit = await c.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    await c.put(url, res.clone()).catch(() => {});
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const res = await fetch(url);
    if (!res.ok) throw e;
    return new Uint8Array(await res.arrayBuffer());
  }
}

let sessions: { unet: ORT.InferenceSession; enc: ORT.InferenceSession; dec: ORT.InferenceSession; seg: ORT.InferenceSession } | null = null;

// The UNet's top‑level self‑attention holds an 8 heads × N × N fp16 score matrix
// (N = latent pixels) in ONE GPU buffer. Past the device's per‑binding limit, phone
// GPUs don't fail — they silently compute garbage attention and the painting comes
// out as a smudge (seen on an S24 Ultra at 640 px: N = 4800 → 368 MB).
let maxTokens = 2304; // 288×512 — known good everywhere we've tried

async function readGpuBudget() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: unknown): Promise<{ limits: { maxStorageBufferBindingSize: number } } | null> } }).gpu;
  const a = await gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  const bind = a?.limits.maxStorageBufferBindingSize;
  // 4096 (512×512) is the most we've seen paint correctly on a phone.
  if (bind) maxTokens = Math.min(4096, Math.floor(Math.sqrt((bind * 0.9) / 16)));
  console.info('Masterpiece+: binding limit', bind, '→ max latent tokens', maxTokens);
}

/** Model size (multiples of 64) for a w×h image: long side ≤ side, and within the GPU budget. */
export function sizeFor(w: number, h: number, side: number) {
  for (let s = side; s >= 192; s -= 32) {
    const k = s / Math.max(w, h);
    const W = Math.max(128, Math.round((w * k) / 64) * 64), H = Math.max(128, Math.round((h * k) / 64) * 64);
    if ((W / 8) * (H / 8) <= maxTokens) return { w: W, h: H };
  }
  return w >= h ? { w: 256, h: 128 } : { w: 128, h: 256 };
}

export async function load(cfg: EngineConfig, onProgress: LoadProgress) {
  if (sessions) return;
  await readGpuBudget();
  BASE = cfg.base;
  CACHE = cfg.cacheName;
  const ort = await getOrt();
  let weights = await loadWeights({ base: cfg.base, key: 'w16', chunks: cfg.chunks, cacheName: cfg.cacheName }, onProgress);
  onProgress('compile', 0);
  const opts: ORT.InferenceSession.SessionOptions = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' };
  const unet = await ort.InferenceSession.create(await cachedBytes('graph.f16.onnx'), { ...opts, externalData: [{ path: 'w', data: new Uint8Array(weights!) }] });
  weights = null; // ORT has its own copy now
  onProgress('compile', 0.85);
  const enc = await ort.InferenceSession.create(await cachedBytes('vae_encoder.onnx'), opts);
  const dec = await ort.InferenceSession.create(await cachedBytes('vae_decoder.onnx'), opts);
  const seg = await ort.InferenceSession.create(await cachedBytes('seg.onnx'), opts);
  onProgress('compile', 1);
  sessions = { unet, enc, dec, seg };
}

export async function release() {
  const s = sessions;
  sessions = null;
  if (s) await Promise.all(Object.values(s).map((x) => x.release().catch(() => {})));
}

// ── per‑style prompt embeddings (CLIP, precomputed at build time; style‑only, scene‑neutral) ──
const embCache = new Map<string, Promise<Float32Array>>();
function styleEmbedding(style: string): Promise<Float32Array> {
  let p = embCache.get(style);
  if (!p) {
    p = (async () => {
      const bytes = await cachedBytes(`emb/${style}.bin`);
      const h = new Uint16Array(bytes.buffer, bytes.byteOffset, 77 * 768);
      const out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) {
        const v = h[i];
        const s = v & 0x8000 ? -1 : 1, e = (v >> 10) & 0x1f, m = v & 0x3ff;
        out[i] = e === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (e - 15) * (1 + m / 1024);
      }
      return out;
    })();
    embCache.set(style, p);
  }
  return p;
}

const canvas = (w: number, h: number) => new OffscreenCanvas(w, h);

/** Draw (part of) a source into a w×h canvas and return its pixels. */
function grab(src: CanvasImageSource | OffscreenCanvas, w: number, h: number, sx?: number, sy?: number, sw?: number, sh?: number) {
  const ctx = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  if (sx === undefined) ctx.drawImage(src, 0, 0, w, h);
  else ctx.drawImage(src, sx, sy!, sw!, sh!, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** One img2img pass on a W×H image (multiples of 64). */
async function img2img(px: ImageData, style: string, strength: number, seed: number, onStep?: (i: number, n: number) => void): Promise<ImageData> {
  const ort = await getOrt();
  const { unet, enc, dec } = sessions!;
  const { width: W, height: H } = px;
  const plane = W * H;
  const rgb = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    rgb[i] = px.data[i * 4] / 127.5 - 1;
    rgb[plane + i] = px.data[i * 4 + 1] / 127.5 - 1;
    rgb[2 * plane + i] = px.data[i * 4 + 2] / 127.5 - 1;
  }
  const er = await enc.run({ image: new ort.Tensor('float32', rgb, [1, 3, H, W]) });
  const init = (await er.latent.getData()) as Float32Array;
  Object.values(er).forEach((t) => t.dispose?.());

  const lh = H / 8, lw = W / 8;
  const emb = new ort.Tensor('float32', await styleEmbedding(style), [1, 77, 768]);
  const z = await lcmImg2Img({
    init,
    strength: Math.min(0.75, Math.max(0.2, strength)),
    steps: STEPS,
    seed,
    onStep,
    unet: async (x, t) => {
      const r = await unet.run({
        sample: new ort.Tensor('float32', x, [1, 4, lh, lw]),
        timestep: new ort.Tensor('int64', BigInt64Array.from([BigInt(t)]), [1]),
        emb,
      });
      const eps = (await r.eps.getData()) as Float32Array;
      Object.values(r).forEach((tt) => tt.dispose?.());
      return eps;
    },
  });
  const d = await dec.run({ latent: new ort.Tensor('float32', z, [1, 4, lh, lw]) });
  const img = (await d.image.getData()) as Float32Array;
  Object.values(d).forEach((t) => t.dispose?.());

  // CHW [-1,1] → RGBA
  const out = new ImageData(W, H);
  for (let i = 0; i < plane; i++) {
    out.data[i * 4] = (img[i] + 1) * 127.5;
    out.data[i * 4 + 1] = (img[plane + i] + 1) * 127.5;
    out.data[i * 4 + 2] = (img[2 * plane + i] + 1) * 127.5;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** P(person | dog | cat) per pixel, resampled to W×H. */
async function subjectMask(photo: ImageBitmap, W: number, H: number) {
  const ort = await getOrt();
  const { w, h } = fitSize(photo.width, photo.height, 512);
  const px = grab(photo, w, h).data;
  const plane = w * h;
  const rgb = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    rgb[i] = px[i * 4] / 255;
    rgb[plane + i] = px[i * 4 + 1] / 255;
    rgb[2 * plane + i] = px[i * 4 + 2] / 255;
  }
  const r = await sessions!.seg.run({ image: new ort.Tensor('float32', rgb, [1, 3, h, w]) });
  const m = (await r.mask.getData()) as Float32Array;
  Object.values(r).forEach((t) => t.dispose?.());
  return resizeMap(m, w, h, W, H);
}

/** Repaint a photo at model resolution (≤ 640 px; the caller upscales). */
export async function paint(photo: ImageBitmap, o: PaintOptions, cb: PaintCallbacks = {}): Promise<ImageData> {
  if (!sessions) throw new Error('Masterpiece+ is not loaded');
  const { w: W, h: H } = sizeFor(photo.width, photo.height, SIDE);
  const src = grab(photo, W, H);

  // Find people first so progress can be split between the passes.
  let boxes: Box[] = [];
  let mask: Float32Array | null = null;
  // People too big or too spread out for a crop (portraits, crowds) get a faithful
  // full‑frame pass instead, blended in through the same soft mask.
  let rest: Float32Array | null = null;
  let restBox: Box | null = null;
  if (o.protectPeople) {
    try {
      mask = await subjectMask(photo, W, H);
      // Only worth it when the crop gets ≥1.3× the scene's pixels per side.
      boxes = subjectBoxes(mask, W, H, sizeFor(1, 1, PEOPLE_SIDE).w / 1.3);
      rest = maskOutside(mask, W, boxes);
      restBox = maskBox(rest, W, H);
    } catch (e) {
      console.warn('Masterpiece+: people finder failed, painting the whole scene', e);
    }
  }
  const faithful = Math.min(o.strength, peopleStrength(o.strength));
  if (faithful >= o.strength) restBox = null; // the scene pass is already faithful
  // Progress: every pass gets an equal slice.
  const passes = 1 + (restBox ? 1 : 0) + boxes.length;
  let pass = 0;
  const step = (i: number, n: number) => cb.onStep?.((pass * n + i) / passes, n);
  cb.onPhase?.('scene');
  const out = await img2img(src, o.style, o.strength, o.seed, step);
  pass++;

  if (passes > 1) cb.onPhase?.('people');
  if (restBox && rest) {
    const near = await img2img(src, o.style, faithful, o.seed, step);
    pass++;
    blendPatch(out.data, W, near.data, { x0: 0, y0: 0, x1: W, y1: H, size: restBox.size }, featherMask(rest, W, H, restBox.size));
  }
  for (const box of boxes) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    // Crop from the full‑resolution photo for the most detail.
    const sx = photo.width / W, sy = photo.height / H;
    const fit = sizeFor(bw * sx, bh * sy, PEOPLE_SIDE);
    const crop = grab(photo, fit.w, fit.h, box.x0 * sx, box.y0 * sy, bw * sx, bh * sy);
    const painted = await img2img(crop, o.style, faithful, o.seed, step);
    pass++;
    const pc = canvas(fit.w, fit.h);
    pc.getContext('2d')!.putImageData(painted, 0, 0);
    const patch = grab(pc, bw, bh);
    blendPatch(out.data, W, patch.data, box, featherMask(maskIn(mask!, W, box), W, H, box.size));
  }

  if (o.keepColors) keepOriginalColors(out, src);
  return out;
}

/** Take luminance from the painting, colour (chroma) from the photo. */
function keepOriginalColors(paint: ImageData, photo: ImageData) {
  const p = paint.data, s = photo.data;
  for (let i = 0; i < p.length; i += 4) {
    const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const pcb = -0.1687 * p[i] - 0.3313 * p[i + 1] + 0.5 * p[i + 2];
    const pcr = 0.5 * p[i] - 0.4187 * p[i + 1] - 0.0813 * p[i + 2];
    const cb = 0.25 * pcb + 0.75 * (-0.1687 * s[i] - 0.3313 * s[i + 1] + 0.5 * s[i + 2]);
    const cr = 0.25 * pcr + 0.75 * (0.5 * s[i] - 0.4187 * s[i + 1] - 0.0813 * s[i + 2]);
    p[i] = y + 1.402 * cr;
    p[i + 1] = y - 0.3441 * cb - 0.7141 * cr;
    p[i + 2] = y + 1.772 * cb;
  }
}

