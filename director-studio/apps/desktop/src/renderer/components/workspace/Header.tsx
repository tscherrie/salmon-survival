import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { currentCheckpoint, formatUsd, type BudgetSummary, type Checkpoint, type ProjectCategory } from '@studio/core';
import { formatDateTime, useLanguage, useT } from '../../i18n.ts';
import { useLayout } from '../../lib/layout.ts';
import { useActions, useApi, useStudio } from '../../state/context.tsx';
import { ConfirmDialog } from '../common/Dialog.tsx';
import { BrandMark, Icon } from '../common/Icon.tsx';
import { Popover } from '../common/Popover.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { BudgetMeter } from '../director/BudgetMeter.tsx';
import { SettingsDialog } from '../start/SettingsDialog.tsx';

/** Ab dieser Director-Breite steht die rechte Zone voll da; darunter klappt sie stufenweise ein (§7.2). */
const ACTIONS_FULL_MIN = 360;
/** Innenabstand der rechten Zone (links 16 wie die Director-Spalte, rechts 12). */
const ACTIONS_PAD = 28;

/** Breite eines Elements (ResizeObserver); 0, solange unbekannt (jsdom). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Stufenweises Einklappen: Ändert sich `resetKey` (Breite, Inhalt, Sprache), beginnt die Stufe wieder bei 0 und
 * steigt vor dem Zeichnen, bis `fits()` stimmt oder `max` erreicht ist. Kein Flackern, weil alles im Layout-Effekt
 * passiert.
 */
function useCollapseLevel(max: number, resetKey: string, fits: () => boolean): number {
  const [state, setState] = useState({ key: resetKey, level: 0 });
  const level = state.key === resetKey ? state.level : 0;
  useLayoutEffect(() => {
    if (level < max && !fits()) setState({ key: resetKey, level: level + 1 });
    else if (state.key !== resetKey) setState({ key: resetKey, level });
  });
  return level;
}

/** Status-Pill des aktuellen Schritts (neutral, nie Tungsten): zur Freigabe, Änderungen gewünscht, in Arbeit. */
function currentPill(c: Checkpoint, running: boolean, t: ReturnType<typeof useT>): string | null {
  if (c.status === 'proposed') return t('cpStatus.proposed');
  if (c.status === 'changes_requested') return t('cpStatus.changes_requested');
  if (c.status === 'pending' && running) return t('cpStatus.inProgress');
  return null;
}

/**
 * Checkpoint-Stepper (§7.2): erledigt = Häkchen in --ok, aktuell = gefüllter --text-Kreis plus Label und
 * neutraler Pill, offen = Ring. Klappt stufenweise ein (0 alle Labels · 1 ohne erledigte · 2 ohne offene ·
 * 3 nur der aktuelle Schritt plus „3/5“); ausgeblendete Labels stehen im Tooltip.
 */
