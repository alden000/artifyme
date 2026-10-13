// On‑device neural style transfer (Magenta arbitrary image stylization).
// All inference runs in the browser via WebGL — pixels never leave the device.
import type * as TF from '@tensorflow/tfjs';

export type ModelKey = 'fast' | 'hq' | 'style';

const MODEL_URLS: Record<ModelKey, string> = {
  fast: 'models/transformer-fast/model.json',
  hq: 'models/transformer-hq/model.json',
  style: 'models/style-mobile/model.json',
};

export const MODEL_SIZES_MB: Record<ModelKey, number> = { fast: 2.4, hq: 7.6, style: 9.3 };

let tfPromise: Promise<typeof TF> | null = null;
const models = new Map<ModelKey, Promise<TF.GraphModel>>();
const progressListeners = new Set<(key: ModelKey, p: number) => void>();

export function onModelProgress(fn: (key: ModelKey, p: number) => void) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export async function getTf(): Promise<typeof TF> {
  if (!tfPromise) {
    tfPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      try {
        await tf.setBackend('webgl');
      } catch {
        /* falls through to whatever backend is available */
      }
      await tf.ready();
      if (tf.getBackend() === 'webgl') {
        // Phones (iOS especially) kill tabs that hoard GPU memory: recycle textures beyond 128 MB.
        tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 128 * 1024 * 1024);
        // im2col turns the 9×9 convolutions into one huge matrix (13k² textures at 896px),
        // far beyond phone GPU limits. Direct convolution keeps every texture small.
        tf.env().set('WEBGL_CONV_IM2COL', false);
      }
      return tf;
    })();
  }
  return tfPromise;
}

export async function backendName() {
  const tf = await getTf();
  return tf.getBackend();
}

export function isModelLoaded(key: ModelKey) {
  return models.has(key);
}

export function loadModel(key: ModelKey): Promise<TF.GraphModel> {
  let p = models.get(key);
  if (!p) {
    p = (async () => {
      const tf = await getTf();
      const model = await tf.loadGraphModel(MODEL_URLS[key], {
        onProgress: (f) => progressListeners.forEach((l) => l(key, f)),
      });
      progressListeners.forEach((l) => l(key, 1));
      return model;
    })();
    p.catch(() => models.delete(key));
    models.set(key, p);
  }
  return p;
}

/** Warm the GPU shaders so the first real render feels instant. */
export async function warmUp(key: Exclude<ModelKey, 'style'> = 'fast') {
  const tf = await getTf();
  const model = await loadModel(key);
  const out = tf.tidy(() => model.predict([tf.zeros([1, 64, 64, 3]), tf.zeros([1, 1, 1, 100])]) as TF.Tensor);
  await out.data();
  out.dispose();
}

export interface StylizeOptions {
  bottleneck: number[];
  model: 'fast' | 'hq';
  /** Longest output side in pixels. */
  maxSide: number;
}

export function fitSize(w: number, h: number, maxSide: number, multiple = 4) {
  // Small sources are upscaled (≤2×) so brushwork stays fine relative to the subject.
  const scale = Math.min(2, maxSide / Math.max(w, h));
  const fw = Math.max(multiple, Math.round((w * scale) / multiple) * multiple);
  const fh = Math.max(multiple, Math.round((h * scale) / multiple) * multiple);
  return { width: fw, height: fh };
}

/** Draw any image source into a canvas of the requested size. */
export function rasterize(src: CanvasImageSource, width: number, height: number, target?: HTMLCanvasElement) {
  const c = target ?? document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return c;
}

/**
 * Stylize a canvas. Returns a new canvas of identical size.
 * The content canvas must already be at the desired processing resolution.
 */
export async function stylizeCanvas(content: HTMLCanvasElement, bottleneck: number[], model: 'fast' | 'hq', out?: HTMLCanvasElement) {
  const tf = await getTf();
  const net = await loadModel(model);
  const result = tf.tidy(() => {
    const img = tf.browser.fromPixels(content).toFloat().div(255).expandDims(0);
    const b = tf.tensor4d(bottleneck, [1, 1, 1, 100]);
    const y = (net.predict([img, b]) as TF.Tensor4D).squeeze([0]) as TF.Tensor3D;
    // Model output can be a few pixels off for odd sizes; snap back to the input size.
    const fixed = y.shape[0] !== content.height || y.shape[1] !== content.width ? tf.image.resizeBilinear(y, [content.height, content.width]) : y;
    return fixed.clipByValue(0, 1) as TF.Tensor3D;
  });
  const canvas = out ?? document.createElement('canvas');
  canvas.width = content.width;
  canvas.height = content.height;
  await tf.browser.toPixels(result, canvas);
  result.dispose();
  return canvas;
}

/** Compute the style embedding of an arbitrary artwork (for "Your own style"). */
export async function styleBottleneck(art: CanvasImageSource & { width: number; height: number }) {
  const tf = await getTf();
  const net = await loadModel('style');
  const c = document.createElement('canvas');
  // The predictor was trained on 256px crops.
  const s = 256 / Math.min(Number(art.width), Number(art.height));
  c.width = Math.round(Number(art.width) * s);
  c.height = Math.round(Number(art.height) * s);
  c.getContext('2d')!.drawImage(art, 0, 0, c.width, c.height);
  const v = tf.tidy(() => (net.predict(tf.browser.fromPixels(c).toFloat().div(255).expandDims(0)) as TF.Tensor).reshape([100]));
  const arr = Array.from(await v.data());
  v.dispose();
  return arr;
}

/** Download every model ahead of time so the studio works fully offline. */
export async function preloadAll() {
  await Promise.all((Object.keys(MODEL_URLS) as ModelKey[]).map((k) => loadModel(k)));
}
