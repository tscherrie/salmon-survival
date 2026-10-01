import { useEffect, useId, useRef, useState } from 'react';
import { isComposerEmpty, type Ref } from '@studio/core';
import { useT } from '../../i18n.ts';
import { formatElapsed } from '../../lib/hooks.ts';
import { displayText } from '../../lib/labels.ts';
import { useLayout } from '../../lib/layout.ts';
import { useActions, useLabelContext, useStudio, useStudioStore, useViewDocument } from '../../state/context.tsx';
import { selectUserMarkers } from '../../state/selectors.ts';
import { Icon, type IconName } from '../common/Icon.tsx';
import { formatShortcut } from '../common/Kbd.tsx';
import { Popover } from '../common/Popover.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { ModelPicker } from '../picker/ModelPicker.tsx';
import { ComposerEditor } from './ComposerEditor.tsx';
import { usePushToTalk } from './usePushToTalk.ts';

/**
 * Composer (DESIGN.md §7.7): Text direkt auf `--panel`, verschmolzen mit dem Director darüber (das „L“ um die
 * Monitor-Ecke). Darunter die Werkzeugleiste: links Einfügen und der Positionsknopf der Kategorie, rechts die
 * Modell-Zusammenfassung, Mikrofon und Senden/Einreihen. Stopp steht nur im Director-Kopf.
 */

interface PositionAction {
  kind: 'marker' | 'slide' | 'page';
  icon: IconName;
  /** Anzahl der gesetzten Marker (nur Video/Audio). */
  count: number;
  run: () => void;
}

/** Positionsknopf bzw. Alt+Enter je Kategorie: Marker am Abspielkopf, aktuelle Folie, aktuelle Seite (Grafik: keiner). */
function usePositionAction(): PositionAction | null {
  const actions = useActions();
  const store = useStudioStore();
  const doc = useViewDocument();
  const markers = useStudio((s) => selectUserMarkers(s).filter((m) => !m.pending).length);
  if (!doc) return null;
  switch (doc.kind) {
    case 'timeline':
      return { kind: 'marker', icon: 'marker', count: markers, run: () => actions.addMarkerAt(store.getState().playhead) };
    case 'deck':
      return {
        kind: 'slide',
        icon: 'slides',
        count: 0,
        run: () => {
          const id = store.getState().selectedSlideId;
          const slide = doc.slides.find((s) => s.id === id) ?? doc.slides[0];
          if (slide) actions.insertRef({ kind: 'slide', slideId: slide.id });
        },
      };
    case 'site':
      return {
        kind: 'page',
        icon: 'web',
        count: 0,
        run: () => {
          const id = store.getState().selectedPageId;
          const page = doc.pages.find((p) => p.id === id) ?? doc.pages[0];
          if (!page) return;
          // Dieselbe Seiten-Referenz wie ein Klick auf die Seitenkarte (gleicher Schlüssel, kein Duplikat)
          const ref: Ref = { kind: 'element', doc: 'site', page: page.path, selector: 'body', ...(page.sourceFile ? { source: { file: page.sourceFile, line: 1 } } : {}) };
          actions.insertRef(ref);
        },
      };
    default:
      return null;
  }
}

/** Aufnahmeanzeige: ersetzt während der Aufnahme bzw. Transkription den linken Teil der Werkzeugleiste. */
function RecordingIndicator() {
  const t = useT();
  const voice = useStudio((s) => s.voice);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!voice.recording) return;
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, [voice.recording]);
  if (voice.transcribing) {
    return (
      <div className="composer-rec is-transcribing" role="status">
        <span className="spin" aria-hidden="true" />
        <span>{t('voice.transcribing')}</span>
      </div>
    );
  }
  if (!voice.recording) return null;
  const clicks = voice.clicks.length;
  return (
    <div className="composer-rec" role="status">
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-label">{t('voice.recording')}</span>
      <span className="rec-time">{formatElapsed(now - voice.startedAt)}</span>
      <span className="level-meter" role="meter" aria-label={t('voice.level')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voice.level * 100)}>
        <span style={{ width: `${Math.round(voice.level * 100)}%` }} />
      </span>
      {clicks > 0 && <span className="rec-clicks">{clicks === 1 ? t('voice.clicksOne') : t('voice.clicks', { count: clicks })}</span>}
    </div>
  );
}