function CheckpointSteps({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const t = useT();
  const lang = useLanguage();
  const actions = useActions();
  const layout = useLayout();
  const running = useStudio((s) => s.runState === 'running');
  const zoneRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const zoneW = useWidth(zoneRef);
  const current = currentCheckpoint(checkpoints);
  const signature = checkpoints.map((c) => `${c.id}:${c.status}:${c.title}`).join('|');
  const level = useCollapseLevel(3, `${zoneW}|${signature}|${running}|${lang}`, () => {
    const zone = zoneRef.current;
    const list = listRef.current;
    if (!zone || !list || zoneW === 0) return true;
    const style = getComputedStyle(zone);
    const inner = zone.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return list.scrollWidth <= inner + 0.5;
  });

  // Klick: Entscheidung im Dock bzw. Systemzeile des Checkpoints im Verlauf zeigen
  const reveal = (c: Checkpoint) => {
    if (layout?.collapsed.director) layout.setCollapsed('director', false);
    actions.announce(t('header.stepTip', { title: c.title, status: t(`cpStatus.${c.status}`) }));
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-checkpoint-id="${CSS.escape(c.id)}"]`);
      if (!target) return;
      target.scrollIntoView?.({ block: 'nearest' });
      const focusable = target.matches('button, [tabindex]') ? target : target.querySelector<HTMLElement>('button, input, [tabindex]');
      focusable?.focus({ preventScroll: true });
    });
  };

  if (checkpoints.length === 0) return <div ref={zoneRef} className="hdr-zone hdr-steps" />;
  const total = checkpoints.length;
  return (
    <div ref={zoneRef} className="hdr-zone hdr-steps">
      <ol ref={listRef} className={`steps steps-l${level}`} aria-label={t('header.checkpoints')}>
        {checkpoints.map((c, i) => {
          const isCurrent = c.id === current?.id;
          const done = c.status === 'approved' || c.status === 'skipped';
          const labelHidden = !isCurrent && ((level >= 1 && done) || (level >= 2 && !done));
          const pill = isCurrent ? currentPill(c, running, t) : null;
          const statusText = t(`cpStatus.${c.status}`);
          const content = (
            <>
              <span className="step-index" aria-hidden="true">
                {c.status === 'approved' ? <Icon name="check" size={11} /> : c.status === 'skipped' ? <Icon name="minus" size={11} /> : i + 1}
              </span>
              <span className={labelHidden ? 'step-title sr-only' : 'step-title'}>{c.title}</span>
              <span className="sr-only">: {statusText}</span>
              {pill && (
                <span className="step-pill" aria-hidden="true">
                  {pill}
                </span>
              )}
              {isCurrent && level >= 3 && (
                <span className="step-count mono" aria-hidden="true">
                  {t('header.stepCount', { current: i + 1, total })}
                </span>
              )}
            </>
          );
          // Offene Schritte ohne Entscheidung und Systemzeile sind keine Knöpfe (es gibt noch nichts zu zeigen)
          const clickable = c.status !== 'pending' || isCurrent;
          return (
            <li
              key={c.id}
              className={`step step-${c.status}${isCurrent ? ' is-current' : ''}${labelHidden ? ' is-compact' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <Tooltip label={t('header.stepTip', { title: c.title, status: statusText })} placement="bottom" disabled={!labelHidden}>
                {clickable ? (
                  <button type="button" className="step-btn" onClick={() => reveal(c)}>
                    {content}
                  </button>
                ) : (
                  <span className="step-btn">{content}</span>
                )}
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function VersionSelector() {
  const t = useT();
  const actions = useActions();
  const versions = useStudio((s) => s.versions);
  const head = useStudio((s) => s.documentVersion);
  const viewing = useStudio((s) => s.viewing);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const shown = viewing?.number ?? head;
  const sorted = [...versions].sort((a, b) => b.number - a.number);
  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        label={t('versions.label')}
        className="versions-popover"
        anchor={
          <Tooltip label={t('versions.label')} placement="bottom" disabled={open}>
            <button
              type="button"
              className={`version-trigger${viewing ? ' is-old' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              aria-label={`${t('versions.label')}: v${shown}`}
            >
              <Icon name="restore" size={14} />
              <span className="mono">v{shown}</span>
              {viewing && <span className="version-viewing">· {t('versions.viewing')}</span>}
              <Icon name="chevronDown" size={12} />
            </button>
          </Tooltip>
        }
      >
        <h3 className="hdr-pop-head">{t('versions.label')}</h3>
        {sorted.length === 0 ? (
          <p className="muted">{t('versions.empty')}</p>
        ) : (
          <ul className="version-list" aria-label={t('versions.label')}>
            {sorted.map((v) => (
              <li key={v.number} className={`version-row${v.number === shown ? ' is-shown' : ''}`} data-version={v.number}>
                <div className="version-info">
                  <span className="version-number">v{v.number}</span>
                  {v.number === head && <span className="badge">{t('versions.current')}</span>}
                  <span className="version-note">{v.note}</span>
                  <span className="version-meta">
                    {t(`versions.author.${v.author}`)} · {formatDateTime(v.createdAt)}
                    {v.restoredFrom ? ` · ← v${v.restoredFrom}` : ''}
                  </span>
                </div>
                <div className="version-actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      void actions.viewVersion(v.number);
                      setOpen(false);
                    }}
                    aria-label={`${t('versions.view')} v${v.number}`}
                  >
                    <Icon name="eye" size={12} /> {t('versions.view')}
                  </button>
                  {v.number !== head && (
                    <button type="button" className="btn ghost sm" onClick={() => setConfirm(v.number)} aria-label={`${t('versions.restore')} v${v.number}`}>
                      <Icon name="restore" size={12} /> {t('versions.restore')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      {confirm !== null && (
        <ConfirmDialog
          title={t('versions.confirmTitle', { number: confirm })}
          text={t('versions.confirmText', { number: confirm })}
          confirmLabel={t('versions.restore')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const n = confirm;
            setConfirm(null);
            setOpen(false);
            void actions.restoreVersion(n);
          }}
        />
      )}
    </>
  );
}

const EXPORT_TARGETS: Record<ProjectCategory, Array<'mp4' | 'srt' | 'wav' | 'mp3' | 'pdf' | 'pptx' | 'png' | 'svg' | 'zip'>> = {
  video: ['mp4', 'srt', 'wav'],
  audio: ['wav', 'mp3'],
  slides: ['pdf', 'pptx', 'png'],
  graphic: ['png', 'pdf', 'svg'],
  web: ['zip'],
};

/** Exportieren (secondary); ab Einklappstufe 1 nur das Icon (Name bleibt per aria-label, Erklärung im Tooltip). */
function ExportMenu({ iconOnly }: { iconOnly: boolean }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const projectId = useStudio((s) => s.projectId);
  const category = useStudio((s) => s.manifest?.category ?? null);
  const doc = useStudio((s) => s.document);
  const [open, setOpen] = useState(false);
  if (!category || !projectId) return null;
  const formats = doc?.kind === 'timeline' && category === 'video' ? doc.formats.map((f) => f.id) : [];
  const run = async (target: string, format?: string) => {
    setOpen(false);
    try {
      const result = await api.exportProject(projectId, { target, ...(format ? { format } : {}) });
      actions.toast('success', t('header.exportDone', { path: result.path }));
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : String(error));
    }
  };
  const trigger = (
    <button
      type="button"
      className={iconOnly ? 'btn sm hdr-export is-icon' : 'btn sm hdr-export'}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={iconOnly ? t('header.export') : undefined}
      onClick={() => setOpen((v) => !v)}
    >
      <Icon name="export" size={14} />
      {!iconOnly && t('header.export')}
    </button>
  );
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('header.export')}
      anchor={
        iconOnly ? (
          <Tooltip label={t('header.export')} placement="bottom" disabled={open}>
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )
      }
    >
      <ul className="menu" role="menu">
        {EXPORT_TARGETS[category].flatMap((target) =>
          target === 'mp4' && formats.length > 1
            ? formats.map((format) => (
                <li key={`${target}-${format}`} role="none">
                  <button type="button" role="menuitem" onClick={() => void run(target, format)}>
                    {t('export.format', { target: t(`export.${target}`), format })}
                  </button>
                </li>
              ))
            : [
                <li key={target} role="none">
                  <button type="button" role="menuitem" onClick={() => void run(target)}>
                    {t(`export.${target}`)}
                  </button>
                </li>,
              ],
        )}
      </ul>
    </Popover>
  );
}

/**
 * Budget in der Kopfzeile (§7.2): Meter 64 × 4 (verbraucht --text-2, reserviert schraffiert, frei --line-2; ab 85 %
 * --warn, darüber --danger) und „$6.84 / $20.00“. Ein Klick öffnet das Popover mit der Aufschlüsselung.
 * Stufe 2 blendet den Balken aus, Stufe 3 den Gesamtbetrag (bleibt im Tooltip).
 */
function BudgetButton({ budget, level }: { budget: BudgetSummary; level: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const total = Math.max(budget.approvedUsd, budget.spentUsd + budget.reservedUsd, 0.0001);
  const committed = budget.spentUsd + budget.reservedUsd;
  const over = committed > budget.approvedUsd + 1e-9;
  const warn = !over && budget.approvedUsd > 0 && committed >= budget.approvedUsd * 0.85;
  const spent = formatUsd(budget.spentUsd);
  const approved = formatUsd(budget.approvedUsd);
  const tip = t('budget.meterAria', { spent, reserved: formatUsd(budget.reservedUsd), approved });
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('header.budget')}
      className="budget-popover"
      anchor={
        <Tooltip label={tip} placement="bottom" disabled={open}>
          <button
            type="button"
            className={`hdr-budget${over ? ' is-over' : warn ? ' is-warn' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={t('header.budgetButton', { spent, approved })}
            onClick={() => setOpen((v) => !v)}
          >
            {level < 2 && (
              <span className="budget-bar" aria-hidden="true">
                <span className="budget-spent" style={{ width: `${(budget.spentUsd / total) * 100}%` }} />
                <span className="budget-reserved" style={{ width: `${(budget.reservedUsd / total) * 100}%` }} />
              </span>
            )}
            <span className="hdr-budget-text mono" aria-hidden="true">
              <span className="hdr-budget-spent">{spent}</span>
              {level < 3 && <span className="hdr-budget-total"> / {approved}</span>}
            </span>
          </button>
        </Tooltip>
      }
    >
      <h3 className="hdr-pop-head">{t('header.budget')}</h3>
      <BudgetMeter budget={budget} detailed />
    </Popover>
  );
}

/**
 * Kopfzeile (§7.2): drei Zonen über den Spalten darunter – Projekt über den Assets (bzw. der Index-Spalte), Stepper
 * über dem Monitor, Budget und Aktionen über dem Director. Die rechte Zone klappt bei weniger als 360 px
 * Director-Breite stufenweise ein: (1) Exportieren nur als Icon, (2) ohne Meter-Balken, (3) ohne Gesamtbetrag.
 */
export function Header() {
  const t = useT();
  const lang = useLanguage();
  const actions = useActions();
  const layout = useLayout();
  const manifest = useStudio((s) => s.manifest);
  const checkpoints = useStudio((s) => s.checkpoints);
  const budget = useStudio((s) => s.budget);
  const viewing = useStudio((s) => s.viewing?.number ?? null);
  const head = useStudio((s) => s.documentVersion);
  const [settings, setSettings] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const sideR = layout?.sideR ?? null;
  const budgetKey = budget ? `${budget.spentUsd}/${budget.reservedUsd}/${budget.approvedUsd}` : '-';
  const level = useCollapseLevel(3, `${sideR}|${budgetKey}|${viewing ?? head}|${lang}|${manifest?.category ?? ''}`, () => {
    if (sideR === null || sideR >= ACTIONS_FULL_MIN) return true;
    const el = actionsRef.current;
    if (!el) return true;
    return el.getBoundingClientRect().width + ACTIONS_PAD <= sideR;
  });
  if (!manifest) return null;
  return (
    <header className="app-header">
      <div className="hdr-zone hdr-project">
        <Tooltip label={t('header.projectsTip')} placement="bottom">
          <button type="button" className="hdr-home" onClick={() => actions.closeProject()} aria-label={t('header.projects')}>
            <Icon name="chevronLeft" size={14} />
            <BrandMark size={16} />
          </button>
        </Tooltip>
        <div className="project-title">
          <h1 title={manifest.title}>{manifest.title}</h1>
          <span className="badge badge-category">{manifest.category ? t(`category.${manifest.category}`) : t('category.unset')}</span>
        </div>
      </div>
      <CheckpointSteps checkpoints={checkpoints} />
      <div className="hdr-zone hdr-actions">
        <div ref={actionsRef} className={`hdr-actions-in hdr-l${level}`}>
          {budget && <BudgetButton budget={budget} level={level} />}
          <VersionSelector />
          <ExportMenu iconOnly={level >= 1} />
          <span className="hdr-sep" aria-hidden="true" />
          <ThemeToggle />
          <Tooltip label={t('header.settings')} placement="bottom">
            <button type="button" className="ibtn" onClick={() => setSettings(true)} aria-label={t('header.settings')}>
              <Icon name="settings" />
            </button>
          </Tooltip>
        </div>
      </div>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </header>
  );
}
