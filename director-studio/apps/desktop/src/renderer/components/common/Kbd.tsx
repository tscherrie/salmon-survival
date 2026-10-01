import { t, useT, type MessageKey } from '../../i18n.ts';

/**
 * Tastenkürzel-Darstellung je Plattform (DESIGN.md §4.4). Keine der beiden UI-Schriften enthält ⌘ ⌥ ⇧ ↵ ⌫; unter
 * macOS stehen die Symbole deshalb in `--font-keys` (Systemschrift), unter Windows/Linux als Text aus i18n.
 * Keycaps nur in Tooltips, Menüs und im Kürzel-Überblick – nie in Knöpfen.
 */
export type KeyName = 'mod' | 'alt' | 'shift' | 'Enter' | 'Backspace' | 'Delete' | 'Escape' | 'Space' | 'Home' | 'End' | (string & {});

interface UserAgentDataLike {
  platform?: string;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  const platform = uaData?.platform || navigator.platform || '';
  return /mac|iphone|ipad/i.test(platform);
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  alt: '⌥',
  shift: '⇧',
  Enter: '↵',
  Backspace: '⌫',
};

const TEXT_KEYS: Record<string, MessageKey> = {
  mod: 'kbd.ctrl',
  alt: 'kbd.alt',
  shift: 'kbd.shift',
  Enter: 'kbd.enter',
  Backspace: 'kbd.backspace',
  Delete: 'kbd.delete',
  Escape: 'kbd.escape',
  Space: 'kbd.space',
  Home: 'kbd.home',
  End: 'kbd.end',
};

/** Beschriftung einer einzelnen Taste; `symbol` = macOS-Symbol (braucht `--font-keys`). */
export function keyLabel(key: KeyName, mac = isMacPlatform()): { text: string; symbol: boolean } {
  if (mac && MAC_SYMBOLS[key]) return { text: MAC_SYMBOLS[key]!, symbol: true };
  const textKey = TEXT_KEYS[key];
  if (textKey) return { text: t(textKey), symbol: false };
  return { text: key.length === 1 ? key.toUpperCase() : key, symbol: false };
}

/** Kürzel als Text für `title`, Ansagen und Tooltips ohne Keycaps: „⌘↵“ bzw. „Strg+Enter“. */
export function formatShortcut(keys: readonly KeyName[], mac = isMacPlatform()): string {
  const labels = keys.map((k) => keyLabel(k, mac).text);
  return mac ? labels.join('') : labels.join('+');
}

const ARIA_NAMES: Record<string, string> = {
  alt: 'Alt',
  shift: 'Shift',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  Space: 'Space',
  Home: 'Home',
  End: 'End',
};

/** Wert für `aria-keyshortcuts` (standardisierte Tastennamen, z. B. „Meta+1“ bzw. „Control+1“). */
export function ariaKeyShortcuts(keys: readonly KeyName[], mac = isMacPlatform()): string {
  return keys.map((k) => (k === 'mod' ? (mac ? 'Meta' : 'Control') : (ARIA_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)))).join('+');
}

/** Keycaps, z. B. `<Kbd keys={['mod', 'Enter']} />`. */
export function Kbd({ keys, className }: { keys: readonly KeyName[]; className?: string }) {
  useT(); // bei Sprachwechsel neu beschriften
  const mac = isMacPlatform();
  return (
    <span className={`kbd-group${className ? ` ${className}` : ''}`}>
      <span className="sr-only">{formatShortcut(keys, mac)}</span>
      {keys.map((key, i) => {
        const label = keyLabel(key, mac);
        return (
          <kbd key={`${key}-${i}`} className={`kbd${label.symbol ? ' is-symbol' : ''}`} aria-hidden="true">
            {label.text}
          </kbd>
        );
      })}
    </span>
  );
}
