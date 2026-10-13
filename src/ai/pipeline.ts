import type { ArtStyle } from '../data/styles';
import { fitSize, rasterize, stylizeCanvas } from './engine';
import { renderProcedural } from './procedural';
import { applyFinish, DEFAULT_FINISH } from './finish';

export type Quality = 'swift' | 'studio' | 'gallery';

// The network paints at a modest size (bolder, more painterly strokes); the Atelier
// finish then repaints & upscales to the final output size.
export const QUALITY: Record<Quality, { label: string; hint: string; maxSide: number; nnSide: number; model: 'fast' | 'hq' }> = {
  swift: { label: 'Swift', hint: '1024px · fastest', maxSide: 1024, nnSide: 448, model: 'fast' },
  studio: { label: 'Studio', hint: '1600px · balanced', maxSide: 1600, nnSide: 640, model: 'hq' },
  gallery: { label: 'Gallery', hint: '2048px · finest', maxSide: 2048, nnSide: 768, model: 'hq' },
};

export interface RenderSettings {
  quality: Quality;
  /** 0..1 — blend between original and the full style. */
  intensity: number;
  /** Keep the original photo's colours, take only texture & light from the style. */
  preserveColor: boolean;
  /** 0..1 — block/pixel density for Pixel Worlds. */
  detail: number;
  /** Painterly post‑process: brushstrokes, palette, impasto, canvas. */
  finish: boolean;
}

export const DEFAULT_SETTINGS: RenderSettings = { quality: 'studio', intensity: 1, preserveColor: false, detail: 0.55, finish: true };

function transferColor(stylized: HTMLCanvasElement, original: HTMLCanvasElement) {
  const w = stylized.width, h = stylized.height;
  const sctx = stylized.getContext('2d', { willReadFrequently: true })!;
  const o = rasterize(original, w, h).getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const img = sctx.getImageData(0, 0, w, h);
  const s = img.data;
  for (let i = 0; i < s.length; i += 4) {
    const y = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
    const cb = -0.168736 * o[i] - 0.331264 * o[i + 1] + 0.5 * o[i + 2];
    const cr = 0.5 * o[i] - 0.418688 * o[i + 1] - 0.081312 * o[i + 2];
    s[i] = y + 1.402 * cr;
    s[i + 1] = y - 0.344136 * cb - 0.714136 * cr;
    s[i + 2] = y + 1.772 * cb;
  }
  sctx.putImageData(img, 0, 0);
}

function blendWithOriginal(stylized: HTMLCanvasElement, original: CanvasImageSource, intensity: number) {
  if (intensity >= 0.999) return stylized;
  const out = document.createElement('canvas');
  out.width = stylized.width;
  out.height = stylized.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(original, 0, 0, out.width, out.height);
  ctx.globalAlpha = Math.max(0, intensity);
  ctx.drawImage(stylized, 0, 0);
  return out;
}

/**
 * Render a still frame in the chosen style.
 * `src` may be any drawable; `sw/sh` are its natural dimensions.
 */
export async function renderStyle(
  style: ArtStyle,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  settings: RenderSettings,
  opts: { maxSide?: number; model?: 'fast' | 'hq' } = {},
): Promise<HTMLCanvasElement> {
  if (style.kind === 'procedural' && style.procedural) {
    const out = renderProcedural(style.procedural, src, sw, sh, settings.detail);
    return blendWithOriginal(out, src, settings.intensity);
  }
  const q = QUALITY[settings.quality];
  const outSide = opts.maxSide ?? q.maxSide;
  if (settings.finish === false) {
    const size = fitSize(sw, sh, Math.min(outSide, 1280));
    const content = rasterize(src, size.width, size.height);
    const out = await stylizeCanvas(content, style.bottleneck!, opts.model ?? q.model);
    if (settings.preserveColor) transferColor(out, content);
    return blendWithOriginal(out, content, settings.intensity);
  }
  const nn = fitSize(sw, sh, Math.min(outSide, q.nnSide));
  const content = rasterize(src, nn.width, nn.height);
  const styled = await stylizeCanvas(content, style.bottleneck!, opts.model ?? q.model);
  if (settings.preserveColor) transferColor(styled, content);
  // Final size: the quality target, but never more than ~1.5× the source's own pixels.
  const out = fitSize(sw, sh, Math.max(nn.width, nn.height, Math.min(outSide, Math.max(sw, sh) * 1.5)), 2);
  const photo = rasterize(src, out.width, out.height);
  const painted = applyFinish(styled, photo, out.width, out.height, style.finish ?? DEFAULT_FINISH, settings.preserveColor ? null : (style.palette ?? null));
  return blendWithOriginal(painted, photo, settings.intensity);
}
