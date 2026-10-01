import { useEffect } from 'react';
import { useT } from '../../i18n.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import { Icon } from './Icon.tsx';

/** Kurzmeldungen unten rechts + aria-live-Region für Screenreader-Ansagen. */
export function Toasts() {
  const t = useT();
  const toasts = useStudio((s) => s.toasts);
  const announcement = useStudio((s) => s.announcement);
  const actions = useActions();

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) => setTimeout(() => actions.dismissToast(toast.id), toast.kind === 'error' ? 8000 : 4000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, actions]);

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : undefined}>
            <Icon name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'dot'} />
            <span>{toast.text}</span>
            <button type="button" className="ibtn" onClick={() => actions.dismissToast(toast.id)} aria-label={t('common.close')}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="sr-only" aria-live="polite" data-testid="announcer">
        {announcement}
      </div>
    </>
  );
}
