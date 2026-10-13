// Latent Consistency Model img2img sampler (port of diffusers' LCMScheduler,
// scaled‑linear betas, 50 original steps, epsilon prediction, timestep_scaling 10).
// Pure maths — the UNet is passed in, so this runs (and is tested) anywhere.

const T = 1000;
const ORIGINAL_STEPS = 50;
const SIGMA_DATA = 0.5;
const TIMESTEP_SCALING = 10;

export const alphasCumprod = (() => {
  const out = new Float64Array(T);
  const b0 = Math.sqrt(0.00085), b1 = Math.sqrt(0.012);
  let ac = 1;
  for (let i = 0; i < T; i++) {
    const beta = (b0 + ((b1 - b0) * i) / (T - 1)) ** 2;
    ac *= 1 - beta;
    out[i] = ac;
  }
  return out;
})();

/** Timesteps used for img2img at `strength` with `steps` inference steps. */
export function lcmTimesteps(steps: number, strength: number): number[] {
  const k = Math.floor(T / ORIGINAL_STEPS);
  const n = Math.floor(ORIGINAL_STEPS * strength);
  const origin: number[] = [];
  for (let i = 1; i <= n; i++) origin.push(i * k - 1);
  origin.reverse();
  if (Math.floor(origin.length / steps) < 1) throw new Error('Strength too low for this many steps');
  const out: number[] = [];
  for (let i = 0; i < steps; i++) out.push(origin[Math.floor((i * origin.length) / steps)]);
  return out;
}

/** Seeded standard‑normal noise (xorshift + Box–Muller). */
export function makeNoise(seed: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s + 0.5) / 4294967296;
  };
  return (n: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      const r = Math.sqrt(-2 * Math.log(rnd())), th = 2 * Math.PI * rnd();
      out[i] = r * Math.cos(th);
      if (i + 1 < n) out[i + 1] = r * Math.sin(th);
    }
    return out;
  };
}

export interface LcmJob {
  /** Encoded photo latent (already in the UNet's scaled latent space). */
  init: Float32Array;
  strength: number;
  steps: number;
  seed: number;
  unet: (sample: Float32Array, t: number) => Promise<Float32Array>;
  onStep?: (i: number, n: number) => void;
}

export async function lcmImg2Img(job: LcmJob): Promise<Float32Array> {
  const ts = lcmTimesteps(job.steps, job.strength);
  const noise = makeNoise(job.seed);
  const n = job.init.length;
  const ac0 = alphasCumprod[ts[0]];
  const e0 = noise(n);
  let x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sqrt(ac0) * job.init[i] + Math.sqrt(1 - ac0) * e0[i];
  let denoised = x;
  for (let s = 0; s < ts.length; s++) {
    const t = ts[s];
    const eps = await job.unet(x, t);
    const at = alphasCumprod[t];
    const scaled = t * TIMESTEP_SCALING;
    const cSkip = SIGMA_DATA ** 2 / (scaled ** 2 + SIGMA_DATA ** 2);
    const cOut = scaled / Math.sqrt(scaled ** 2 + SIGMA_DATA ** 2);
    const sa = Math.sqrt(at), sb = Math.sqrt(1 - at);
    denoised = new Float32Array(n);
    for (let i = 0; i < n; i++) denoised[i] = cOut * ((x[i] - sb * eps[i]) / sa) + cSkip * x[i];
    if (s < ts.length - 1) {
      const ap = alphasCumprod[ts[s + 1]];
      const z = noise(n);
      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) next[i] = Math.sqrt(ap) * denoised[i] + Math.sqrt(1 - ap) * z[i];
      x = next;
    }
    job.onStep?.(s + 1, ts.length);
  }
  return denoised;
}
