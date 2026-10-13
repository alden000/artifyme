import { h } from './dom';
import { haptic } from './fx';

export function slider(opts: { label: string; value: number; min?: number; max?: number; step?: number; format?: (v: number) => string; onInput: (v: number) => void }) {
  const { min = 0, max = 1, step = 0.01, format = (v) => `${Math.round(v * 100)}%` } = opts;
  const out = h('output', null, format(opts.value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(opts.value), 'aria-label': opts.label });
  const paint = () => {
    const p = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--p', `${p}%`);
  };
  let lastTick = -1;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    paint();
    const tick = Math.round(((v - min) / (max - min)) * 10);
    if (tick !== lastTick) {
      lastTick = tick;
      haptic(3);
    }
    opts.onInput(v);
  });
  paint();
  return h('label', { class: 'ctl ctl-slider' }, h('span', { class: 'ctl-head' }, h('span', null, opts.label), out), input);
}

export function toggle(opts: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: opts.value });
  input.addEventListener('change', () => {
    haptic(6);
    opts.onChange(input.checked);
  });
  return h('label', { class: 'ctl ctl-toggle' }, h('span', { class: 'ctl-text' }, h('span', null, opts.label), opts.hint ? h('small', null, opts.hint) : null), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

export function segmented<T extends string | number>(opts: { label: string; options: { value: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void }) {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': opts.label });
  const thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true' });
  group.append(thumb);
  const buttons = opts.options.map((o, i) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'seg-opt',
        'aria-checked': String(o.value === opts.value),
        onclick: () => select(i),
      },
      h('b', null, o.label),
      o.hint ? h('small', null, o.hint) : null,
    ),
  );
  group.append(...buttons);
  const place = (i: number) => {
    group.style.setProperty('--n', String(opts.options.length));
    group.style.setProperty('--i', String(i));
  };
  const select = (i: number) => {
    buttons.forEach((b, j) => b.setAttribute('aria-checked', String(i === j)));
    place(i);
    haptic(6);
    opts.onChange(opts.options[i].value);
  };
  place(Math.max(0, opts.options.findIndex((o) => o.value === opts.value)));
  return h('div', { class: 'ctl ctl-seg' }, h('span', { class: 'ctl-head' }, h('span', null, opts.label)), group);
}
