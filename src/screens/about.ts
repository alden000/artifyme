import { h } from '../ui/dom';
import { icons } from '../ui/icons';
import { toast } from '../ui/fx';
import { back } from '../router';
import { canInstall, isStandalone, promptInstall } from '../pwa';
import { MP_DOWNLOAD_MB, mpInstalled, mpRemove, mpSupport } from '../ai/masterpiece';
import { ensureMpInstalled } from './mpflow';

export default function about(root: HTMLElement) {
  const mpStatus = h('p', null, 'Checking this device…');
  const mpBtn = h('button', { class: 'ghost-btn', hidden: true });
  const refreshMp = async () => {
    const sup = await mpSupport();
    if (!sup.ok) {
      mpStatus.textContent = `Not available on this device. ${sup.reason ?? ''}`;
      mpBtn.hidden = true;
      return;
    }
    const inst = await mpInstalled();
    mpStatus.textContent = inst ? 'Installed — paints offline on your GPU.' : `Supported here. One‑time ${MP_DOWNLOAD_MB} MB download.`;
    mpBtn.hidden = false;
    mpBtn.textContent = inst ? 'Remove from device' : 'Download painter';
    mpBtn.onclick = async () => {
      if (inst) {
        if (!confirm('Remove the Masterpiece+ painter? You can download it again later.')) return;
        await mpRemove();
        toast('Masterpiece+ removed.', { icon: icons.check });
      } else await ensureMpInstalled();
      void refreshMp();
    };
  };
  void refreshMp();
  const mpCard = h('section', { class: 'card glow' }, h('h3', null, h('span', { html: icons.wand }), 'Masterpiece+'), h('p', null, 'A generative AI painter that redraws your photo in an artist’s hand. Runs fully on‑device with WebGPU.'), mpStatus, mpBtn);

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
      h('p', null, 'Your photos never leave this device. The AI runs inside your browser on your own graphics chip. No accounts, no uploads, no tracking. Your Collection is stored locally and can be deleted at any time.'),
    ),
    mpCard,
    installCard ?? "",
    h(
      'section',
      { class: 'card' },
      h('h3', null, h('span', { html: icons.palette }), 'Credits'),
      h('p', null, 'Masterpiece+: LCM‑DreamShaper‑v7 (Latent Consistency Models, Luo et al., 2023; DreamShaper by Lykon; based on Stable Diffusion 1.5) with the SDXS tiny autoencoder, used under CreativeML OpenRAIL licences. By using Masterpiece+ you agree to its use restrictions (no illegal, harmful, deceptive or harassing content). ', h('a', { href: 'models/mp2/LICENSE-MODEL.txt', target: '_blank', rel: 'noopener', class: 'link' }, 'Read the licence'), '. People & pets are found with DeepLabV3‑MobileNetV3 (torchvision, BSD‑3). Runtime: ONNX Runtime Web.'),
      h('p', null, 'Reference artworks are public‑domain works sourced from Wikimedia Commons.'),
    ),
    h('p', { class: 'home-foot' }, `ArtifyMe ${__APP_VERSION__}`),
  );
}
