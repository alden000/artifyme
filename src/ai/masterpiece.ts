// Masterpiece+ — on‑device generative repainting.
//
// Image‑to‑image with a Latent Consistency Model (LCM‑DreamShaper‑v7): the photo
// itself is encoded, partly re‑noised and repainted in 4 steps, so the result keeps
// your scene — layout, pose, lighting, colours — while the brushwork, forms and
// palette move toward the chosen style. Runs with onnxruntime‑web on WebGPU.
// Nothing is uploaded.
import type * as ORT from 'onnxruntime-web';
import { lcmImg2Img } from './lcm';
import { blendPatch, featherMask, fitSize, maskBox, maskIn, maskOutside, resizeMap, subjectBoxes, type Box } from './split';

export const MP_DOWNLOAD_MB = 945; // UNet weights + runtime + autoencoder + people finder
const BASE = new URL('models/mp2/', document.baseURI).href;
const CHUNKS = 26;
const CACHE = 'artifyme-mp-v2';
// v1 engine, plus the classic models and a service‑worker copy of the painter.
const OLD_CACHES = ['artifyme-mp-v1', 'artifyme-models-v1'];
// 640 px: small subjects (a child in a wide shot) survive far better than at 512,
// without 768's ~7× attention memory on phone GPUs.
const SIDE = 640;
const STEPS = 4;
/** People are repainted from a crop this big, at most this strength. */
const PEOPLE_SIDE = 512;
const PEOPLE_STRENGTH = 0.3;
const FILES = ['graph.f16.onnx', 'vae_encoder.onnx', 'vae_decoder.onnx', 'seg.onnx'];

export interface Support {
  ok: boolean;
  reason?: string;
}

let supportP: Promise<Support> | null = null;
export function mpSupport(): Promise<Support> {
  supportP ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (o?: unknown) => Promise<GPUAdapterLike | null> } }).gpu;
    if (!gpu) return { ok: false, reason: 'Needs WebGPU (iOS 26+, recent Chrome on Android).' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (!adapter) return { ok: false, reason: 'No compatible graphics chip found.' };
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mem && mem < 6) return { ok: false, reason: 'Needs a device with at least 8 GB of memory.' };
    // The painter is 1.7 GB in half precision; full precision would not fit in a browser.
    if (!adapter.features.has('shader-f16')) return { ok: false, reason: 'Your graphics chip lacks half‑precision support.' };
    if (adapter.limits.maxBufferSize < 256 * 1024 * 1024) return { ok: false, reason: 'Graphics memory limits are too small.' };
    return { ok: true };
  })();
  return supportP;
}
interface GPUAdapterLike {
  features: { has(f: string): boolean };
  limits: { maxBufferSize: number };
}

/** Free the space used by earlier Masterpiece+ engines. */
function dropOldCaches() {
  OLD_CACHES.forEach((c) => caches.delete(c).catch(() => {}));
}

export async function mpInstalled(): Promise<boolean> {
  try {
    const c = await caches.open(CACHE);
    for (let i = 0; i < CHUNKS; i++) if (!(await c.match(`${BASE}weights.q8.${String(i).padStart(2, '0')}`))) return false;
    for (const f of FILES) if (!(await c.match(BASE + f))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function mpRemove() {
  await caches.delete(CACHE).catch(() => {});
  dropOldCaches();
  sessions = null;
}

type Progress = (phase: 'download' | 'unpack' | 'compile', p: number) => void;

function runWorker(req: object, onProgress: Progress): Promise<ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./mp-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.phase, m.p);
      else if (m.type === 'weights') {
        resolve(m.buffer);
        w.terminate();
      } else if (m.type === 'done') {
        resolve(null);
        w.terminate();
      } else if (m.type === 'error') {
        reject(new Error(m.message));
        w.terminate();
      }
    };
    w.onerror = (e) => {
      reject(new Error(e.message || 'Worker failed'));
      w.terminate();
    };
    w.postMessage(req);
  });
}

/** Download everything for offline use (no GPU work). */
export async function mpDownload(onProgress: Progress) {
  dropOldCaches();
  await runWorker({ base: BASE, key: 'w16', chunks: CHUNKS, cacheName: CACHE, downloadOnly: true }, onProgress);
  const c = await caches.open(CACHE);
  await Promise.all(FILES.map(async (f) => (await c.match(BASE + f)) || c.add(BASE + f).catch(() => {})));
}

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
let loading: Promise<void> | null = null;

export const mpReady = () => !!sessions;

