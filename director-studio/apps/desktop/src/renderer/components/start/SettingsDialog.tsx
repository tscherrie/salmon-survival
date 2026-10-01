import { useEffect, useId, useState } from 'react';
import { DIRECTOR_EFFORTS, type AppSettings, type AuthStatus, type DirectorEffort, type DirectorRuntimeId } from '@studio/core';
import { useT, type Language } from '../../i18n.ts';
import { useContrastMode, useThemeMode } from '../../lib/theme.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import { Dialog } from '../common/Dialog.tsx';
import { Kbd } from '../common/Kbd.tsx';
import { setShortcutsOpen } from '../common/ShortcutsDialog.tsx';
import { setTechDetails, useTechDetails } from '../director/techDetails.ts';
import { AuthStatusPanel } from './AuthStatusPanel.tsx';

const RUNTIMES: Array<DirectorRuntimeId | 'auto'> = ['auto', 'anthropic', 'agent-sdk', 'fal'];

/** Eingabe für einen Schlüssel: wird nie vorbefüllt und nach dem Speichern sofort geleert. */
function SecretField({ name, label, configured }: { name: 'anthropic' | 'fal'; label: string; configured: boolean | null }) {
  const t = useT();
  const actions = useActions();
  const id = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    const secret = value.trim();
    setValue('');
    await actions.setSecret(name, secret);
    setBusy(false);
  };
  return (
    <div className="secret-field">
      <label htmlFor={id}>
        {label}
        {configured !== null && <span className={`status-chip ${configured ? 'status-used' : 'status-unused'}`}>{configured ? t('settings.configured') : t('settings.notConfigured')}</span>}
      </label>
      <div className="secret-row">
        <input
          id={id}
          type="password"
          className="field"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t('settings.keyPlaceholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
        <button type="button" className="btn" onClick={() => void save()} disabled={!value.trim() || busy}>
          {t('settings.keySave')}
        </button>
        <button type="button" className="btn ghost" onClick={() => void actions.setSecret(name, null)} disabled={busy}>
          {t('settings.keyRemove')}
        </button>
      </div>
    </div>
  );
}

/** Segment-Auswahl (Theme, Kontrast): wirkt sofort und wird gespeichert, unabhängig von „Speichern“. */
function Segment<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: ReadonlyArray<{ id: V; label: string }>; onChange: (v: V) => void }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Schalter-Zeile: Beschriftung links, Schalter rechts (an = --text, nie Tungsten); optional ein Hinweis darunter. */
function SwitchRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <>
      <div className="settings-row">
        <label htmlFor={id} className="settings-row-label">
          {label}
        </label>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="settings-hint">
          {hint}
        </p>
      )}
    </>
  );
}

/**
 * Gruppe „Darstellung“ (DESIGN.md §7.13): Theme, erhöhter Kontrast, technische Details im Verlauf und das Zurücksetzen
 * der einmaligen Hinweise (§8.6). Alles wirkt sofort.
 */
function AppearanceSection() {
  const t = useT();
  const actions = useActions();
  const [theme, setTheme] = useThemeMode();
  const [contrast, setContrast] = useContrastMode();
  const tech = useTechDetails();
  return (
    <section className="settings-section">
      <h3>{t('theme.label')}</h3>
      <Segment
        label={t('settings.theme')}
        value={theme}
        options={(['dark', 'light', 'system'] as const).map((id) => ({ id, label: t(`theme.${id}`) }))}
        onChange={setTheme}
      />
      <Segment
        label={t('settings.contrast')}
        value={contrast}
        options={(['system', 'more', 'normal'] as const).map((id) => ({ id, label: t(`contrast.${id}`) }))}
        onChange={setContrast}
      />
      <SwitchRow label={t('settings.techDetails')} checked={tech} onChange={setTechDetails} />
      <div className="settings-row">
        <p className="settings-row-text">{t('settings.resetHintsText')}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            actions.resetCoach();
            actions.announce(t('settings.hintsReset'));
            actions.toast('success', t('settings.hintsReset'));
          }}
        >
          {t('settings.resetHints')}
        </button>
      </div>
    </section>
  );
}

