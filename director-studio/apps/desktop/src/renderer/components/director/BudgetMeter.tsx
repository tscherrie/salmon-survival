import { formatUsd, type BudgetSummary } from '@studio/core';
import { useT } from '../../i18n.ts';

/** Kostenleiste: verbraucht / reserviert / freigegeben (kompakt in der Kopfzeile, ausführlich im Panel). */
export function BudgetMeter({ budget, detailed = false }: { budget: BudgetSummary | null; detailed?: boolean }) {
  const t = useT();
  if (!budget) return null;
  const total = Math.max(budget.approvedUsd, budget.spentUsd + budget.reservedUsd, 0.0001);
  const spentPct = (budget.spentUsd / total) * 100;
  const reservedPct = (budget.reservedUsd / total) * 100;
  const over = budget.spentUsd + budget.reservedUsd > budget.approvedUsd + 1e-9;
  const aria = t('budget.meterAria', { spent: formatUsd(budget.spentUsd), reserved: formatUsd(budget.reservedUsd), approved: formatUsd(budget.approvedUsd) });
  return (
    <div className={`budget${detailed ? ' budget-detailed' : ''}${over ? ' is-over' : ''}`}>
      <div className="budget-bar" role="img" aria-label={aria} title={aria}>
        <span className="budget-spent" style={{ width: `${spentPct}%` }} />
        <span className="budget-reserved" style={{ width: `${reservedPct}%` }} />
      </div>
      <div className="budget-text">
        <span className="budget-strong">{formatUsd(budget.spentUsd)}</span>
        <span className="muted"> / {formatUsd(budget.approvedUsd)}</span>
        {detailed && budget.reservedUsd > 0 && (
          <span className="muted">
            {' '}
            · {formatUsd(budget.reservedUsd)} {t('budget.reserved')}
          </span>
        )}
      </div>
      {detailed && (
        <dl className="budget-sources">
          <div>
            <dt>{t('budget.spent')}</dt>
            <dd>{formatUsd(budget.spentUsd)}</dd>
          </div>
          <div>
            <dt>{t('budget.reserved')}</dt>
            <dd>{formatUsd(budget.reservedUsd)}</dd>
          </div>
          <div>
            <dt>{t('budget.approved')}</dt>
            <dd>{formatUsd(budget.approvedUsd)}</dd>
          </div>
          <div>
            <dt>{t('budget.available')}</dt>
            <dd>{formatUsd(budget.availableUsd)}</dd>
          </div>
          {(['fal', 'director', 'other'] as const).map((source) => (
            <div key={source} className="budget-source">
              <dt>{t(`budget.source.${source}`)}</dt>
              <dd>{formatUsd(budget.bySource[source])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
