// Hosts the Masterpiece+ engine off the main thread. Terminating this worker frees
// everything it allocated, which is how the app gives memory back after painting.
/// <reference lib="webworker" />
import { load, paint, release, type EngineConfig, type PaintOptions } from './mp-engine';

type Msg = { type: 'load'; cfg: EngineConfig } | { type: 'paint'; photo: ImageBitmap; opts: PaintOptions } | { type: 'release' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: unknown, t: Transferable[] = []) => scope.postMessage(m, t);

scope.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      if (!('gpu' in navigator)) return post({ type: 'error', code: 'no-webgpu', message: 'WebGPU is not available in workers' });
      await load(m.cfg, (phase, p) => post({ type: 'progress', phase, p }));
      post({ type: 'loaded' });
    } else if (m.type === 'paint') {
      const out = await paint(m.photo, m.opts, {
        onStep: (i, n) => post({ type: 'step', i, n }),
        onPhase: (phase) => post({ type: 'phase', phase }),
      });
      m.photo.close();
      post({ type: 'painted', width: out.width, height: out.height, data: out.data.buffer }, [out.data.buffer]);
    } else if (m.type === 'release') {
      await release();
      post({ type: 'released' });
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
