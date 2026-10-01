import { useEffect, useSyncExternalStore } from 'react';
import { useT, type MessageKey } from '../../i18n.ts';
import { Dialog } from './Dialog.tsx';
import { Kbd, type KeyName } from './Kbd.tsx';

/**
 * Kürzel-Übersicht (DESIGN.md §13.4): `?` außerhalb von Textfeldern öffnet sie auf Start und im Arbeitsbereich, die
 * Einstellungen haben einen Knopf dafür. Der Offen-Zustand ist ein kleiner, abonnierbarer Wert, damit beide Wege
 * denselben Dialog öffnen.
 */
let open = false;
const listeners = new Set<() => void>();

export function setShortcutsOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => open;

export function useShortcutsOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

/** `?` (ohne Strg/⌘/Alt, nicht in Textfeldern, kein anderer Dialog offen) öffnet die Übersicht. */
export function useShortcutsKey(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Eine Zeile: Beschriftung links, eine oder mehrere Tastenfolgen rechts (getrennt durch „/“). */
interface Row {
  label: MessageKey;
  combos: ReadonlyArray<readonly KeyName[]>;
}

const GROUPS: ReadonlyArray<{ title: MessageKey; rows: Row[] }> = [
  {
    title: 'shortcuts.group.general',
    rows: [
      { label: 'shortcuts.overview', combos: [['?']] },
      { label: 'shortcuts.newProject', combos: [['mod', 'N']] },
      { label: 'shortcuts.openProject', combos: [['mod', 'O']] },
      { label: 'shortcuts.models', combos: [['mod', 'M']] },
      { label: 'shortcuts.assetSearch', combos: [['mod', 'K']] },
      { label: 'shortcuts.regions', combos: [['F6']] },
    ],
  },
  {
    title: 'shortcuts.group.layout',
    rows: [
      { label: 'shortcuts.assets', combos: [['mod', '1']] },
      { label: 'shortcuts.director', combos: [['mod', '2']] },
      { label: 'shortcuts.stage', combos: [['mod', '3']] },
      { label: 'shortcuts.focus', combos: [['mod', '0']] },
    ],
  },
  {
    title: 'shortcuts.group.composer',
    rows: [
      { label: 'shortcuts.send', combos: [['mod', 'Enter']] },
      { label: 'shortcuts.newline', combos: [['Enter'], ['shift', 'Enter']] },
      { label: 'shortcuts.position', combos: [['alt', 'Enter']] },
      { label: 'shortcuts.chipRemove', combos: [['Backspace']] },
      { label: 'shortcuts.ptt', combos: [['mod', 'shift', 'Space']] },
    ],
  },
  {
    title: 'shortcuts.group.timeline',
    rows: [
      { label: 'shortcuts.marker', combos: [['Enter']] },
      { label: 'shortcuts.clipRef', combos: [['shift', 'Enter']] },
      { label: 'shortcuts.jumpMarker', combos: [['['], [']']] },
      { label: 'shortcuts.jumpSection', combos: [['alt', '['], ['alt', ']']] },
      { label: 'shortcuts.play', combos: [['Space']] },
      { label: 'shortcuts.shuttle', combos: [['J'], ['K'], ['L']] },
      { label: 'shortcuts.frame', combos: [['←'], ['→']] },
      { label: 'shortcuts.beat', combos: [['shift', '←'], ['shift', '→']] },
      { label: 'shortcuts.startEnd', combos: [['Home'], ['End']] },
      { label: 'shortcuts.beatGrid', combos: [['B']] },
      { label: 'shortcuts.zoom', combos: [['+'], ['−']] },
      { label: 'shortcuts.fit', combos: [['shift', 'Z']] },
      { label: 'shortcuts.track', combos: [['↑'], ['↓']] },
    ],
  },
  {
    title: 'shortcuts.group.markers',
    rows: [
      { label: 'shortcuts.markerFocus', combos: [['Tab']] },
      { label: 'shortcuts.markerJump', combos: [['Enter']] },
      { label: 'shortcuts.markerRemove', combos: [['Delete']] },
      { label: 'shortcuts.markerExit', combos: [['Escape']] },
    ],
  },
];

/** Linke Spalte: Allgemein, Layout, Composer; rechte Spalte: Timeline und Markerleiste. */
const COLUMNS = [GROUPS.slice(0, 3), GROUPS.slice(3)];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={t('shortcuts.title')} onClose={onClose} width={720} className="shortcuts-dialog">
      <p className="shortcuts-note">{t('shortcuts.note')}</p>
      {/* Fokus auf die Übersicht selbst (scrollbar per Pfeiltasten), nicht auf „Schließen“ */}
      <div className="shortcuts-columns" tabIndex={-1} data-autofocus>
        {COLUMNS.map((groups, c) => (
          <div key={c} className="shortcuts-column">
            {groups.map((group) => (
              <section key={group.title} className="shortcuts-group" aria-label={t(group.title)}>
                <h3 className="overline">{t(group.title)}</h3>
                <dl>
                  {group.rows.map((row) => (
                    <div key={row.label} className="shortcuts-row">
                      <dt>{t(row.label)}</dt>
                      <dd>
                        {row.combos.map((combo, i) => (
                          <span key={i} className="shortcuts-combo">
                            {i > 0 && (
                              <span className="shortcuts-or" aria-hidden="true">
                                /
                              </span>
                            )}
                            <Kbd keys={combo} />
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Wurzel-Baustein für App.tsx: hört auf `?` und zeigt die Übersicht, solange sie offen ist. */
export function Shortcuts() {
  useShortcutsKey();
  const isOpen = useShortcutsOpen();
  return isOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null;
}
