// Masterpiece+ download worker: fills the weight cache without touching the GPU.
/// <reference lib="webworker" />
import { loadWeights, type WeightsRequest } from './weights';

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (ev: MessageEvent<WeightsRequest>) => {
  try {
    await loadWeights({ ...ev.data, downloadOnly: true }, (phase, p) => post({ type: 'progress', phase, p }));
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
