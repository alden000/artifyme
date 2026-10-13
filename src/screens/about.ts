import { h } from '../ui/dom';
import { icons } from '../ui/icons';
import { haptic, toast } from '../ui/fx';
import { back } from '../router';
import { backendName, isModelLoaded, loadModel, MODEL_SIZES_MB, onModelProgress, type ModelKey } from '../ai/engine';
import { canInstall, isStandalone, promptInstall } from '../pwa';

const MODEL_LABEL: Record<ModelKey, [string, string]> = {
  fast: ['Swift painter', 'Live previews & video'],
  hq: ['Studio painter', 'High‑fidelity stills'],
  style: ['Style learner', 'Powers “Your Style”'],
};

export default function about(root: HTMLElement) {
  const rows = (Object.keys(MODEL_LABEL) as ModelKey[]).map((k) => {
    const bar = h('i', { class: 'mbar-fill', style: `--p:${isModelLoaded(k) ? 1 : 0}` });
    const state = h('small', null, isModelLoaded(k) ? 'Ready offline' : `${MODEL_SIZES_MB[k]} MB`);
    return { k, bar, state, el: h('div', { class: 'model-row' }, h('div', null, h('b', null, MODEL_LABEL[k][0]), h('small', null, MODEL_LABEL[k][1])), state, h('span', { class: 'mbar' }, bar)) };
  });
  const off = onModelProgress((k, p) => {
    const r = rows.find((x) => x.k === k)!;
    r.bar.style.setProperty('--p', String(p));
    r.state.textContent = p >= 1 ? 'Ready offline' : `${Math.round(p * 100)}%`;
  });
  const dl = h(
    'button',
    {
      class: 'ghost-btn',
      onclick: async () => {
        haptic(8);
        dl.disabled = true;
        try {
          for (const r of rows) await loadModel(r.k);
          toast('All AI painters are stored on this device.', { icon: icons.check });
        } catch {
          toast('Download interrupted. Check your connection.', { icon: icons.info });
        } finally {
          dl.disabled = false;
        }
      },
    },
    h('span', { html: icons.download }),
    'Download all for offline',
  );

  const engine = h('span', { class: 'muted' }, '…');
  backendName().then((b) => (engine.textContent = b === 'webgl' ? 'GPU (WebGL)' : b.toUpperCase()));

  const installCard = isStandalone()
    ? null
    : h(
        'section',
        { class: 'card' },
        h('h3', null, h('span', { html: icons.install }), 'Install ArtifyMe'),
        canInstall()
          ? h('p', null, 'Add ArtifyMe to your home screen for a full‑screen, offline studio.')
          : h('p', null, 'On iPhone & iPad: tap ', h('b', null, 'Share'), ' then ', h('b', null, 'Add to Home Screen'), '. On Android: open the browser menu and choose ', h('b', null, 'Install app'), '.'),
        canInstall() ? h('button', { class: 'ghost-btn', onclick: () => promptInstall() }, 'Install now') : null,
      );

  root.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(), html: icons.back }), h('div', { class: 'topbar-title' }, h('span', { class: 'eyebrow' }, 'About')), h('span', { class: 'icon-btn ghost' })),
    h('div', { class: 'page-head' }, h('img', { src: 'icons/logo.svg', alt: '', class: 'about-logo' }), h('h1', { class: 'display sm' }, 'Artify', h('em', null, 'Me')), h('p', { class: 'lede' }, 'A pocket atelier where artificial intelligence studies the great masters — and paints you in their hand.')),
    h(
      'section',
      { class: 'card glow' },
      h('h3', null, h('span', { html: icons.lock }), 'Private by design'),
      h('p', null, 'Your photos and videos never leave this device. The AI runs inside your browser on your own graphics chip. No accounts, no uploads, no tracking. Your Collection is stored locally and can be deleted at any time.'),
    ),
    h('section', { class: 'card' }, h('h3', null, h('span', { html: icons.sparkle }), 'AI painters'), h('div', { class: 'models' }, rows.map((r) => r.el)), dl, h('p', { class: 'muted small' }, 'Engine: ', engine)),
    installCard ?? "",
    h(
      'section',
      { class: 'card' },
      h('h3', null, h('span', { html: icons.palette }), 'Credits'),
      h('p', null, 'Neural style transfer: Magenta “Arbitrary Image Stylization” (Ghiasi et al., 2017) via the TensorFlow.js port by Reiichiro Nakano — Apache 2.0.'),
      h('p', null, 'Reference artworks are public‑domain works sourced from Wikimedia Commons. Pixel Worlds textures are generated procedurally. Minecraft is a trademark of Mojang Synergies AB; ArtifyMe is not affiliated with Mojang or Microsoft.'),
    ),
    h('p', { class: 'home-foot' }, `ArtifyMe ${__APP_VERSION__}`),
  );
  return () => off();
}
