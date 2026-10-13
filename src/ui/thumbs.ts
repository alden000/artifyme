import type { ArtStyle } from '../data/styles';
import { renderProcedural } from '../ai/procedural';

const cache = new Map<string, Promise<string>>();

const SAMPLE: Record<string, string> = { minecraft: 'styles/vermeer.webp', arcade: 'styles/davinci.webp', bricks: 'styles/starry.webp' };

/** Pixel‑World cards show the effect applied to a famous painting. */
export function proceduralThumb(style: ArtStyle): Promise<string> {
  if (!style.procedural) return Promise.resolve(style.thumb);
  let p = cache.get(style.id);
  if (!p) {
    p = (async () => {
      const img = new Image();
      img.src = SAMPLE[style.procedural!];
      await img.decode();
      const out = renderProcedural(style.procedural!, img, img.naturalWidth, img.naturalHeight, 0.05);
      const t = document.createElement('canvas');
      t.width = 240;
      t.height = 320;
      const ctx = t.getContext('2d')!;
      ctx.imageSmoothingEnabled = style.procedural !== 'arcade' && style.procedural !== 'minecraft';
      ctx.drawImage(out, 0, 0, 240, 320);
      return t.toDataURL('image/webp', 0.85);
    })();
    cache.set(style.id, p);
  }
  return p;
}
