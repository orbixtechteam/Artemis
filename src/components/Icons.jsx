import React from 'react';

// Stroke icons on a 24x24 grid (Lucide-style, drawn here). Usage: <Icon name="folder" size={16} />
const P = (d) => <path d={d} />;
const SHAPES = {
  plus: P('M12 5v14M5 12h14'),
  x: P('M6 6l12 12M18 6L6 18'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  folder: P('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  folderOpen: P('M4 19h13.5a2 2 0 0 0 1.9-1.4L21 11H8.5a2 2 0 0 0-1.9 1.4L4 19zm0 0a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5l2 2H18a1 1 0 0 1 1 1v3'),
  folderPlus: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v6M9 14h6" /></>,
  folders: <><path d="M4 8V6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v7" /><path d="M2 11a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  pdf: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 17v-5h1.5a1.5 1.5 0 0 1 0 3H9" /></>,
  sheet: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M10 9v12" /></>,
  pin: <><path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" /></>,
  download: <><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 21h16" /></>,
  expand: <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></>,
  code: <><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /></>,
  artifact: <><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
  video: <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15l-5-5L5 21" /></>,
  terminal: <><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  pencil: P('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  trash: P('M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'),
  arrowRight: P('M5 12h14M13 6l6 6-6 6'),
  arrowUp: P('M12 19V5M5 12l7-7 7 7'),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />,
  bell: P('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4'),
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  bulb: P('M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'),
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  users: <><circle cx="9" cy="9" r="3" /><circle cx="16.5" cy="10" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 19a4.5 4.5 0 0 1 7-3.6" /></>,
  pause: P('M9 6v12M15 6v12'),
  at: <><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  sliders: <><path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  paperclip: P('M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8'),
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  external: P('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  plug: P('M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4'),
  spinner: P('M21 12a9 9 0 1 1-6.2-8.55'),
  warning: P('M12 3l10 18H2zM12 10v5M12 18h.01'),
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  refresh: P('M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5'),
  home: P('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'),
  chat: P('M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z'),
  chevronRight: P('M9 6l6 6-6 6'),
  chevronDown: P('M6 9l6 6 6-6'),
  chevronUpDown: P('M8 9.5l4-4 4 4M8 14.5l4 4 4-4'),
  chevronLeft: P('M15 6l-6 6 6 6'),
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  speaker: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  dots: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
  compact: P('M4 7h16M7 12h10M10 17h4'),
  layers: P('M12 3l9 5-9 5-9-5zM3 13l9 5 9-5'),
  wrench: P('M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4z'),
  send: P('M4 12l16-8-6 16-3-7z'),
  edit: P('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  calc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" /></>,
  move: P('M5 12h14M13 6l6 6-6 6'),
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  upload: P('M12 16V4M6 10l6-6 6 6M4 20h16'),
  chart: P('M4 20V10M10 20V4M16 20v-8M22 20H2'),
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  play: P('M7 5l12 7-12 7z'),
  bolt: P('M13 3L5 14h6l-1 7 8-11h-6z'),
  more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
  shield: P('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'),
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" /></>,
  fingerprint: <><path d="M6 9a6.5 6.5 0 0 1 12 0M4.5 13a8 8 0 0 1 .4-3M19.5 13c0 3-.5 5-1.5 7M8 20c.8-1.6 1-3.5 1-5a3 3 0 0 1 6 0c0 2-.3 4-1 6M12 14.5c0 2-.3 3.8-1 5.5" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  sparkle: P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'),
  ghost: P('M5 21V11a7 7 0 0 1 14 0v10l-3-2-2 2-2-2-2 2-2-2zM9.5 11h.01M14.5 11h.01'),
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  rows: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" /></>,
  graph: <><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="8" r="2.2" /><circle cx="9" cy="18" r="2.2" /><path d="M7.9 7l8.2.8M7.2 8l1.4 8M16.9 9.9l-6.4 6.7" /></>,
  link: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1')
};

export function Icon({ name, size = 16, className = '', title, ...rest }) {
  const shape = SHAPES[name] || SHAPES.wrench;
  return (
    <svg
      className={`icon ${name === 'spinner' ? 'spin' : ''} ${className}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...rest}
    >
      {title && <title>{title}</title>}
      {shape}
    </svg>
  );
}

export const FILE_ICON = { sheet: 'sheet', docx: 'doc', pdf: 'pdf', text: 'file', image: 'image', error: 'warning' };
