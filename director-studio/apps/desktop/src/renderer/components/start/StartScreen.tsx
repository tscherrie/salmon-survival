import { useState } from 'react';
import { formatDateTime, useT } from '../../i18n.ts';
import { useActions, useApi, useApiMode, useStudio } from '../../state/context.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { AuthStatusPanel } from './AuthStatusPanel.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';

const CATEGORY_ICONS: Record<string, IconName> = { video: 'film', audio: 'audio', slides: 'slides', graphic: 'layers', web: 'web' };

/** Startbildschirm: zuletzt geöffnete Projekte, neues Projekt, öffnen, Einstellungen, Anmeldestatus. */
export function StartScreen() {
  const t = useT();
  const api = useApi();
  const mode = useApiMode();
  const actions = useActions();
  const recent = useStudio((s) => s.recent);
  const [dialog, setDialog] = useState<'new' | 'settings' | null>(null);

  const openExisting = async () => {
    const dir = await api.chooseDirectory();
    if (dir) await actions.openProject(dir);
  };

  return (
    <div className="start">
      <header className="start-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="director" size={20} />
          </span>
          <div>
            <h1>{t('app.title')}</h1>
            <p className="muted">{t('start.tagline')}</p>
          </div>
        </div>
        <span className="spacer" />
        {mode === 'fake' && <span className="badge badge-warn">{t('app.fakeMode')}</span>}
        <ThemeToggle />
        <Tooltip label={t('start.settings')} placement="bottom">
          <button type="button" className="ibtn" onClick={() => setDialog('settings')} aria-label={t('start.settings')}>
            <Icon name="settings" />
          </button>
        </Tooltip>
      </header>
      <main className="start-main">
        <section className="start-actions">
          <button type="button" className="start-action is-primary" onClick={() => setDialog('new')}>
            <Icon name="plus" size={20} />
            <span>{t('start.newProject')}</span>
          </button>
          <button type="button" className="start-action" onClick={() => void openExisting()}>
            <Icon name="folder" size={20} />
            <span>{t('start.openProject')}</span>
          </button>
          <div className="start-auth">
            <AuthStatusPanel compact />
            <button type="button" className="link-button" onClick={() => setDialog('settings')}>
              {t('start.settings')} →
            </button>
          </div>
        </section>
        <section className="start-recent" aria-labelledby="recent-heading">
          <h2 id="recent-heading">{t('start.recent')}</h2>
          {recent.length === 0 ? (
            <p className="muted">{t('start.noRecent')}</p>
          ) : (
            <ul className="recent-list">
              {recent.map((p) => (
                <li key={p.path}>
                  <button type="button" className="recent-item" onClick={() => void actions.openProject(p.path)}>
                    <span className="recent-icon" aria-hidden="true">
                      <Icon name={p.category ? (CATEGORY_ICONS[p.category] ?? 'folder') : 'director'} size={18} />
                    </span>
                    <span className="recent-main">
                      <span className="recent-title">{p.title}</span>
                      <span className="recent-path">{p.path}</span>
                    </span>
                    <span className="recent-side">
                      <span className="badge">{p.category ? t(`category.${p.category}`) : t('category.unset')}</span>
                      <span className="muted">{t('start.updated', { date: formatDateTime(p.updatedAt) })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