export function mpLoad(onProgress: Progress = () => {}): Promise<void> {
  if (sessions) return Promise.resolve();
  loading ??= (async () => {
    const sup = await mpSupport();
    if (!sup.ok) throw new Error(sup.reason);
    dropOldCaches();
    const ort = await getOrt();
    const weights = await runWorker({ base: BASE, key: 'w16', chunks: CHUNKS, cacheName: CACHE }, onProgress);
    onProgress('compile', 0);
    const opts: ORT.InferenceSession.SessionOptions = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' };
    const unet = await ort.InferenceSession.create(await cachedBytes('graph.f16.onnx'), { ...opts, externalData: [{ path: 'w', data: new Uint8Array(weights!) }] });
    onProgress('compile', 0.85);
    const enc = await ort.InferenceSession.create(await cachedBytes('vae_encoder.onnx'), opts);
    const dec = await ort.InferenceSession.create(await cachedBytes('vae_decoder.onnx'), opts);
    const seg = await ort.InferenceSession.create(await cachedBytes('seg.onnx'), opts);
    onProgress('compile', 1);
    sessions = { unet, enc, dec, seg };
  })();
  loading.catch(() => (loading = null));
  return loading;
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

export interface PaintOptions {
  style: string;
  /** 0.25 (faithful to the photo) … 0.6 (artistic freedom). */
  strength: number;
  keepColors: boolean;
  /** Repaint people & pets from an enlarged crop so they stay recognisable. */
  protectPeople?: boolean;
  seed: number;
  onStep?: (i: number, n: number) => void;
  onPhase?: (phase: 'scene' | 'people') => void;
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Draw (part of) a source into a w×h canvas and return its pixels. */
function grab(src: CanvasImageSource, w: number, h: number, sx?: number, sy?: number, sw?: number, sh?: number) {
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
async function subjectMask(photo: HTMLCanvasElement, W: number, H: number) {
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

/** Repaint a photo. Returns a canvas at ~2× the model resolution. */
export async function mpPaint(photo: HTMLCanvasElement, o: PaintOptions): Promise<HTMLCanvasElement> {
  if (!sessions) throw new Error('Masterpiece+ is not loaded');
  const s = SIDE / Math.max(photo.width, photo.height);
  const W = Math.max(256, Math.round((photo.width * s) / 64) * 64), H = Math.max(256, Math.round((photo.height * s) / 64) * 64);
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
      boxes = subjectBoxes(mask, W, H, PEOPLE_SIDE / 1.3);
      rest = maskOutside(mask, W, boxes);
      restBox = maskBox(rest, W, H);
    } catch (e) {
      console.warn('Masterpiece+: people finder failed, painting the whole scene', e);
    }
  }
  const faithful = Math.min(o.strength, PEOPLE_STRENGTH);
  if (faithful >= o.strength) restBox = null; // the scene pass is already faithful
  // Progress: every pass gets an equal slice.
  const passes = 1 + (restBox ? 1 : 0) + boxes.length;
  let pass = 0;
  const step = (i: number, n: number) => o.onStep?.((pass * n + i) / passes, n);
  o.onPhase?.('scene');
  const out = await img2img(src, o.style, o.strength, o.seed, step);
  pass++;

  if (passes > 1) o.onPhase?.('people');
  if (restBox && rest) {
    const near = await img2img(src, o.style, faithful, o.seed, step);
    pass++;
    blendPatch(out.data, W, near.data, { x0: 0, y0: 0, x1: W, y1: H, size: restBox.size }, featherMask(rest, W, H, restBox.size));
  }
  for (const box of boxes) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    // Crop from the full‑resolution photo for the most detail.
    const sx = photo.width / W, sy = photo.height / H;
    const fit = fitSize(bw * sx, bh * sy, PEOPLE_SIDE);
    const crop = grab(photo, fit.w, fit.h, box.x0 * sx, box.y0 * sy, bw * sx, bh * sy);
    const painted = await img2img(crop, o.style, faithful, o.seed, step);
    pass++;
    const pc = canvas(fit.w, fit.h);
    pc.getContext('2d')!.putImageData(painted, 0, 0);
    const patch = grab(pc, bw, bh);
    blendPatch(out.data, W, patch.data, box, featherMask(maskIn(mask!, W, box), W, H, box.size));
  }

  if (o.keepColors) keepOriginalColors(out, src);
  const result = canvas(W, H);
  result.getContext('2d')!.putImageData(out, 0, 0);
  return upscale(result, photo.width / photo.height);
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

/** 2× upscale with a gentle unsharp mask, restoring the photo's aspect ratio. */
function upscale(src: HTMLCanvasElement, aspect: number) {
  const long = src.width * 2 > src.height * 2 ? src.width * 2 : src.height * 2;
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const blurC = document.createElement('canvas');
  blurC.width = w;
  blurC.height = h;
  const bctx = blurC.getContext('2d', { willReadFrequently: true })!;
  bctx.filter = 'blur(1.2px)';
  bctx.drawImage(c, 0, 0);
  const a = ctx.getImageData(0, 0, w, h), b = bctx.getImageData(0, 0, w, h);
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k++) a.data[i + k] = a.data[i + k] + (a.data[i + k] - b.data[i + k]) * 0.55;
  }
  ctx.putImageData(a, 0, 0);
  return c;
}