/**
 * Einstellungen (DESIGN.md §7.13), 560 px: Anmeldung (Status, Schlüssel, Laufzeit), Darstellung (wirkt sofort) und
 * Allgemein (Sprache, Denktiefe, Tastenkürzel). Sprache, Denktiefe und Laufzeit gelten erst mit „Speichern“.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const actions = useActions();
  const settings = useStudio((s) => s.settings);
  const auth = useStudio((s) => s.authStatus);
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const languageId = useId();
  const effortId = useId();

  useEffect(() => {
    void actions.loadAuthStatus();
  }, [actions]);
  useEffect(() => {
    if (!draft && settings) setDraft(settings);
  }, [settings, draft]);

  const save = async () => {
    if (!draft) return;
    await actions.updateSettings({
      language: draft.language,
      defaultEffort: draft.defaultEffort,
      preferredRuntime: draft.preferredRuntime,
      allowClaudeSubscription: draft.allowClaudeSubscription,
    });
    actions.toast('success', t('settings.saved'));
    onClose();
  };

  // Status des Schlüsselfelds: nur der hinterlegte API-Key zählt (ein Login-Profil zeigt das Anmeldepanel).
  const anthropicKeyStored = auth ? ((auth.anthropic as AuthStatus['anthropic'] | undefined)?.apiKey ?? false) : null;

  return (
    <Dialog
      title={t('settings.title')}
      onClose={onClose}
      width={560}
      className="settings-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!draft}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <section className="settings-section">
        <h3>{t('settings.auth')}</h3>
        <AuthStatusPanel />
      </section>
      <section className="settings-section">
        <h3>{t('settings.keys')}</h3>
        <p className="settings-hint">{t('settings.keysHint')}</p>
        <SecretField name="anthropic" label={t('settings.anthropicKey')} configured={anthropicKeyStored} />
        <SecretField name="fal" label={t('settings.falKey')} configured={auth ? auth.falConfigured : null} />
      </section>
      {draft && (
        <section className="settings-section">
          <h3>{t('settings.runtime')}</h3>
          <div className="options settings-options" role="radiogroup" aria-label={t('settings.runtime')}>
            {RUNTIMES.map((id) => {
              const checked = draft.preferredRuntime === id;
              return (
                <label key={id} className={`option${checked ? ' is-checked' : ''}`}>
                  <span className="opt-mark opt-radio">
                    <input type="radio" name="runtime" checked={checked} onChange={() => setDraft({ ...draft, preferredRuntime: id })} />
                  </span>
                  <span className="option-label">{t(`settings.runtime.${id}`)}</span>
                </label>
              );
            })}
          </div>
          <SwitchRow
            label={t('settings.subscription')}
            checked={draft.allowClaudeSubscription}
            onChange={(on) => setDraft({ ...draft, allowClaudeSubscription: on })}
            hint={t('settings.subscriptionHint')}
          />
        </section>
      )}
      <AppearanceSection />
      <section className="settings-section">
        <h3>{t('settings.general')}</h3>
        {draft && (
          <>
            <div className="settings-row">
              <label htmlFor={languageId} className="settings-row-label">
                {t('settings.language')}
              </label>
              <select id={languageId} className="field" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value as Language })}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor={effortId} className="settings-row-label">
                {t('settings.effort')}
              </label>
              <select id={effortId} className="field" value={draft.defaultEffort} onChange={(e) => setDraft({ ...draft, defaultEffort: e.target.value as DirectorEffort })}>
                {DIRECTOR_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {t(`effort.${e}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="settings-row">
          <span className="settings-row-text">
            <span className="settings-row-label">{t('settings.shortcuts')}</span>
            <span className="settings-hint">
              {t('settings.shortcutsText')} <Kbd keys={['?']} />
            </span>
          </span>
          <button type="button" className="btn" onClick={() => setShortcutsOpen(true)}>
            {t('settings.shortcutsShow')}
          </button>
        </div>
      </section>
    </Dialog>
  );
}
