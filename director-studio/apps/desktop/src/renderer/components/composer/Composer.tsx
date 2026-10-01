import { useEffect, useState } from 'react';
import { composerToDisplayText, isComposerEmpty } from '@studio/core';
import { useT } from '../../i18n.ts';
import { formatElapsed } from '../../lib/hooks.ts';
import { useActions, useLabelContext, useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { Popover } from '../common/Popover.tsx';
import { ModelPickerBar } from '../picker/ModelPickerBar.tsx';
import { ComposerEditor } from './ComposerEditor.tsx';
import { usePushToTalk } from './usePushToTalk.ts';

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
      <div className="voice-indicator is-transcribing" role="status">
        <span className="spin" aria-hidden="true" />
        {t('voice.transcribing')}
      </div>
    );
  }
  if (!voice.recording) return null;
  return (
    <div className="voice-indicator" role="status">
      <span className="rec-dot" aria-hidden="true" />
      <span>{t('voice.recording')}</span>
      <span className="voice-time">{formatElapsed(now - voice.startedAt)}</span>
      <span className="level-meter" role="meter" aria-label={t('voice.level')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voice.level * 100)}>
        <span style={{ width: `${Math.round(voice.level * 100)}%` }} />
      </span>
      {voice.clicks.length > 0 && <span className="voice-clicks">{t('voice.clicks', { count: voice.clicks.length })}</span>}
    </div>
  );
}

/**
 * Steckplatz der Modellwahl in der Composer-Werkzeugleiste (DESIGN.md §7.8). Übergangsweise öffnet er die
 * bisherige Picker-Leiste als Popover; die Modell-Zusammenfassung mit zweistufigem Panel ersetzt ihn.
 */
function ModelsSlot() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="composer-models">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top"
        align="end"
        label={t('picker.label')}
        className="models-popover"
        anchor={
          <button type="button" className="btn ghost" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="director" size={14} />
            {t('picker.models')}
            <Icon name="chevronDown" size={12} />
          </button>
        }
      >
        <ModelPickerBar />
      </Popover>
    </div>
  );
}

/** Composer: Push-to-Talk, Rich-Text mit Chips, Senden/Stopp und Warteschlange. */
export function Composer() {
  const t = useT();
  const actions = useActions();
  const segments = useStudio((s) => s.composer);
  const runState = useStudio((s) => s.runState);
  const queue = useStudio((s) => s.queue);
  const recording = useStudio((s) => s.voice.recording);
  const ctx = useLabelContext();
  const { start, stop } = usePushToTalk();
  const empty = isComposerEmpty(segments);
  const running = runState === 'running';

  const send = () => void actions.send();

  return (
    <section className="composer" aria-label={t('composer.label')}>
      <div className="composer-row">
        <button
          type="button"
          className={`mic-button${recording ? ' is-recording' : ''}`}
          aria-label={t('voice.hold')}
          aria-pressed={recording}
          title={t('voice.hold')}
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
          <Icon name="mic" size={18} />
        </button>
        <ComposerEditor onSubmit={send} />
        <div className="composer-actions">
          <ModelsSlot />
          {running && (
            <button type="button" className="btn danger" onClick={() => void actions.interrupt()}>
              <Icon name="stop" size={14} /> {t('composer.stop')}
            </button>
          )}
          <button type="button" className="btn primary" onClick={send} disabled={empty}>
            <Icon name="send" size={14} /> {running ? t('composer.queue') : t('composer.send')}
          </button>
        </div>
      </div>
      <div className="composer-meta">
        <RecordingIndicator />
        {queue.length > 0 && (
          <div className="composer-queue">
            <span>{t('composer.queued', { count: queue.length })}</span>
            {queue.map((message, i) => (
              <span key={i} className="queue-item">
                <span className="queue-text">{composerToDisplayText(message.segments, ctx)}</span>
                <button type="button" className="btn sm" onClick={() => void actions.sendQueued(i)} disabled={running}>
                  {t('composer.sendNow')}
                </button>
                <button type="button" className="ibtn sm" onClick={() => actions.removeQueued(i)} aria-label={t('common.remove')}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <span id="composer-hint" className="hint composer-hint">
          {t('composer.hint')}
        </span>
      </div>
    </section>
  );
}
