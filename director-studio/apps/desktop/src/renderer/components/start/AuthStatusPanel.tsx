import { useT } from '../../i18n.ts';
import { useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';

/** Anmeldestatus: aktive Director-Laufzeit, verfügbare Alternativen, fal-Zugang. */
export function AuthStatusPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const auth = useStudio((s) => s.authStatus);
  if (!auth) return <p className="muted">{t('common.loading')}</p>;
  return (
    <div className={`auth-status${compact ? ' is-compact' : ''}`} data-testid="auth-status">
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
      {!compact && (
        <ul className="auth-runtimes">
          {auth.runtimes.map((r) => (
            <li key={r.id} className={r.available ? 'is-available' : 'is-unavailable'}>
              <span className="auth-runtime-name">{t(`runtime.${r.id}`)}</span>
              <span className="auth-runtime-state">{r.available ? t('settings.available') : t('settings.unavailable')}</span>
              <span className="auth-runtime-detail">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
