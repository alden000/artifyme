import { h } from '../ui/dom';
import { icons } from '../ui/icons';
import { haptic, ripple, setAccent, tilt } from '../ui/fx';
import { slider, toggle } from '../ui/controls';
import { MASTERS, REIMAGINE, type ArtStyle } from '../data/styles';
import { mpSupport } from '../ai/masterpiece';
import { ensureMpInstalled } from './mpflow';
import { back, go } from '../router';
import { currentStyle, persistSettings, state } from '../state';
import { runRender } from './render';

type Tab = 'masters' | 'reimagine';

export default function studio(root: HTMLElement) {
  const media = state.media;
  if (!media) {
    queueMicrotask(() => go('home', { replace: true }));
    return;
  }
  let disposed = false;
  const tabFor = (s: ArtStyle): Tab => (s.kind === 'generative' ? 'reimagine' : 'masters');
  let tab: Tab = tabFor(currentStyle());

  // ── Stage ───────────────────────────────────────────────
  const base = media.still;
  base.className = 'stage-media';
  const frame = h('div', { class: 'stage-frame', style: `--ar:${media.width}/${media.height}` }, base);
  const stage = h('div', { class: 'stage' }, frame);
  const notice = h('p', { class: 'studio-note', hidden: true });

  // ── Meta / placard ──────────────────────────────────────
  const metaName = h('h2', { class: 'meta-name' });
  const metaSub = h('p', { class: 'meta-sub' });
  const metaChip = h('span', { class: 'chip' });
  const meta = h('div', { class: 'meta' }, h('div', null, metaName, metaSub), metaChip);

  // ── Tabs + carousel ─────────────────────────────────────
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const tabDefs: { id: Tab; label: string; icon: string }[] = [
    { id: 'masters', label: 'Masters', icon: icons.brush },
    { id: 'reimagine', label: 'Reimagine', icon: icons.wand },
  ];
  tabsEl.style.setProperty('--n', String(tabDefs.length));
  const tabBtns: HTMLButtonElement[] = tabDefs.map((t, i) =>
    h(
      'button',
      {
        class: 'tab',
        role: 'tab',
        onclick: () => {
          if (tab === t.id) return;
          haptic(6);
          tab = t.id;
          tabsEl.style.setProperty('--i', String(i));
          tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
          buildCarousel();
        },
      },
      h('span', { html: t.icon }),
      t.label,
    ),
  );
  tabsEl.append(h('span', { class: 'tab-ink' }), ...tabBtns);
  const tabIndex = tabDefs.findIndex((t) => t.id === tab);
  tabsEl.style.setProperty('--i', String(tabIndex));
  tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(tabIndex === j)));

  const carousel = h('div', { class: 'carousel', role: 'listbox', 'aria-label': 'Art styles' });

  const card = (s: ArtStyle) => {
    const el = h(
      'button',
      {
        class: 'style-card',
        role: 'option',
        style: `--accent:${s.accent}`,
        'aria-selected': String(s.id === state.styleId),
        'aria-label': `${s.name} by ${s.artist}`,
        onclick: () => {
          if (state.styleId === s.id) return;
          selectStyle(s);
          centerCard(el, true);
        },
      },
      h('span', { class: 'style-art' }, h('img', { alt: '', decoding: 'async', loading: 'lazy', src: s.thumb }), h('i', { class: 'gloss' })),
      h('span', { class: 'style-name' }, s.name),
    );
    el.dataset.id = s.id;
    return tilt(el, 8);
  };

  function buildCarousel() {
    carousel.classList.remove('in');
    carousel.replaceChildren(...(tab === 'masters' ? MASTERS : REIMAGINE).map(card));
    void carousel.offsetWidth;
    carousel.classList.add('in');
    const sel = carousel.querySelector<HTMLElement>(`[data-id="${state.styleId}"]`);
    if (sel) requestAnimationFrame(() => centerCard(sel, false));
    else carousel.scrollLeft = 0;
    updateDepth();
  }

  // Horizontal only — scrollIntoView would also yank the page vertically.
  function centerCard(el: HTMLElement, smooth: boolean) {
    carousel.scrollTo({ left: el.offsetLeft - (carousel.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Cards shrink & dim with distance from the centre: a lens‑like carousel.
  let depthRaf = 0;
  function updateDepth() {
    cancelAnimationFrame(depthRaf);
    depthRaf = requestAnimationFrame(() => {
      const r = carousel.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      carousel.querySelectorAll<HTMLElement>('.style-card').forEach((c) => {
        const cr = c.getBoundingClientRect();
        const d = Math.min(1, Math.abs(cr.left + cr.width / 2 - mid) / (r.width * 0.6));
        c.style.setProperty('--d', d.toFixed(3));
      });
    });
  }
  carousel.addEventListener('scroll', updateDepth, { passive: true });

  // ── Fine‑tune panel ─────────────────────────────────────
  const tune = h(
    'div',
    { class: 'tune' },
    h(
      'div',
      { class: 'tune-inner' },
      slider({
        label: 'Faithful ↔ Artistic',
        value: state.mp.strength,
        min: 0.25,
        max: 0.6,
        format: (v) => (v < 0.33 ? 'Faithful' : v < 0.45 ? 'Balanced' : 'Artistic'),
        onInput: (v) => {
          state.mp.strength = v;
          persistSettings();
        },
      }),
      toggle({
        label: 'Protect people',
        hint: 'Repaints people & pets separately so they stay recognisable',
        value: state.mp.protectPeople,
        onChange: (v) => {
          state.mp.protectPeople = v;
          persistSettings();
        },
      }),
      toggle({
        label: 'Keep my colours',
        hint: 'Hair, skin & clothing keep their real colours',
        value: state.mp.keepColors,
        onChange: (v) => {
          state.mp.keepColors = v;
          persistSettings();
        },
      }),
    ),
  );
  const tuneToggle = h('button', { class: 'icon-btn', 'aria-label': 'Fine‑tune', 'aria-expanded': 'false', html: icons.sliders });
  tuneToggle.addEventListener('click', () => {
    const open = !tune.classList.contains('open');
    tune.classList.toggle('open', open);
    tuneToggle.setAttribute('aria-expanded', String(open));
    haptic(6);
  });

  // ── CTA ─────────────────────────────────────────────────
  const ctaHint = h('small', null, 'Masterpiece+ · redrawn on‑device');
  const cta = ripple(h('button', { class: 'cta', onclick: () => artify() }, h('span', { class: 'cta-ico', html: icons.sparkle }), h('span', { class: 'cta-txt' }, h('b', null, 'Paint'), ctaHint), h('i', { class: 'cta-shine' })));
  let supported = true;
  void mpSupport().then((sup) => {
    if (sup.ok || disposed) return;
    supported = false;
    cta.classList.add('disabled');
    ctaHint.textContent = 'Needs a recent phone with WebGPU';
    notice.hidden = false;
    notice.textContent = `Masterpiece+ isn’t available on this device. ${sup.reason ?? ''}`;
  });

  function selectStyle(s: ArtStyle) {
    haptic(8);
    state.styleId = s.id;
    carousel.querySelectorAll('.style-card').forEach((c) => c.setAttribute('aria-selected', String((c as HTMLElement).dataset.id === s.id)));
    renderMeta(true);
  }

  function renderMeta(animate = false) {
    const s = currentStyle();
    setAccent(s.accent);
    root.style.setProperty('--accent', s.accent);
    metaName.textContent = s.name;
    metaSub.textContent = `${s.artist} · ${s.year}`;
    metaChip.textContent = s.movement;
    if (animate) {
      meta.classList.remove('swap');
      void meta.offsetWidth;
      meta.classList.add('swap');
    }
  }

  async function artify() {
    if (!supported) return;
    haptic([12, 30, 18]);
    cta.classList.add('pressed');
    setTimeout(() => cta.classList.remove('pressed'), 400);
    if (!(await ensureMpInstalled()) || disposed) return;
    const ok = await runRender();
    if (ok && !disposed) go('result');
  }

  root.classList.add('mp-mode');
  root.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(), html: icons.back }), h('div', { class: 'topbar-title' }, h('span', { class: 'eyebrow' }, 'Atelier')), tuneToggle),
    stage,
    notice,
    meta,
    tabsEl,
    carousel,
    tune,
    h('div', { class: 'cta-wrap' }, cta),
  );

  renderMeta();
  buildCarousel();

  return () => {
    disposed = true;
  };
}
