import { h, pickFile } from '../ui/dom';
import { icons } from '../ui/icons';
import { back } from '../router';
import { listCreations, listeners, type Creation } from '../store/gallery';
import { openViewer } from './viewer';
import { ingest } from './home';

export default function gallery(root: HTMLElement) {
  const grid = h('div', { class: 'masonry' });
  const count = h('span', { class: 'muted' });
  const urls: string[] = [];

  const render = async () => {
    const items: Creation[] = await listCreations();
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    count.textContent = items.length ? `${items.length} piece${items.length === 1 ? '' : 's'}` : '';
    if (!items.length) {
      grid.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-frame' }, h('span', { html: icons.palette })),
          h('h3', null, 'Your walls are bare'),
          h('p', null, 'Every masterpiece you create is kept here — privately, on this device only.'),
          h('button', { class: 'ghost-btn', onclick: async () => ingest(await pickFile('image/*,video/*')) }, 'Create your first'),
        ),
      );
      return;
    }
    grid.replaceChildren(
      ...items.map((c, i) => {
        const u = URL.createObjectURL(c.thumb);
        urls.push(u);
        return h(
          'button',
          { class: 'tile', style: `--i:${i};--ar:${c.width}/${c.height}`, onclick: () => openViewer(c, items) },
          h('img', { src: u, alt: c.styleName, loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'tile-cap' }, c.styleName),
          c.kind === 'video' ? h('span', { class: 'badge-play', html: icons.play }) : null,
        );
      }),
    );
  };

  root.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(), html: icons.back }), h('div', { class: 'topbar-title' }, h('span', { class: 'eyebrow' }, 'Collection')), h('span', { class: 'icon-btn ghost' })),
    h('div', { class: 'page-head' }, h('h1', { class: 'display sm' }, 'Your ', h('em', null, 'private'), ' gallery'), count),
    grid,
  );
  void render();
  listeners.add(render);
  return () => {
    listeners.delete(render);
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
