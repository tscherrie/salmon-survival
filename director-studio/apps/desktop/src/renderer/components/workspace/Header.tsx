import { useState } from 'react';
import { currentCheckpoint, type Checkpoint, type ProjectCategory } from '@studio/core';
import { formatDateTime, useT } from '../../i18n.ts';
import { useActions, useApi, useStudio } from '../../state/context.tsx';
import { ConfirmDialog } from '../common/Dialog.tsx';
import { Icon } from '../common/Icon.tsx';
import { Popover } from '../common/Popover.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { BudgetMeter } from '../director/BudgetMeter.tsx';
import { SettingsDialog } from '../start/SettingsDialog.tsx';

function CheckpointSteps({ checkpoints }: { checkpoints: Checkpoint[] }) {
  const t = useT();
  if (checkpoints.length === 0) return null;
  const current = currentCheckpoint(checkpoints);
  return (
    <ol className="steps" aria-label={t('header.checkpoints')}>
      {checkpoints.map((c, i) => (
        <li
          key={c.id}
          className={`step step-${c.status}${c.id === current?.id ? ' is-current' : ''}`}
          aria-current={c.id === current?.id ? 'step' : undefined}
          title={`${c.title} – ${t(`cpStatus.${c.status}`)}`}
        >
          <span className="step-index" aria-hidden="true">
            {c.status === 'approved' ? <Icon name="check" size={11} /> : i + 1}
          </span>
          <span className="step-title">{c.title}</span>
          <span className="sr-only">: {t(`cpStatus.${c.status}`)}</span>
        </li>
      ))}
    </ol>
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
          <button type="button" className={`version-trigger${viewing ? ' is-old' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`${t('versions.label')}: v${shown}`}>
            <Icon name="restore" size={14} />v{shown}
            <Icon name="chevronDown" size={12} />
          </button>
        }
      >
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
                    className="button button-small"
                    onClick={() => {
                      void actions.viewVersion(v.number);
                      setOpen(false);
                    }}
                    aria-label={`${t('versions.view')} v${v.number}`}
                  >
                    <Icon name="eye" size={12} /> {t('versions.view')}
                  </button>
                  {v.number !== head && (
                    <button type="button" className="button button-small" onClick={() => setConfirm(v.number)} aria-label={`${t('versions.restore')} v${v.number}`}>
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

function ExportMenu() {
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
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      label={t('header.export')}
      anchor={
        <button type="button" className="button button-small" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="export" size={14} /> {t('header.export')}
        </button>
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

/** Kopfzeile: Projekt, Kategorie, Checkpoint-Fortschritt, Budget, Versionen, Export. */
export function Header() {
  const t = useT();
  const actions = useActions();
  const manifest = useStudio((s) => s.manifest);
  const checkpoints = useStudio((s) => s.checkpoints);
  const budget = useStudio((s) => s.budget);
  const [settings, setSettings] = useState(false);
  if (!manifest) return null;
  return (
    <header className="app-header">
      <button type="button" className="button button-ghost button-small" onClick={() => actions.closeProject()}>
        <Icon name="chevronLeft" size={14} /> {t('header.projects')}
      </button>
      <div className="project-title">
        <h1>{manifest.title}</h1>
        <span className="badge badge-category">{manifest.category ? t(`category.${manifest.category}`) : t('category.unset')}</span>
        <span className="badge badge-muted">{t(`header.phase.${manifest.phase}`)}</span>
      </div>
      <CheckpointSteps checkpoints={checkpoints} />
      <span className="spacer" />
      <div className="header-budget" title={t('header.budget')}>
        <BudgetMeter budget={budget} />
      </div>
      <VersionSelector />
      <ExportMenu />
      <ThemeToggle />
      <button type="button" className="icon-button" onClick={() => setSettings(true)} aria-label={t('header.settings')} title={t('header.settings')}>
        <Icon name="settings" />
      </button>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </header>
  );
}
