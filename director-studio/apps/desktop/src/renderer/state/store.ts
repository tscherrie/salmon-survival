import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  documentAssetIds,
  insertRefAt,
  isComposerEmpty,
  normalizeRef,
  refLabel,
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
import { insertSegmentsAt, trimSegments } from '../lib/composerOps.ts';
import { labelContextFor } from '../lib/labels.ts';
import { reduceEvent } from './reducer.ts';
import { initialData, initialVoice, type StudioData, type Toast, type Transport } from './types.ts';

export interface StudioActions {
  init(): Promise<void>;
  handleEvent(event: StudioEvent): void;
  toast(kind: Toast['kind'], text: string): void;
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

  // Composer
  setComposer(segments: ComposerSegment[], caret?: number): void;
  setCaret(position: number): void;
  insertRef(ref: Ref): void;
  insertSegments(segments: ComposerSegment[]): void;
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
  importFiles(mode: 'link' | 'import'): Promise<void>;
  importDroppedFiles(files: File[]): Promise<void>;
  revealAsset(assetId: string): Promise<void>;

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
        if (event.type === 'preview_pick' && state.voice.recording && event.projectId === state.projectId) {
          get().addVoiceClick({ atMs: performance.now() - state.voice.startedAt, ref: event.ref });
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
          case 'preview_pick': {
            const doc = viewDocument(get());
            get().announce(t('stage.refAdded', { label: event.label ?? refLabel(event.ref, labelContextFor(doc, get().assets)) }));
            break;
          }
          default:
            break;
        }
      },

      toast(kind, text) {
        const id = ++toastCounter;
        set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-5) }));
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
        const doc = (snapshot.document as StudioDocument | null) ?? null;
        const head = snapshot.versions.reduce((max, v) => Math.max(max, v.number), 0);
        const formats = doc?.kind === 'timeline' ? doc.formats : [];
        set({
          ...initialData(),
          settings: get().settings,
          authStatus: get().authStatus,
          recent: get().recent,
          models: get().models,
          transport: get().transport,
          overlays: get().overlays,
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
          question: snapshot.pendingQuestion ? { ...snapshot.pendingQuestion, runId: null } : null,
          approvals: snapshot.pendingApprovals,
          activities: snapshot.activities,
          formatId: formats[0]?.id ?? null,
          selectedSlideId: doc?.kind === 'deck' ? (doc.slides[0]?.id ?? null) : null,
          selectedPageId: doc?.kind === 'site' ? (doc.pages[0]?.id ?? null) : null,
        });
      },

      async refreshSnapshot() {
        const id = get().projectId;
        if (!id) return;
        const snapshot = await guarded(() => api.getSnapshot(id));
        if (!snapshot || get().projectId !== id) return;
        const { composer, caret, queue } = get();
        get().loadSnapshot(snapshot);
        set({ composer, caret, queue, composerRevision: get().composerRevision + 1 });
      },

      closeProject() {
        set({ ...initialData(), settings: get().settings, authStatus: get().authStatus, recent: get().recent, models: get().models, overlays: get().overlays });
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
        set((s) => ({ composer: segments, caret: caret ?? s.caret }));
      },

      setCaret(position) {
        set({ caret: Math.max(0, position) });
      },

      insertRef(input) {
        const ref = normalizeRef(input);
        const state = get();
        if (state.voice.recording) {
          get().addVoiceClick({ atMs: performance.now() - state.voice.startedAt, ref });
        } else {
          set({ composer: insertRefAt(state.composer, state.caret, ref), caret: state.caret + 1, composerRevision: state.composerRevision + 1 });
        }
        get().announce(t('stage.refAdded', { label: refLabel(ref, labelContextFor(viewDocument(get()), get().assets)) }));
      },

      insertSegments(segments) {
        const state = get();
        const result = insertSegmentsAt(state.composer, state.caret, segments);
        set({ composer: result.segments, caret: result.caret, composerRevision: state.composerRevision + 1 });
      },

      async send() {
        const state = get();
        if (!state.projectId || isComposerEmpty(state.composer)) return;
        const message: ComposerMessage = { segments: trimSegments(state.composer) };
        set({ composer: [], caret: 0, composerRevision: state.composerRevision + 1 });
        if (state.runState === 'running') {
          set((s) => ({ queue: [...s.queue, message] }));
          return;
        }
        try {
          await api.sendMessage(state.projectId, message);
        } catch (error) {
          set((s) => ({ composer: message.segments, caret: 0, composerRevision: s.composerRevision + 1 }));
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

      async importFiles(mode) {
        const id = get().projectId;
        if (!id) return;
        const paths = await guarded(() => api.chooseFiles());
        if (!paths || paths.length === 0) return;
        const assets = await guarded(() => api.importFiles(id, paths, mode));
        if (!assets) return;
        set((s) => ({ assets: assets.reduce((list, a) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]), s.assets) }));
        get().toast('success', t('assets.imported', { count: assets.length }));
      },

      async importDroppedFiles(files) {
        const id = get().projectId;
        if (!id || files.length === 0) return;
        // Electron: echter Pfad über webUtils.getPathForFile; Browser/Fake: nur der Dateiname.
        const paths = files.map((file) => api.pathForFile?.(file) || file.name);
        try {
          const assets = await api.importFiles(id, paths, 'link');
          set((s) => ({ assets: assets.reduce((list, a) => (list.some((x) => x.id === a.id) ? list : [...list, a]), s.assets) }));
          for (const asset of assets) get().insertRef({ kind: 'asset', assetId: asset.id });
        } catch (error) {
          get().toast('error', t('composer.importFailed', { error: errorText(error) }));
        }
      },

      async revealAsset(assetId) {
        await guarded(() => api.revealAsset(projectId(), assetId));
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
