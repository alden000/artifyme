import type { Media } from '../state';
import { loadVideo } from './video';

const MAX_STILL = 2048;

function toCanvas(src: CanvasImageSource, w: number, h: number) {
  const s = Math.min(1, MAX_STILL / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function decodeImage(file: Blob): Promise<HTMLCanvasElement> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const c = toCanvas(bmp, bmp.width, bmp.height);
    bmp.close();
    return c;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return toCanvas(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function loadMedia(file: File | Blob): Promise<Media> {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp)$/i.test((file as File).name ?? '');
  const url = URL.createObjectURL(file);
  if (!isVideo) {
    const still = await decodeImage(file);
    return { kind: 'image', file, url, width: still.width, height: still.height, still };
  }
  const v = await loadVideo(url);
  await new Promise<void>((res) => {
    const t = Math.min(0.15, (v.duration || 1) / 4);
    const done = () => res();
    v.addEventListener('seeked', done, { once: true });
    v.currentTime = t;
    setTimeout(done, 1500);
  });
  const still = toCanvas(v, v.videoWidth, v.videoHeight);
  return { kind: 'video', file, url, width: v.videoWidth, height: v.videoHeight, still, duration: v.duration };
}
