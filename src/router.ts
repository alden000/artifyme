// Tiny screen router with cinematic transitions (View Transitions API when
// available, a hand‑tuned CSS fallback otherwise). Android back is honoured.

export type ScreenName = 'home' | 'studio' | 'result' | 'gallery' | 'about';
export type Cleanup = void | (() => void);
export type Screen = (root: HTMLElement) => Cleanup;

const registry = new Map<ScreenName, () => Promise<Screen>>();
let current: { name: ScreenName; cleanup: Cleanup; el: HTMLElement } | null = null;
const stack: ScreenName[] = [];
let busy = false;

export function register(name: ScreenName, loader: () => Promise<Screen>) {
  registry.set(name, loader);
}

export const currentScreen = () => current?.name;

async function swap(name: ScreenName, dir: 'forward' | 'back') {
  const app = document.getElementById('app')!;
  const screen = await registry.get(name)!();
  const mount = () => {
    if (current) {
      if (typeof current.cleanup === 'function') current.cleanup();
      current.el.remove();
    }
    const el = document.createElement('section');
    el.className = `screen screen-${name}`;
    el.dataset.screen = name;
    app.append(el);
    const cleanup = screen(el);
    current = { name, cleanup, el };
    window.scrollTo(0, 0);
    return el;
  };

  document.documentElement.dataset.nav = dir;
  type VT = { finished: Promise<void>; updateCallbackDone: Promise<void> };
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => VT }).startViewTransition;
  if (vt && current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = vt.call(document, () => void mount());
    // Never let a stalled animation block navigation: the DOM swap is what matters.
    await t.updateCallbackDone.catch(() => {});
    await Promise.race([t.finished.catch(() => {}), new Promise((r) => setTimeout(r, 900))]);
  } else {
    const el = mount();
    el.classList.add('enter', `enter-${dir}`);
    el.addEventListener('animationend', () => el.classList.remove('enter', `enter-${dir}`), { once: true });
  }
}

export async function go(name: ScreenName, opts: { replace?: boolean } = {}) {
  if (busy) return;
  busy = true;
  try {
    if (opts.replace) {
      stack.pop();
      history.replaceState({ screen: name, depth: stack.length }, '');
    } else if (current) {
      history.pushState({ screen: name, depth: stack.length + 1 }, '');
    } else {
      history.replaceState({ screen: name, depth: 0 }, '');
    }
    stack.push(name);
    await swap(name, 'forward');
  } finally {
    busy = false;
  }
}

export function back(fallback: ScreenName = 'home') {
  if (stack.length > 1) history.back();
  else void go(fallback, { replace: true });
}

// Overlays (lightbox etc.) get their own history entry so Android back closes them.
const overlayClosers: (() => void)[] = [];
export function pushOverlay(close: () => void) {
  overlayClosers.push(close);
  history.pushState({ overlay: true }, '');
}

addEventListener('popstate', async () => {
  const closeOverlay = overlayClosers.pop();
  if (closeOverlay) return closeOverlay();
  if (stack.length <= 1) return;
  stack.pop();
  const target = stack[stack.length - 1];
  busy = true;
  try {
    await swap(target, 'back');
  } finally {
    busy = false;
  }
});
