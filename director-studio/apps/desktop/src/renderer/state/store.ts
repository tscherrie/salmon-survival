import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  documentAssetIds,
  insertRefAt,
  isComposerEmpty,
  normalizeRef,
  normalizeSegments,
  removeSegment,
  type AppSettings,
  type CheckpointDecision,
  type ComposerMessage,
  type ComposerSegment,
  type CreateProjectInput,
  type DirectorEffort,
  type Modality,
  type PickerSelection,
  type PreviewViewport,
  type ProjectSnapshot,
  type Ref,
  type StudioApi,
  type StudioDocument,
  type StudioEvent,
  type VoiceClick,
} from '@studio/core';
import { setLanguage, t } from '../i18n.ts';
import { defaultCoach, readCoach, writeCoach, type CoachKey } from '../lib/coach.ts';
import { insertSegmentsAt, trimSegments } from '../lib/composerOps.ts';
import { labelContextFor, refChipLabel } from '../lib/labels.ts';
import { reconcileRefNumbers, refKey } from '../lib/refNumbers.ts';
import { formatTc } from '../lib/timecode.ts';
import { reduceEvent } from './reducer.ts';
import { selectUserMarkers } from './selectors.ts';
import { initialData, initialVoice, type StudioData, type Toast, type Transport } from './types.ts';

/** Dauer des Verknüpfungs-Blitzes (DESIGN.md §5). */
export const FLASH_MS = 600;

export interface StudioActions {
  init(): Promise<void>;
  handleEvent(event: StudioEvent): void;
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void;
  dismissToast(id: number): void;
  announce(text: string): void;
  pushOverlay(): void;
  popOverlay(): void;

  // Projekte
  loadRecent(): Promise<void>;
  openProject(path: string): Promise<boolean>;
  createProject(input: CreateProjectInput): Promise<boolean>;
  loadSnapshot(snapshot: ProjectSnapshot): void;
  refreshSnapshot(): Promise<void>;
  closeProject(): void;

  // Einstellungen
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  setSecret(name: 'anthropic' | 'fal', value: string | null): Promise<void>;
  loadAuthStatus(): Promise<void>;

  // Composer (alle Schreibzugriffe laufen über `writeComposer`, DESIGN.md §8.7)
  setComposer(segments: ComposerSegment[], caret?: number): void;
  setCaret(position: number): void;
  /** Fügt eine Referenz am Caret ein. Steht ihr Schlüssel schon im Composer, blitzt der Chip stattdessen (`false`). */
  insertRef(ref: Ref): boolean;
  insertSegments(segments: ComposerSegment[]): void;
  /** Entfernt das Segment an `index` (Chip-×, Rücktaste, Entf) und setzt den Caret. */
  removeComposerSegment(index: number, caret: number): void;
  /** Entfernt alle Chips mit diesem Schlüssel (Marker entfernen, Kontextmenü). */
  removeRefByKey(key: string): void;
  send(): Promise<void>;
  sendQueued(index?: number): Promise<void>;
  removeQueued(index: number): void;
  interrupt(): Promise<void>;

  // Wiedergabe & Auswahl
  requestSeek(frame: number): void;
  setPlayhead(frame: number): void;
  setPlaying(playing: boolean): void;
  setPlaybackRate(rate: number): void;
  setTransport(transport: Transport | null): void;
  togglePlay(): void;
  shuttle(key: 'j' | 'k' | 'l'): void;
  setFormat(formatId: string): void;
  toggleSafeArea(): void;
  selectSlide(slideId: string | null): void;
  selectPage(pageId: string | null): void;
  setActiveTrack(trackId: string | null): void;
  setViewport(viewport: PreviewViewport): void;

  // Referenzen und Marker (§8.7, §9.4)
  /** Marker = Zeit-Chip am Frame (begrenzt auf 0…Dauer). Der Abspielkopf bleibt stehen. */
  addMarkerAt(frame: number): void;
  /** Abspielkopf zum vorigen (-1) bzw. nächsten (1) Nutzer-Marker; am Ende nur die Ansage. */
  jumpToMarker(direction: -1 | 1): void;
  /** Zeigt, worauf eine Referenz zeigt (Abspielkopf, Folie, Seite …), und lässt die Gegenstücke blitzen. */
  revealRef(ref: Ref): void;
  setHoveredRef(key: string | null): void;
  flashRef(key: string): void;

