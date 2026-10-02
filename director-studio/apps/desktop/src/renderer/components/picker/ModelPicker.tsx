import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useElementSize } from '../../lib/hooks.ts';
import { useActions, useApiMode, useStudio } from '../../state/context.tsx';
import { Icon, MODALITY_ICONS } from '../common/Icon.tsx';
import { isMacPlatform } from '../common/Kbd.tsx';
import { Popover } from '../common/Popover.tsx';
import { Tooltip } from '../common/Tooltip.tsx';

/**
 * Modellwahl (DESIGN.md §7.8): eine leise Zusammenfassung in der Composer-Werkzeugleiste und ein Popover mit zwei
 * Ebenen an derselben Stelle (höchstens 400 px breit). Ebene 1 listet die neun Modalitäten mit Auswahl und Preis,
 * Ebene 2 ersetzt sie durch die Modelle einer Modalität. Nach der Wahl geht es zurück auf Ebene 1; das Popover
 * bleibt offen, bis Esc oder ein Klick daneben es schließt.
 */

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

/** Ereignis, mit dem andere Bereiche die Modellwahl öffnen (z. B. „Anderes Modell …“ an der Fehlerkarte). */
export const OPEN_MODELS_EVENT = 'studio:open-models';

/** Öffnet das Modell-Popover; mit `modality` direkt auf Ebene 2 dieser Modalität. */
export function openModelPicker(modality?: Modality): void {
  window.dispatchEvent(new CustomEvent<{ modality: Modality | null }>(OPEN_MODELS_EVENT, { detail: { modality: modality ?? null } }));
}

/** Kurzname für die Zusammenfassung: „Claude Opus 5.5“ → „Opus 5.5“, sonst der Anzeigename. */
function shortModelName(model: ModelInfo | undefined, modelId: string): string {
  if (!model) return modelId.split('/').filter(Boolean).at(-1) ?? modelId;
  return model.displayName.replace(/^Claude\s+/, '');
}

interface CatalogEntry {
  modality: Modality;
  selection: PickerSelection;
  models: ModelInfo[];
  /** Gewähltes Modell (nur bei gebundener Auswahl und bekanntem Katalog). */
  current: ModelInfo | undefined;
  /** Anzeigename der Auswahl („Auto“ oder Modellname). */
  name: string;
  price: string;
}

/** Katalog je Modalität mit der Auswahl des Projekts; lädt die Modelle beim ersten Bedarf. */
function useCatalog(): { entries: CatalogEntry[]; effort: DirectorEffort } {
  const t = useT();
  const actions = useActions();
  const models = useStudio((s) => s.models);
  const mode = useApiMode();
  const pickers = useStudio((s) => s.manifest?.pickers);
  const effort = useStudio((s) => s.manifest?.director.effort ?? 'xhigh');

  useEffect(() => {
    if (!models) void actions.loadModels();
  }, [models, actions]);

  const entries = useMemo(
    () =>
      MODALITIES.filter((modality) => mode !== 'native' || modality !== 'director').map((modality): CatalogEntry => {
        const list = (models ?? []).filter((m) => modelMatchesModality(m, modality));
        const selection = selectionFor(pickers ?? {}, modality);
        const current = selection.mode === 'model' ? list.find((m) => m.id === selection.modelId) : undefined;
        const name = selection.mode === 'auto' ? t('picker.auto') : (current?.displayName ?? selection.modelId);
        return { modality, selection, models: list, current, name, price: current?.price ? formatPrice(current.price) : '' };
      }),
    [models, pickers, t, mode],
  );
  return { entries, effort };
}

// ───────────────────────── Ebene 2: Modelle einer Modalität ─────────────────────────

type Option = { kind: 'auto' } | { kind: 'model'; model: ModelInfo };