/** „+“: Asset einfügen (fokussiert die Asset-Suche) oder eine Datei verknüpfen und als Chip einfügen. */
function AddMenu() {
  const t = useT();
  const actions = useActions();
  const layout = useLayout();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const focusAssetSearch = () => {
    setOpen(false);
    if (layout?.collapsed.assets) layout.setCollapsed('assets', false);
    // Nach dem Aufklappen steht die Leiste erst im übernächsten Frame
    const focus = () => document.querySelector<HTMLInputElement>('.assets input[type="search"]')?.focus();
    requestAnimationFrame(() => requestAnimationFrame(focus));
  };

  const insertFile = () => {
    setOpen(false);
    void actions.importFiles('link', { insert: true });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top"
      align="start"
      label={t('composer.add')}
      className="composer-add-menu"
      anchor={
        <Tooltip label={t('composer.add')} disabled={open}>
          <button type="button" className="ibtn" aria-label={t('composer.add')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="plus" size={16} />
          </button>
        </Tooltip>
      }
    >
      <ul className="menu" role="menu" ref={menuRef} aria-label={t('composer.add')} onKeyDown={onMenuKeyDown}>
        <li role="none">
          <button type="button" role="menuitem" onClick={focusAssetSearch}>
            <Icon name="image" size={14} />
            {t('composer.addAsset')}
          </button>
        </li>
        <li role="none">
          <button type="button" role="menuitem" onClick={insertFile}>
            <Icon name="link" size={14} />
            {t('composer.addFile')}
          </button>
        </li>
      </ul>
    </Popover>
  );
}

/** Positionsknopf: Marker (mit Anzahl), Folie oder Seite. */
function PositionButton({ action }: { action: PositionAction }) {
  const t = useT();
  const altEnter = formatShortcut(['alt', 'Enter']);
  const tip =
    action.kind === 'marker'
      ? t('composer.markerTip', { enter: formatShortcut(['Enter']), altEnter })
      : t(action.kind === 'slide' ? 'composer.slideTip' : 'composer.pageTip', { altEnter });
  return (
    <Tooltip label={tip}>
      <button type="button" className="btn ghost composer-position" onClick={action.run}>
        <Icon name={action.icon} size={14} />
        {t(action.kind === 'marker' ? 'composer.marker' : action.kind === 'slide' ? 'composer.slide' : 'composer.page')}
        {action.kind === 'marker' && action.count > 0 && (
          <>
            <span className="composer-position-count" aria-hidden="true">
              {action.count}
            </span>
            <span className="sr-only">, {t('composer.markerCount', { count: action.count })}</span>
          </>
        )}
      </button>
    </Tooltip>
  );
}

/** Warteschlange: bis zu drei Zeilen über dem Text (weitere scrollen). */
function QueueRows() {
  const t = useT();
  const actions = useActions();
  const queue = useStudio((s) => s.queue);
  const running = useStudio((s) => s.runState === 'running');
  const ctx = useLabelContext();
  if (queue.length === 0) return null;
  return (
    <div className="composer-queue">
      <div className="composer-queue-head">{t('composer.queued', { count: queue.length })}</div>
      <ul className="composer-queue-list" aria-label={t('composer.queueLabel')}>
        {queue.map((message, i) => {
          const text = displayText(message.segments, ctx);
          return (
            <li key={i} className="queue-row">
              <Icon name="queue" size={14} className="queue-icon" />
              <span className="queue-text" title={text}>
                {text}
              </span>
              <button type="button" className="btn sm ghost" onClick={() => void actions.sendQueued(i)} disabled={running}>
                {t('composer.sendNow')}
              </button>
              <Tooltip label={t('composer.removeQueued')}>
                <button type="button" className="ibtn sm" onClick={() => actions.removeQueued(i)} aria-label={t('composer.removeQueued')}>
                  <Icon name="close" size={12} />
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Composer() {
  const t = useT();
  const actions = useActions();
  const segments = useStudio((s) => s.composer);
  const running = useStudio((s) => s.runState === 'running');
  // Offene Entscheidung (Rückfrage, Genehmigung, Checkpoint zur Freigabe): Dann ist das Dock der Primärknopf (§6)
  const decisionOpen = useStudio((s) => s.question !== null || s.approvals.length > 0 || s.checkpoints.some((c) => c.status === 'proposed'));
  const voiceActive = useStudio((s) => s.voice.recording || s.voice.transcribing);
  const recording = useStudio((s) => s.voice.recording);
  const category = useStudio((s) => s.manifest?.category ?? null);
  const position = usePositionAction();
  const { start, stop } = usePushToTalk();
  const hintId = useId();
  const empty = isComposerEmpty(segments);

  // Senden-Zustände (§7.7.1): Tungsten nur, wenn Senden wirklich die nächste Aktion ist
  const queueing = !empty && running;
  const primary = !empty && !running && !decisionOpen;
  const sendLabel = queueing ? t('composer.queue') : t('composer.send');
  const sendTip = queueing ? `${t('composer.queue')} · ${t('composer.queueTip')}` : t('composer.send');

  const placeholder = category === 'slides' ? t('composer.placeholderSlides') : category === 'web' ? t('composer.placeholderWeb') : t('composer.placeholder');

  const send = () => void actions.send();

  return (
    <section className="composer" aria-label={t('composer.label')}>
      <QueueRows />
      <ComposerEditor onSubmit={send} onPositionRef={position?.run} placeholder={placeholder} describedBy={hintId} />
      <span id={hintId} className="sr-only">
        {t('composer.keysHint', { send: formatShortcut(['mod', 'Enter']), position: formatShortcut(['alt', 'Enter']), talk: formatShortcut(['mod', 'shift', 'Space']) })}
      </span>
      <div className="composer-bar">
        <div className="composer-bar-start">
          {voiceActive ? (
            <RecordingIndicator />
          ) : (
            <>
              <AddMenu />
              {position && <PositionButton action={position} />}
            </>
          )}
        </div>
        <div className="composer-bar-end">
          <ModelPicker />
          <Tooltip label={t('voice.hold')} keys={['mod', 'shift', 'Space']}>
            <button
              type="button"
              className={`ibtn composer-mic${recording ? ' is-recording' : ''}`}
              aria-label={t('voice.hold')}
              aria-pressed={recording}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                void start();
              }}
              onPointerUp={() => void stop()}
              onPointerCancel={() => void stop()}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  void start();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  void stop();
                }
              }}
            >
              <Icon name="mic" size={16} />
            </button>
          </Tooltip>
          <Tooltip label={sendTip} keys={['mod', 'Enter']}>
            <button type="button" className={`btn composer-send${primary ? ' primary' : ''}`} onClick={send} disabled={empty}>
              {sendLabel}
            </button>
          </Tooltip>
        </div>
      </div>
    </section>
  );
}