  // Einmalige Hinweise (§8.6)
  completeCoach(key: CoachKey): void;
  resetCoach(): void;

  // Versionen
  viewVersion(number: number): Promise<void>;
  exitVersionView(): void;
  restoreVersion(number: number): Promise<void>;

  // Director
  answerQuestion(answers: Record<string, string>): Promise<void>;
  decideCheckpoint(checkpointId: string, decision: CheckpointDecision): Promise<void>;
  decideApproval(approvalId: string, approved: boolean): Promise<void>;
  setEffort(effort: DirectorEffort): Promise<void>;

  // Modelle
  loadModels(): Promise<void>;
  refreshModels(): Promise<void>;
  setPicker(modality: Modality, selection: PickerSelection): Promise<void>;

  // Assets
  /** Dateien wählen und importieren bzw. verknüpfen; `insert` fügt danach je Datei einen Asset-Chip ein (Composer „+“). */
  importFiles(mode: 'link' | 'import', opts?: { insert?: boolean }): Promise<void>;
  /** Verknüpft fallen gelassene Dateien; `insert: false` (Ablage auf der Asset-Leiste) setzt keine Chips, sondern meldet nur. */
  importDroppedFiles(files: File[], opts?: { insert?: boolean }): Promise<void>;
  revealAsset(assetId: string): Promise<void>;
  /** Verknüpfte Datei neu zuordnen: Datei wählen (`chooseFiles`) → `relinkAsset`. `true` bei Erfolg. */
  relinkAsset(assetId: string): Promise<boolean>;

  // Sprache
  startVoice(startedAt: number): void;
  addVoiceClick(click: VoiceClick): void;
  setVoiceLevel(level: number): void;
  setVoiceTranscribing(transcribing: boolean): void;
  stopVoice(): VoiceClick[];
}

export type StudioState = StudioData & StudioActions;
export type StudioStore = StoreApi<StudioState>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function viewDocument(state: StudioData): StudioDocument | null {
  return state.viewing?.document ?? state.document;
}

