import { h, reducedMotion } from './dom';

// ───────────────────────── Aurora: living oil‑paint backdrop ─────────────────────────
const FRAG = `
precision mediump float;
uniform vec2 r;
uniform float t;
uniform vec3 accent;
uniform float energy;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / r.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * r.xy) / min(r.x, r.y) * 1.6;
  float tt = t * 0.035;
  vec2 q = vec2(fbm(p + vec2(0.0, tt)), fbm(p + vec2(5.2, 1.3) - tt));
  vec2 w = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + tt*1.3), fbm(p + 3.0*q + vec2(8.3, 2.8) - tt*0.9));
  float f = fbm(p + 3.5 * w);
  vec3 ink = vec3(0.035, 0.03, 0.05);
  vec3 violet = vec3(0.22, 0.12, 0.36);
  vec3 rose = vec3(0.55, 0.16, 0.30);
  vec3 gold = vec3(0.85, 0.66, 0.36);
  vec3 col = mix(ink, violet, smoothstep(0.2, 0.9, f));
  col = mix(col, mix(rose, accent, 0.65), smoothstep(0.45, 1.0, length(q)) * 0.55);
  col = mix(col, gold, smoothstep(0.78, 1.05, w.x * f * 1.5) * 0.35 * energy);
  // brush‑stroke sheen
  col += 0.05 * energy * sin(18.0 * f + tt * 6.0) * vec3(1.0, 0.85, 0.6) * smoothstep(0.5, 0.9, f);
  // vignette toward the edges for focus
  float vig = smoothstep(1.25, 0.25, length(uv - vec2(0.5, 0.42)));
  col *= mix(0.35, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}`;

class Aurora {
  private gl: WebGLRenderingContext | null = null;
  private uR?: WebGLUniformLocation | null;
  private uT?: WebGLUniformLocation | null;
  private uA?: WebGLUniformLocation | null;
  private uE?: WebGLUniformLocation | null;
  private accent = [0.85, 0.66, 0.36];
  private target = [0.85, 0.66, 0.36];
  private energy = 1;
  private paused = false;
  private last = 0;
  private start = performance.now();
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uR = gl.getUniformLocation(prog, 'r');
    this.uT = gl.getUniformLocation(prog, 't');
    this.uA = gl.getUniformLocation(prog, 'accent');
    this.uE = gl.getUniformLocation(prog, 'energy');
    this.gl = gl;
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => document.hidden || this.kick());
    this.kick();
  }
  private resize() {
    // Rendered at low resolution then smoothed by CSS — cheap on phones, still lush.
    const s = 0.28;
    this.canvas.width = Math.max(64, Math.round(innerWidth * s));
    this.canvas.height = Math.max(64, Math.round(innerHeight * s));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.draw(performance.now());
  }
  private kick() {
    requestAnimationFrame((ts) => this.loop(ts));
  }
  private loop(ts: number) {
    if (document.hidden) return;
    if (!this.paused && ts - this.last > 1000 / 30) {
      this.last = ts;
      this.draw(ts);
    }
    if (!this.paused && !reducedMotion()) this.kick();
  }
  private draw(ts: number) {
    const gl = this.gl;
    if (!gl) return;
    for (let i = 0; i < 3; i++) this.accent[i] += (this.target[i] - this.accent[i]) * 0.04;
    gl.uniform2f(this.uR!, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uT!, (ts - this.start) / 1000);
    gl.uniform3f(this.uA!, this.accent[0], this.accent[1], this.accent[2]);
    gl.uniform1f(this.uE!, this.energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  setAccent(hex: string) {
    const n = parseInt(hex.replace('#', ''), 16);
    this.target = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  setEnergy(e: number) {
    this.energy = e;
  }
  /** Free the GPU for the neural network while it paints. */
  pause(p: boolean) {
    const was = this.paused;
    this.paused = p;
    if (was && !p) this.kick();
  }
}

let aurora: Aurora | null = null;
export const initAurora = (c: HTMLCanvasElement) => (aurora = new Aurora(c));
export const setAccent = (hex: string) => aurora?.setAccent(hex);
export const pauseAurora = (p: boolean) => aurora?.pause(p);
export const auroraEnergy = (e: number) => aurora?.setEnergy(e);

// ───────────────────────── micro‑interactions ─────────────────────────
export function haptic(pattern: number | number[] = 8) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/** Material‑like ink ripple, but in liquid gold. */
export function ripple(el: HTMLElement) {
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = h('span', { class: 'ripple', style: `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px` });
    el.append(dot);
    setTimeout(() => dot.remove(), 750);
  });
  return el;
}

