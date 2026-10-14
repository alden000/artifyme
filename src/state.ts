import { ALL_STYLES, type ArtStyle } from './data/styles';

export interface MpSettings {
  /** img2img strength for the scene: 0.25 keeps the photo, 0.65 lets the artist take over. */
  strength: number;
  keepColors: boolean;
  /** Repaint detected people & pets separately (crop, faithful) so they stay recognisable. */
  protectPeople: boolean;
}

export interface Media {
  kind: 'image';
  file: Blob;
  url: string;
  width: number;
  height: number;
  /** Decoded photo, ready for drawing. */
  still: HTMLCanvasElement;
}

export interface Result {
  kind: 'image' | 'video';
  blob: Blob;
  url: string;
  width: number;
  height: number;
  style: ArtStyle;
  canvas?: HTMLCanvasElement;
  poster?: HTMLCanvasElement;
  creationId?: string;
  /** Present when produced by Masterpiece+ (enables "Paint again"). */
  mpSeed?: number;
}

const load = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

export const state = {
  media: null as Media | null,
  result: null as Result | null,
  styleId: 'starry',
  // v5: Masterpiece+ is the only engine; people are protected by default.
  mp: load<MpSettings>('artifyme.mp5', { strength: 0.45, keepColors: false, protectPeople: true }),
  mpSeed: 7,
};

export function persistSettings() {
  save('artifyme.mp5', state.mp);
}

export function currentStyle(): ArtStyle {
  return ALL_STYLES.find((s) => s.id === state.styleId) ?? ALL_STYLES[0];
}

export function setMedia(m: Media | null) {
  if (state.media && state.media.url !== m?.url) URL.revokeObjectURL(state.media.url);
  state.media = m;
}

export function setResult(r: Result | null) {
  if (state.result && state.result.url !== r?.url) URL.revokeObjectURL(state.result.url);
  state.result = r;
}
