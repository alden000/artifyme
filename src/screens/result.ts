import { h, reducedMotion } from '../ui/dom';
import { icons } from '../ui/icons';
import { goldBurst, haptic, ripple, setAccent, toast } from '../ui/fx';
import { back, go } from '../router';
import { state } from '../state';
import { canShareFile, fileName, saveBlob, shareBlob } from '../media/save';

/** Before/after comparator with a draggable gold seam. */
export function compare(before: HTMLElement, after: HTMLElement, ar: string) {
  const handle = h('div', { class: 'cmp-handle', role: 'slider', 'aria-label': 'Compare with original', tabindex: '0' }, h('span', { class: 'cmp-knob', html: icons.compare }));
  const labelB = h('span', { class: 'cmp-label left' }, 'Original');
  const labelA = h('span', { class: 'cmp-label right' }, 'Artified');
  before.classList.add('cmp-before');
  after.classList.add('cmp-after');
  const el = h('div', { class: 'cmp', style: `--ar:${ar};--p:0` }, before, after, handle, labelB, labelA);
  let p = 0;
  const set = (v: number) => {
    p = Math.max(0, Math.min(1, v));
    el.style.setProperty('--p', p.toFixed(4));
    handle.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  };
  let dragging = false;
  const fromEvent = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    set((e.clientX - r.left) / r.width);
  };
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    fromEvent(e);
    haptic(4);
  });
  el.addEventListener('pointermove', (e) => dragging && fromEvent(e));
  const end = () => {
    dragging = false;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') set(p - 0.05);
    if (e.key === 'ArrowRight') set(p + 0.05);
  });
  const sweep = (to: number, dur = 900) =>
    new Promise<void>((res) => {
      const from = p;
      const t0 = performance.now();
      const step = (ts: number) => {
        if (dragging) return res();
        const k = Math.min(1, (ts - t0) / dur);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        set(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  return { el, set, sweep };
}

export default function result(root: HTMLElement) {
  const r = state.result;
  const media = state.media;
  if (!r || !media) {
    queueMicrotask(() => go('home', { replace: true }));
    return;
  }
  setAccent(r.style.accent);
  root.style.setProperty('--accent', r.style.accent);
  const ar = `${r.width}/${r.height}`;
  let stage: HTMLElement;
  let intro: (() => void) | null = null;
  let video: HTMLVideoElement | null = null;

  if (r.kind === 'image') {
    const before = h('img', { src: media.url, alt: 'Original' });
    if (media.kind === 'video') before.setAttribute('src', media.still.toDataURL('image/jpeg', 0.9));
    const after = h('img', { src: r.url, alt: `Your photo in the style of ${r.style.name}`, class: r.style.kind === 'procedural' ? 'pixel' : '' });
    const cmp = compare(before, after, ar);
    stage = h('div', { class: 'result-stage reveal' }, cmp.el);
    intro = () => {
      if (reducedMotion()) return;
      setTimeout(async () => {
        await cmp.sweep(0.62, 1000);
        await cmp.sweep(0.5, 500);
      }, 1500);
    };
  } else {
    video = h('video', { class: 'result-video', src: r.url, autoplay: true, loop: true, muted: true, playsInline: true, playsinline: true, poster: r.poster?.toDataURL('image/jpeg', 0.85) });
    video.muted = true;
    const soundBtn = h('button', { class: 'icon-btn floating', 'aria-label': 'Toggle sound', html: icons.mute });
    soundBtn.addEventListener('click', () => {
      video!.muted = !video!.muted;
      soundBtn.innerHTML = video!.muted ? icons.mute : icons.sound;
      if (!video!.muted) void video!.play();
    });
    stage = h('div', { class: 'result-stage reveal', style: `--ar:${ar}` }, h('div', { class: 'video-frame', style: `--ar:${ar}` }, video, soundBtn));
    void video.play().catch(() => {});
  }

  const name = fileName(r.style.id, r.blob.type);
  const save = ripple(
    h(
      'button',
      {
        class: 'cta cta-save',
        onclick: async (e: MouseEvent) => {
          haptic(12);
          const how = await saveBlob(r.blob, name);
          if (how === 'cancelled') return;
          goldBurst(e.clientX || innerWidth / 2, e.clientY || innerHeight * 0.8);
          haptic([10, 40, 20]);
          toast(how === 'shared' ? 'Ready — choose “Save” to keep it in Photos.' : 'Saved to your downloads.', { icon: icons.check });
        },
      },
      h('span', { class: 'cta-ico', html: icons.download }),
      h('span', { class: 'cta-txt' }, h('b', null, r.kind === 'video' ? 'Save video' : 'Save image'), h('small', null, `${r.width}×${r.height} · ${r.blob.type.split('/')[1].toUpperCase()}`)),
      h('i', { class: 'cta-shine' }),
    ),
  );

  const canShare = canShareFile(new File([r.blob], name, { type: r.blob.type }));
  const actions = h(
    'div',
    { class: 'result-actions' },
    canShare
      ? h(
          'button',
          {
            class: 'action',
            onclick: async () => {
              haptic(8);
              await shareBlob(r.blob, name);
            },
          },
          h('span', { html: icons.share }),
          'Share',
        )
      : null,
    r.mpSeed !== undefined
      ? h(
          'button',
          {
            class: 'action',
            onclick: async () => {
              haptic(10);
              state.mpSeed = (Math.random() * 1e9) | 0;
              const { runRender } = await import('./render');
              if (await runRender()) go('result', { replace: true });
            },
          },
          h('span', { html: icons.refresh }),
          'Paint again',
        )
      : null,
    h('button', { class: 'action', onclick: () => back('studio') }, h('span', { html: icons.palette }), 'Restyle'),
    h('button', { class: 'action', onclick: () => go('gallery') }, h('span', { html: icons.gallery }), 'Collection'),
    h('button', { class: 'action', onclick: () => go('home') }, h('span', { html: icons.plus }), 'New'),
  );

  const no = String(Math.floor((Date.now() / 1000) % 10000)).padStart(4, '0');
  const placard = h(
    'div',
    { class: 'placard' },
    h('p', { class: 'placard-no' }, `ArtifyMe Collection · No. ${no}`),
    h('h1', { class: 'placard-title' }, h('em', null, 'Untitled'), r.style.kind === 'generative' ? `, ${r.style.name.toLowerCase()}` : `, after ${r.style.name}`),
    h('p', { class: 'placard-sub' }, `${r.style.artist} (${r.style.year}) · ${r.style.movement}`),
    h('p', { class: 'placard-medium' }, `${r.mpSeed !== undefined ? 'Redrawn by Masterpiece+' : r.style.kind === 'neural' ? 'Neural pigment' : 'Procedural pixels'} on device, ${new Date().getFullYear()}`),
  );

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to atelier', onclick: () => back('studio'), html: icons.back }),
      h('div', { class: 'topbar-title' }, h('span', { class: 'eyebrow' }, 'Masterpiece')),
      h('button', { class: 'icon-btn', 'aria-label': 'Start over', onclick: () => go('home'), html: icons.close }),
    ),
    stage,
    placard,
    h('div', { class: 'cta-wrap' }, save),
    actions,
    h('p', { class: 'privacy small' }, h('span', { html: icons.lock }), 'Kept privately in your on‑device Collection.'),
  );
  intro?.();
  return () => video?.pause();
}
