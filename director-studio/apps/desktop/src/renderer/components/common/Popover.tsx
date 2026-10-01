import { useEffect, useRef, type ReactNode } from 'react';
import { useClickOutside } from '../../lib/hooks.ts';
import { useActions } from '../../state/context.tsx';

/**
 * Aufklappbares Panel an einem Auslöser. Schließt per Klick außerhalb und Escape;
 * gibt den Fokus an den Auslöser zurück.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  placement = 'bottom',
  align = 'start',
  className,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchor: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
  label?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const actions = useActions();
  useClickOutside([wrapRef], onClose, open);

  useEffect(() => {
    if (!open) return;
    actions.pushOverlay();
    return () => actions.popOverlay();
  }, [open, actions]);

  return (
    <div
      ref={wrapRef}
      className="popover-wrap"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          onClose();
          wrapRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
        }
      }}
    >
      {anchor}
      {open && (
        <div className={`popover popover-${placement} popover-${align} ${className ?? ''}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
