// "Atelier finish": turns raw neural style‑transfer output into something that
// reads as an actual painting. Runs on the GPU (WebGL2), entirely on‑device.
//
//   1. Upscale the network output to the final resolution.
//   2. Re‑inject a little of the photo's fine structure (eyes, edges stay crisp).
//   3. Anisotropic Kuwahara filter — repaints the image as directional
//      brushstrokes that follow the local edge flow (Kyprianidis et al. 2009/2011).
//   4. Re‑grade colours toward the source artwork's palette (Reinhard, Lab space).
//   5. Impasto: light the paint surface so strokes have physical relief.
//   6. Ground: canvas weave, paper fibre or wooden panel grain.

export type Surface = 'canvas' | 'paper' | 'panel' | 'none';

export interface Finish {
  /** Brush size multiplier (0 disables the stroke filter). */
  brush: number;
  /** Paint relief strength 0..1. */
  impasto: number;
  surface: Surface;
  /** How strongly to pull colours toward the artwork's palette 0..1. */
  colorMatch: number;
}

/** Lab mean & std: [Lm, am, bm, Ls, as, bs]. */
export type LabStats = [number, number, number, number, number, number];
/** Colour signature of a reference artwork: distribution + its key pigments (Lab). */
export interface Palette {
  stats: LabStats;
  colors: [number, number, number][];
}

export const DEFAULT_FINISH: Finish = { brush: 0.4, impasto: 0.2, surface: 'canvas', colorMatch: 0.12 };

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const LIB = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 px; // 1/size
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

// Base: upscaled stylization + photo micro‑detail (difference of Gaussians on luma).
const BASE = LIB + `
uniform sampler2D sty; uniform sampler2D photo; uniform sampler2D photoBlur; uniform float detail;
void main(){
  vec3 s = texture(sty, uv).rgb;
  float d = luma(texture(photo, uv).rgb) - luma(texture(photoBlur, uv).rgb);
  o = vec4(clamp(s + d * detail, 0.0, 1.0), 1.0);
}`;

// Separable Gaussian blur (used for the photo blur and the structure tensor).
const BLUR = LIB + `
uniform sampler2D src; uniform vec2 dir; uniform float sigma;
void main(){
  vec4 acc = vec4(0.0); float wsum = 0.0;
  int r = int(ceil(2.5 * sigma));
  for (int i = -12; i <= 12; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-0.5 * float(i * i) / (sigma * sigma));
    acc += texture(src, uv + dir * px * float(i)) * w; wsum += w;
  }
  o = acc / wsum;
}`;

// Structure tensor from Sobel gradients of the colour image.
const TENSOR = LIB + `
uniform sampler2D src;
void main(){
  vec3 gx = (-1.0*texture(src, uv + px*vec2(-1,-1)).rgb - 2.0*texture(src, uv + px*vec2(-1,0)).rgb - 1.0*texture(src, uv + px*vec2(-1,1)).rgb
             +1.0*texture(src, uv + px*vec2( 1,-1)).rgb + 2.0*texture(src, uv + px*vec2( 1,0)).rgb + 1.0*texture(src, uv + px*vec2( 1,1)).rgb) * 0.25;
  vec3 gy = (-1.0*texture(src, uv + px*vec2(-1,-1)).rgb - 2.0*texture(src, uv + px*vec2(0,-1)).rgb - 1.0*texture(src, uv + px*vec2(1,-1)).rgb
             +1.0*texture(src, uv + px*vec2(-1, 1)).rgb + 2.0*texture(src, uv + px*vec2(0, 1)).rgb + 1.0*texture(src, uv + px*vec2(1, 1)).rgb) * 0.25;
  o = vec4(dot(gx, gx), dot(gy, gy), dot(gx, gy), 1.0);
}`;

