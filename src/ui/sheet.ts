import { h } from './dom';
import { pushOverlay } from '../router';

/** Modal bottom sheet. Returns a close() function. Android back closes it. */
export function openSheet(content: HTMLElement, opts: { onClose?: () => void; dismissable?: boolean } = {}) {
  const host = document.getElementById('overlays')!;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 450);
    opts.onClose?.();
  };
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => opts.dismissable !== false && history.back() });
  const panel = h('div', { class: 'sheet-panel', role: 'dialog' }, h('span', { class: 'sheet-grip', 'aria-hidden': 'true' }), content);
  const el = h('div', { class: 'sheet' }, backdrop, panel);
  host.append(el);
  pushOverlay(close);
  requestAnimationFrame(() => el.classList.add('in'));
  return () => {
    if (!closed) history.back();
  };
}
