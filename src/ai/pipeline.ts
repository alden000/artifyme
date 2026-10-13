import type { ArtStyle } from '../data/styles';
import { fitSize, rasterize, stylizeCanvas } from './engine';
import { renderProcedural } from './procedural';

export type Quality = 'swift' | 'studio' | 'gallery';

export const QUALITY: Record<Quality, { label: string; hint: string; maxSide: number; model: 'fast' | 'hq' }> = {
  swift: { label: 'Swift', hint: '512px · fastest', maxSide: 512, model: 'fast' },
  studio: { label: 'Studio', hint: '896px · balanced', maxSide: 896, model: 'hq' },
  gallery: { label: 'Gallery', hint: '1280px · finest', maxSide: 1280, model: 'hq' },
};

export interface RenderSettings {
  quality: Quality;
  /** 0..1 — blend between original and the full style. */
  intensity: number;
  /** Keep the original photo's colours, take only texture & light from the style. */
  preserveColor: boolean;
  /** 0..1 — block/pixel density for Pixel Worlds. */
  detail: number;
}

export const DEFAULT_SETTINGS: RenderSettings = { quality: 'studio', intensity: 1, preserveColor: false, detail: 0.55 };

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
  const size = fitSize(sw, sh, opts.maxSide ?? q.maxSide);
  const content = rasterize(src, size.width, size.height);
  const out = await stylizeCanvas(content, style.bottleneck!, opts.model ?? q.model);
  if (settings.preserveColor) transferColor(out, content);
  return blendWithOriginal(out, content, settings.intensity);
}
