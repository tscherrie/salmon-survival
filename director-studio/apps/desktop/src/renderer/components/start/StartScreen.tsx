import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatUsd, type ProjectCategory, type RecentProject } from '@studio/core';
import { formatDateTime, getLanguage, useT } from '../../i18n.ts';
import { useActions, useApi, useApiMode, useStudio } from '../../state/context.tsx';
import { isEditableTarget } from '../workspace/Workspace.tsx';
import { BrandMark, Icon, type IconName } from '../common/Icon.tsx';
import { ariaKeyShortcuts, isMacPlatform } from '../common/Kbd.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { AuthStatusPanel } from './AuthStatusPanel.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';

const CATEGORIES: ProjectCategory[] = ['video', 'audio', 'slides', 'graphic', 'web'];
const CATEGORY_ICONS: Record<ProjectCategory, IconName> = { video: 'film', audio: 'audio', slides: 'slides', graphic: 'layers', web: 'web' };
/** Karten unter dem Feature; alles Weitere steht in der kompakten Liste „Weitere Projekte“. */
const CARD_COUNT = 4;

type DialogState = { kind: 'new'; category?: ProjectCategory } | { kind: 'settings' } | null;

const categoryIcon = (category: ProjectCategory | null): IconName => (category ? CATEGORY_ICONS[category] : 'director');

function locale(): string {
  return getLanguage() === 'de' ? 'de-DE' : 'en-GB';
}

/** „Heute, 11:45“, „Gestern, 09:10“, sonst „28.09., 11:45“. */
function useRelativeDate(): (iso: string) => string {
  const t = useT();
  return (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(date)) / 86_400_000);
    if (diff === 0) return t('start.today', { time });
    if (diff === 1) return t('start.yesterday', { time });
    return formatDateTime(iso);
  };
}

/** Nur Tag und Monat („28.08.“) für die kompakte Liste. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(date);
}

/**
 * Standbild eines Projekts. Ohne Standbild (oder wenn es nicht lädt) eine ruhige Kategorie-Kachel: `--raised`,
 * Kategorie-Icon 24 in `--text-3` und der Titel. Es werden keine Vorschauen erfunden (DESIGN.md §7.12).
 */
