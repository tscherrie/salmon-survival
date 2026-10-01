import { useEffect, useRef } from 'react';
import { useT } from '../../i18n.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import type { Toast } from '../../state/types.ts';
import { Icon } from './Icon.tsx';

/** Standzeit für Hinweis und Erfolg (DESIGN.md §7.11). Fehler bleiben, bis sie geschlossen werden. */
export const TOAST_MS = 4000;
/** Ein Toast: Icon in der Bedeutungsfarbe, Text, optional „Rückgängig“; die Standzeit pausiert, solange der Zeiger darauf liegt. */
function ToastItem({ toast }: { toast: Toast }) {
  const t = useT();
  const actions = useActions();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(TOAST_MS);
  const startedAt = useRef(0);
  const sticky = toast.kind === 'error';

  const start = () => {
    if (sticky) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => actions.dismissToast(toast.id), remaining.current);
  };
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(600, remaining.current - (Date.now() - startedAt.current));
  };
  useEffect(() => {
    start();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Der Timer gehört zu genau diesem Toast; start/pause lesen nur Refs
  }, [toast.id]);

  return (
    <div className={`toast toast-${toast.kind}`} role={sticky ? 'alert' : undefined} onMouseEnter={pause} onMouseLeave={start}>
      <Icon name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'info'} size={14} />
      <span className="toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            toast.action!.run();
            actions.dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="ibtn sm" onClick={() => actions.dismissToast(toast.id)} aria-label={t('common.close')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/**
 * Kurzmeldungen (DESIGN.md §7.11): im Arbeitsbereich unten links über der Bühne, damit Monitor und Senden frei bleiben;
 * höchstens drei (begrenzt der Store), gestapelt. Dazu die aria-live-Region für Screenreader-Ansagen.
 */
export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  const announcement = useStudio((s) => s.announcement);
  const inWorkspace = useStudio((s) => s.screen !== 'start');
  return (
    <>
      <div className={`toasts${inWorkspace ? ' is-workspace' : ''}`} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>
      <div className="sr-only" aria-live="polite" data-testid="announcer">
        {announcement}
      </div>
    </>
  );
}
