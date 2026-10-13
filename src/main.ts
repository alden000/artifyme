import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/manrope';
import './css/app.css';

import { h, reducedMotion, sleep, splitLetters } from './ui/dom';
import { initAurora } from './ui/fx';
import { go, register } from './router';
import { initPwa } from './pwa';
import { getTf, loadModel, warmUp } from './ai/engine';

register('home', () => import('./screens/home').then((m) => m.default));
register('studio', () => import('./screens/studio').then((m) => m.default));
register('result', () => import('./screens/result').then((m) => m.default));
register('gallery', () => import('./screens/gallery').then((m) => m.default));
register('about', () => import('./screens/about').then((m) => m.default));

async function splash() {
  const seen = sessionStorage.getItem('artifyme.splash');
  if (seen || reducedMotion()) return;
  sessionStorage.setItem('artifyme.splash', '1');
  const el = h(
    'div',
    { class: 'splash' },
    h('div', {
      class: 'splash-mark',
      html: `<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1cf"/><stop offset=".4" stop-color="#e9c47e"/><stop offset=".75" stop-color="#b8863b"/><stop offset="1" stop-color="#f6dca0"/></linearGradient></defs>
      <path class="s1" pathLength="1" d="M120 392 C170 300 214 190 258 112 C270 92 286 96 292 118 C318 214 344 300 392 392" fill="none" stroke="url(#sg)" stroke-width="30" stroke-linecap="round"/>
      <path class="s2" pathLength="1" d="M168 300 C232 268 300 262 368 284" fill="none" stroke="url(#sg)" stroke-width="24" stroke-linecap="round"/>
      <path class="s3" d="M392 108 l10 26 26 10 -26 10 -10 26 -10 -26 -26 -10 26 -10z" fill="#fff4da"/></svg>`,
    }),
    h('h1', { class: 'splash-word' }, ...splitLetters('Artify'), h('em', null, ...splitLetters('Me'))),
    h('p', { class: 'splash-tag' }, 'Become the masterpiece'),
  );
  document.body.append(el);
  await sleep(2300);
  el.classList.add('out');
  setTimeout(() => el.remove(), 900);
  await sleep(350);
}

async function boot() {
  initAurora(document.getElementById('aurora') as HTMLCanvasElement);
  initPwa();
  const intro = splash();
  // Start the AI engine & fast painter quietly while the intro plays.
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200));
  idle(() => {
    getTf()
      .then(() => loadModel('fast'))
      .then(() => warmUp('fast'))
      .catch((e) => console.warn('AI warm‑up deferred:', e));
  });
  await intro;
  await go('home');
  document.body.classList.add('ready');
}

void boot();