/** Pointer‑driven 3D tilt with a travelling specular highlight. */
export function tilt(el: HTMLElement, max = 10) {
  if (reducedMotion()) return el;
  let raf = 0;
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.setProperty('--rx', `${(-y * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * max).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
  };
  const leave = () => {
    cancelAnimationFrame(raf);
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('pointercancel', leave);
  el.addEventListener('pointerup', leave);
  return el;
}

/** Device‑orientation parallax (where permitted) blended with pointer parallax. */
export function parallax(el: HTMLElement) {
  if (reducedMotion()) return () => {};
  const set = (x: number, y: number) => {
    el.style.setProperty('--px', x.toFixed(3));
    el.style.setProperty('--py', y.toFixed(3));
  };
  const onMove = (e: PointerEvent) => set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
  const onTilt = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    set(Math.max(-1, Math.min(1, e.gamma / 30)) * 0.5, Math.max(-1, Math.min(1, (e.beta - 45) / 30)) * 0.5);
  };
  addEventListener('pointermove', onMove);
  addEventListener('deviceorientation', onTilt);
  return () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('deviceorientation', onTilt);
  };
}

// ───────────────────────── toast ─────────────────────────
export function toast(message: string, opts: { icon?: string; action?: { label: string; run: () => void }; duration?: number } = {}) {
  const host = document.getElementById('overlays')!;
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    opts.icon ? h('span', { class: 'toast-ico', html: opts.icon }) : null,
    h('span', { class: 'toast-msg' }, message),
    opts.action
      ? h(
          'button',
          {
            class: 'toast-act',
            onclick: () => {
              opts.action!.run();
              dismiss();
            },
          },
          opts.action.label,
        )
      : null,
  );
  host.querySelectorAll('.toast').forEach((t) => t.classList.add('out'));
  host.append(el);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  };
  setTimeout(dismiss, opts.duration ?? 3200);
  return dismiss;
}

// ───────────────────────── gold leaf confetti ─────────────────────────
export function goldBurst(originX = innerWidth / 2, originY = innerHeight * 0.6) {
  if (reducedMotion()) return;
  const c = h('canvas', { class: 'burst' });
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.append(c);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const colors = ['#fff1cf', '#e9c47e', '#c99a4b', '#f6dca0', '#ffffff', '#e2557a'];
  const parts = Array.from({ length: 90 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const v = 6 + Math.random() * 9;
    return { x: originX, y: originY, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 4 + Math.random() * 7, h: 6 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], life: 1 };
  });
  let last = performance.now();
  const step = (ts: number) => {
    const dt = Math.min(2, (ts - last) / 16.7);
    last = ts;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of parts) {
      p.vy += 0.28 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      p.life -= 0.009 * dt;
      if (p.life <= 0 || p.y > innerHeight + 40) continue;
      alive++;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.abs(Math.cos(p.r * 1.7)) + 0.15);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

/** Animated number count‑up for progress readouts. */
export function countTo(el: HTMLElement, to: number, suffix = '%') {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  const t0 = performance.now();
  const dur = 380;
  const tick = (ts: number) => {
    const k = Math.min(1, (ts - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = `${Math.round(from + (to - from) * e)}${suffix}`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
