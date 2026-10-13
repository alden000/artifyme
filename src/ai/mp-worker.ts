// Masterpiece+ weight loader (Web Worker).
// Streams the 8‑bit packed weights chunk by chunk, keeps them in Cache Storage
// for offline use, and expands them into the fp16/fp32 buffer the ONNX graph
// references — never holding the whole compressed file in memory at once.
/// <reference lib="webworker" />

interface Entry {
  n: string;
  s: number[];
  k: 'q8' | 'f16' | 'raw';
  o: number;
  so?: number;
  b?: number;
  w16?: number;
  w32?: number;
}
interface Manifest {
  tensors: Entry[];
  total16: number;
  total32: number;
}
interface Req {
  base: string;
  key: 'w16' | 'w32';
  chunks: number;
  cacheName: string;
  downloadOnly?: boolean;
}

const post = (m: unknown, t?: Transferable[]) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t ?? []);

// ── fp16 helpers ──
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  const h = sign | (e << 10) | (m >> 13);
  return m & 0x1000 ? h + 1 : h; // round half up
}
const halfToFloat = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    t[h] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  return t;
})();

async function getChunk(cache: Cache | null, url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) {
    const b = new Uint8Array(await hit.arrayBuffer());
    onBytes(b.byteLength);
    return b;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  // Don't trust content-length: Pages gzips responses, so it's the *compressed* size.
  const parts: Uint8Array[] = [];
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    onBytes(value.byteLength);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.byteLength;
  }
  if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { base, key, chunks, cacheName, downloadOnly } = ev.data;
  try {
    const cache = 'caches' in self ? await caches.open(cacheName).catch(() => null) : null;
    const man: Manifest = await (await fetch(base + 'manifest.json')).json();
    const blobTotal = man.tensors.reduce((m, e) => Math.max(m, e.k === 'q8' ? e.so! + e.s[0] * 4 : e.o + (e.k === 'raw' ? e.b! : e.s.reduce((a, b) => a * b, 1) * 2)), 0);
    let downloaded = 0;
    const onBytes = (n: number) => {
      downloaded += n;
      post({ type: 'progress', phase: 'download', p: Math.min(1, downloaded / blobTotal) });
    };

    if (downloadOnly) {
      for (let c = 0; c < chunks; c++) await getChunk(cache, `${base}weights.q8.${String(c).padStart(2, '0')}`, onBytes);
      post({ type: 'done' });
      return;
    }

    const total = key === 'w16' ? man.total16 : man.total32;
    const out = new ArrayBuffer(total);
    const outU8 = new Uint8Array(out);

    // Chunk window: [winStart, winEnd) of the compressed blob currently in memory.
    const CH = 32 * 1024 * 1024;
    let window: Uint8Array = new Uint8Array(0);
    let winStart = 0;
    let next = 0;
    const ensure = async (end: number) => {
      while (winStart + window.byteLength < end) {
        const c = await getChunk(cache, `${base}weights.q8.${String(next).padStart(2, '0')}`, onBytes);
        next++;
        const merged = new Uint8Array(window.byteLength + c.byteLength);
        merged.set(window, 0);
        merged.set(c, window.byteLength);
        window = merged;
      }
    };
    const view = (o: number, n: number) => window.subarray(o - winStart, o - winStart + n);
    const release = (before: number) => {
      // Drop whole chunks we no longer need.
      const drop = Math.floor((before - winStart) / CH) * CH;
      if (drop > 0) {
        window = window.slice(drop);
        winStart += drop;
      }
    };

    let cur = 0;
    let done = 0;
    for (const e of man.tensors) {
      cur = Math.ceil(cur / 16) * 16;
      const numel = e.s.reduce((a, b) => a * b, 1);
      if (e.k === 'raw') {
        await ensure(e.o + e.b!);
        outU8.set(view(e.o, e.b!), cur);
        cur += e.b!;
      } else {
        const width = (key === 'w16' ? e.w16 : e.w32) ?? 4;
        let src: Float32Array;
        if (e.k === 'q8') {
          const oc = e.s[0];
          await ensure(e.so! + oc * 4);
          const q = new Int8Array(view(e.o, numel).slice().buffer);
          const sc = new Float32Array(view(e.so!, oc * 4).slice().buffer);
          const per = numel / oc;
          src = new Float32Array(numel);
          for (let c = 0; c < oc; c++) {
            const s = sc[c];
            const off = c * per;
            for (let i = 0; i < per; i++) src[off + i] = q[off + i] * s;
          }
        } else {
          await ensure(e.o + numel * 2);
          const h = new Uint16Array(view(e.o, numel * 2).slice().buffer);
          if (width === 2) {
            outU8.set(new Uint8Array(h.buffer), cur);
            cur += numel * 2;
            done++;
            release(e.o);
            continue;
          }
          src = new Float32Array(numel);
          for (let i = 0; i < numel; i++) src[i] = halfToFloat[h[i]];
        }
        if (width === 4) {
          new Float32Array(out, cur, numel).set(src);
        } else {
          const dst = new Uint16Array(out, cur, numel);
          for (let i = 0; i < numel; i++) dst[i] = toHalf(src[i]);
        }
        cur += numel * width;
      }
      done++;
      release(e.k === 'q8' ? e.o : e.o);
      if (done % 20 === 0) post({ type: 'progress', phase: 'unpack', p: done / man.tensors.length });
    }
    post({ type: 'weights', buffer: out }, [out]);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
