import { h } from '../ui/dom';
import { icons } from '../ui/icons';
import { goldBurst, haptic, toast } from '../ui/fx';
import { pushOverlay } from '../router';
import { deleteCreation, type Creation } from '../store/gallery';
import { canShareFile, fileName, saveBlob, shareBlob } from '../media/save';

/** Full‑screen lightbox for a creation from the Collection. Swipe to browse. */
export function openViewer(start: Creation, list: Creation[]) {
  let index = Math.max(0, list.findIndex((c) => c.id === start.id));
  let url = '';
  const media = h('div', { class: 'viewer-media' });
  const title = h('p', { class: 'viewer-title' });
  const date = h('p', { class: 'viewer-date' });
  const counter = h('span', { class: 'viewer-count' });

  const show = (dir = 0) => {
    const c = list[index];
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(c.blob);
    const el =
      c.kind === 'video'
        ? h('video', { src: url, autoplay: true, loop: true, muted: true, playsInline: true, playsinline: true, controls: true })
        : h('img', { src: url, alt: c.styleName });
    el.classList.add(dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : 'fade');
    media.replaceChildren(el);
    title.textContent = `After ${c.styleName}`;
    date.textContent = new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    counter.textContent = `${index + 1} / ${list.length}`;
  };

  const close = () => {
    overlay.classList.remove('in');
    setTimeout(() => {
      overlay.remove();
      if (url) URL.revokeObjectURL(url);
    }, 400);
  };

  const name = () => fileName(list[index].styleId, list[index].blob.type);
  const overlay = h(
    'div',
    { class: 'viewer', role: 'dialog', 'aria-label': 'Creation viewer' },
    h('div', { class: 'viewer-top' }, h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => history.back(), html: icons.close }), counter),
    media,
    h(
      'div',
      { class: 'viewer-bottom' },
      h('div', null, title, date),
      h(
        'div',
        { class: 'viewer-actions' },
        h(
          'button',
          {
            class: 'icon-btn',
            'aria-label': 'Delete',
            onclick: async () => {
              if (!confirm('Delete this creation from your Collection?')) return;
              haptic(10);
              await deleteCreation(list[index].id);
              list.splice(index, 1);
              if (!list.length) return history.back();
              index = Math.min(index, list.length - 1);
              show();
            },
            html: icons.trash,
          },
        ),
        canShareFile(new File([start.blob], 'x', { type: start.blob.type }))
          ? h('button', { class: 'icon-btn', 'aria-label': 'Share', onclick: () => shareBlob(list[index].blob, name()), html: icons.share })
          : null,
        h(
          'button',
          {
            class: 'icon-btn gold',
            'aria-label': 'Save',
            onclick: async (e: MouseEvent) => {
              const how = await saveBlob(list[index].blob, name());
              if (how === 'cancelled') return;
              goldBurst(e.clientX, e.clientY);
              toast(how === 'shared' ? 'Choose “Save” to keep it in Photos.' : 'Saved to your downloads.', { icon: icons.check });
            },
            html: icons.download,
          },
        ),
      ),
    ),
  );

  // Swipe navigation
  let x0 = 0;
  media.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  media.addEventListener('pointerup', (e) => {
    const dx = e.clientX - x0;
    if (Math.abs(dx) < 50) return;
    const next = index + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= list.length) return;
    index = next;
    haptic(5);
    show(dx < 0 ? 1 : -1);
  });

  document.getElementById('overlays')!.append(overlay);
  pushOverlay(close);
  show();
  requestAnimationFrame(() => overlay.classList.add('in'));
}
