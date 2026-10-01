import { useT } from '../../i18n.ts';
import { nextThemeMode, useThemeMode } from '../../lib/theme.ts';
import { Icon } from './Icon.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Schaltet Dunkel → Hell → System (live, gespeichert). */
export function ThemeToggle() {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const label = `${t('theme.label')}: ${t(`theme.${mode}`)}`;
  return (
    <Tooltip label={label} placement="bottom">
      <button type="button" className="ibtn" onClick={() => setMode(nextThemeMode(mode))} aria-label={label}>
        <Icon name={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'monitor'} />
      </button>
    </Tooltip>
  );
}
