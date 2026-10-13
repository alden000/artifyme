import { h, sleep } from '../ui/dom';
import { icons } from '../ui/icons';
import { countTo, haptic, pauseAurora, toast } from '../ui/fx';
import { currentStyle, setResult, state } from '../state';
import { canvasToBlob } from '../media/save';
import { addCreation, newId } from '../store/gallery';
import { mpLoad, mpPaint, mpReady } from '../ai/masterpiece';

const LINES = [
  'Grinding the pigments…',
  'Studying the brushwork of {artist}…',
  'Stretching a fresh canvas…',
  'Laying the first strokes…',
  'Building up the glazes…',
  'Chasing the light…',
  'Adding the final flourishes…',
  'Varnishing your masterpiece…',
];

const QUOTES = [
  ['I dream my painting and I paint my dream.', 'Vincent van Gogh'],
  ['Colour is my day‑long obsession, joy and torment.', 'Claude Monet'],
  ['Art is not what you see, but what you make others see.', 'Edgar Degas'],
  ['Every child is an artist.', 'Pablo Picasso'],
  ['Colour is a power which directly influences the soul.', 'Wassily Kandinsky'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
];

async function makeThumb(src: HTMLCanvasElement) {
  const s = 420 / Math.max(src.width, src.height);
  const t = document.createElement('canvas');
  t.width = Math.round(src.width * s);
  t.height = Math.round(src.height * s);
  const ctx = t.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, t.width, t.height);
  return canvasToBlob(t, 'image/jpeg', 0.82);
}

/** Full‑screen cinematic render. Resolves true when a result is ready in state.result. */
export async function runRender(): Promise<boolean> {
  const media = state.media!;
  const style = currentStyle();
  const abort = new AbortController();

  const R = 54;
  const C = 2 * Math.PI * R;
  const ring = h('div', {
    class: 'ring',
    html: `<svg viewBox="0 0 120 120"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1cf"/><stop offset=".5" stop-color="#e9c47e"/><stop offset="1" stop-color="${style.accent}"/></linearGradient></defs><circle cx="60" cy="60" r="${R}" class="ring-track"/><circle cx="60" cy="60" r="${R}" class="ring-bar" stroke="url(#rg)" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`,
  });
  const pct = h('b', { class: 'ring-pct' }, '0%');
  ring.append(pct);
  const bar = ring.querySelector<SVGCircleElement>('.ring-bar')!;
  const setP = (p: number) => {
    const v = Math.max(0, Math.min(1, p));
    bar.style.strokeDashoffset = String(C * (1 - v));
    countTo(pct, Math.round(v * 100));
  };

  const canvasView = h('canvas', { class: 'render-canvas' });
  canvasView.width = media.still.width;
  canvasView.height = media.still.height;
  canvasView.getContext('2d')!.drawImage(media.still, 0, 0);
  const frameEl = h('div', { class: 'render-frame', style: `--ar:${media.width}/${media.height}` }, canvasView, h('div', { class: 'render-scan' }), h('div', { class: 'render-bristles' }));
  const status = h('p', { class: 'render-status' }, 'Preparing…');
  const quote = QUOTES[(Math.random() * QUOTES.length) | 0];
  const overlay = h(
    'div',
    { class: 'render-overlay', style: `--accent:${style.accent}`, role: 'dialog', 'aria-label': 'Painting your masterpiece' },
    h('div', { class: 'render-bg' }),
    h(
      'div',
      { class: 'render-body' },
      h('p', { class: 'eyebrow' }, h('i', { class: 'dot' }), style.kind === 'generative' ? 'Masterpiece+' : `After ${style.artist}`),
      h('h2', { class: 'render-title' }, style.name),
      frameEl,
      h('div', { class: 'render-meter' }, ring, status),
      h('blockquote', { class: 'render-quote' }, `“${quote[0]}”`, h('cite', null, quote[1])),
      h('button', { class: 'ghost-btn', onclick: () => abort.abort() }, 'Cancel'),
    ),
  );
  document.getElementById('overlays')!.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  pauseAurora(true);

  let li = 0;
  const say = (s: string) => {
    status.classList.remove('tick');
    void status.offsetWidth;
    status.textContent = s;
    status.classList.add('tick');
  };
  const lineTimer = setInterval(() => say(LINES[li++ % LINES.length].replace('{artist}', style.artist)), 2300);
  say(LINES[0]);

  let simTimer = 0;
  try {
    {
      // Masterpiece+: unpack & compile the painter (first time per session), then paint.
      const wasReady = mpReady();
      if (!wasReady) {
        say('Waking the painter…');
        await mpLoad((phase, p) => {
          if (phase === 'download') setP(p * 0.45);
          else if (phase === 'unpack') setP(0.45 + p * 0.3);
          else setP(0.75 + p * 0.1);
          if (phase === 'compile' && p === 0) say('Preparing the canvas on your GPU…');
        });
      }
      if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      let fake = wasReady ? 0.08 : 0.85;
      simTimer = window.setInterval(() => {
        fake += (0.97 - fake) * 0.05;
        setP(fake);
      }, 150);
      say(style.kind === 'generative' ? `Drawing you as ${style.name.toLowerCase()}…` : `Redrawing you in the hand of ${style.artist.split(' ').slice(-1)[0]}…`);
      await sleep(60);
      const seed = state.mpSeed;
      const out = await mpPaint(media.still, {
        style: style.id,
        strength: state.mp.strength,
        keepColors: state.mp.keepColors,
        protectPeople: state.mp.protectPeople,
        seed,
        onPhase: (ph) => ph === 'people' && say('Taking extra care with faces…'),
        onStep: (i, n) => {
          fake = Math.max(fake, (wasReady ? 0.05 : 0.85) + ((wasReady ? 0.9 : 0.12) * i) / n);
          setP(fake);
        },
      });
      if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      clearInterval(simTimer);
      setP(1);
      say('Signed & varnished.');
      const blob = await canvasToBlob(out, 'image/jpeg', 0.93);
      const id = newId();
      setResult({ kind: 'image', blob, url: URL.createObjectURL(blob), width: out.width, height: out.height, style, canvas: out, creationId: id, mpSeed: seed });
      void addCreation({ id, kind: 'image', styleId: style.id, styleName: style.name, createdAt: Date.now(), blob, thumb: await makeThumb(out), width: out.width, height: out.height }).catch(() => {});
    }
    haptic([20, 60, 30]);
    await sleep(380);
    return true;
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') {
      console.error(e);
      const msg = /memory|OOM|allocate|texture/i.test(String(e)) ? 'Your device ran out of graphics memory. Close other apps and try again.' : (e as Error).message || 'Something went wrong while painting.';
      toast(msg, { icon: icons.info, duration: 5000 });
    }
    return false;
  } finally {
    clearInterval(lineTimer);
    clearInterval(simTimer);
    pauseAurora(false);
    overlay.classList.remove('in');
    overlay.classList.add('out');
    setTimeout(() => overlay.remove(), 600);
  }
}
