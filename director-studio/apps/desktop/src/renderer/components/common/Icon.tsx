import type { AssetKind, Modality, TrackKind } from '@studio/core';

/** Schlichte Strich-Icons (24er Raster, `currentColor`). */
const PATHS = {
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M7 7h10v10H7z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  send: 'M4 12l16-8-6 16-3-7z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  star: 'M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z',
  warning: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 5v5h5',
  export: 'M12 15V3M7 8l5-5 5 5M5 14v6h14v-6',
  folder: 'M3 6h6l2 2h10v11H3z',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 8.2 4 8l-1 3 2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9a1.5 1.5 0 1 1 0 .1',
  audio: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0',
  text: 'M5 6h14M12 6v13M9 19h6',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  data: 'M5 6c0-1.5 3-3 7-3s7 1.5 7 3-3 3-7 3-7-1.5-7-3zM5 6v12c0 1.5 3 3 7 3s7-1.5 7-3V6M5 12c0 1.5 3 3 7 3s7-1.5 7-3',
  font: 'M5 19l6-14h2l6 14M8 14h8',
  document: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  web: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  slides: 'M3 5h18v12H3zM8 21h8M12 17v4',
  overlay: 'M4 4h12v12H4zM8 8h12v12H8z',
  muted: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6',
  director: 'M4 18l4-12 4 8 4-8 4 12',
  wand: 'M5 19L15 9M14 4v3M19 9h-3M17 5l-2 2',
  lipsync: 'M4 12c3-4 13-4 16 0-3 4-13 4-16 0zM8 12h8',
  voice: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM19 10a7 7 0 0 1-14 0',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14',
  tools: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z',
  check: 'M5 12l4 4 10-10',
  dot: 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  cursor: 'M5 3l14 8-6 2-2 6z',
  region: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4',
  marker: 'M6 3v18M6 4h11l-3 4 3 4H6',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  queue: 'M4 6h16M4 12h10M4 18h7',
  budget: 'M12 3v18M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.5 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  monitor: 'M3 4h18v12H3zM8 20h8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  const filled = name === 'play' || name === 'stop' || name === 'star' || name === 'dot';
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

export const ASSET_KIND_ICONS: Record<AssetKind, IconName> = {
  image: 'image',
  video: 'film',
  audio: 'audio',
  text: 'text',
  code: 'code',
  data: 'data',
  font: 'font',
  document: 'document',
  web: 'web',
};

export const TRACK_KIND_ICONS: Record<TrackKind, IconName> = {
  video: 'film',
  overlay: 'overlay',
  text: 'text',
  audio: 'audio',
};

export const MODALITY_ICONS: Record<Modality, IconName> = {
  director: 'director',
  text: 'text',
  image: 'image',
  video: 'film',
  lipsync: 'lipsync',
  voice: 'voice',
  music: 'music',
  sound: 'sound',
  tools: 'tools',
};
