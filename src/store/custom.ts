// "Your Style": user‑supplied artworks distilled into a 100‑number embedding.
// Only the tiny embedding + a thumbnail are kept, locally.
import type { ArtStyle } from '../data/styles';
import { styleBottleneck } from '../ai/engine';
import { DEFAULT_FINISH, imagePalette } from '../ai/finish';

const KEY = 'artifyme.custom-styles';
const MAX = 8;

export function loadCustomStyles(): ArtStyle[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function persist(list: ArtStyle[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full / private mode */
  }
}

export async function createCustomStyle(art: HTMLCanvasElement, existing: ArtStyle[]): Promise<ArtStyle[]> {
  const bottleneck = await styleBottleneck(art);
  const t = document.createElement('canvas');
  const s = Math.max(240 / art.width, 320 / art.height);
  t.width = 240;
  t.height = 320;
  const ctx = t.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art, (240 - art.width * s) / 2, (320 - art.height * s) / 2, art.width * s, art.height * s);
  const n = existing.length + 1;
  const style: ArtStyle = {
    id: `custom-${Date.now().toString(36)}`,
    kind: 'neural',
    name: `Muse No. ${n}`,
    artist: 'Your artwork',
    year: String(new Date().getFullYear()),
    movement: 'Personal',
    blurb: 'Distilled on‑device from an artwork you chose.',
    accent: '#d8b26e',
    thumb: t.toDataURL('image/jpeg', 0.82),
    bottleneck: bottleneck.map((v) => +v.toFixed(5)),
    finish: DEFAULT_FINISH,
    palette: imagePalette(art),
  };
  const list = [style, ...existing].slice(0, MAX);
  persist(list);
  return list;
}

export function removeCustomStyle(id: string, existing: ArtStyle[]) {
  const list = existing.filter((s) => s.id !== id);
  persist(list);
  return list;
}