// Anisotropic Kuwahara with polynomial sector weights.
const KUWAHARA = LIB + `
uniform sampler2D src; uniform sampler2D tfm; uniform float radius;
const float ALPHA = 1.0; const float Q = 8.0;
void main(){
  vec3 g = texture(tfm, uv).xyz; // E, G, F
  float E = g.x, G = g.y, F = g.z;
  float disc = sqrt((E - G) * (E - G) + 4.0 * F * F);
  float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
  vec2 t = vec2(l1 - E, -F);
  vec2 dir = length(t) > 0.0 ? normalize(t) : vec2(0.0, 1.0);
  float A = (l1 + l2 > 0.0) ? (l1 - l2) / (l1 + l2) : 0.0;
  float a = radius * clamp((ALPHA + A) / ALPHA, 0.1, 2.0);
  float b = radius * clamp(ALPHA / (ALPHA + A), 0.1, 2.0);
  float cp = dir.x, sp = dir.y; // dir is the edge tangent: long axis follows the edge
  mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
  int mx = int(sqrt(a*a*cp*cp + b*b*sp*sp));
  int my = int(sqrt(a*a*sp*sp + b*b*cp*cp));
  float zeta = 2.0 / radius;
  float zc = 0.58; float szc = sin(zc);
  float eta = (zeta + cos(zc)) / (szc * szc);
  vec4 m[8]; vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
  for (int y = -14; y <= 14; y++) {
    if (y < -my || y > my) continue;
    for (int x = -14; x <= 14; x++) {
      if (x < -mx || x > mx) continue;
      vec2 v = SR * vec2(float(x), float(y));
      if (dot(v, v) > 0.25) continue;
      vec3 c = texture(src, uv + vec2(float(x), float(y)) * px).rgb;
      float w[8]; float sum = 0.0; float z, vxx, vyy;
      vxx = zeta - eta * v.x * v.x; vyy = zeta - eta * v.y * v.y;
      z = max(0.0,  v.y + vxx); w[0] = z*z; sum += w[0];
      z = max(0.0, -v.x + vyy); w[2] = z*z; sum += w[2];
      z = max(0.0, -v.y + vxx); w[4] = z*z; sum += w[4];
      z = max(0.0,  v.x + vyy); w[6] = z*z; sum += w[6];
      vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * r.x * r.x; vyy = zeta - eta * r.y * r.y;
      z = max(0.0,  r.y + vxx); w[1] = z*z; sum += w[1];
      z = max(0.0, -r.x + vyy); w[3] = z*z; sum += w[3];
      z = max(0.0, -r.y + vxx); w[5] = z*z; sum += w[5];
      z = max(0.0,  r.x + vyy); w[7] = z*z; sum += w[7];
      float gw = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++) { float wk = w[k] * gw; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; }
    }
  }
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) continue;
    vec3 mu = m[k].rgb / m[k].w;
    vec3 var = abs(s[k] / m[k].w - mu * mu);
    float sig = var.r + var.g + var.b;
    float w = 1.0 / (1.0 + pow(1000.0 * sig, 0.5 * Q));
    acc += vec4(mu * w, w);
  }
  o = vec4(acc.w > 0.0 ? acc.rgb / acc.w : texture(src, uv).rgb, 1.0);
}`;

// Brush streaks: integrate colour along the edge‑tangent streamlines (LIC).
const FLOW = LIB + `
uniform sampler2D src; uniform sampler2D tfm; uniform float len;
vec2 tangent(vec2 p){
  vec3 g = texture(tfm, p).xyz; float E = g.x, G = g.y, F = g.z;
  float l1 = 0.5 * (E + G + sqrt((E - G) * (E - G) + 4.0 * F * F));
  vec2 t = vec2(l1 - E, -F);
  return length(t) > 1e-8 ? normalize(t) : vec2(0.0);
}
uniform float bristle; // bristle width in px
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float bn(vec2 p){ return h21(floor(p / px / bristle)); }
void main(){
  vec3 acc = texture(src, uv).rgb; float wsum = 1.0;
  float nacc = bn(uv), nsum = 1.0;
  float sigma = len * 0.5;
  for (int dirSign = -1; dirSign <= 1; dirSign += 2) {
    vec2 p = uv; vec2 prev = tangent(uv) * float(dirSign);
    for (int i = 1; i <= 16; i++) {
      if (float(i) > len) break;
      vec2 t = tangent(p);
      if (dot(t, prev) < 0.0) t = -t;
      if (length(t) == 0.0) break;
      p += t * px; prev = t;
      float w = exp(-0.5 * float(i * i) / (sigma * sigma));
      acc += texture(src, p).rgb * w; wsum += w;
      float nw = exp(-0.5 * float(i * i) / (4.0 * sigma * sigma)); // bristles run longer than colour
      nacc += bn(p) * nw; nsum += nw;
    }
  }
  // Alpha carries the bristle streak texture for the compose pass.
  o = vec4(acc / wsum, clamp(0.5 + (nacc / nsum - 0.5) * 3.0, 0.0, 1.0));
}`;

