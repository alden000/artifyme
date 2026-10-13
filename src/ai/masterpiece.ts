// Masterpiece+ — on‑device generative repainting.
//
// A one‑step latent diffusion model (SDXS‑512‑DreamShaper, OpenRAIL++) guided by
// a sketch ControlNet. The photo is reduced to an ink drawing, and the model
// *redraws* it in the chosen artist's hand — new brushwork, new forms, the
// artist's own way of depicting a face — rather than recolouring the photo.
// Runs with onnxruntime‑web on WebGPU. Nothing is uploaded.
import type * as ORT from 'onnxruntime-web';

export const MP_DOWNLOAD_MB = 555; // weights + runtime + decoder + line‑art model
const BASE = new URL('models/mp/', document.baseURI).href;
const CHUNKS = 16;
const CACHE = 'artifyme-mp-v1';
const SIDE = 512;
// v2: fp16 graph with fp32 timestep embedding + float Resize scales (v1 failed to load on phones).
const GRAPH = { fp16: 'graph.f16.v2.onnx', fp32: 'graph.f32.v2.onnx' } as const;
const STALE = ['graph.f16.onnx', 'graph.f32.onnx'];
// scaled‑linear schedule, ᾱ at t = 999 (the model's single step)
const AC999 = (() => {
  let ac = 1;
  const b0 = Math.sqrt(0.00085), b1 = Math.sqrt(0.012);
  for (let i = 0; i < 1000; i++) ac *= 1 - (b0 + ((b1 - b0) * i) / 999) ** 2;
  return ac;
})();

export const SUBJECTS = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'child', label: 'Child' },
  { id: 'people', label: 'People' },
  { id: 'dog', label: 'Dog' },
  { id: 'cat', label: 'Cat' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'city', label: 'City' },
  { id: 'object', label: 'Object' },
] as const;
export type Subject = (typeof SUBJECTS)[number]['id'];

export interface Support {
  ok: boolean;
  reason?: string;
  precision?: 'fp16' | 'fp32';
}

let supportP: Promise<Support> | null = null;
export function mpSupport(): Promise<Support> {
  supportP ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (o?: unknown) => Promise<GPUAdapterLike | null> } }).gpu;
    if (!gpu) return { ok: false, reason: 'Needs WebGPU (iOS 26+, recent Chrome on Android).' };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (!adapter) return { ok: false, reason: 'No compatible graphics chip found.' };
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mem && mem < 4) return { ok: false, reason: 'Needs a phone with at least 6 GB of memory.' };
    const f16 = adapter.features.has('shader-f16');
    if (!f16 && isPhone()) return { ok: false, reason: 'Your graphics chip lacks half‑precision support.' };
    if (adapter.limits.maxBufferSize < 256 * 1024 * 1024) return { ok: false, reason: 'Graphics memory limits are too small.' };
    return { ok: true, precision: f16 ? 'fp16' : 'fp32' };
  })();
  return supportP;
}
interface GPUAdapterLike {
  features: { has(f: string): boolean };
  limits: { maxBufferSize: number };
}
const isPhone = () => matchMedia('(pointer: coarse)').matches;

