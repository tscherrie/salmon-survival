import { join } from 'node:path';
import type { Checkpoint, CheckpointStatus, RecentProject } from '@studio/core';
import { exists, readJson, writeJsonAtomic } from './fsutil.ts';

/**
 * Gespeicherter Eintrag: der öffentliche {@link RecentProject} plus die Datei hinter `poster`. Die Datei bleibt in
 * Main (der Renderer bekommt nur die URL); über sie liefert das Asset-Protokoll das Standbild auch, solange das
 * Projekt geschlossen ist.
 */
export interface RecentEntry extends RecentProject {
  posterFile?: string | undefined;
  posterMime?: string | undefined;
}

const CHECKPOINT_STATUSES: ReadonlySet<CheckpointStatus> = new Set(['pending', 'proposed', 'approved', 'changes_requested', 'skipped']);

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Prüft eine gespeicherte Zeile. Die optionalen Felder (Standbild, Checkpoint, Budget) fallen einzeln weg, wenn sie
 * unbrauchbar sind (ältere oder von Hand bearbeitete Datei); es wird nie etwas ergänzt.
 */
function sanitize(raw: unknown): RecentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== 'string' || typeof r.title !== 'string') return null;
  const entry: RecentEntry = {
    path: r.path,
    title: r.title,
    category: (typeof r.category === 'string' ? r.category : null) as RecentProject['category'],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  };
  if (typeof r.poster === 'string' && r.poster && typeof r.posterFile === 'string' && r.posterFile) {
    entry.poster = r.poster;
    entry.posterFile = r.posterFile;
    if (typeof r.posterMime === 'string') entry.posterMime = r.posterMime;
  }
  const cp = r.checkpoint as Record<string, unknown> | undefined;
  if (
    cp &&
    typeof cp === 'object' &&
    Number.isInteger(cp.index) &&
    Number.isInteger(cp.total) &&
    (cp.index as number) >= 1 &&
    (cp.index as number) <= (cp.total as number) &&
    typeof cp.title === 'string' &&
    CHECKPOINT_STATUSES.has(cp.status as CheckpointStatus)
  ) {
    entry.checkpoint = { index: cp.index as number, total: cp.total as number, title: cp.title, status: cp.status as CheckpointStatus };
  }
  const budget = r.budget as Record<string, unknown> | undefined;
  if (budget && typeof budget === 'object' && isAmount(budget.spentUsd) && isAmount(budget.approvedUsd)) {
    entry.budget = { spentUsd: budget.spentUsd, approvedUsd: budget.approvedUsd };
  }
  return entry;
}

/** Öffentliche Sicht ohne die Dateifelder. */
function publicView({ posterFile: _file, posterMime: _mime, ...rest }: RecentEntry): RecentProject {
  return rest;
}

/**
 * Stand der Checkpoints für den Startbildschirm: der erste noch nicht erledigte Schritt (nicht freigegeben, nicht
 * übersprungen); sind alle erledigt, der letzte. Ohne Checkpoints `undefined`.
 */
export function recentCheckpoint(checkpoints: readonly Checkpoint[]): RecentProject['checkpoint'] {
  if (checkpoints.length === 0) return undefined;
  const open = checkpoints.findIndex((c) => c.status !== 'approved' && c.status !== 'skipped');
  const at = open === -1 ? checkpoints.length - 1 : open;
  const cp = checkpoints[at]!;
  return { index: at + 1, total: checkpoints.length, title: cp.title, status: cp.status };
}

/** Liste zuletzt geöffneter Projekte im App-Datenordner. */
export class RecentProjects {
  constructor(
    private readonly appDataDir: string,
    private readonly max = 20,
  ) {}

  private get file(): string {
    return join(this.appDataDir, 'recent-projects.json');
  }

  /** Gespeicherte Liste ohne Filter – auch Projekte auf gerade nicht erreichbaren Laufwerken bleiben erhalten. */
  private async readRaw(): Promise<RecentEntry[]> {
    if (!(await exists(this.file))) return [];
    const items = await readJson<unknown>(this.file);
    return Array.isArray(items) ? items.map(sanitize).filter((i): i is RecentEntry => i !== null) : [];
  }

  /** Nur erreichbare Projekte (für die Anzeige); die gespeicherte Liste bleibt unverändert. */
  async list(): Promise<RecentProject[]> {
    const alive: RecentProject[] = [];
    for (const item of await this.readRaw()) if (await exists(join(item.path, 'project.json'))) alive.push(publicView(item));
    return alive;
  }

  /** Stellt das Projekt an den Anfang der Liste (Öffnen, Anlegen). */
  async touch(entry: RecentEntry): Promise<void> {
    const items = (await this.readRaw()).filter((i) => i.path !== entry.path);
    items.unshift(entry);
    await writeJsonAtomic(this.file, items.slice(0, this.max));
  }

  /**
   * Ersetzt den Eintrag eines Projekts an seiner Stelle (Schließen: aktueller Checkpoint, Budget, Standbild), ohne die
   * Reihenfolge zu ändern. Fehlt das Projekt in der Liste, passiert nichts.
   */
  async update(entry: RecentEntry): Promise<void> {
    const items = await this.readRaw();
    const at = items.findIndex((i) => i.path === entry.path);
    if (at === -1) return;
    items[at] = entry;
    await writeJsonAtomic(this.file, items);
  }

  /** Datei und Typ zum Standbild mit genau dieser URL (für das Asset-Protokoll bei geschlossenem Projekt). */
  async posterFile(url: string): Promise<{ path: string; mime: string } | null> {
    const hit = (await this.readRaw()).find((i) => i.poster === url && i.posterFile);
    return hit ? { path: hit.posterFile!, mime: hit.posterMime ?? 'image/jpeg' } : null;
  }

  async remove(path: string): Promise<void> {
    const items = (await this.readRaw()).filter((i) => i.path !== path);
    await writeJsonAtomic(this.file, items);
  }
}
