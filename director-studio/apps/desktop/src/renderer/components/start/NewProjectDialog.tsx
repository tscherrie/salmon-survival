import { useId, useState } from 'react';
import { STANDARD_FORMATS, type ProjectCategory } from '@studio/core';
import { useT } from '../../i18n.ts';
import { useActions, useApi, useStudio } from '../../state/context.tsx';
import { Dialog } from '../common/Dialog.tsx';
import { Icon } from '../common/Icon.tsx';

const CATEGORIES: Array<ProjectCategory | 'open'> = ['video', 'audio', 'slides', 'graphic', 'web', 'open'];
const FORMAT_IDS = ['16:9', '9:16', '1:1', '4:5'] as const;

/** Neues Projekt; aus „Neu aus Kategorie“ ist die Kategorie schon gewählt (`initialCategory`). */
export function NewProjectDialog({ onClose, initialCategory = 'video' }: { onClose: () => void; initialCategory?: ProjectCategory }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const settings = useStudio((s) => s.settings);
  const titleId = useId();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ProjectCategory | 'open'>(initialCategory);
  const [formats, setFormats] = useState<string[]>(['16:9']);
  const [directory, setDirectory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatsRelevant = category === 'video' || category === 'graphic' || category === 'open';

  const create = async () => {
    if (!title.trim()) {
      setError(t('newProject.nameRequired'));
      return;
    }
    setBusy(true);
    const ok = await actions.createProject({
      title: title.trim(),
      category: category === 'open' ? null : category,
      ...(directory ? { directory } : {}),
      ...(formatsRelevant ? { formats: formats.map((id) => STANDARD_FORMATS[id]!).filter(Boolean) } : {}),
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      title={t('newProject.title')}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void create()} disabled={busy}>
            {busy ? t('newProject.creating') : t('newProject.create')}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor={titleId} className="field-label">
          {t('newProject.name')}
        </label>
        <input
          id={titleId}
          className="field"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          placeholder={t('newProject.namePlaceholder')}
          aria-invalid={!!error}
          aria-describedby={error ? `${titleId}-err` : undefined}
          data-autofocus
        />
        {error && (
          <p id={`${titleId}-err`} className="field-error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="category-grid">
          <legend className="field-label">{t('newProject.category')}</legend>
          {CATEGORIES.map((c) => (
            <label key={c} className={`category-option${category === c ? ' is-checked' : ''}${c === 'open' ? ' is-open' : ''}`}>
              <input type="radio" name="category" checked={category === c} onChange={() => setCategory(c)} />
              <span>{c === 'open' ? t('category.open') : t(`category.${c}`)}</span>
            </label>
          ))}
        </fieldset>
        {formatsRelevant && (
          <fieldset className="format-row">
            <legend className="field-label">{t('newProject.formats')}</legend>
            {FORMAT_IDS.map((id) => (
              <label key={id} className={`format-option${formats.includes(id) ? ' is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={formats.includes(id)}
                  onChange={() => setFormats((f) => (f.includes(id) ? (f.length > 1 ? f.filter((x) => x !== id) : f) : [...f, id]))}
                />
                <span className="format-swatch" style={{ aspectRatio: id.replace(':', '/') }} aria-hidden="true" />
                <span>{id}</span>
              </label>
            ))}
            <p className="hint">{t('newProject.formatsHint')}</p>
          </fieldset>
        )}
        <div className="folder-row">
          <span className="field-label">{t('newProject.folder')}</span>
          <code className="folder-path">{directory ?? settings?.projectsDir ?? t('newProject.defaultFolder')}</code>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              const dir = await api.chooseDirectory();
              if (dir) setDirectory(dir);
            }}
          >
            <Icon name="folder" size={13} /> {t('newProject.chooseFolder')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