// Colour grade + impasto lighting + painting ground.
const COMPOSE = LIB + `
uniform sampler2D src; uniform sampler2D height;
uniform vec3 imgMean; uniform vec3 imgStd; uniform vec3 artMean; uniform vec3 artStd;
uniform float colorMatch; uniform float impasto; uniform int surface; uniform vec2 size; uniform float relief;
uniform vec3 pal[12]; uniform int palN;
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
vec3 rgb2lab(vec3 c){
  vec3 l = toLin(c);
  vec3 xyz = mat3(0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505) * l;
  xyz /= vec3(0.95047, 1.0, 1.08883);
  vec3 f = mix(7.787 * xyz + 16.0/116.0, pow(xyz, vec3(1.0/3.0)), step(0.008856, xyz));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 lab2rgb(vec3 lab){
  float fy = (lab.x + 16.0) / 116.0; float fx = fy + lab.y / 500.0; float fz = fy - lab.z / 200.0;
  vec3 f = vec3(fx, fy, fz);
  vec3 xyz = mix((f - 16.0/116.0) / 7.787, f*f*f, step(0.206893, f)) * vec3(0.95047, 1.0, 1.08883);
  vec3 l = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * xyz;
  return toSrgb(l);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
void main(){
  vec4 tex = texture(src, uv);
  vec3 c = tex.rgb;
  float br = tex.a;
  if (colorMatch > 0.0) {
    vec3 lab = rgb2lab(c);
    // 1) Match the overall distribution (Reinhard), gently.
    vec3 t = (lab - imgMean) / max(imgStd, vec3(1.0)) * artStd + artMean;
    lab = mix(lab, vec3(mix(lab.x, t.x, 0.35), t.yz), 0.5);
    // 2) Pull every colour toward the painter's own pigments (soft nearest‑palette).
    if (palN > 0) {
      float dmin = 1e9;
      for (int i = 0; i < 12; i++) { if (i >= palN) break; vec3 d = lab - pal[i]; dmin = min(dmin, 0.6 * d.x * d.x + dot(d.yz, d.yz)); }
      vec3 acc = vec3(0.0); float ws = 0.0;
      for (int i = 0; i < 12; i++) {
        if (i >= palN) break;
        vec3 d = lab - pal[i];
        float w = exp(-(0.6 * d.x * d.x + dot(d.yz, d.yz) - dmin) / 260.0);
        acc += pal[i] * w; ws += w;
      }
      vec3 p = acc / ws;
      lab = vec3(mix(lab.x, p.x, 0.4), mix(lab.yz, p.yz, 0.85));
    }
    c = mix(c, clamp(lab2rgb(lab), 0.0, 1.0), colorMatch);
  }
  // Impasto: height from paint luminance, lit from the upper left.
  if (impasto > 0.0) {
    #define HT(o) (luma(texture(height, uv + (o)).rgb) + (texture(height, uv + (o)).a - 0.5) * 0.35)
    float hL = HT(-vec2(px.x, 0.0)), hR = HT(vec2(px.x, 0.0));
    float hD = HT(-vec2(0.0, px.y)), hU = HT(vec2(0.0, px.y));
    vec3 n = normalize(vec3((hL - hR) * relief, (hD - hU) * relief, 1.0));
    vec3 L = normalize(vec3(-0.55, 0.6, 0.6));
    float diff = dot(n, L) - L.z;
    vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, hv), 0.0), 40.0);
    c = c * (1.0 + diff * 0.55 * impasto) + spec * 0.05 * impasto;
  }
  // Restore punch: local contrast against the softened paint, plus a touch of vibrance.
  vec3 soft = texture(height, uv).rgb;
  c = clamp(c + (c - soft) * 0.9, 0.0, 1.0);
  float l = luma(c);
  c = clamp(mix(vec3(l), c, 1.12), 0.0, 1.0);
  // Bristle streaks inside each stroke.
  c *= 1.0 + (br - 0.5) * 0.12 * (0.35 + impasto);
  vec2 p = uv * size;
  if (surface == 1) { // canvas weave
    float wx = sin(p.x * 1.9) * 0.5 + 0.5, wy = sin(p.y * 1.9) * 0.5 + 0.5;
    float weave = mix(wx, wy, step(0.5, fract((floor(p.x / 3.3) + floor(p.y / 3.3)) * 0.5)));
    float grain = noise(p * 0.7) - 0.5;
    c *= 1.0 + (weave - 0.5) * 0.06 + grain * 0.045;
  } else if (surface == 2) { // paper: soft fibres + warm tooth
    float fib = noise(vec2(p.x * 0.08, p.y * 1.1)) * 0.6 + noise(p * 0.45) * 0.4;
    c = mix(c, c * vec3(1.02, 1.0, 0.95), 0.6);
    c *= 1.0 + (fib - 0.5) * 0.07;
  } else if (surface == 3) { // wooden panel + craquelure hint
    float grain = noise(vec2(p.x * 0.02, p.y * 0.35)) - 0.5;
    float crack = smoothstep(0.02, 0.0, abs(noise(p * 0.035) - 0.5)) * 0.08;
    c *= 1.0 + grain * 0.05 - crack;
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

class Finisher {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly maxSize: number;
  private progs = new Map<string, Prog>();
  private floatOk: boolean;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.maxSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  private prog(name: string, frag: string): Prog {
    let pr = this.progs.get(name);
    if (pr) return pr;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
    pr = { p, u: new Map() };
    this.progs.set(name, pr);
    return pr;
  }

  private tex(w: number, h: number, src?: TexImageSource, float = false) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    } else if (float && this.floatOk) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return t;
  }

  private run(name: string, frag: string, target: WebGLTexture | null, w: number, h: number, inputs: Record<string, WebGLTexture>, uniforms: Record<string, number | number[]>) {
    const gl = this.gl;
    const pr = this.prog(name, frag);
    gl.useProgram(pr.p);
    let fb: WebGLFramebuffer | null = null;
    if (target) {
      fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    const loc = (n: string) => {
      if (!pr.u.has(n)) pr.u.set(n, gl.getUniformLocation(pr.p, n));
      return pr.u.get(n)!;
    };
    let unit = 0;
    for (const [n, t] of Object.entries(inputs)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(loc(n), unit++);
    }
    gl.uniform2f(loc('px'), 1 / w, 1 / h);
    for (const [n, v] of Object.entries(uniforms)) {
      const l = loc(n);
      if (n === 'surface' || n === 'palN') gl.uniform1i(l, v as number);
      else if (Array.isArray(v) && v.length > 3) gl.uniform3fv(l, v);
      else if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else gl.uniform3fv(l, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.getParameter(gl.ARRAY_BUFFER_BINDING));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (fb) gl.deleteFramebuffer(fb);
  }

  finish(stylized: HTMLCanvasElement, photo: CanvasImageSource, outW: number, outH: number, f: Finish, palette: Palette | null, detail: number): HTMLCanvasElement {
    const gl = this.gl;
    const s = Math.min(1, this.maxSize / Math.max(outW, outH));
    const w = Math.round(outW * s), h = Math.round(outH * s);
    this.canvas.width = w;
    this.canvas.height = h;
    const created: WebGLTexture[] = [];
    const T = (src?: TexImageSource, float = false) => {
      const t = this.tex(w, h, src, float);
      created.push(t);
      return t;
    };
    // Scale of features relative to a 1024px reference.
    const k = Math.max(w, h) / 1024;
    try {
      const sty = T(stylized);
      const ph = T(photo as TexImageSource);
      const tmpA = T(), tmpB = T();
      // Photo blur for the detail layer.
      this.run('blur', BLUR, tmpA, w, h, { src: ph }, { dir: [1, 0], sigma: 1.6 * k });
      this.run('blur', BLUR, tmpB, w, h, { src: tmpA }, { dir: [0, 1], sigma: 1.6 * k });
      const base = T();
      this.run('base', BASE, base, w, h, { sty, photo: ph, photoBlur: tmpB }, { detail });

      let painted = base;
      if (f.brush > 0) {
        const t0 = T(undefined, true), t1 = T(undefined, true);
        this.run('tensor', TENSOR, t0, w, h, { src: base }, {});
        const sig = 2.2 * k;
        this.run('blur', BLUR, t1, w, h, { src: t0 }, { dir: [1, 0], sigma: sig });
        this.run('blur', BLUR, t0, w, h, { src: t1 }, { dir: [0, 1], sigma: sig });
        const kw = T();
        this.run('kuwahara', KUWAHARA, kw, w, h, { src: base, tfm: t0 }, { radius: Math.min(8, Math.max(1.5, 2.4 * k * f.brush)) });
        const fl = T();
        this.run('flow', FLOW, fl, w, h, { src: kw, tfm: t0 }, { len: Math.min(12, Math.max(2, 4.5 * k * f.brush)), bristle: Math.max(1, 1.2 * k) });
        painted = fl;
      }
      // Height map for impasto = lightly blurred paint.
      this.run('blur', BLUR, tmpA, w, h, { src: painted }, { dir: [1, 0], sigma: 1.8 * k });
      this.run('blur', BLUR, tmpB, w, h, { src: tmpA }, { dir: [0, 1], sigma: 1.8 * k });

      const stats = imageLabStats(stylized);
      const colors = (palette?.colors ?? []).slice(0, 12);
      const palFlat = new Float32Array(36);
      colors.forEach((c, i) => palFlat.set(c, i * 3));
      const surfaceId = { none: 0, canvas: 1, paper: 2, panel: 3 }[f.surface];
      this.run('compose', COMPOSE, null, w, h, { src: painted, height: tmpB }, {
        imgMean: stats.slice(0, 3),
        imgStd: stats.slice(3, 6),
        artMean: palette ? palette.stats.slice(0, 3) : stats.slice(0, 3),
        artStd: palette ? palette.stats.slice(3, 6) : stats.slice(3, 6),
        'pal[0]': Array.from(palFlat),
        palN: colors.length,
        colorMatch: palette ? f.colorMatch : 0,
        impasto: f.impasto,
        relief: 6 * Math.max(1, k),
        surface: surfaceId,
        size: [w / Math.max(1, k * 0.9), h / Math.max(1, k * 0.9)],
      });
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      // Sources were uploaded with FLIP_Y, so the default framebuffer is already upright.
      out.getContext('2d')!.drawImage(this.canvas, 0, 0);
      return out;
    } finally {
      created.forEach((t) => gl.deleteTexture(t));
    }
  }
}

// ── colour statistics (shared with the build script's maths) ──
const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function lab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Lab mean/std of any drawable, measured on a 64px thumbnail. */
export function imageLabStats(src: CanvasImageSource & { width: number; height: number }): LabStats {
  const n = 64;
  const c = document.createElement('canvas');
  const sc = n / Math.max(Number(src.width), Number(src.height));
  c.width = Math.max(1, Math.round(Number(src.width) * sc));
  c.height = Math.max(1, Math.round(Number(src.height) * sc));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0], sq = [0, 0, 0];
  const count = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const v = lab(d[i], d[i + 1], d[i + 2]);
    for (let j = 0; j < 3; j++) {
      sum[j] += v[j];
      sq[j] += v[j] * v[j];
    }
  }
  const mean = sum.map((s) => s / count);
  const std = sq.map((s, j) => Math.sqrt(Math.max(0, s / count - mean[j] * mean[j])));
  return [mean[0], mean[1], mean[2], std[0], std[1], std[2]];
}

let finisher: Finisher | null | undefined;
function getFinisher() {
  if (finisher === undefined) {
    try {
      finisher = new Finisher();
    } catch (e) {
      console.warn('Atelier finish unavailable:', e);
      finisher = null;
    }
  }
  return finisher;
}

/**
 * Apply the painterly finish. Falls back to a plain upscale if WebGL2 is missing.
 * `detail` re‑injects photo micro‑structure (0..0.5).
 */
export function applyFinish(stylized: HTMLCanvasElement, photo: CanvasImageSource, outW: number, outH: number, f: Finish, palette: Palette | null, detail = 0.18): HTMLCanvasElement {
  const fin = getFinisher();
  if (fin) {
    try {
      return fin.finish(stylized, photo, outW, outH, f, palette, detail);
    } catch (e) {
      console.warn('Atelier finish failed, using raw output:', e);
    }
  }
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(stylized, 0, 0, outW, outH);
  return out;
}

/** Full colour signature (stats + 10 key pigments) of an artwork — used for "Your Style". */
export function imagePalette(src: CanvasImageSource & { width: number; height: number }): Palette {
  const n = 64;
  const c = document.createElement('canvas');
  const sc = n / Math.max(Number(src.width), Number(src.height));
  c.width = Math.max(1, Math.round(Number(src.width) * sc));
  c.height = Math.max(1, Math.round(Number(src.height) * sc));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px: [number, number, number][] = [];
  for (let i = 0; i < d.length; i += 4) px.push(lab(d[i], d[i + 1], d[i + 2]));
  const d2 = (p: number[], q: number[]) => (p[0] - q[0]) ** 2 * 0.5 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const cents: [number, number, number][] = [px[px.length >> 1]];
  while (cents.length < 10) {
    let best = px[0], bd = -1;
    for (const p of px) {
      const dd = Math.min(...cents.map((q) => d2(p, q)));
      if (dd > bd) { bd = dd; best = p; }
    }
    cents.push(best);
  }
  for (let it = 0; it < 15; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cents.forEach((q, i) => { const dd = d2(p, q); if (dd < bd) { bd = dd; bi = i; } });
      acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; acc[bi][3]++;
    }
    acc.forEach((a, i) => { if (a[3]) cents[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const round = (v: number) => +v.toFixed(1);
  return { stats: imageLabStats(src).map(round) as LabStats, colors: cents.map((q) => q.map(round) as [number, number, number]) };
}