/** Erzeugt einen Store pro App-Instanz (Tests bleiben isoliert) und abonniert die Ereignisse der API. */
export function createStudioStore(api: StudioApi): StudioStore {
  let toastCounter = 0;
  let seekNonce = 0;
  let flashNonce = 0;

  const store = createStore<StudioState>()((set, get) => {
    const projectId = () => {
      const id = get().projectId;
      if (!id) throw new Error('Kein Projekt geöffnet');
      return id;
    };

    /** Führt einen API-Aufruf aus und meldet Fehler als Toast. */
    const guarded = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (error) {
        get().toast('error', errorText(error));
        return undefined;
      }
    };

    const labelContext = () => labelContextFor(viewDocument(get()), get().assets);
    const fpsOf = () => {
      const doc = viewDocument(get());
      return doc?.kind === 'timeline' ? doc.fps : 30;
    };

    /**
     * Einziger Schreibweg für den Composer (§8.7): gleicht die Nummern ab (§9.3), erhöht `composerRevision` und
     * schließt den Marker-Hinweis, sobald es einen Zeit-Chip gibt. `numbers` ersetzt die bisherigen Nummern als
     * Ausgangspunkt (Snapshot neu laden), `patch` wird im selben Schritt mitgeschrieben.
     */
    const writeComposer = (segments: ComposerSegment[], caret: number, opts: { numbers?: Record<string, number>; patch?: Partial<StudioData> } = {}) => {
      const s = get();
      const coach = opts.patch?.coach ?? s.coach;
      const markerDone = coach.markerStrip === 'open' && segments.some((seg) => seg.type === 'ref' && seg.ref.kind === 'time');
      set({
        ...opts.patch,
        composer: segments,
        caret: Math.max(0, caret),
        refNumbers: reconcileRefNumbers(opts.numbers ?? s.refNumbers, segments),
        composerRevision: s.composerRevision + 1,
        ...(markerDone ? { coach: { ...coach, markerStrip: 'done' as const } } : {}),
      });
      if (markerDone) writeCoach(get().coach);
    };

    /** Gesprochene Beschriftung: Zeit-Chips als „Marker 2 bei 00:24:00“, sonst die Chip-Beschriftung. */
    const spokenLabel = (ref: Ref): string => {
      if (ref.kind === 'time') {
        const n = get().refNumbers[refKey(ref)];
        const time = formatTc(ref.frame, fpsOf(), 'short');
        return n ? t('ref.markerLabel', { n, time }) : time;
      }
      return refChipLabel(ref, labelContext());
    };

    const removedText = (ref: Ref): string => {
      const n = get().refNumbers[refKey(ref)];
      return ref.kind === 'time' && n ? t('stage.markerRemoved', { n }) : t('ref.removed', { label: spokenLabel(ref) });
    };

    /**
     * Fügt eine Referenz am Caret ein (während der Aufnahme: als Klick vormerken, ohne Duplikatprüfung, §9.3).
     * Steht der Schlüssel schon im Composer, wird nichts eingefügt: Der Chip blitzt, und die Ansage nennt ihn.
     */
    const addRef = (input: Ref, opts: { label?: string | undefined; announceAdded?: boolean } = {}): boolean => {
      const ref = normalizeRef(input);
      const state = get();
      const announceAdded = opts.announceAdded ?? true;
      if (state.voice.recording) {
        get().addVoiceClick({ atMs: performance.now() - state.voice.startedAt, ref });
        if (announceAdded) get().announce(t('stage.refAdded', { label: opts.label ?? spokenLabel(ref) }));
        return true;
      }
      const key = refKey(ref);
      if (state.composer.some((seg) => seg.type === 'ref' && refKey(seg.ref) === key)) {
        const n = state.refNumbers[key];
        get().flashRef(key);
        get().announce(ref.kind === 'time' && n ? t('stage.markerExists', { n }) : t('ref.exists', { label: spokenLabel(ref) }));
        return false;
      }
      writeComposer(insertRefAt(state.composer, state.caret, ref), state.caret + 1);
      if (announceAdded) get().announce(t('stage.refAdded', { label: opts.label ?? spokenLabel(ref) }));
      return true;
    };

    const refreshDocument = async (number: number) => {
      const id = get().projectId;
      if (!id) return;
      try {
        const version = await api.getVersion(id, number);
        if (get().projectId !== id || number < get().documentVersion) return;
        set({ document: version.document, documentVersion: number, usedAssetIds: [...documentAssetIds(version.document)] });
      } catch (error) {
        get().toast('error', errorText(error));
      }
    };

    return {
      ...initialData(),
      coach: readCoach(),

      async init() {
        const [settings, authStatus, recent] = await Promise.all([
          guarded(() => api.getSettings()),
          guarded(() => api.getAuthStatus()),
          guarded(() => api.listRecentProjects()),
        ]);
        if (settings) setLanguage(settings.language);
        set({ settings: settings ?? null, authStatus: authStatus ?? null, recent: recent ?? [] });
      },

      handleEvent(event) {
        const state = get();
        if (event.type === 'preview_pick') {
          // Picks aus der Web-Vorschau laufen wie Bühnenklicks über insertRef (Aufnahme, Duplikatschutz, Nummern)
          if (state.projectId && event.projectId === state.projectId) addRef(event.ref, { label: event.label });
          return;
        }
        const patch = reduceEvent(state, event);
        if (!patch) return;
        const previousCategory = state.manifest?.category ?? null;
        set(patch);
        switch (event.type) {
          case 'document':
            if (event.version.number >= get().documentVersion) void refreshDocument(event.version.number);
            break;
          case 'manifest':
            if (previousCategory === null && event.manifest.category !== null) void get().refreshSnapshot();
            break;
          case 'run_state':
            if (event.state === 'idle' && get().queue.length > 0) void get().sendQueued(0);
            break;
          case 'approval_resolved': {
            // Director-Verlauf: Erledigte Genehmigungen bleiben als Systemzeile stehen (§7.6.2)
            const request = state.approvals.find((a) => a.id === event.approvalId);
            if (request) set((s) => ({ decidedApprovals: [...s.decidedApprovals, { request, approved: event.approved, decidedAt: new Date().toISOString() }].slice(-50) }));
            break;
          }
          default:
            break;
        }
      },

      toast(kind, text, action) {
        const id = ++toastCounter;
        // Höchstens drei gleichzeitig (DESIGN.md §7.11); der älteste weicht
        set((s) => ({ toasts: [...s.toasts, { id, kind, text, ...(action ? { action } : {}) }].slice(-3) }));
      },

      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      },

      announce(text) {
        set({ announcement: text });
      },

      pushOverlay() {
        set((s) => ({ overlays: s.overlays + 1 }));
      },

      popOverlay() {
        set((s) => ({ overlays: Math.max(0, s.overlays - 1) }));
      },

      // ───────────── Projekte ─────────────

      async loadRecent() {
        const recent = await guarded(() => api.listRecentProjects());
        if (recent) set({ recent });
      },

      async openProject(path) {
        try {
          const snapshot = await api.openProject(path);
          get().loadSnapshot(snapshot);
          return true;
        } catch (error) {
          get().toast('error', t('start.openFailed', { error: errorText(error) }));
          return false;
        }
      },

      async createProject(input) {
        const snapshot = await guarded(() => api.createProject(input));
        if (!snapshot) return false;
        get().loadSnapshot(snapshot);
        return true;
      },

      loadSnapshot(snapshot) {
        const doc = snapshot.document;
        const head = snapshot.versions.reduce((max, v) => Math.max(max, v.number), 0);
        const formats = doc?.kind === 'timeline' ? doc.formats : [];
        writeComposer([], 0, {
          numbers: {},
          patch: {
            ...initialData(),
            settings: get().settings,
            authStatus: get().authStatus,
            recent: get().recent,
            models: get().models,
            transport: get().transport,
            overlays: get().overlays,
            coach: get().coach,
            screen: 'workspace',
            projectId: snapshot.manifest.id,
            path: snapshot.path,
            manifest: snapshot.manifest,
            document: doc,
            documentVersion: head,
            versions: [...snapshot.versions].sort((a, b) => a.number - b.number),
            assets: snapshot.assets,
            usedAssetIds: snapshot.usedAssetIds,
            budget: snapshot.budget,
            checkpoints: snapshot.checkpoints,
            messages: snapshot.messages,
            generations: snapshot.generations,
            runState: snapshot.runState,
            question: snapshot.pendingQuestion
              ? { questionId: snapshot.pendingQuestion.questionId, questions: snapshot.pendingQuestion.questions, runId: snapshot.pendingQuestion.runId || null }
              : null,
            approvals: snapshot.pendingApprovals,
            activities: snapshot.activities,
            formatId: formats[0]?.id ?? null,
            selectedSlideId: doc?.kind === 'deck' ? (doc.slides[0]?.id ?? null) : null,
            selectedPageId: doc?.kind === 'site' ? (doc.pages[0]?.id ?? null) : null,
          },
        });
      },

      async refreshSnapshot() {
        const id = get().projectId;
        if (!id) return;
        const snapshot = await guarded(() => api.getSnapshot(id));
        if (!snapshot || get().projectId !== id) return;
        const { composer, caret, queue, refNumbers } = get();
        get().loadSnapshot(snapshot);
        // Composer samt Nummern übernehmen: Die Chips behalten ihre Nummern
        writeComposer(composer, caret, { numbers: refNumbers, patch: { queue } });
      },

      closeProject() {
        writeComposer([], 0, {
          numbers: {},
          patch: { ...initialData(), settings: get().settings, authStatus: get().authStatus, recent: get().recent, models: get().models, overlays: get().overlays, coach: get().coach },
        });
        void get().loadRecent();
      },

      // ───────────── Einstellungen ─────────────

      async updateSettings(patch) {
        const settings = await guarded(() => api.updateSettings(patch));
        if (!settings) return;
        setLanguage(settings.language);
        set({ settings });
        await get().loadAuthStatus();
      },

      async setSecret(name, value) {
        const ok = await guarded(async () => {
          await api.setSecret(name, value);
          return true;
        });
        if (ok) {
          get().toast('success', value === null ? t('settings.keyRemoved') : t('settings.keySaved'));
          await get().loadAuthStatus();
        }
      },

      async loadAuthStatus() {
        const authStatus = await guarded(() => api.getAuthStatus());
        if (authStatus) set({ authStatus });
      },

      // ───────────── Composer ─────────────

      setComposer(segments, caret) {
        writeComposer(segments, caret ?? get().caret);
      },

      setCaret(position) {
        set({ caret: Math.max(0, position) });
      },

      insertRef(input) {
        return addRef(input);
      },

      insertSegments(segments) {
        // Diktat: keine Duplikatprüfung; gleiche Schlüssel teilen sich eine Nummer (§9.3)
        const state = get();
        const result = insertSegmentsAt(state.composer, state.caret, segments);
        writeComposer(result.segments, result.caret);
      },

      removeComposerSegment(index, caret) {
        const segment = get().composer[index];
        if (!segment) return;
        const spoken = segment.type === 'ref' ? removedText(segment.ref) : null;
        writeComposer(removeSegment(get().composer, index), caret);
        if (spoken) get().announce(spoken);
      },

      removeRefByKey(key) {
        const state = get();
        const kept: ComposerSegment[] = [];
        let removed: Ref | null = null;
        let caret = state.caret;
        let pos = 0;
        for (const seg of state.composer) {
          if (seg.type === 'ref' && refKey(seg.ref) === key) {
            removed = seg.ref;
            if (pos < state.caret) caret -= 1;
          } else {
            kept.push(seg);
          }
          pos += seg.type === 'text' ? seg.text.length : 1;
        }
        if (!removed) return;
        const spoken = removedText(removed);
        writeComposer(normalizeSegments(kept), caret, state.hoveredRefKey === key ? { patch: { hoveredRefKey: null } } : {});
        get().announce(spoken);
      },

      async send() {
        const state = get();
        if (!state.projectId || isComposerEmpty(state.composer)) return;
        const message: ComposerMessage = { segments: trimSegments(state.composer) };
        // Nach dem Senden ist der Composer leer, also auch die Markerleiste; die Nummern beginnen neu
        writeComposer([], 0, { patch: { hoveredRefKey: null } });
        if (state.runState === 'running') {
          set((s) => ({ queue: [...s.queue, message] }));
          return;
        }
        try {
          await api.sendMessage(state.projectId, message);
        } catch (error) {
          writeComposer(message.segments, 0);
          get().toast('error', errorText(error));
        }
      },

      async sendQueued(index = 0) {
        const state = get();
        const message = state.queue[index];
        if (!message || !state.projectId) return;
        set({ queue: state.queue.filter((_, i) => i !== index) });
        await guarded(() => api.sendMessage(projectId(), message));
      },

      removeQueued(index) {
        set((s) => ({ queue: s.queue.filter((_, i) => i !== index) }));
      },

      async interrupt() {
        await guarded(() => api.interrupt(projectId()));
      },

      // ───────────── Wiedergabe ─────────────

      requestSeek(frame) {
        const doc = viewDocument(get());
        const max = doc?.kind === 'timeline' ? Math.max(0, doc.durationFrames - 1) : Number.MAX_SAFE_INTEGER;
        const clamped = Math.max(0, Math.min(Math.round(frame), max));
        seekNonce += 1;
        set({ playhead: clamped, seekRequest: { frame: clamped, nonce: seekNonce } });
      },

      setPlayhead(frame) {
        if (frame !== get().playhead) set({ playhead: frame });
      },

      setPlaying(playing) {
        if (playing !== get().playing) set({ playing });
      },

      setPlaybackRate(rate) {
        set({ playbackRate: rate });
      },

      setTransport(transport) {
        set({ transport });
      },

      togglePlay() {
        const { transport, playing } = get();
        if (transport) transport.toggle();
        else set({ playing: !playing });
      },

      shuttle(key) {
        const { transport, playbackRate, playing } = get();
        if (key === 'k') {
          transport?.pause();
          set({ playing: false, playbackRate: 1 });
          return;
        }
        let rate: number;
        if (key === 'l') rate = !playing || playbackRate <= 0 ? 1 : Math.min(playbackRate * 2, 4);
        else rate = !playing || playbackRate >= 0 ? -1 : Math.max(playbackRate * 2, -4);
        set({ playbackRate: rate });
        if (transport) transport.play();
        else set({ playing: true });
      },

      setFormat(formatId) {
        set({ formatId });
      },

      toggleSafeArea() {
        set((s) => ({ safeArea: !s.safeArea }));
      },

      selectSlide(slideId) {
        set({ selectedSlideId: slideId });
      },

      selectPage(pageId) {
        set({ selectedPageId: pageId });
      },

      setActiveTrack(trackId) {
        set({ activeTrackId: trackId });
      },

      setViewport(viewport) {
        set({ viewport });
      },

      // ───────────── Referenzen und Marker ─────────────

      addMarkerAt(frame) {
        const doc = viewDocument(get());
        if (doc?.kind !== 'timeline') return;
        const ref: Ref = { kind: 'time', frame: Math.max(0, Math.min(Math.round(frame), doc.durationFrames)) };
        if (get().voice.recording) {
          // Schwebender Marker: Die Nummer kommt mit der Transkription
          addRef(ref);
          return;
        }
        if (!addRef(ref, { announceAdded: false })) return;
        const key = refKey(ref);
        set({ lastMarkerKey: key });
        get().announce(t('stage.markerSet', { n: get().refNumbers[key] ?? '', time: formatTc(ref.frame, doc.fps, 'short') }));
      },

      jumpToMarker(direction) {
        const state = get();
        const doc = viewDocument(state);
        if (doc?.kind !== 'timeline') return;
        const markers = selectUserMarkers(state);
        let target = direction > 0 ? markers.find((m) => m.frame > state.playhead) : undefined;
        if (direction < 0) for (const m of markers) if (m.frame < state.playhead) target = m;
        if (!target) {
          get().announce(t('stage.noMoreMarkers'));
          return;
        }
        get().requestSeek(target.frame);
        get().flashRef(target.key);
        const time = formatTc(target.frame, doc.fps, 'short');
        get().announce(t('ref.revealed', { label: target.n ? t('ref.markerLabel', { n: target.n, time }) : time }));
      },

      revealRef(ref) {
        const doc = viewDocument(get());
        const seek = (frame: number) => {
          if (doc?.kind === 'timeline') get().requestSeek(frame);
        };
        switch (ref.kind) {
          case 'time':
            seek(ref.frame);
            break;
          case 'range':
            seek(ref.from);
            break;
          case 'marker': {
            const marker = doc?.kind === 'timeline' ? doc.markers.find((m) => m.id === ref.markerId) : undefined;
            if (marker) seek(marker.frame);
            break;
          }
          case 'clip': {
            if (doc?.kind !== 'timeline') break;
            for (const track of doc.tracks) {
              const clip = track.clips.find((c) => c.id === ref.clipId);
              if (!clip) continue;
              seek(clip.start);
              get().setActiveTrack(track.id);
              break;
            }
            break;
          }
          case 'slide':
            get().selectSlide(ref.slideId);
            break;
          case 'element':
          case 'region': {
            if (ref.slideId) get().selectSlide(ref.slideId);
            else if (ref.page && doc?.kind === 'site') {
              const page = doc.pages.find((p) => p.path === ref.page);
              if (page) get().selectPage(page.id);
            }
            if (ref.kind === 'region' && ref.doc === 'timeline' && ref.frame !== undefined) seek(ref.frame);
            break;
          }
          case 'version':
            void get().viewVersion(ref.versionNumber);
            break;
          case 'asset':
            // Assets: Die Asset-Leiste öffnet sich und zeigt die Karte (reagiert auf den Blitz)
            break;
        }
        get().flashRef(refKey(ref));
        get().announce(t('ref.revealed', { label: spokenLabel(ref) }));
      },

      setHoveredRef(key) {
        if (get().hoveredRefKey !== key) set({ hoveredRefKey: key });
      },

      flashRef(key) {
        flashNonce += 1;
        const nonce = flashNonce;
        set({ flash: { key, nonce } });
        setTimeout(() => {
          if (get().flash?.nonce === nonce) set({ flash: null });
        }, FLASH_MS);
      },

      // ───────────── Hinweise ─────────────

      completeCoach(key) {
        const coach = get().coach;
        if (coach[key] === 'done') return;
        set({ coach: { ...coach, [key]: 'done' } });
        writeCoach(get().coach);
      },

      resetCoach() {
        set({ coach: defaultCoach() });
        writeCoach(get().coach);
      },

      // ───────────── Versionen ─────────────

      async viewVersion(number) {
        if (number === get().documentVersion) {
          set({ viewing: null });
          return;
        }
        const version = await guarded(() => api.getVersion(projectId(), number));
        if (version) set({ viewing: { number, document: version.document } });
      },

      exitVersionView() {
        set({ viewing: null });
      },

      async restoreVersion(number) {
        const ok = await guarded(async () => {
          await api.restoreVersion(projectId(), number);
          return true;
        });
        if (ok) {
          set({ viewing: null });
          get().toast('success', t('versions.restored', { number }));
        }
      },

      // ───────────── Director ─────────────

      async answerQuestion(answers) {
        const question = get().question;
        if (!question) return;
        await guarded(() => api.answerQuestion(projectId(), question.questionId, answers));
      },

      async decideCheckpoint(checkpointId, decision) {
        await guarded(() => api.decideCheckpoint(projectId(), checkpointId, decision));
      },

      async decideApproval(approvalId, approved) {
        await guarded(() => api.decideApproval(projectId(), approvalId, approved));
      },

      async setEffort(effort) {
        const manifest = get().manifest;
        if (manifest) set({ manifest: { ...manifest, director: { ...manifest.director, effort } } });
        await guarded(() => api.setEffort(projectId(), effort));
      },

      // ───────────── Modelle ─────────────

      async loadModels() {
        const models = await guarded(() => api.listModels());
        if (models) set({ models });
      },

      async refreshModels() {
        const result = await guarded(() => api.refreshModels());
        if (!result) return;
        get().toast('success', t('picker.refreshed', { count: result.count }));
        await get().loadModels();
      },

      async setPicker(modality, selection) {
        const manifest = get().manifest;
        if (manifest) set({ manifest: { ...manifest, pickers: { ...manifest.pickers, [modality]: selection } } });
        await guarded(() => api.setPicker(projectId(), modality, selection));
      },

      // ───────────── Assets ─────────────

      async importFiles(mode, opts) {
        const id = get().projectId;
        if (!id) return;
        const paths = await guarded(() => api.chooseFiles());
        if (!paths || paths.length === 0) return;
        const assets = await guarded(() => api.importFiles(id, paths, mode));
        if (!assets) return;
        set((s) => ({ assets: assets.reduce((list, a) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]), s.assets) }));
        if (opts?.insert) for (const asset of assets) get().insertRef({ kind: 'asset', assetId: asset.id });
        else get().toast('success', t('assets.imported', { count: assets.length }));
      },

      async importDroppedFiles(files, opts) {
        const id = get().projectId;
        if (!id || files.length === 0) return;
        // Electron: echter Pfad über webUtils.getPathForFile; Browser/Fake: nur der Dateiname.
        const paths = files.map((file) => api.pathForFile?.(file) || file.name);
        try {
          const assets = await api.importFiles(id, paths, 'link');
          set((s) => ({ assets: assets.reduce((list, a) => (list.some((x) => x.id === a.id) ? list : [...list, a]), s.assets) }));
          if (opts?.insert === false) get().toast('success', t('assets.imported', { count: assets.length }));
          else for (const asset of assets) get().insertRef({ kind: 'asset', assetId: asset.id });
        } catch (error) {
          get().toast('error', t('composer.importFailed', { error: errorText(error) }));
        }
      },

      async revealAsset(assetId) {
        await guarded(() => api.revealAsset(projectId(), assetId));
      },

      async relinkAsset(assetId) {
        const id = get().projectId;
        if (!id) return false;
        const paths = await guarded(() => api.chooseFiles());
        const path = paths?.[0];
        if (!path) return false;
        try {
          const asset = await api.relinkAsset(id, assetId, path);
          if (get().projectId !== id) return false;
          set((s) => ({ assets: s.assets.some((a) => a.id === asset.id) ? s.assets.map((a) => (a.id === asset.id ? asset : a)) : [...s.assets, asset] }));
          get().toast('success', t('assets.relinked', { title: asset.title }));
          return true;
        } catch (error) {
          get().toast('error', t('assets.relinkFailed', { error: errorText(error) }));
          return false;
        }
      },

      // ───────────── Sprache ─────────────

      startVoice(startedAt) {
        set({ voice: { ...initialVoice, recording: true, startedAt } });
      },

      addVoiceClick(click) {
        set((s) => ({ voice: { ...s.voice, clicks: [...s.voice.clicks, click] } }));
      },

      setVoiceLevel(level) {
        set((s) => (s.voice.recording ? { voice: { ...s.voice, level } } : {}));
      },

      setVoiceTranscribing(transcribing) {
        set((s) => ({ voice: { ...s.voice, transcribing } }));
      },

      stopVoice() {
        const clicks = get().voice.clicks;
        set((s) => ({ voice: { ...s.voice, recording: false, level: 0, clicks: [] } }));
        return clicks;
      },
    };
  });

  api.onEvent((event) => store.getState().handleEvent(event));
  return store;
}
