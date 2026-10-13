// Thin‑line icon set (24px grid, 1.6 stroke) drawn for ArtifyMe.
const i = (body: string, extra = '') =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  back: i('<path d="M15 5l-7 7 7 7"/>'),
  close: i('<path d="M6 6l12 12M18 6L6 18"/>'),
  photo: i('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  video: i('<rect x="2.5" y="5" width="14" height="14" rx="3"/><path d="M16.5 10l5-3v10l-5-3"/>'),
  camera: i('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  sparkle: i('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  gallery: i('<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/>'),
  info: i('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
  download: i('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  share: i('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6"/>'),
  sliders: i('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  lock: i('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  trash: i('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>'),
  refresh: i('<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>'),
  palette: i('<path d="M12 3a9 9 0 100 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 004-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>'),
  plus: i('<path d="M12 5v14M5 12h14"/>'),
  sound: i('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>'),
  mute: i('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  compare: i('<path d="M12 3v18"/><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2"/>'),
  install: i('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M12 8v7M9 12l3 3 3-3"/>'),
  check: i('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cube: i('<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>'),
  brush: i('<path d="M20 4c-3 1-8 6-10 9l2 2c3-2 8-7 9-10z"/><path d="M10 13c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2.5 2.5 1 1 2.5 1.5 4 1.5 2.5 0 4-2 4-4.5"/>'),
  play: i('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  wand: i('<path d="M4 20L16 8M14 6l4 4"/><path d="M18 3v3M16.5 4.5h3M20 13v2M19 14h2M9 3v2M8 4h2"/>'),
};

export type IconName = keyof typeof icons;
