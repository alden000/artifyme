// Saving creations. On phones the native share sheet is the only way to reach
// the Photos app ("Save Image" / "Save Video"); elsewhere we download a file.

export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/jpeg', q = 0.94) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), type, q));

export function extFor(mime: string) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'bin';
}

export function fileName(styleId: string, mime: string) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `ArtifyMe-${styleId}-${stamp}.${extFor(mime)}`;
}

export function canShareFile(file: File) {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

/** Returns 'shared' | 'downloaded' | 'cancelled'. */
export async function saveBlob(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  if (isTouchDevice() && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: 'ArtifyMe' });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  download(blob, name);
  return 'downloaded';
}

export async function shareBlob(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: 'Made with ArtifyMe', text: 'Painted on‑device with ArtifyMe ✨' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
