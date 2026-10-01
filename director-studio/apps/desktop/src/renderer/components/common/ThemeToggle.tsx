import { useT } from '../../i18n.ts';
import { nextThemeMode, useThemeMode } from '../../lib/theme.ts';
import { Icon } from './Icon.tsx';

export function ThemeToggle() {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const label = `${t('theme.label')}: ${t(`theme.${mode}`)}`;
  return (
    <button type="button" className="icon-button" onClick={() => setMode(nextThemeMode(mode))} aria-label={label} title={label}>
      <Icon name={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'monitor'} />
    </button>
  );
}
