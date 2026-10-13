import { h } from '../ui/dom';
import { icons } from '../ui/icons';
import { haptic, toast } from '../ui/fx';
import { openSheet } from '../ui/sheet';
import { MP_DOWNLOAD_MB, mpDownload, mpInstalled, mpSupport } from '../ai/masterpiece';

/**
 * Make sure Masterpiece+ can run here and its painter is on the device.
 * Shows a one‑time download sheet. Resolves true when ready to paint.
 */
export async function ensureMpInstalled(): Promise<boolean> {
  const sup = await mpSupport();
  if (!sup.ok) {
    toast(`Masterpiece+ isn’t available on this device. ${sup.reason ?? ''}`, { icon: icons.info, duration: 5200 });
    return false;
  }
  if (await mpInstalled()) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const bar = h('i', { class: 'mbar-fill', style: '--p:0' });
    const status = h('small', { class: 'sheet-status' }, 'One‑time download · works offline afterwards');
    const go = h('button', { class: 'cta cta-sheet' }, h('span', { class: 'cta-ico', html: icons.download }), h('span', { class: 'cta-txt' }, h('b', null, 'Download painter'), h('small', null, `${MP_DOWNLOAD_MB} MB · Wi‑Fi recommended`)), h('i', { class: 'cta-shine' }));
    const later = h('button', { class: 'ghost-btn' }, 'Not now');
    const content = h(
      'div',
      { class: 'mp-sheet' },
      h('p', { class: 'eyebrow' }, h('i', { class: 'dot' }), 'Masterpiece+'),
      h('h2', { class: 'display sm' }, 'An AI painter that ', h('em', null, 'redraws'), ' you.'),
      h(
        'ul',
        { class: 'mp-points' },
        h('li', null, h('span', { html: icons.brush }), 'Repaints your photo in the artist’s own hand — new brushwork, new forms, not a colour filter.'),
        h('li', null, h('span', { html: icons.sparkle }), 'Anime, 3D cartoon, comic, sketch, watercolour & pop art, plus all 21 masters.'),
        h('li', null, h('span', { html: icons.lock }), 'Runs entirely on your phone. Your photos never leave it.'),
      ),
      h('div', { class: 'mp-progress', hidden: true }, h('span', { class: 'mbar' }, bar)),
      status,
      go,
      later,
    );
    const close = openSheet(content, { onClose: () => finish(false) });
    later.addEventListener('click', () => close());
    go.addEventListener('click', async () => {
      haptic(10);
      go.setAttribute('disabled', '');
      later.setAttribute('hidden', '');
      (content.querySelector('.mp-progress') as HTMLElement).hidden = false;
      try {
        await mpDownload((_, p) => {
          bar.style.setProperty('--p', String(p));
          status.textContent = `Downloading the painter… ${Math.round(p * 100)}%`;
        });
        status.textContent = 'Ready. The painter now lives on this device.';
        haptic([10, 40, 20]);
        settled = true;
        resolve(true);
        setTimeout(close, 700);
      } catch (e) {
        status.textContent = `Download interrupted — ${(e as Error).message}. Tap to retry.`;
        go.removeAttribute('disabled');
        later.removeAttribute('hidden');
      }
    });
  });
}
