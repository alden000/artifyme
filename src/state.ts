import { ALL_STYLES, type ArtStyle } from './data/styles';
import { DEFAULT_SETTINGS, type RenderSettings } from './ai/pipeline';

export interface MpSettings {
  on: boolean;
  /** img2img strength: 0.3 keeps the photo, 0.7 lets the artist take over. */
  strength: number;
  keepColors: boolean;
}

export interface Media {
  kind: 'image' | 'video';
  file: Blob;
  url: string;
  width: number;
  height: number;
  /** Decoded still (image) or poster frame (video), ready for drawing. */
  still: HTMLCanvasElement;
  duration?: number;
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

export interface VideoSettings {
  fps: 12 | 24;
  maxSide: 360 | 540 | 720;
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
  customStyles: [] as ArtStyle[],
  settings: load<RenderSettings>('artifyme.settings', DEFAULT_SETTINGS),
  video: load<VideoSettings>('artifyme.video', { fps: 12, maxSide: 540 }),
  // v4: faithful‑first default (0.35) after real‑photo testing.
  mp: load<MpSettings>('artifyme.mp4', { on: false, strength: 0.35, keepColors: false }),
  mpSeed: 7,
};

export function persistSettings() {
  save('artifyme.settings', state.settings);
  save('artifyme.video', state.video);
  save('artifyme.mp4', state.mp);
}

export function currentStyle(): ArtStyle {
  return state.customStyles.find((s) => s.id === state.styleId) ?? ALL_STYLES.find((s) => s.id === state.styleId) ?? ALL_STYLES[0];
}

export function setMedia(m: Media | null) {
  if (state.media && state.media.url !== m?.url) URL.revokeObjectURL(state.media.url);
  state.media = m;
}

export function setResult(r: Result | null) {
  if (state.result && state.result.url !== r?.url) URL.revokeObjectURL(state.result.url);
  state.result = r;
}