function ModelList({ entry, onSelect, onBack }: { entry: CatalogEntry; onSelect: (selection: PickerSelection) => void; onBack: () => void }) {
  const t = useT();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { modality, selection, models } = entry;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = models.filter((m) => !q || [m.displayName, m.vendor ?? '', m.id, m.description].join(' ').toLowerCase().includes(q));
    return list.sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || Number(a.status === 'deprecated') - Number(b.status === 'deprecated'));
  }, [models, query]);
  // Einträge: 0 = Auto, danach die Modelle
  const options: Option[] = [{ kind: 'auto' }, ...filtered.map((model) => ({ kind: 'model' as const, model }))];

  // Die Suche ist fokussiert, sobald die Ebene erscheint
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Aktive Option im sichtbaren Bereich halten
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onSelect(option.kind === 'auto' ? { mode: 'auto' } : { mode: 'model', modelId: option.model.id });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'ArrowLeft') {
      // ← geht zurück, solange der Cursor am Anfang der Suche steht
      const input = event.currentTarget;
      if (input.selectionStart === 0 && input.selectionEnd === 0) {
        event.preventDefault();
        onBack();
      }
    }
  };

  const isSelected = (option: Option) =>
    option.kind === 'auto' ? selection.mode === 'auto' : selection.mode === 'model' && selection.modelId === option.model.id;

  return (
    <>
      <div className="mp-head mp-head-detail">
        <button type="button" className="mp-back" onClick={onBack} aria-label={`${t('picker.back')}: ${modalityLabel(modality)}`}>
          <Icon name="chevronLeft" size={14} />
          <span>{modalityLabel(modality)}</span>
        </button>
        <label className="mp-search">
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
          <span className="mp-count" aria-hidden="true" title={t('picker.count', { count: filtered.length })}>
            {filtered.length}
          </span>
        </label>
      </div>
      <ul ref={listRef} className="mp-list" role="listbox" id={listId} aria-label={modalityLabel(modality)}>
        {options.map((option, index) => {
          const selected = isSelected(option);
          const common = {
            id: `${listId}-${index}`,
            role: 'option',
            'aria-selected': selected,
            'data-index': index,
            onMouseEnter: () => setActive(index),
            onClick: () => choose(index),
          } as const;
          if (option.kind === 'auto') {
            return (
              <li key="auto" {...common} className={`mp-option${index === active ? ' is-active' : ''}`}>
                <div className="mp-option-head">
                  <span className="mp-option-name">{t('picker.auto')}</span>
                  <span className="spacer" />
                  {selected && <Icon name="check" size={14} className="mp-check" />}
                </div>
                <p className="mp-option-desc">{t('picker.autoDescription')}</p>
              </li>
            );
          }
          const m = option.model;
          const example = exampleCost(m);
          const badges = capabilityBadges(m, t);
          return (
            <li key={m.id} {...common} className={`mp-option${index === active ? ' is-active' : ''}${m.status === 'deprecated' ? ' is-deprecated' : ''}`}>
              <div className="mp-option-head">
                <span className="mp-option-name">{m.displayName}</span>
                {m.vendor && <span className="mp-option-vendor">{m.vendor}</span>}
                {m.recommended && <span className="badge">{t('picker.recommended')}</span>}
                {m.status === 'beta' && <span className="badge">{t('picker.beta')}</span>}
                <span className="spacer" />
                <span className="mp-option-price">{formatPrice(m.price)}</span>
                {selected && <Icon name="check" size={14} className="mp-check" />}
              </div>
              <p className="mp-option-desc">{m.description}</p>
              {(badges.length > 0 || example) && (
                <div className="mp-option-foot">
                  {badges.map((b) => (
                    <span key={b} className="badge badge-cap">
                      {b}
                    </span>
                  ))}
                  <span className="spacer" />
                  {example && <span className="mp-example">{example}</span>}
                </div>
              )}
              {m.status === 'deprecated' && (
                <p className="mp-warning">
                  <Icon name="warning" size={12} /> {t('picker.deprecated')}
                </p>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && <li className="mp-empty">{t('picker.noModels')}</li>}
      </ul>
    </>
  );
}

// ───────────────────────── Ebene 1 + 2: Inhalt des Popovers ─────────────────────────

/**
 * Inhalt des Popovers (auch einzeln renderbar, z. B. in Tests). Startet auf Ebene 1 bzw. direkt auf Ebene 2 von
 * `initialModality`. `autoFocus` setzt den Fokus beim Öffnen auf die erste Zeile.
 */
export function ModelPickerPanel({
  initialModality = null,
  autoFocus = false,
  maxHeight,
}: {
  initialModality?: Modality | null;
  autoFocus?: boolean;
  /** Höchsthöhe in px (Platz über dem Auslöser); ohne Angabe gilt nur die CSS-Grenze. */
  maxHeight?: number;
}) {
  const t = useT();
  const actions = useActions();
  const { entries, effort } = useCatalog();
  const [level, setLevel] = useState<Modality | null>(initialModality);
  // Richtung der Überblendung und die Zeile, die nach dem Zurückgehen den Fokus bekommt
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const returnTo = useRef<Modality | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const rowButton = (modality: Modality) => rowsRef.current?.querySelector<HTMLButtonElement>(`[data-modality="${modality}"]`) ?? null;

  useLayoutEffect(() => {
    if (level !== null) return;
    if (returnTo.current) {
      rowButton(returnTo.current)?.focus();
      returnTo.current = null;
    } else if (autoFocus) {
      rowsRef.current?.querySelector<HTMLButtonElement>('.mp-row-btn')?.focus();
    }
  }, [level, autoFocus]);

  const open = (modality: Modality) => {
    setDirection('forward');
    setLevel(modality);
  };
  const back = () => {
    returnTo.current = level;
    setDirection('back');
    setLevel(null);
  };

  const onRowsKeyDown = (event: React.KeyboardEvent) => {
    const buttons = Array.from(rowsRef.current?.querySelectorAll<HTMLButtonElement>('.mp-row-btn') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const modality = buttons[index]?.dataset.modality as Modality | undefined;
      if (modality) open(modality);
    }
  };

  const entry = level ? entries.find((e) => e.modality === level) : undefined;

  return (
    <div
      className="mp-panel"
      style={maxHeight ? { maxHeight } : undefined}
      onKeyDown={(event) => {
        // Esc auf Ebene 2 geht zurück, statt das Popover zu schließen
        if (event.key === 'Escape' && level !== null) {
          event.preventDefault();
          event.stopPropagation();
          back();
        }
      }}
    >
      {entry ? (
        <div key={`level-${entry.modality}`} className="mp-level is-detail is-forward">
          <ModelList
            entry={entry}
            onBack={back}
            onSelect={(selection) => {
              void actions.setPicker(entry.modality, selection);
              back();
            }}
          />
        </div>
      ) : (
        <div key="level-root" className={`mp-level is-root${direction === 'back' ? ' is-back' : ''}`}>
          <div className="mp-head">
            <span className="mp-title">{t('picker.heading')}</span>
            <Tooltip label={t('picker.refresh')}>
              <button type="button" className="ibtn sm" onClick={() => void actions.refreshModels()} aria-label={t('picker.refresh')}>
                <Icon name="refresh" size={14} />
              </button>
            </Tooltip>
          </div>
          <div className="mp-rows" ref={rowsRef} onKeyDown={onRowsKeyDown}>
            {entries.map((e) => {
              const bound = e.selection.mode === 'model';
              const selectionText = `${e.name}${e.price ? `, ${e.price}` : ''}`;
              return (
                <div key={e.modality} className={`mp-row${bound ? ' is-bound' : ''}${e.modality === 'director' ? ' has-effort' : ''}`}>
                  <button
                    type="button"
                    className="mp-row-btn"
                    data-modality={e.modality}
                    aria-label={t('picker.choose', { modality: modalityLabel(e.modality), selection: selectionText })}
                    onClick={() => open(e.modality)}
                  >
                    <Icon name={MODALITY_ICONS[e.modality]} size={14} className="mp-row-icon" />
                    <span className="mp-mod">{modalityLabel(e.modality)}</span>
                    <span className="mp-sel">{e.name}</span>
                    {e.modality !== 'director' && e.price && <span className="mp-price">{e.price}</span>}
                    {e.current?.status === 'deprecated' && <Icon name="warning" size={12} className="mp-warn" title={t('picker.deprecated')} />}
                    {e.modality === 'director' && <span className="mp-effort-space" aria-hidden="true" />}
                    <Icon name="chevronRight" size={12} className="mp-chev" />
                  </button>
                  {e.modality === 'director' && (
                    <span className="mp-effort-wrap">
                      <select
                        className="mp-effort"
                        value={effort}
                        onChange={(ev) => void actions.setEffort(ev.target.value as DirectorEffort)}
                        aria-label={t('effort.label')}
                      >
                        {DIRECTOR_EFFORTS.map((value) => (
                          <option key={value} value={value}>
                            {t(`effort.option.${value}`)}
                          </option>
                        ))}
                      </select>
                      <Icon name="chevronDown" size={12} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mp-foot">
            <Icon name="info" size={14} />
            <span>{t('picker.footnote')}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Zusammenfassung in der Composer-Werkzeugleiste ─────────────────────────

/**
 * Platz, den die Zusammenfassung höchstens einnimmt: Sie ist leise und soll die Leiste nicht füllen. Bei vielen
 * gebundenen Modellen (oder wenig Platz) wird daraus „Modelle · 5 gebunden“.
 */
const SUMMARY_BUDGET = 480;

/** Mindestabstand zwischen Popover und Kopfzeile (bzw. oberem Fensterrand). */
const POPOVER_EDGE = 8;

/**
 * Leiser Ghost-Knopf mit der verbindlichen Auswahl: „Opus 5.5 · sehr hoch | h3-max | +7 Auto“. Reicht der Platz
 * nicht, wird daraus „Modelle · 2 gebunden“. Öffnet das Popover (auch mit mod+M) rechtsbündig nach oben.
 */
export function ModelPicker() {
  const t = useT();
  const { entries, effort } = useCatalog();
  const [open, setOpen] = useState(false);
  const [openState, setOpenState] = useState<{ nonce: number; modality: Modality | null }>({ nonce: 0, modality: null });
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [compact, setCompact] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const descId = useId();
  const { width: slotWidth } = useElementSize(slotRef);

  const director = entries.find((e) => e.modality === 'director')!;
  const bound = entries.filter((e) => e.modality !== 'director' && e.selection.mode === 'model');
  const boundCount = entries.filter((e) => e.selection.mode === 'model').length;
  const autoCount = entries.length - boundCount;
  const directorName = director.selection.mode === 'model' ? shortModelName(director.current, director.selection.modelId) : t('picker.auto');
  const effortText = t(`effort.${effort}`);

  const show = (modality: Modality | null) => {
    // Platz zwischen Kopfzeile und Auslöser: Das Popover wächst nach oben, aber nie über die Kopfzeile
    const top = buttonRef.current?.getBoundingClientRect().top;
    const ceiling = (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + POPOVER_EDGE;
    setMaxHeight(top && top - ceiling > 160 ? Math.floor(top - 6 - ceiling) : undefined);
    setOpenState((s) => ({ nonce: s.nonce + 1, modality }));
    setOpen(true);
  };

  // mod+M öffnet bzw. schließt das Popover (auch aus dem Composer heraus); andere Bereiche öffnen es per Ereignis
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!mod || event.altKey || event.shiftKey || event.code !== 'KeyM' || event.defaultPrevented) return;
      event.preventDefault();
      if (openRef.current) setOpen(false);
      else show(null);
    };
    const onOpen = (event: Event) => show((event as CustomEvent<{ modality: Modality | null }>).detail?.modality ?? null);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_MODELS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_MODELS_EVENT, onOpen);
    };
  }, []);

  const summaryKey = `${directorName}|${effortText}|${bound.map((e) => e.name).join('|')}|${autoCount}`;
  // Platz messen: Passt die volle Zusammenfassung nicht in den Steckplatz (höchstens SUMMARY_BUDGET), wird sie kompakt
  useLayoutEffect(() => {
    const natural = measureRef.current?.offsetWidth ?? 0;
    setCompact(slotWidth > 0 && natural > Math.min(slotWidth, SUMMARY_BUDGET));
  }, [slotWidth, summaryKey]);

  const full = (
    <>
      <span className="mp-item mp-item-director">
        <span className="mp-item-name">{directorName}</span>
        <span className="mp-q">· {effortText}</span>
      </span>
      {bound.map((e) => (
        <span key={e.modality} className="mp-item">
          <Icon name={MODALITY_ICONS[e.modality]} size={12} />
          <span className="mp-item-name">{shortModelName(e.current, e.selection.mode === 'model' ? e.selection.modelId : '')}</span>
        </span>
      ))}
      {autoCount > 0 && (
        <span className="mp-item">
          <span className="mp-q">{t('picker.autoCount', { count: autoCount })}</span>
        </span>
      )}
    </>
  );

  const description = t('picker.summaryAria', {
    director: `${modalityLabel('director')}: ${directorName}, ${effortText}`,
    bound: bound.map((e) => `${modalityLabel(e.modality)} ${e.name}`).join(', ') || '–',
    auto: t('picker.autoCount', { count: autoCount }),
  });

  return (
    <div className="mp-slot" ref={slotRef}>
      <span className="mp-summary mp-measure" ref={measureRef} aria-hidden="true">
        {full}
        <Icon name="chevronDown" size={12} className="mp-summary-chev" />
      </span>
      <span id={descId} className="sr-only">
        {description}
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top"
        align="end"
        label={t('picker.label')}
        className="model-popover"
        anchor={
          <Tooltip label={t('picker.models')} keys={['mod', 'M']} disabled={open}>
            <button
              ref={buttonRef}
              type="button"
              className={`mp-summary${compact ? ' is-compact' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={t('picker.models')}
              aria-describedby={descId}
              onClick={() => (open ? setOpen(false) : show(null))}
            >
              {compact ? (
                <span className="mp-item">
                  <span className="mp-item-name">{t('picker.summaryBound', { count: boundCount })}</span>
                </span>
              ) : (
                full
              )}
              <Icon name="chevronDown" size={12} className="mp-summary-chev" />
            </button>
          </Tooltip>
        }
      >
        <ModelPickerPanel key={openState.nonce} initialModality={openState.modality} autoFocus maxHeight={maxHeight} />
      </Popover>
    </div>
  );
}
