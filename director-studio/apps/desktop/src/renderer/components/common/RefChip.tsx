import type { Ref } from '@studio/core';
import { refChipParts, refChipTitle, type ChipLabelContext } from '../../lib/labels.ts';
import { refKey } from '../../lib/refNumbers.ts';
import { useActions, useAssetUrl, useStudio } from '../../state/context.tsx';
import { Icon } from './Icon.tsx';

/**
 * Inhalt eines Chips in React: `[Nummer] [Icon oder Thumb] Label`, dieselbe Anatomie wie `editorDom.createChip`
 * (DESIGN.md §7.7.2). Zeit-Chips zeigen den Timecode in Mono, die Frames gedämpft.
 */
export function ChipBody({ value, ctx, n }: { value: Ref; ctx: ChipLabelContext; n?: number | undefined }) {
  const assetUrl = useAssetUrl();
  const parts = refChipParts(value, ctx);
  const thumb = parts.thumbAssetId ? assetUrl(parts.thumbAssetId, 'thumb') : '';
  return (
    <>
      {n !== undefined && <span className="n">{n}</span>}
      {thumb ? (
        <span className="th" style={{ backgroundImage: `url("${thumb}")` }} aria-hidden="true" />
      ) : (
        parts.icon && <Icon name={parts.icon} size={12} className="chip-icon" />
      )}
      <span className={parts.mono ? 'chip-label tc' : 'chip-label'}>
        {parts.text}
        {parts.secondary && <span className="ff">{parts.secondary}</span>}
      </span>
    </>
  );
}

/**
 * Statischer Chip (gesendete Nachrichten im Verlauf): Ein Klick zeigt die Stelle, Hover verknüpft ihn mit seinem
 * Gegenstück auf Bühne und Monitor (§9.4). Gesendete Chips tragen keine Nummer: Die Nummern gehören zum Composer.
 */
export function StaticRefChip({ value, ctx }: { value: Ref; ctx: ChipLabelContext }) {
  const actions = useActions();
  const key = refKey(value);
  const linked = useStudio((s) => s.hoveredRefKey === key);
  const flashing = useStudio((s) => s.flash?.key === key);
  return (
    <button
      type="button"
      className={`chip chip-static chip-${value.kind}${linked ? ' is-linked' : ''}${flashing ? ' is-flash' : ''}`}
      data-ref-key={key}
      title={refChipTitle(value, ctx)}
      onClick={() => actions.revealRef(value)}
      onMouseEnter={() => actions.setHoveredRef(key)}
      onMouseLeave={() => actions.setHoveredRef(null)}
    >
      <ChipBody value={value} ctx={ctx} />
    </button>
  );
}