export async function mpInstalled(): Promise<boolean> {
  try {
    const c = await caches.open(CACHE);
    for (let i = 0; i < CHUNKS; i++) if (!(await c.match(`${BASE}weights.q8.${String(i).padStart(2, '0')}`))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function mpRemove() {
  await caches.delete(CACHE).catch(() => {});
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
  await runWorker({ base: BASE, key: 'w16', chunks: CHUNKS, cacheName: CACHE, downloadOnly: true }, onProgress);
  // Warm the small files into the cache too.
  const c = await caches.open(CACHE);
  await Promise.all([GRAPH.fp16, GRAPH.fp32, 'vae_decoder.onnx', 'lineart.onnx'].map(async (f) => (await c.match(BASE + f)) || c.add(BASE + f).catch(() => {})));
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

let sessions: { unet: ORT.InferenceSession; dec: ORT.InferenceSession; lines: ORT.InferenceSession } | null = null;
let loading: Promise<void> | null = null;

export const mpReady = () => !!sessions;

export function mpLoad(onProgress: Progress = () => {}): Promise<void> {
  if (sessions) return Promise.resolve();
  loading ??= (async () => {
    const sup = await mpSupport();
    if (!sup.ok) throw new Error(sup.reason);
    const ort = await getOrt();
    const key = sup.precision === 'fp16' ? 'w16' : 'w32';
    const weights = await runWorker({ base: BASE, key, chunks: CHUNKS, cacheName: CACHE }, onProgress);
    onProgress('compile', 0);
    caches.open(CACHE).then((c) => STALE.forEach((f) => c.delete(BASE + f))).catch(() => {});
    const graph = await cachedBytes(GRAPH[sup.precision === 'fp16' ? 'fp16' : 'fp32']);
    const opts: ORT.InferenceSession.SessionOptions = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' };
    const unet = await ort.InferenceSession.create(graph, { ...opts, externalData: [{ path: 'w', data: new Uint8Array(weights!) }] });
    onProgress('compile', 0.8);
    const dec = await ort.InferenceSession.create(await cachedBytes('vae_decoder.onnx'), opts);
    onProgress('compile', 0.9);
    // Learned line‑art extractor ("Informative Drawings"): clean, artist‑like outlines
    // make the painter follow the photo's composition and faces far more closely.
    const lines = await ort.InferenceSession.create(await cachedBytes('lineart.onnx'), opts);
    onProgress('compile', 1);
    sessions = { unet, dec, lines };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

// ── per‑style prompt embeddings (precomputed with CLIP at build time) ──
const embCache = new Map<string, Promise<Float32Array>>();
function styleEmbedding(style: string, subject: Subject): Promise<Float32Array> {
  const k = `${style}|${subject}`;
  let p = embCache.get(k);
  if (!p) {
    p = (async () => {
      const idx = SUBJECTS.findIndex((s) => s.id === subject);
      const bytes = await cachedBytes(`emb2/${style}.bin`);
      const per = 77 * 768;
      const h = new Uint16Array(bytes.buffer, bytes.byteOffset + idx * per * 2, per);
      const out = new Float32Array(per);
      for (let i = 0; i < per; i++) {
        const v = h[i];
        const s = v & 0x8000 ? -1 : 1, e = (v >> 10) & 0x1f, m = v & 0x3ff;
        out[i] = e === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (e - 15) * (1 + m / 1024);
      }
      return out;
    })();
    embCache.set(k, p);
  }
  return p;
}

function gaussian(seed: number, n: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s + 0.5) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = rnd(), v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

export interface PaintOptions {
  style: string;
  subject: Subject;
  /** 0.5..1 — how closely to follow the photo's lines. */
  fidelity: number;
  keepColors: boolean;
  seed: number;
}

/** Repaint a photo. Returns a canvas at ~2× the model resolution. */
export async function mpPaint(photo: HTMLCanvasElement, o: PaintOptions): Promise<HTMLCanvasElement> {
  if (!sessions) throw new Error('Masterpiece+ is not loaded');
  const ort = await getOrt();
  const { unet, dec } = sessions;
  const s = SIDE / Math.max(photo.width, photo.height);
  const W = Math.max(256, Math.round((photo.width * s) / 64) * 64), H = Math.max(256, Math.round((photo.height * s) / 64) * 64);
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(photo, 0, 0, W, H);
  // Photo → line drawing (1 = paper, 0 = ink).
  const px = sctx.getImageData(0, 0, W, H).data;
  const plane = W * H;
  const rgb = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    rgb[i] = px[i * 4] / 255;
    rgb[plane + i] = px[i * 4 + 1] / 255;
    rgb[2 * plane + i] = px[i * 4 + 2] / 255;
  }
  const lr = await sessions.lines.run({ image: new ort.Tensor('float32', rgb, [1, 3, H, W]) });
  const lines = (await lr.lines.getData()) as Float32Array;
  Object.values(lr).forEach((t) => t.dispose?.());
  const cond = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const v = Math.min(1, Math.max(0, lines[i]));
    cond[i] = v;
    cond[plane + i] = v;
    cond[2 * plane + i] = v;
  }

  const lh = H / 8, lw = W / 8;
  const x = gaussian(o.seed, 4 * lh * lw);
  const emb = await styleEmbedding(o.style, o.subject);
  const feeds = {
    sample: new ort.Tensor('float32', x, [1, 4, lh, lw]),
    timestep: new ort.Tensor('int64', BigInt64Array.from([999n]), [1]),
    emb: new ort.Tensor('float32', emb, [1, 77, 768]),
    cond: new ort.Tensor('float32', cond, [1, 3, H, W]),
    cscale: new ort.Tensor('float32', Float32Array.from([o.fidelity]), [1]),
  };
  const r = await unet.run(feeds);
  const eps = (await r.eps.getData()) as Float32Array;
  const a = Math.sqrt(AC999), b = Math.sqrt(1 - AC999);
  const z = new Float32Array(x.length);
  for (let i = 0; i < z.length; i++) z[i] = (x[i] - b * eps[i]) / a;
  Object.values(r).forEach((t) => t.dispose?.());
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
  if (o.keepColors) keepOriginalColors(out, sctx.getImageData(0, 0, W, H));
  const painted = document.createElement('canvas');
  painted.width = W;
  painted.height = H;
  painted.getContext('2d')!.putImageData(out, 0, 0);
  return upscale(painted, photo.width / photo.height);
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
