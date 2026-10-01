import type { ReactNode } from 'react';
import { useT, type MessageKey } from '../i18n.ts';
import { useContrastMode, useThemeMode, type ContrastMode, type ThemeMode } from '../lib/theme.ts';
import { BrandMark, Icon } from '../components/common/Icon.tsx';
import { Kbd } from '../components/common/Kbd.tsx';
import { Tooltip } from '../components/common/Tooltip.tsx';

/**
 * Bausteine-Übersicht (nur im Entwicklungsmodus, `?story=bausteine`): die Zustandsmatrix aus DESIGN.md §11 für
 * Ghost/Icon, secondary, primary, Chip und Asset-Karte sowie Größen, Segmente, Toggles, Felder, Badges, Keycaps,
 * Spinner und Live-Punkt – in beiden Themes und mit erhöhtem Kontrast umschaltbar. Hover, Gedrückt und Fokus werden
 * über `data-force` erzwungen; alles bleibt zusätzlich echt bedienbar.
 */

type State = 'rest' | 'hover' | 'pressed' | 'focus' | 'on' | 'disabled' | 'loading' | 'error' | 'linked' | 'selected';
const STATES: State[] = ['rest', 'hover', 'pressed', 'focus', 'on', 'disabled', 'loading', 'error', 'linked', 'selected'];

const force = (state: State) => (state === 'hover' || state === 'pressed' || state === 'focus' ? { 'data-force': state } : {});

function Ghost({ state }: { state: State }) {
  const t = useT();
  if (state === 'error' || state === 'linked' || state === 'selected') return null;
  return (
    <div className="story-row">
      <button type="button" className={`btn ghost${state === 'on' ? ' on' : ''}`} disabled={state === 'disabled'} aria-busy={state === 'loading' || undefined} {...force(state)}>
        {state === 'loading' ? <span className="spin" aria-hidden="true" /> : <Icon name="marker" size={14} />}
        {t('story.action')}
      </button>
      <button type="button" className={`ibtn${state === 'on' ? ' on' : ''}`} disabled={state === 'disabled'} aria-label={t('story.action')} {...force(state)}>
        {state === 'loading' ? <span className="spin" aria-hidden="true" /> : <Icon name="sideLeft" size={16} />}
      </button>
    </div>
  );
}

function Secondary({ state }: { state: State }) {
  const t = useT();
  if (state === 'on' || state === 'linked' || state === 'selected') return null;
  return (
    <button type="button" className={`btn${state === 'error' ? ' is-error' : ''}`} disabled={state === 'disabled'} aria-busy={state === 'loading' || undefined} {...force(state)}>
      {state === 'loading' ? <span className="spin" aria-hidden="true" /> : <Icon name={state === 'error' ? 'stop' : 'export'} size={14} />}
      {state === 'error' ? t('director.stop') : t('header.export')}
    </button>
  );
}

function Primary({ state }: { state: State }) {
  const t = useT();
  if (state === 'on' || state === 'error' || state === 'linked' || state === 'selected') return null;
  return (
    <button type="button" className="btn primary" disabled={state === 'disabled'} aria-busy={state === 'loading' || undefined} {...force(state)}>
      {state === 'loading' && <span className="spin" aria-hidden="true" />}
      {t('composer.send')}
    </button>
  );
}

function Chip({ state }: { state: State }) {
  const t = useT();
  if (!['rest', 'hover', 'focus', 'linked'].includes(state)) return null;
  return (
    <span className={`chip${state === 'linked' ? ' is-linked' : ''}`} tabIndex={state === 'focus' ? 0 : undefined} {...force(state)}>
      <span className="n">2</span>
      <span className="tc">00:24:00</span>
      <button type="button" className="chip-remove" aria-label={t('composer.removeChip', { label: '00:24:00' })} tabIndex={-1}>
        ×
      </button>
    </span>
  );
}

