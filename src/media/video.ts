// Frame‑accurate video stylization, fully on‑device.
// Encoding path 1: WebCodecs (H.264 + AAC) muxed to MP4 — fast & deterministic.
// Encoding path 2: real‑time playback into MediaRecorder for older browsers.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export const MAX_VIDEO_SECONDS = 15;

export interface VideoJob {
  file: Blob;
  fps: number;
  maxSide: number;
  /** Stylize one frame. Receives a canvas at processing size, returns a canvas (any size). */
  stylize: (frame: HTMLCanvasElement) => Promise<HTMLCanvasElement>;
  onProgress: (done: number, total: number, preview: HTMLCanvasElement) => void;
  signal: AbortSignal;
}

export interface VideoResult {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  duration: number;
  poster: HTMLCanvasElement;
}

export function loadVideo(src: Blob | string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('This video format is not supported by your browser.'));
    v.src = typeof src === 'string' ? src : URL.createObjectURL(src);
    v.load();
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      // Make sure the decoded frame is actually presented before we read it.
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (rvfc && !v.paused) rvfc.call(v, () => resolve());
      else setTimeout(resolve, 0);
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function decodeAudio(file: Blob, duration: number): Promise<AudioBuffer | null> {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const buf = await new Promise<AudioBuffer>((res, rej) => {
      file.arrayBuffer().then((ab) => ctx.decodeAudioData(ab, res, rej), rej);
    });
    void ctx.close();
    if (buf.duration <= duration + 0.05) return buf;
    // Trim to the processed segment.
    const len = Math.floor(duration * buf.sampleRate);
    const off = new OfflineAudioContext(buf.numberOfChannels, len, buf.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return await off.startRendering();
  } catch {
    return null;
  }
}

async function canUseWebCodecs(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
  for (const codec of candidates) {
    const cfg: VideoEncoderConfig = { codec, width, height, bitrate: Math.round(width * height * fps * 0.18), framerate: fps };
    try {
      const s = await VideoEncoder.isConfigSupported(cfg);
      if (s.supported) return cfg;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function canEncodeAac(sampleRate: number, channels: number) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    const s = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128000 });
    return !!s.supported;
  } catch {
    return false;
  }
}

export async function stylizeVideo(job: VideoJob): Promise<VideoResult> {
  const video = await loadVideo(job.file);
  const duration = Math.min(MAX_VIDEO_SECONDS, video.duration || 0);
  if (!isFinite(duration) || duration <= 0) throw new Error('Could not read the video duration.');
  const total = Math.max(1, Math.floor(duration * job.fps));

  const scale = Math.min(1, job.maxSide / Math.max(video.videoWidth, video.videoHeight));
  const pw = Math.round((video.videoWidth * scale) / 4) * 4;
  const ph = Math.round((video.videoHeight * scale) / 4) * 4;
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = pw;
  frameCanvas.height = ph;
  const fctx = frameCanvas.getContext('2d', { willReadFrequently: false })!;

  // Output canvas at a fixed, even size.
  const ow = even(pw), oh = even(ph);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = ow;
  outCanvas.height = oh;
  const octx = outCanvas.getContext('2d')!;

  const audio = await decodeAudio(job.file, duration);
  const vcfg = await canUseWebCodecs(ow, oh, job.fps);
  const aacOk = audio ? await canEncodeAac(audio.sampleRate, Math.min(2, audio.numberOfChannels)) : false;

  const poster = document.createElement('canvas');
  const drawFrame = async (i: number) => {
    if (job.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await seek(video, Math.min(duration - 0.001, i / job.fps));
    fctx.drawImage(video, 0, 0, pw, ph);
    const styled = await job.stylize(frameCanvas);
    octx.imageSmoothingEnabled = true;
    octx.drawImage(styled, 0, 0, ow, oh);
    if (i === 0) {
      poster.width = ow;
      poster.height = oh;
      poster.getContext('2d')!.drawImage(outCanvas, 0, 0);
    }
    job.onProgress(i + 1, total, outCanvas);
  };

  if (vcfg) {
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: ow, height: oh, frameRate: job.fps },
      audio: audio && aacOk ? { codec: 'aac', sampleRate: audio.sampleRate, numberOfChannels: Math.min(2, audio.numberOfChannels) } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let encErr: unknown = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encErr = e) });
    venc.configure(vcfg);
    for (let i = 0; i < total; i++) {
      await drawFrame(i);
      const frame = new VideoFrame(outCanvas, { timestamp: Math.round((i * 1e6) / job.fps), duration: Math.round(1e6 / job.fps) });
      venc.encode(frame, { keyFrame: i % (job.fps * 2) === 0 });
      frame.close();
      if (encErr) throw encErr;
      // Back‑pressure so we never queue hundreds of frames on low‑end phones.
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    }
    await venc.flush();
    venc.close();

    if (audio && aacOk) {
      const ch = Math.min(2, audio.numberOfChannels);
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encErr = e) });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: audio.sampleRate, numberOfChannels: ch, bitrate: 128000 });
      const block = 1024 * 8;
      for (let off = 0; off < audio.length; off += block) {
        const n = Math.min(block, audio.length - off);
        const planar = new Float32Array(n * ch);
        for (let c = 0; c < ch; c++) planar.set(audio.getChannelData(c).subarray(off, off + n), c * n);
        const data = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / audio.sampleRate) * 1e6), data: planar });
        aenc.encode(data);
        data.close();
      }
      await aenc.flush();
      aenc.close();
    }
    if (encErr) throw encErr;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    URL.revokeObjectURL(video.src);
    return { blob, mime: 'video/mp4', width: ow, height: oh, duration, poster };
  }

  // ── Fallback: render frames to JPEG, then replay them in real time into MediaRecorder.
  const frames: Blob[] = [];
  for (let i = 0; i < total; i++) {
    await drawFrame(i);
    frames.push(await new Promise<Blob>((r) => outCanvas.toBlob((b) => r(b!), 'image/jpeg', 0.92)));
  }
  URL.revokeObjectURL(video.src);
  const blob = await recordFrames(frames, outCanvas, job.fps, audio);
  return { blob, mime: blob.type, width: ow, height: oh, duration, poster };
}

function pickRecorderMime() {
  const types = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

async function recordFrames(frames: Blob[], canvas: HTMLCanvasElement, fps: number, audio: AudioBuffer | null): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Video export is not supported in this browser.');
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(fps);
  let actx: AudioContext | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  if (audio) {
    actx = new AudioContext({ sampleRate: audio.sampleRate });
    const dest = actx.createMediaStreamDestination();
    srcNode = actx.createBufferSource();
    srcNode.buffer = audio;
    srcNode.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mime = pickRecorderMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  // Pre‑decode a few frames ahead so playback never stutters.
  const decoded: Promise<ImageBitmap>[] = [];
  const decode = (i: number) => (decoded[i] ??= createImageBitmap(frames[i]));
  for (let i = 0; i < Math.min(6, frames.length); i++) decode(i);
  ctx.drawImage(await decode(0), 0, 0);

  rec.start(250);
  srcNode?.start();
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    const bmp = await decode(i);
    if (i + 6 < frames.length) decode(i + 6);
    const due = t0 + (i * 1000) / fps;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  }
  await new Promise((r) => setTimeout(r, 1000 / fps));
  rec.stop();
  srcNode?.stop();
  await stopped;
  void actx?.close();
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}