function ProjectPicture({ project, className }: { project: RecentProject; className: string }) {
  const [failed, setFailed] = useState(false);
  if (project.poster && !failed) {
    return (
      <span className={`${className} always-dark`}>
        <img src={project.poster} alt="" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={`${className} is-tile`}>
      <Icon name={categoryIcon(project.category)} size={24} />
      <span className="start-tile-title">{project.title}</span>
    </span>
  );
}

/** Mini-Checkpoint-Leiste: erledigt --text-3, aktuell --text, offen --line-2 (nie Tungsten, §6). */
function MiniSteps({ checkpoint }: { checkpoint: NonNullable<RecentProject['checkpoint']> }) {
  const t = useT();
  const done = (i: number) => i < checkpoint.index - 1 || (i === checkpoint.index - 1 && (checkpoint.status === 'approved' || checkpoint.status === 'skipped'));
  return (
    <div className="mini-steps" role="img" aria-label={t('start.step', { index: checkpoint.index, total: checkpoint.total })}>
      {Array.from({ length: checkpoint.total }, (_, i) => (
        <i key={i} className={done(i) ? 'is-done' : i === checkpoint.index - 1 ? 'is-current' : undefined} />
      ))}
    </div>
  );
}

function StepLine({ checkpoint }: { checkpoint: NonNullable<RecentProject['checkpoint']> }) {
  const t = useT();
  if (checkpoint.status === 'proposed') {
    return (
      <p className="feature-waiting">
        <span className="feature-waiting-dot" aria-hidden="true" />
        <span>
          {t('start.waiting')} <strong>{checkpoint.title}</strong>
        </span>
      </p>
    );
  }
  return (
    <p className="feature-step">
      <span className="feature-step-title">{checkpoint.title}</span>
      <span className="badge">{t(`cpStatus.${checkpoint.status}`)}</span>
    </p>
  );
}

function BudgetLine({ budget }: { budget: NonNullable<RecentProject['budget']> }) {
  const t = useT();
  const total = Math.max(budget.approvedUsd, budget.spentUsd, 0.0001);
  const over = budget.spentUsd > budget.approvedUsd + 1e-9;
  const spent = formatUsd(budget.spentUsd);
  const approved = formatUsd(budget.approvedUsd);
  return (
    <div className={`feature-budget${over ? ' is-over' : ''}`}>
      <span className="feature-budget-label">{t('start.budget')}</span>
      <span className="budget-bar" role="img" aria-label={t('start.budgetAria', { spent, approved })}>
        <span className="budget-spent" style={{ width: `${(budget.spentUsd / total) * 100}%` }} />
      </span>
      <span className="feature-budget-text mono" aria-hidden="true">
        <span className="budget-strong">{spent}</span> / {approved}
      </span>
    </div>
  );
}

/** Pfad mit Auslassung am Anfang: Der Projektname am Ende bleibt lesbar. */
function PathText({ path }: { path: string }) {
  return (
    <span className="start-path mono" dir="rtl" title={path}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

/** Das zuletzt bearbeitete Projekt: großes Standbild, Stand der Checkpoints, Budget und „Öffnen“. */
function Feature({ project, onOpen }: { project: RecentProject; onOpen: () => void }) {
  const t = useT();
  const relative = useRelativeDate();
  const titleId = useId();
  return (
    <article className="feature" aria-labelledby={titleId}>
      {/* Das Bild ist eine zusätzliche Klickfläche für die Maus; per Tastatur öffnet „Öffnen“ */}
      <div className="feature-media" onClick={onOpen}>
        <ProjectPicture project={project} className="feature-picture" />
      </div>
      <div className="feature-info">
        <p className="overline">
          {relative(project.updatedAt)} · {t('start.lastEdited')}
        </p>
        <h3 id={titleId} className="feature-title">
          {project.title}
        </h3>
        <p className="feature-meta">
          <span>{project.category ? t(`category.${project.category}`) : t('category.unset')}</span>
          {project.checkpoint && (
            <>
              <span className="start-sep" aria-hidden="true" />
              <span>{t('start.step', { index: project.checkpoint.index, total: project.checkpoint.total })}</span>
            </>
          )}
        </p>
        {project.checkpoint && (
          <>
            <MiniSteps checkpoint={project.checkpoint} />
            <StepLine checkpoint={project.checkpoint} />
          </>
        )}
        {project.budget && <BudgetLine budget={project.budget} />}
        <div className="feature-actions">
          <button type="button" className="btn" onClick={onOpen} aria-label={t('start.openAria', { title: project.title })}>
            {t('start.open')}
            <Icon name="chevronRight" size={14} />
          </button>
          <PathText path={project.path} />
        </div>
      </div>
    </article>
  );
}

function ProjectCard({ project, onOpen }: { project: RecentProject; onOpen: () => void }) {
  const t = useT();
  const titleId = useId();
  const metaId = useId();
  return (
    <li>
      <button type="button" className="pcard" onClick={onOpen} aria-labelledby={titleId} aria-describedby={metaId}>
        <ProjectPicture project={project} className="pcard-picture" />
        <span className="pcard-info">
          <span id={titleId} className="pcard-title">
            {project.title}
          </span>
          <span id={metaId} className="pcard-meta">
            <span className="pcard-kind">
              {project.category ? t(`category.${project.category}`) : t('category.unset')}
              <span className="start-sep" aria-hidden="true" />
              <span className="mono">{formatDateTime(project.updatedAt)}</span>
            </span>
            {project.checkpoint && (
              <span className="pcard-step">
                {project.checkpoint.status === 'proposed' && <span className="feature-waiting-dot" aria-hidden="true" />}
                <span className="pcard-step-text">
                  {project.checkpoint.title} · {t(`cpStatus.${project.checkpoint.status}`)}
                </span>
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function ProjectRow({ project, onOpen, detailed = false }: { project: RecentProject; onOpen: () => void; detailed?: boolean }) {
  const t = useT();
  const titleId = useId();
  const metaId = useId();
  return (
    <li>
      <button type="button" className="prow" onClick={onOpen} aria-labelledby={titleId} aria-describedby={metaId}>
        <span className="prow-icon" aria-hidden="true">
          <Icon name={categoryIcon(project.category)} size={14} />
        </span>
        <span className="prow-main">
          <span id={titleId} className="prow-title">
            {project.title}
          </span>
          <span id={metaId} className="prow-kind">
            {project.category ? t(`category.${project.category}`) : t('category.unset')}
            {detailed && project.checkpoint && ` · ${project.checkpoint.title} · ${t(`cpStatus.${project.checkpoint.status}`)}`}
          </span>
        </span>
        {detailed && <PathText path={project.path} />}
        <span className="prow-date mono">{detailed ? formatDateTime(project.updatedAt) : shortDate(project.updatedAt)}</span>
      </button>
    </li>
  );
}

/** Leerzustand nach §11: Icon, Titel, ein Satz, höchstens eine Aktion. */
function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty-state start-empty">
      <Icon name={icon} size={20} />
      <strong>{title}</strong>
      {text && <span>{text}</span>}
      {action}
    </div>
  );
}

/** Rechte Zone: „Zuletzt geöffnet“ mit Suche und Raster/Liste, Feature, Karten und „Weitere Projekte“. */
function RecentArea({ recent, onOpen }: { recent: RecentProject[]; onOpen: (path: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? recent.filter((p) => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : recent), [recent, q]);
  const [feature, ...rest] = matches;
  const cards = rest.slice(0, CARD_COUNT);
  const more = rest.slice(CARD_COUNT);
  const open = (p: RecentProject) => () => onOpen(p.path);

  let body: ReactNode;
  if (recent.length === 0) {
    body = <Empty icon="folder" title={t('start.emptyTitle')} text={t('start.emptyText')} />;
  } else if (matches.length === 0) {
    body = (
      <Empty
        icon="search"
        title={t('start.noMatches', { query: query.trim() })}
        action={
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery('');
              searchRef.current?.focus();
            }}
          >
            {t('start.resetFilter')}
          </button>
        }
      />
    );
  } else if (view === 'list' || q) {
    body = (
      <ul className="prow-list is-detailed">
        {matches.map((p) => (
          <ProjectRow key={p.path} project={p} onOpen={open(p)} detailed />
        ))}
      </ul>
    );
  } else {
    body = (
      <>
        <Feature project={feature!} onOpen={open(feature!)} />
        {cards.length > 0 && (
          <ul className="pgrid">
            {cards.map((p) => (
              <ProjectCard key={p.path} project={p} onOpen={open(p)} />
            ))}
          </ul>
        )}
        {more.length > 0 && (
          <section className="start-more" aria-labelledby="start-more-heading">
            <h3 id="start-more-heading" className="overline">
              {t('start.more')}
            </h3>
            <ul className="prow-list">
              {more.map((p) => (
                <ProjectRow key={p.path} project={p} onOpen={open(p)} />
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <main className="start-recent" aria-labelledby="recent-heading">
      <div className="start-recent-head">
        <h2 id="recent-heading">{t('start.recent')}</h2>
        <span className="spacer" />
        {recent.length > 0 && (
          <>
            <label className="field start-search">
              <Icon name="search" size={14} />
              <input ref={searchRef} type="search" value={query} placeholder={t('start.search')} aria-label={t('start.search')} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="seg" role="group" aria-label={t('start.view')}>
              {(['grid', 'list'] as const).map((id) => (
                <Tooltip key={id} label={t(`start.view.${id}`)} placement="bottom">
                  <button type="button" aria-pressed={view === id} aria-label={t(`start.view.${id}`)} onClick={() => setView(id)}>
                    <Icon name={id} size={14} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </>
        )}
      </div>
      {body}
    </main>
  );
}

/** Linke Zone: Frage, Neues Projekt, Öffnen, „Neu aus Kategorie“ und unten der Anmeldestatus. */
function Launch({ onNew, onOpenExisting, onSettings }: { onNew: (category?: ProjectCategory) => void; onOpenExisting: () => void; onSettings: () => void }) {
  const t = useT();
  const catsId = useId();
  return (
    <aside className="launch" aria-labelledby="launch-heading">
      <h2 id="launch-heading" className="launch-title">
        {t('start.question')}
      </h2>
      <p className="launch-lede">{t('start.tagline')}</p>
      <div className="launch-actions">
        <Tooltip label={t('start.newProject')} keys={['mod', 'N']}>
          <button type="button" className="btn primary lg" onClick={() => onNew()} aria-keyshortcuts={ariaKeyShortcuts(['mod', 'N'])}>
            <Icon name="plus" size={16} />
            {t('start.newProject')}
          </button>
        </Tooltip>
        <Tooltip label={t('start.openProject')} keys={['mod', 'O']}>
          <button type="button" className="btn lg" onClick={onOpenExisting} aria-keyshortcuts={ariaKeyShortcuts(['mod', 'O'])}>
            <Icon name="folder" size={16} />
            {t('start.openProject')}
          </button>
        </Tooltip>
      </div>
      <h3 id={catsId} className="overline launch-cats-title">
        {t('start.newFromCategory')}
      </h3>
      <ul className="launch-cats" aria-labelledby={catsId}>
        {CATEGORIES.map((c) => (
          <li key={c}>
            <button type="button" className="launch-cat" onClick={() => onNew(c)} aria-labelledby={`launch-cat-name-${c}`} aria-describedby={`launch-cat-${c}`}>
              <span className="launch-cat-icon" aria-hidden="true">
                <Icon name={CATEGORY_ICONS[c]} size={16} />
              </span>
              <span className="launch-cat-text">
                <span id={`launch-cat-name-${c}`} className="launch-cat-name">
                  {t(`category.${c}`)}
                </span>
                <span id={`launch-cat-${c}`} className="launch-cat-examples">
                  {t(`start.examples.${c}`)}
                </span>
              </span>
              <Icon name="chevronRight" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="launch-status">
        <AuthStatusPanel compact onSetup={onSettings} />
      </div>
    </aside>
  );
}

/**
 * Startbildschirm (DESIGN.md §7.12): links (400 px, `--panel`) die Frage, „Neues Projekt“, „Projekt öffnen …“,
 * „Neu aus Kategorie“ und der Anmeldestatus; rechts „Zuletzt geöffnet“ mit dem zuletzt bearbeiteten Projekt als
 * Feature, Projektkarten und „Weitere Projekte“. Kürzel: mod+N, mod+O.
 */
export function StartScreen() {
  const t = useT();
  const api = useApi();
  const mode = useApiMode();
  const actions = useActions();
  const recent = useStudio((s) => s.recent);
  const [dialog, setDialog] = useState<DialogState>(null);

  const openExisting = async () => {
    const dir = await api.chooseDirectory();
    if (dir) await actions.openProject(dir);
  };
  const openExistingRef = useRef(openExisting);
  openExistingRef.current = openExisting;

  // mod+N / mod+O (§13.4), nicht während ein Dialog offen ist
  const dialogOpen = dialog !== null;
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!mod || event.altKey || event.shiftKey || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        setDialog({ kind: 'new' });
      } else if (key === 'o' && !isEditableTarget(event.target)) {
        event.preventDefault();
        void openExistingRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen]);

  return (
    <div className="start">
      <header className="start-header">
        <div className="brand">
          <BrandMark size={20} />
          <h1>{t('app.title')}</h1>
        </div>
        <span className="spacer" />
        {mode === 'fake' && <span className="badge badge-warn">{t('app.fakeMode')}</span>}
        <ThemeToggle />
        <Tooltip label={t('start.settings')} placement="bottom">
          <button type="button" className="ibtn" onClick={() => setDialog({ kind: 'settings' })} aria-label={t('start.settings')}>
            <Icon name="settings" />
          </button>
        </Tooltip>
      </header>
      <div className="start-body">
        <Launch onNew={(category) => setDialog({ kind: 'new', ...(category ? { category } : {}) })} onOpenExisting={() => void openExisting()} onSettings={() => setDialog({ kind: 'settings' })} />
        <RecentArea recent={recent} onOpen={(path) => void actions.openProject(path)} />
      </div>
      {dialog?.kind === 'new' && <NewProjectDialog onClose={() => setDialog(null)} {...(dialog.category ? { initialCategory: dialog.category } : {})} />}
      {dialog?.kind === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