function Card({ state }: { state: State }) {
  const t = useT();
  if (!['rest', 'hover', 'focus', 'loading', 'error', 'linked', 'selected'].includes(state)) return null;
  return (
    <div
      className={`asset-card story-card${state === 'linked' ? ' is-linked' : ''}${state === 'error' ? ' is-error' : ''}${state === 'selected' ? ' is-selected' : ''}`}
      {...(state === 'hover' ? { 'data-force': 'hover' } : {})}
    >
      <button type="button" className="asset-card-main" {...(state === 'focus' ? { 'data-force': 'focus' } : {})}>
        <span className="asset-preview">{state !== 'loading' && <span className="asset-icon"><Icon name="image" size={20} /></span>}</span>
        <span className="asset-title">{t('assetKind.image')}</span>
      </button>
      {state === 'linked' && (
        <span className="chip story-n">
          <span className="n">3</span>
        </span>
      )}
      {state === 'hover' && (
        <button type="button" className="asset-insert btn sm">
          {t('assets.toComposer')}
        </button>
      )}
      {state === 'error' && <span className="field-error">{t('assetStatus.missing')}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="overline">{title}</h2>
      {children}
    </section>
  );
}

export function BuildingBlocksStory() {
  const t = useT();
  const [theme, setTheme] = useThemeMode();
  const [contrast, setContrast] = useContrastMode();
  const themes: ThemeMode[] = ['dark', 'light', 'system'];
  const contrasts: ContrastMode[] = ['system', 'more', 'normal'];
  return (
    <main className="story">
      <header className="story-head">
        <BrandMark size={20} />
        <div>
          <h1>{t('story.title')}</h1>
          <p>{t('story.subtitle')}</p>
        </div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label={t('theme.label')}>
          {themes.map((m) => (
            <button key={m} type="button" aria-pressed={theme === m} onClick={() => setTheme(m)}>
              {t(`theme.${m}`)}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={t('settings.contrast')}>
          {contrasts.map((m) => (
            <button key={m} type="button" aria-pressed={contrast === m} onClick={() => setContrast(m)}>
              {t(`contrast.${m}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="story-panel">
        <table className="story-matrix">
          <thead>
            <tr>
              <th>{t('story.state')}</th>
              {(['story.col.ghost', 'story.col.secondary', 'story.col.primary', 'story.col.chip', 'story.col.card'] as MessageKey[]).map((k) => (
                <th key={k}>{t(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATES.map((state) => (
              <tr key={state}>
                <td>{t(`story.state.${state}`)}</td>
                <td>
                  <Ghost state={state} />
                </td>
                <td>
                  <Secondary state={state} />
                </td>
                <td>
                  <Primary state={state} />
                </td>
                <td>
                  <Chip state={state} />
                </td>
                <td>
                  <Card state={state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section title={t('story.sizes')}>
        <div className="story-row">
          <button type="button" className="btn sm">
            <Icon name="export" size={12} /> {t('header.export')}
          </button>
          <button type="button" className="btn">
            <Icon name="export" size={14} /> {t('header.export')}
          </button>
          <button type="button" className="btn lg">
            <Icon name="plus" size={16} /> {t('start.newProject')}
          </button>
          <button type="button" className="btn primary sm">
            {t('composer.send')}
          </button>
          <button type="button" className="btn primary lg">
            {t('start.newProject')}
          </button>
          <button type="button" className="btn danger sm">
            <Icon name="stop" size={12} /> {t('director.stop')}
          </button>
          <button type="button" className="ibtn sm" aria-label={t('common.close')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </Section>

      <Section title={t('story.controls')}>
        <div className="story-row">
          <div className="seg" role="group" aria-label={t('monitor.format')}>
            <button type="button" aria-pressed>
              16:9
            </button>
            <button type="button" aria-pressed={false}>
              9:16
            </button>
            <button type="button" aria-pressed={false} disabled>
              1:1
            </button>
          </div>
          <button type="button" className="toggle on" aria-pressed>
            <span className="led" /> {t('story.state.on')}
          </button>
          <button type="button" className="toggle" aria-pressed={false}>
            <span className="led" /> {t('story.state.rest')}
          </button>
          <div className="field" style={{ width: 220 }}>
            <Icon name="search" size={14} />
            <input placeholder={t('assets.searchPlaceholder')} aria-label={t('story.field')} />
            <button type="button" className="ibtn sm" aria-label={t('assets.status')}>
              <Icon name="filter" size={14} />
            </button>
          </div>
          <div>
            <input className="field is-error" aria-invalid="true" aria-label={t('story.field')} defaultValue="" placeholder={t('story.field')} />
            <p className="field-error">{t('story.fieldError')}</p>
          </div>
        </div>
        <div className="story-row" style={{ marginTop: 16 }}>
          <span className="badge">{t('picker.recommended')}</span>
          <span className="badge">{t('cpStatus.proposed')}</span>
          <span className="badge ok">{t('director.run.idle')}</span>
          <span className="badge warn">{t('monitor.mediaMissingFile')}</span>
          <span className="badge danger">{t('common.error')}</span>
          <span className="badge solid">1</span>
          <Kbd keys={['mod', 'Enter']} />
          <Kbd keys={['mod', '1']} />
          <Kbd keys={['alt', 'Enter']} />
          <span className="spin" aria-hidden="true" />
          <span className="live" aria-hidden="true" />
          <Tooltip label={t('layout.hideAssets')} keys={['mod', '1']}>
            <button type="button" className="btn ghost">
              {t('story.tooltip')}
            </button>
          </Tooltip>
          <span className="chip chip-asset">
            <Icon name="image" size={12} /> {t('assetKind.image')}
          </span>
        </div>
      </Section>

      <Section title={t('monitor.label')}>
        <div className="story-monitor always-dark">
          <div className="seg" role="group" aria-label={t('monitor.format')}>
            <button type="button" aria-pressed>
              16:9
            </button>
            <button type="button" aria-pressed={false}>
              9:16
            </button>
          </div>
          <button type="button" className="ibtn" aria-label={t('monitor.safeArea')}>
            <Icon name="safeArea" size={16} />
          </button>
          <button type="button" className="ibtn" aria-label={t('monitor.label')} data-force="focus">
            <Icon name="fullscreen" size={16} />
          </button>
          <span className="monitor-clock">00:00:28:12</span>
        </div>
      </Section>
    </main>
  );
}
