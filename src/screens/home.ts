import { h, pickFile } from '../ui/dom';
import { icons } from '../ui/icons';
import { haptic, parallax, ripple, setAccent, tilt, toast } from '../ui/fx';
import { MASTERS, REIMAGINE } from '../data/styles';
import { go } from '../router';
import { setMedia, setResult, state } from '../state';
import { loadMedia } from '../media/load';
import { listCreations, type Creation } from '../store/gallery';
import { openViewer } from './viewer';

export async function ingest(file: File | null) {
  if (!file) return;
  haptic(10);
  const loader = h('div', { class: 'ingest' }, h('div', { class: 'ingest-ring' }), h('p', null, 'Preparing your canvas…'));
  document.getElementById('overlays')!.append(loader);
  try {
    const media = await loadMedia(file);
    setMedia(media);
    setResult(null);
    await go('studio');
  } catch (e) {
    toast((e as Error).message || 'That file could not be opened.', { icon: icons.info });
  } finally {
    loader.classList.add('out');
    setTimeout(() => loader.remove(), 400);
  }
}

const FEATURED = ['starry', 'kiss', 'wave'];

export default function home(root: HTMLElement) {
  setAccent('#c9a25a');
  const featured = FEATURED.map((id) => MASTERS.find((m) => m.id === id)!);

  const stack = h(
    'div',
    { class: 'hero-stack', 'aria-hidden': 'true' },
    featured.map((s, i) =>
      tilt(
        h(
          'figure',
          { class: `hero-card c${i}` },
          h('img', { src: s.thumb, alt: '', decoding: 'async', fetchpriority: i === 1 ? 'high' : 'auto' }),
          h('figcaption', null, h('b', null, s.name), h('span', null, s.artist)),
          h('i', { class: 'gloss' }),
        ),
        14,
      ),
    ),
    h('div', { class: 'hero-orbit' }),
  );

  const photoBtn = ripple(
    h(
      'button',
      { class: 'pick pick-photo', onclick: async () => ingest(await pickFile('image/*')) },
      h('span', { class: 'pick-ico', html: icons.photo }),
      h('span', { class: 'pick-txt' }, h('b', null, 'Photo'), h('small', null, 'From your library')),
    ),
  );
  const camBtn = ripple(
    h('button', { class: 'pick-cam', onclick: async () => ingest(await pickFile('image/*', 'environment')), 'aria-label': 'Take a photo' }, h('span', { html: icons.camera }), 'Capture a moment'),
  );

  const recentRow = h('div', { class: 'recent-row' });
  const recent = h('section', { class: 'recent', hidden: true }, h('div', { class: 'section-head' }, h('h2', null, 'Recent masterpieces'), h('button', { class: 'link', onclick: () => go('gallery') }, 'View all')), recentRow);

  const names = ['Van Gogh', 'Hokusai', 'Klimt', 'Munch', 'Monet', 'Kandinsky', 'Mondrian', 'Seurat', 'Mucha', 'Rembrandt', 'Vermeer', 'Da Vinci', 'Anime', 'Comic', 'Watercolour'];
  const marquee = h('div', { class: 'marquee', 'aria-hidden': 'true' }, h('div', { class: 'marquee-track' }, [...names, ...names].map((n) => h('span', null, n, h('i', null, '✦')))));

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/logo.svg', alt: '', class: 'brand-mark' }), h('span', { class: 'brand-word' }, 'Artify', h('em', null, 'Me'))),
      h(
        'div',
        { class: 'topbar-actions' },
        h('button', { class: 'icon-btn', 'aria-label': 'Your collection', onclick: () => go('gallery'), html: icons.gallery }),
        h('button', { class: 'icon-btn', 'aria-label': 'About ArtifyMe', onclick: () => go('about'), html: icons.info }),
      ),
    ),
    h(
      'div',
      { class: 'home-hero' },
      stack,
      h(
        'div',
        { class: 'hero-copy' },
        h('p', { class: 'eyebrow' }, h('i', { class: 'dot' }), 'On‑device AI atelier'),
        h('h1', { class: 'display' }, 'Become the ', h('em', { class: 'shimmer' }, 'masterpiece'), '.'),
        h('p', { class: 'lede' }, 'Have your photos redrawn in the hand of history’s greatest artists — rendered privately, right on your phone.'),
      ),
    ),
    h('div', { class: 'picks single' }, photoBtn),
    camBtn,
    h('p', { class: 'privacy' }, h('span', { html: icons.lock }), 'Nothing is uploaded. Every brushstroke happens on your device.'),
    marquee,
    recent,
    h(
      'section',
      { class: 'showcase' },
      h('div', { class: 'section-head' }, h('h2', null, 'The collection'), h('span', { class: 'muted' }, `${MASTERS.length + REIMAGINE.length} styles`)),
      h(
        'div',
        { class: 'showcase-grid' },
        MASTERS.slice(0, 6).map((s) =>
          h(
            'button',
            {
              class: 'mini-art',
              style: `--accent:${s.accent}`,
              onclick: async () => {
                state.styleId = s.id;
                ingest(await pickFile('image/*'));
              },
            },
            h('img', { src: s.thumb, alt: s.name, loading: 'lazy', decoding: 'async' }),
            h('span', null, s.artist.split(' ').slice(-1)[0]),
          ),
        ),
      ),
    ),
    h('footer', { class: 'home-foot' }, 'Crafted for the curious. ', h('span', { class: 'muted' }, 'Works offline once installed.')),
  );

  const stop = parallax(stack);
  listCreations().then((items: Creation[]) => {
    if (!items.length) return;
    recent.hidden = false;
    items.slice(0, 8).forEach((c) => {
      const url = URL.createObjectURL(c.thumb);
      recentRow.append(
        h(
          'button',
          { class: 'recent-item', onclick: () => openViewer(c, items) },
          h('img', { src: url, alt: c.styleName, onload: () => setTimeout(() => URL.revokeObjectURL(url), 1000) }),
          c.kind === 'video' ? h('span', { class: 'badge-play', html: icons.play }) : null,
        ),
      );
    });
  });

  return () => stop();
}
