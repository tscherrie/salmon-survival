import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DIRECTOR_EFFORTS,
  MODALITIES,
  exampleCost,
  formatPrice,
  modelMatchesModality,
  selectionFor,
  type DirectorEffort,
  type Modality,
  type ModelInfo,
  type PickerSelection,
} from '@studio/core';
import { modalityLabel, useT } from '../../i18n.ts';
import { useActions, useStudio } from '../../state/context.tsx';
import { Icon, MODALITY_ICONS } from '../common/Icon.tsx';
import { Popover } from '../common/Popover.tsx';

/** Fähigkeits-Badges eines Modells (aus dem Eingabeschema abgeleitet). */
export function capabilityBadges(model: ModelInfo, t: ReturnType<typeof useT>): string[] {
  const c = model.capabilities;
  const out: string[] = [];
  if (c.audioInput) out.push(t('cap.audioInput'));
  if (c.multiImageInput) out.push(t('cap.multiImageInput'));
  else if (c.imageInput) out.push(t('cap.imageInput'));
  if (c.videoInput) out.push(t('cap.videoInput'));
  if (c.maxDurationSec) out.push(t('cap.maxDuration', { sec: c.maxDurationSec }));
  if (c.nativeAudio) out.push(t('cap.nativeAudio'));
  const best = c.resolutions?.[c.resolutions.length - 1];
  if (best) out.push(best);
  if (c.wordTimestamps) out.push(t('cap.wordTimestamps'));
  if (c.toolUse) out.push(t('cap.toolUse'));
  if (c.vision) out.push(t('cap.vision'));
  return out;
}

function shortPrice(model: ModelInfo | undefined): string {
  return model?.price ? formatPrice(model.price) : '';
}

function ModelPicker({
  modality,
  models,
  selection,
  onSelect,
  align,
}: {
  modality: Modality;
  models: ModelInfo[];
  selection: PickerSelection;
  onSelect: (s: PickerSelection) => void;
  align: 'start' | 'end';
}) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = selection.mode === 'model' ? models.find((m) => m.id === selection.modelId) : undefined;
  const currentName = selection.mode === 'auto' ? t('picker.auto') : (current?.displayName ?? selection.modelId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = models.filter((m) => !q || [m.displayName, m.vendor ?? '', m.id, m.description].join(' ').toLowerCase().includes(q));
    return list.sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || Number(a.status === 'deprecated') - Number(b.status === 'deprecated'));
  }, [models, query]);
  // Einträge: 0 = Auto, danach Modelle
  const options: Array<{ kind: 'auto' } | { kind: 'model'; model: ModelInfo }> = [{ kind: 'auto' }, ...filtered.map((model) => ({ kind: 'model' as const, model }))];

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onSelect(option.kind === 'auto' ? { mode: 'auto' } : { mode: 'model', modelId: option.model.id });
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  };

  const isSelected = (option: (typeof options)[number]) =>
    option.kind === 'auto' ? selection.mode === 'auto' : selection.mode === 'model' && selection.modelId === option.model.id;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top"
      align={align}
      label={modalityLabel(modality)}
      className="picker-popover"
      anchor={
        <button
          type="button"
          className={`picker-trigger${selection.mode === 'model' ? ' is-bound' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('picker.choose', { modality: modalityLabel(modality), selection: `${currentName}${current?.price ? `, ${shortPrice(current)}` : ''}` })}
          onClick={() => setOpen((v) => !v)}
          data-modality={modality}
        >
          <Icon name={MODALITY_ICONS[modality]} size={14} />
          <span className="picker-modality">{modalityLabel(modality)}</span>
          <span className="picker-current">{currentName}</span>
          {current?.price && <span className="picker-price">{shortPrice(current)}</span>}
          {current?.status === 'deprecated' && <Icon name="warning" size={12} className="warn" title={t('picker.deprecated')} />}
          <Icon name="chevronDown" size={12} />
        </button>
      }
    >
      <div className="picker-search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t('picker.search')}
          aria-label={t('picker.search')}
          aria-controls={listId}
          aria-activedescendant={`${listId}-${active}`}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul className="picker-list" role="listbox" id={listId} aria-label={modalityLabel(modality)}>
        {options.map((option, index) => {
          const selected = isSelected(option);
          if (option.kind === 'auto') {
            return (
              <li
                key="auto"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                className={`picker-option${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <div className="picker-option-head">
                  <span className="picker-option-name">{t('picker.auto')}</span>
                  {selected && <Icon name="check" size={14} />}
                </div>
                <p className="picker-option-desc">{t('picker.autoDescription')}</p>
              </li>
            );
          }
          const m = option.model;
          const example = exampleCost(m);
          return (
            <li
              key={m.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={selected}
              className={`picker-option${index === active ? ' is-active' : ''}${m.status === 'deprecated' ? ' is-deprecated' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <div className="picker-option-head">
                {m.recommended && <Icon name="star" size={12} className="star" title={t('picker.recommended')} />}
                <span className="picker-option-name">{m.displayName}</span>
                {m.vendor && <span className="picker-option-vendor">{m.vendor}</span>}
                {m.status === 'beta' && <span className="badge">{t('picker.beta')}</span>}
                <span className="spacer" />
                <span className="picker-option-price">{formatPrice(m.price)}</span>
                {selected && <Icon name="check" size={14} />}
              </div>
              <p className="picker-option-desc">{m.description}</p>
              <div className="picker-option-foot">
                {capabilityBadges(m, t).map((b) => (
                  <span key={b} className="badge badge-cap">
                    {b}
                  </span>
                ))}
                <span className="spacer" />
                {example && <span className="picker-example">{example}</span>}
              </div>
              {m.status === 'deprecated' && (
                <p className="picker-warning">
                  <Icon name="warning" size={12} /> {t('picker.deprecated')}
                </p>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && <li className="picker-empty">{t('picker.noModels')}</li>}
      </ul>
    </Popover>
  );
}

/** Modell-Picker je Modalität (über dem Composer) + Denktiefe für den Director. */
export function ModelPickerBar() {
  const t = useT();
  const actions = useActions();
  const models = useStudio((s) => s.models);
  const pickers = useStudio((s) => s.manifest?.pickers);
  const effort = useStudio((s) => s.manifest?.director.effort ?? 'xhigh');

  useEffect(() => {
    if (!models) void actions.loadModels();
  }, [models, actions]);

  const byModality = useMemo(() => {
    const map = new Map<Modality, ModelInfo[]>();
    for (const modality of MODALITIES) map.set(modality, (models ?? []).filter((m) => modelMatchesModality(m, modality)));
    return map;
  }, [models]);

  return (
    <section className="picker-bar" aria-label={t('picker.label')}>
      {MODALITIES.map((modality, index) => (
        <div key={modality} className="picker-slot">
          <ModelPicker
            modality={modality}
            align={index >= 5 ? 'end' : 'start'}
            models={byModality.get(modality) ?? []}
            selection={selectionFor(pickers ?? {}, modality)}
            onSelect={(selection) => void actions.setPicker(modality, selection)}
          />
          {modality === 'director' && (
            <label className="effort-select">
              <span className="sr-only">{t('effort.label')}</span>
              <select value={effort} onChange={(e) => void actions.setEffort(e.target.value as DirectorEffort)} aria-label={t('effort.label')} title={t('effort.label')}>
                {DIRECTOR_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {t(`effort.${e}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ))}
      <button type="button" className="icon-button picker-refresh" onClick={() => void actions.refreshModels()} aria-label={t('picker.refresh')} title={t('picker.refresh')}>
        <Icon name="refresh" />
      </button>
    </section>
  );
}
