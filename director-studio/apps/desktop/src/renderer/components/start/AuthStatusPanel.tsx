import type { AuthStatus } from '@studio/core';
import { useT } from '../../i18n.ts';
import { useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';

/**
 * Anmeldestatus: aktive Director-Laufzeit, Anthropic-Zugang (API-Key bzw. Login-Profil), Alternativen, fal-Zugang.
 * Kompakt (Startbildschirm, §7.12): zwei ruhige Zeilen mit Statuspunkt links und – wo etwas fehlt – der Aktion rechts.
 */
export function AuthStatusPanel({ compact = false, onSetup }: { compact?: boolean; onSetup?: () => void }) {
  const t = useT();
  const auth = useStudio((s) => s.authStatus);
  if (!auth) return <p className="muted">{t('common.loading')}</p>;
  // Ältere Backends ohne `anthropic`-Feld: Zeilen weglassen statt abzustürzen.
  const anthropic = auth.anthropic as AuthStatus['anthropic'] | undefined;
  if (compact) {
    return (
      <div className="auth-status is-compact" data-testid="auth-status">
        <div className={`auth-row${auth.active ? '' : ' is-missing'}`}>
          <span className="auth-dot" aria-hidden="true" />
          <span className="auth-row-text">
            {t('settings.activeRuntime')}: <strong>{auth.active ? t(`runtime.${auth.active}`) : t('settings.noRuntime')}</strong>
          </span>
          {!auth.active && onSetup && (
            <button type="button" className="btn ghost sm" onClick={onSetup}>
              {t('start.directorSetup')}
            </button>
          )}
        </div>
        <div className={`auth-row${auth.falConfigured ? '' : ' is-missing'}`}>
          <span className="auth-dot" aria-hidden="true" />
          <span className="auth-row-text">
            {t('settings.falStatus')}: <strong>{auth.falConfigured ? t('settings.configured') : t('settings.notConfigured')}</strong>
          </span>
          {!auth.falConfigured && onSetup && (
            <button type="button" className="btn ghost sm" onClick={onSetup}>
              {t('start.keySetup')}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="auth-status" data-testid="auth-status">
      <div className={`auth-active${auth.active ? '' : ' is-missing'}`}>
        <Icon name={auth.active ? 'check' : 'warning'} size={14} />
        <span>
          {t('settings.activeRuntime')}: <strong>{auth.active ? t(`runtime.${auth.active}`) : t('settings.noRuntime')}</strong>
        </span>
      </div>
      <div className={`auth-active${auth.falConfigured ? '' : ' is-missing'}`}>
        <Icon name={auth.falConfigured ? 'check' : 'warning'} size={14} />
        <span>
          {t('settings.falStatus')}: <strong>{auth.falConfigured ? t('settings.configured') : t('settings.notConfigured')}</strong>
        </span>
      </div>
      {anthropic && (
        <ul className="auth-anthropic" aria-label={t('runtime.anthropic')}>
          <li className={anthropic.apiKey ? 'is-available' : 'is-unavailable'} data-testid="auth-anthropic-key">
            <Icon name={anthropic.apiKey ? 'check' : 'dot'} size={12} />
            <span>
              {t('settings.anthropicKeyStatus')}: <strong>{anthropic.apiKey ? t('settings.stored') : t('settings.notStored')}</strong>
            </span>
          </li>
          <li className={anthropic.oauthProfile ? 'is-available' : 'is-unavailable'} data-testid="auth-anthropic-login">
            <Icon name={anthropic.oauthProfile ? 'check' : 'dot'} size={12} />
            <span>
              {t('settings.anthropicLogin')}: <strong>{anthropic.oauthProfile ? t('settings.found') : t('settings.notFound')}</strong>
            </span>
          </li>
          {!anthropic.apiKey && !anthropic.oauthProfile && <li className="auth-anthropic-hint">{t('settings.anthropicLoginHint')}</li>}
        </ul>
      )}
      <ul className="auth-runtimes">
        {auth.runtimes.map((r) => (
          <li key={r.id} className={r.available ? 'is-available' : 'is-unavailable'}>
            <span className="auth-runtime-name">{t(`runtime.${r.id}`)}</span>
            <span className="auth-runtime-state">{r.available ? t('settings.available') : t('settings.unavailable')}</span>
            <span className="auth-runtime-detail">{r.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
