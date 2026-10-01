import { useEffect, useMemo, useState } from 'react';
import { formatUsd, type Generation, type ModelInfo } from '@studio/core';
import { useT } from '../../i18n.ts';
import { formatElapsed } from '../../lib/hooks.ts';
import { useStudio } from '../../state/context.tsx';
import { Icon } from '../common/Icon.tsx';
import { Popover } from '../common/Popover.tsx';

/**
 * Job-Zeile (DESIGN.md §7.6.4, ersetzt Warteschlange und Budget-Fuß): eine 32-px-Zeile über dem Dock, nur solange
 * Generierungen laufen oder warten, kürzlich fertig wurden (10 s) oder fehlgeschlagen und noch nicht ausgeblendet
 * sind. Fortschritt als 2-px-Linie in --text-2 (nie Tungsten); ohne Schätzung steht sie still auf 0 %.
 */

/** So lange bleibt eine fertige Generierung sichtbar. */
export const JOB_DONE_MS = 10_000;
/** Fehlgeschlagene Generierungen aus früheren Sitzungen tauchen nicht wieder auf. */
const SESSION_START = Date.now() - 5 * 60_000;

type JobState = 'running' | 'queued' | 'failed' | 'done';

interface Job {
  generation: Generation;
  state: JobState;
}

const ORDER: Record<JobState, number> = { running: 0, queued: 1, failed: 2, done: 3 };

function finishedAt(g: Generation): number {
  return Date.parse(g.finishedAt ?? g.createdAt);
}

export function visibleJobs(generations: readonly Generation[], now: number, dismissed: ReadonlySet<string>): Job[] {
  const jobs: Job[] = [];
  for (const g of generations) {
    if (g.status === 'running' || g.status === 'queued') jobs.push({ generation: g, state: g.status });
    else if (g.status === 'failed' && !dismissed.has(g.id) && finishedAt(g) >= SESSION_START) jobs.push({ generation: g, state: 'failed' });
    else if ((g.status === 'completed' || g.status === 'canceled') && now - finishedAt(g) < JOB_DONE_MS) jobs.push({ generation: g, state: 'done' });
  }
  return jobs.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.generation.queuePosition ?? 0) - (b.generation.queuePosition ?? 0));
}

/** Kurzer Modellname: Anzeigename aus dem Katalog, sonst der Name hinter dem Anbieter (`minimax/h3-max/…` → `h3-max`). */
export function shortModelName(endpointId: string, models: readonly ModelInfo[] | null): string {
  const known = models?.find((m) => m.id === endpointId)?.displayName;
  if (known) return known;
  const parts = endpointId.split('/').filter(Boolean);
  return parts[1] ?? parts[0] ?? endpointId;
}

/** Angeforderte Länge der Ausgabe („8 s“), falls die Eingabe sie nennt. */
function outputSeconds(g: Generation): number | null {
  const raw = g.input.duration ?? g.input.duration_seconds ?? g.input.seconds;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function JobRow({ job, now, models, onDismiss, more }: { job: Job; now: number; models: readonly ModelInfo[] | null; onDismiss?: () => void; more?: React.ReactNode }) {
  const t = useT();
  const g = job.generation;
  const started = Date.parse(g.submittedAt ?? g.createdAt);
  const elapsedMs = Math.max(0, now - (Number.isFinite(started) ? started : now));
  const seconds = outputSeconds(g);
  const model = `${shortModelName(g.endpointId, models)}${seconds ? ` · ${Math.round(seconds)}\u00A0s` : ''}`;
  // Fortschritt nur mit Schätzung (Restdauer); sonst statisch 0 %
  const progress = job.state === 'running' && g.etaSec !== undefined ? Math.min(1, elapsedMs / 1000 / (elapsedMs / 1000 + Math.max(0, g.etaSec))) : 0;
  return (
    <div className={`job job-${job.state}`} data-generation-id={g.id}>
      <span className="job-icon" aria-hidden="true">
        {job.state === 'running' || job.state === 'queued' ? (
          <span className="spin" />
        ) : job.state === 'failed' ? (
          <Icon name="close" size={12} />
        ) : (
          <Icon name={g.status === 'canceled' ? 'minus' : 'check'} size={12} />
        )}
      </span>
      <span className="job-what" title={`${g.purpose} · ${model}`}>
        {g.purpose}
      </span>
      <span className="job-model">{model}</span>
      <span className="sr-only">{t(`director.gen.${g.status}`)}</span>
      <span className="job-time mono">
        {job.state === 'queued' ? (g.queuePosition ? t('director.queuePosition', { n: g.queuePosition }) : t('director.gen.queued')) : job.state === 'running' ? formatElapsed(elapsedMs) : ''}
      </span>
      <span className="job-cost mono">{job.state === 'done' && g.costUsd !== undefined ? formatUsd(g.costUsd) : job.state === 'done' ? '' : `≈ ${formatUsd(g.estimateUsd)}`}</span>
      {more}
      {onDismiss && (
        <button type="button" className="ibtn sm job-dismiss" aria-label={t('jobs.dismiss')} onClick={onDismiss}>
          <Icon name="close" size={12} />
        </button>
      )}
      {job.state === 'running' && (
        <span className="job-progress" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
        </span>
      )}
    </div>
  );
}

export function JobTray() {
  const t = useT();
  const generations = useStudio((s) => s.generations);
  const models = useStudio((s) => s.models);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState(false);

  const jobs = useMemo(() => visibleJobs(generations, now, dismissed), [generations, now, dismissed]);
  const ticking = jobs.some((j) => j.state === 'running' || j.state === 'done');
  const recentDone = generations.some((g) => (g.status === 'completed' || g.status === 'canceled') && Date.now() - finishedAt(g) < JOB_DONE_MS);

  // Sekundentakt für die verstrichene Zeit und das Ausblenden fertiger Jobs
  useEffect(() => {
    setNow(Date.now());
    if (!ticking && !recentDone) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, recentDone]);

  useEffect(() => {
    if (jobs.length < 2) setOpen(false);
  }, [jobs.length]);

  if (jobs.length === 0) return null;
  const [first, ...rest] = jobs;
  const dismiss = (id: string) => setDismissed((s) => new Set([...s, id]));

  const more =
    rest.length > 0 ? (
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top"
        align="end"
        label={t('jobs.label')}
        className="jobs-popover"
        anchor={
          <button type="button" className="job-more mono" aria-haspopup="dialog" aria-expanded={open} aria-label={t('jobs.moreLabel', { count: rest.length })} onClick={() => setOpen((v) => !v)}>
            {t('jobs.more', { count: rest.length })}
          </button>
        }
      >
        <div className="jobs-list">
          {jobs.map((job) => (
            <JobRow key={job.generation.id} job={job} now={now} models={models} onDismiss={job.state === 'failed' ? () => dismiss(job.generation.id) : undefined} />
          ))}
        </div>
      </Popover>
    ) : null;

  return (
    <div className="job-tray" role="status" aria-label={t('jobs.label')}>
      <JobRow key={first!.generation.id} job={first!} now={now} models={models} more={more} onDismiss={first!.state === 'failed' ? () => dismiss(first!.generation.id) : undefined} />
    </div>
  );
}
