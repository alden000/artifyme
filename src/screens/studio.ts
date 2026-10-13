import { h, pickFile } from '../ui/dom';
import { icons } from '../ui/icons';
import { haptic, ripple, setAccent, tilt, toast } from '../ui/fx';
import { segmented, slider, toggle } from '../ui/controls';
import { MASTERS, PIXEL_WORLDS, type ArtStyle } from '../data/styles';
import { back, go } from '../router';
import { currentStyle, persistSettings, state } from '../state';
import { isModelLoaded, loadModel, onModelProgress } from '../ai/engine';
import { QUALITY, renderStyle, type Quality } from '../ai/pipeline';
import { proceduralThumb } from '../ui/thumbs';
import { createCustomStyle, loadCustomStyles, removeCustomStyle } from '../store/custom';
import { loadMedia } from '../media/load';
import { runRender } from './render';

type Tab = 'masters' | 'pixel' | 'yours';

export default function studio(root: HTMLElement) {
  const media = state.media;
  if (!media) {
    queueMicrotask(() => go('home', { replace: true }));
    return;
  }
  state.customStyles = loadCustomStyles();
  let disposed = false;
  let tab: Tab = currentStyle().kind === 'procedural' ? 'pixel' : currentStyle().id.startsWith('custom-') ? 'yours' : 'masters';

  // ── Stage ───────────────────────────────────────────────
  const base: HTMLElement =
    media.kind === 'video'
      ? h('video', { class: 'stage-media', src: media.url, muted: true, autoplay: true, loop: true, playsInline: true, playsinline: true, 'webkit-playsinline': true })
      : (() => {
          const c = media.still;
          c.className = 'stage-media';
          return c;
        })();
  if (base instanceof HTMLVideoElement) {
    base.muted = true;
    void base.play().catch(() => {});
  }
  const preview = h('canvas', { class: 'stage-preview' });
  const sweep = h('div', { class: 'stage-sweep' });
  const pill = h('div', { class: 'stage-pill', hidden: true });
  const holdHint = h('div', { class: 'stage-hint' }, h('span', { html: icons.compare }), 'Hold to compare');
  const frame = h('div', { class: 'stage-frame', style: `--ar:${media.width}/${media.height}` }, base, preview, sweep, pill, holdHint);
  const stage = h('div', { class: 'stage' }, frame);

  frame.addEventListener('pointerdown', () => frame.classList.add('peek'));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => frame.addEventListener(e, () => frame.classList.remove('peek')));

  // ── Meta / placard ──────────────────────────────────────
  const metaName = h('h2', { class: 'meta-name' });
  const metaSub = h('p', { class: 'meta-sub' });
  const metaChip = h('span', { class: 'chip' });
  const meta = h('div', { class: 'meta' }, h('div', null, metaName, metaSub), metaChip);

  // ── Tabs + carousel ─────────────────────────────────────
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const tabDefs: { id: Tab; label: string; icon: string }[] = [
    { id: 'masters', label: 'Masters', icon: icons.brush },
    { id: 'pixel', label: 'Pixel Worlds', icon: icons.cube },
    { id: 'yours', label: 'Your Style', icon: icons.wand },
  ];
  const tabInk = h('span', { class: 'tab-ink' });
  tabsEl.append(tabInk);
  const tabBtns = tabDefs.map((t, i) =>
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
  tabsEl.append(...tabBtns);
  const tabIndex = tabDefs.findIndex((t) => t.id === tab);
  tabsEl.style.setProperty('--i', String(tabIndex));
  tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(tabIndex === j)));

  const carousel = h('div', { class: 'carousel', role: 'listbox', 'aria-label': 'Art styles' });

  const card = (s: ArtStyle) => {
    const img = h('img', { alt: '', decoding: 'async', loading: 'lazy' });
    if (s.kind === 'procedural') proceduralThumb(s).then((u) => (img.src = u));
    else img.src = s.thumb;
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
      h('span', { class: 'style-art' }, img, h('i', { class: 'gloss' })),
      h('span', { class: 'style-name' }, s.name),
    );
    if (s.id.startsWith('custom-')) {
      let t = 0;
      el.addEventListener('pointerdown', () => {
        t = window.setTimeout(() => {
          haptic([10, 40, 10]);
          if (confirm(`Remove “${s.name}” from your styles?`)) {
            state.customStyles = removeCustomStyle(s.id, state.customStyles);
            if (state.styleId === s.id) selectStyle(MASTERS[0]);
            buildCarousel();
          }
        }, 650);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => el.addEventListener(e, () => clearTimeout(t)));
    }
    el.dataset.id = s.id;
    return tilt(el, 8);
  };

  const addCard = () =>
    h(
      'button',
      { class: 'style-card add-card', onclick: addCustomStyle },
      h('span', { class: 'style-art' }, h('span', { class: 'add-ico', html: icons.plus }), h('small', null, 'Add artwork')),
      h('span', { class: 'style-name' }, 'Teach a style'),
    );

  function buildCarousel() {
    carousel.classList.remove('in');
    carousel.replaceChildren();
    const list = tab === 'masters' ? MASTERS : tab === 'pixel' ? PIXEL_WORLDS : state.customStyles;
    if (tab === 'yours') carousel.append(addCard());
    list.forEach((s) => carousel.append(card(s)));
    if (tab === 'yours' && !list.length) {
      carousel.append(h('p', { class: 'carousel-empty' }, 'Choose any painting, poster or pattern — ArtifyMe will learn its look on‑device.'));
    }
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
  const tune = h('div', { class: 'tune' });
  const tuneToggle = h('button', { class: 'icon-btn', 'aria-label': 'Fine‑tune', 'aria-expanded': 'false', html: icons.sliders });
  tuneToggle.addEventListener('click', () => {
    const open = !tune.classList.contains('open');
    tune.classList.toggle('open', open);
    tuneToggle.setAttribute('aria-expanded', String(open));
    haptic(6);
  });

  function buildTune() {
    const s = currentStyle();
    const kids: HTMLElement[] = [
      slider({
        label: 'Intensity',
        value: state.settings.intensity,
        min: 0.2,
        onInput: (v) => {
          state.settings.intensity = v;
          persistSettings();
          schedulePreview(160);
        },
      }),
    ];
    if (s.kind === 'neural') {
      kids.push(
        toggle({
          label: 'Keep original colours',
          hint: 'Borrow only the brushwork & texture',
          value: state.settings.preserveColor,
          onChange: (v) => {
            state.settings.preserveColor = v;
            persistSettings();
            schedulePreview(0);
          },
        }),
      );
    } else {
      kids.push(
        slider({
          label: 'Detail',
          value: state.settings.detail,
          format: (v) => (v < 0.34 ? 'Chunky' : v < 0.67 ? 'Classic' : 'Fine'),
          onInput: (v) => {
            state.settings.detail = v;
            persistSettings();
            schedulePreview(120);
          },
        }),
      );
    }
    if (media!.kind === 'image') {
      if (s.kind === 'neural') {
        kids.push(
          segmented<Quality>({
            label: 'Render quality',
            value: state.settings.quality,
            options: (Object.keys(QUALITY) as Quality[]).map((k) => ({ value: k, label: QUALITY[k].label, hint: QUALITY[k].hint.split(' · ')[0] })),
            onChange: (v) => {
              state.settings.quality = v;
              persistSettings();
              updateCta();
            },
          }),
        );
      }
    } else {
      kids.push(
        segmented({
          label: 'Frame rate',
          value: state.video.fps,
          options: [
            { value: 12, label: '12 fps', hint: 'Painterly' },
            { value: 24, label: '24 fps', hint: 'Cinematic' },
          ],
          onChange: (v) => {
            state.video.fps = v as 12 | 24;
            persistSettings();
            updateCta();
          },
        }),
        segmented({
          label: 'Resolution',
          value: state.video.maxSide,
          options: [
            { value: 360, label: '360p' },
            { value: 540, label: '540p' },
            { value: 720, label: '720p' },
          ],
          onChange: (v) => {
            state.video.maxSide = v as 360 | 540 | 720;
            persistSettings();
            updateCta();
          },
        }),
      );
    }
    tune.replaceChildren(h('div', { class: 'tune-inner' }, ...kids));
  }

  // ── CTA ─────────────────────────────────────────────────
  const ctaHint = h('small');
  const cta = ripple(h('button', { class: 'cta', onclick: () => artify() }, h('span', { class: 'cta-ico', html: icons.sparkle }), h('span', { class: 'cta-txt' }, h('b', null, 'Artify'), ctaHint), h('i', { class: 'cta-shine' })));

  function updateCta() {
    const s = currentStyle();
    if (media!.kind === 'video') {
      const secs = Math.min(15, media!.duration ?? 0);
      ctaHint.textContent = `${Math.round(secs)}s · ${state.video.fps} fps · ${state.video.maxSide}p`;
    } else if (s.kind === 'procedural') ctaHint.textContent = 'Instant · pixel perfect';
    else ctaHint.textContent = `${QUALITY[state.settings.quality].label} quality · on‑device`;
  }

  // ── Live preview ────────────────────────────────────────
  let previewToken = 0;
  let previewTimer = 0;
  function schedulePreview(delay = 90) {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(runPreview, delay);
  }
  async function runPreview() {
    const token = ++previewToken;
    const s = currentStyle();
    frame.classList.add('busy');
    try {
      if (s.kind === 'neural' && !isModelLoaded('fast')) pill.hidden = false;
      const out = await renderStyle(s, media!.still, media!.still.width, media!.still.height, state.settings, { maxSide: 400, model: 'fast' });
      if (disposed || token !== previewToken) return;
      preview.width = out.width;
      preview.height = out.height;
      preview.getContext('2d')!.drawImage(out, 0, 0);
      preview.classList.remove('show');
      void preview.offsetWidth;
      preview.classList.add('show');
      preview.classList.toggle('pixel', s.kind === 'procedural');
    } catch (e) {
      console.error(e);
      if (token === previewToken) toast('Preview unavailable — you can still Artify.', { icon: icons.info });
    } finally {
      if (token === previewToken) {
        frame.classList.remove('busy');
        pill.hidden = true;
      }
    }
  }
  const offProgress = onModelProgress((k, p) => {
    if (k === 'fast' || k === 'style') pill.textContent = p < 1 ? `${k === 'style' ? 'Learning to see' : 'Mixing AI pigments'} · ${Math.round(p * 100)}%` : 'Ready';
  });

  function selectStyle(s: ArtStyle) {
    haptic(8);
    const prevKind = currentStyle().kind;
    state.styleId = s.id;
    carousel.querySelectorAll('.style-card').forEach((c) => c.setAttribute('aria-selected', String((c as HTMLElement).dataset.id === s.id)));
    renderMeta(true);
    if (prevKind !== s.kind) buildTune();
    updateCta();
    schedulePreview();
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

  async function addCustomStyle() {
    const file = await pickFile('image/*');
    if (!file) return;
    pill.hidden = false;
    pill.textContent = 'Learning to see · 0%';
    try {
      const m = await loadMedia(file);
      URL.revokeObjectURL(m.url);
      state.customStyles = await createCustomStyle(m.still, state.customStyles);
      toast('New style learned. It lives only on this device.', { icon: icons.wand });
      selectStyle(state.customStyles[0]);
      buildCarousel();
    } catch (e) {
      console.error(e);
      toast('Could not learn that style. Try another image.', { icon: icons.info });
    } finally {
      pill.hidden = true;
    }
  }

  async function artify() {
    haptic([12, 30, 18]);
    cta.classList.add('pressed');
    setTimeout(() => cta.classList.remove('pressed'), 400);
    const ok = await runRender();
    if (ok && !disposed) go('result');
  }

  root.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(), html: icons.back }), h('div', { class: 'topbar-title' }, h('span', { class: 'eyebrow' }, media.kind === 'video' ? 'Motion atelier' : 'Atelier')), tuneToggle),
    stage,
    meta,
    tabsEl,
    carousel,
    tune,
    h('div', { class: 'cta-wrap' }, cta),
  );

  renderMeta();
  buildTune();
  buildCarousel();
  updateCta();
  // Fetch the fast network in the background, then show the first preview.
  void loadModel('fast').catch(() => {});
  schedulePreview(260);

  return () => {
    disposed = true;
    offProgress();
    clearTimeout(previewTimer);
    if (base instanceof HTMLVideoElement) base.pause();
  };
}
