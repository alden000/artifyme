// Masterpiece+ — main‑thread API. The painter itself runs in a Web Worker
// (mp-engine.worker.ts) that is shut down soon after use: keeping 1.7 GB of weights
// resident made the whole phone sluggish. Nothing is uploaded.
import type { LoadProgress, PaintOptions as EngineOptions } from './mp-engine';

export const MP_DOWNLOAD_MB = 945; // UNet weights + runtime + autoencoder + people finder
const BASE = new URL('models/mp2/', document.baseURI).href;
const CHUNKS = 26;
const CACHE = 'artifyme-mp-v2';
// v1 engine, plus the classic models and a service‑worker copy of the painter.
const OLD_CACHES = ['artifyme-mp-v1', 'artifyme-models-v1'];
const FILES = ['graph.f16.onnx', 'vae_encoder.onnx', 'vae_decoder.onnx', 'seg.onnx'];
/** Free the painter this long after the last paint (Restyle / Paint again within it are instant). */
const IDLE_MS = 60_000;

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
  mpRelease();
}

type Progress = LoadProgress;

/** Download everything for offline use (no GPU work). */
export async function mpDownload(onProgress: Progress) {
  dropOldCaches();
  await new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL('./mp-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.phase, m.p);
      else {
        w.terminate();
        if (m.type === 'done') resolve();
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Worker failed'));
    };
    w.postMessage({ base: BASE, key: 'w16', chunks: CHUNKS, cacheName: CACHE });
  });
  const c = await caches.open(CACHE);
  await Promise.all(FILES.map(async (f) => (await c.match(BASE + f)) || c.add(BASE + f).catch(() => {})));
}

// ── engine host: a worker, or the main thread where workers lack WebGPU ──
interface Host {
  load(onProgress: Progress): Promise<void>;
  paint(photo: ImageBitmap, o: EngineOptions, onStep?: (i: number, n: number) => void, onPhase?: (p: 'scene' | 'people') => void): Promise<ImageData>;
  dispose(): void;
}

class NoWorkerGpu extends Error {}

function workerHost(): Host {
  const w = new Worker(new URL('./mp-engine.worker.ts', import.meta.url), { type: 'module' });
  type Handler = (m: { type: string; [k: string]: unknown }) => void;
  let handler: Handler = () => {};
  let fail: (e: Error) => void = () => {};
  w.onmessage = (e) => handler(e.data);
  w.onerror = (e) => fail(new Error(e.message || 'The painter stopped unexpectedly.'));
  const call = <T>(msg: object, transfer: Transferable[], on: (m: { type: string; [k: string]: unknown }, done: (v: T) => void) => void) =>
    new Promise<T>((resolve, reject) => {
      fail = reject;
      handler = (m) => {
        if (m.type === 'error') reject(m.code === 'no-webgpu' ? new NoWorkerGpu() : new Error(String(m.message)));
        else on(m, resolve);
      };
      w.postMessage(msg, transfer);
    });
  return {
    load: (onProgress) =>
      call<void>({ type: 'load', cfg: { base: BASE, cacheName: CACHE, chunks: CHUNKS } }, [], (m, done) => {
        if (m.type === 'progress') onProgress(m.phase as 'download', m.p as number);
        else if (m.type === 'loaded') done();
      }),
    paint: (photo, opts, onStep, onPhase) =>
      call<ImageData>({ type: 'paint', photo, opts }, [photo], (m, done) => {
        if (m.type === 'step') onStep?.(m.i as number, m.n as number);
        else if (m.type === 'phase') onPhase?.(m.phase as 'scene');
        else if (m.type === 'painted') done(new ImageData(new Uint8ClampedArray(m.data as ArrayBuffer), m.width as number, m.height as number));
      }),
    // Terminating the worker frees its GPU buffers and WebAssembly memory at once.
    dispose: () => w.terminate(),
  };
}

async function mainThreadHost(): Promise<Host> {
  const eng = await import('./mp-engine');
  return {
    load: (onProgress) => eng.load({ base: BASE, cacheName: CACHE, chunks: CHUNKS }, onProgress),
    paint: (photo, opts, onStep, onPhase) => eng.paint(photo, opts, { onStep, onPhase }),
    dispose: () => void eng.release(),
  };
}

let host: Host | null = null;
let ready = false;
let loading: Promise<void> | null = null;
let busy = false;
let idleTimer = 0;

export const mpReady = () => ready;

export function mpLoad(onProgress: Progress = () => {}): Promise<void> {
  clearTimeout(idleTimer);
  if (ready) return Promise.resolve();
  loading ??= (async () => {
    const sup = await mpSupport();
    if (!sup.ok) throw new Error(sup.reason);
    dropOldCaches();
    try {
      host = workerHost();
      await host.load(onProgress);
    } catch (e) {
      host?.dispose();
      host = null;
      if (!(e instanceof NoWorkerGpu)) throw e;
      host = await mainThreadHost();
      await host.load(onProgress);
    }
    ready = true;
  })();
  loading.catch(() => {
    host?.dispose();
    host = null;
  });
  loading.finally(() => (loading = null)).catch(() => {});
  return loading;
}

/** Free the painter's memory now (the next paint reloads it from the on‑device cache). */
export function mpRelease() {
  clearTimeout(idleTimer);
  if (busy || loading) return;
  host?.dispose();
  host = null;
  ready = false;
}

function scheduleRelease() {
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(mpRelease, IDLE_MS);
}
// Leaving the app: give the memory back straight away.
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && mpRelease());

export interface PaintOptions extends EngineOptions {
  onStep?: (i: number, n: number) => void;
  onPhase?: (phase: 'scene' | 'people') => void;
}

/** Repaint a photo. Returns a canvas at ~2× the model resolution. */
export async function mpPaint(photo: HTMLCanvasElement, o: PaintOptions): Promise<HTMLCanvasElement> {
  if (!host || !ready) throw new Error('Masterpiece+ is not loaded');
  clearTimeout(idleTimer);
  busy = true;
  try {
    const { onStep, onPhase, ...opts } = o;
    const out = await host.paint(await createImageBitmap(photo), opts, onStep, onPhase);
    const c = document.createElement('canvas');
    c.width = out.width;
    c.height = out.height;
    c.getContext('2d')!.putImageData(out, 0, 0);
    return upscale(c, photo.width / photo.height);
  } catch (e) {
    // A failed paint may leave the GPU in a bad state; start fresh next time.
    busy = false;
    mpRelease();
    throw e;
  } finally {
    busy = false;
    scheduleRelease();
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
