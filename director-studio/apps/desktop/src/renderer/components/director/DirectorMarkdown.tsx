import { useMemo } from 'react';
import { secondsToFrames } from '@studio/core';
import { useT } from '../../i18n.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { refKey } from '../../lib/refNumbers.ts';
import { formatTc, tcParts } from '../../lib/timecode.ts';
import { useActions, useApi, useStudio, useViewDocument } from '../../state/context.tsx';

/** Nummern der Zeit-Chips im Composer als stabiler Text („time:720=1,time:372=2“), damit Tippen nicht neu rendert. */
function timeNumbersSignature(numbers: Record<string, number>): string {
  return Object.entries(numbers)
    .filter(([key]) => key.startsWith('time:'))
    .map(([key, n]) => `${key}=${n}`)
    .sort()
    .join(',');
}

/**
 * Markdown des Directors: Timecodes sind Daylight-Links (`.tc-link`), Links öffnen extern. Der Director schreibt Zeiten
 * als `mm:ss.mmm` (Datenformat aus Core); angezeigt werden sie im Format der Chips, `MM:SS:FF` (DESIGN.md §9.2). Ein
 * Klick zeigt die Stelle (`revealRef`: Abspielkopf, Blitz, Ansage). Steht im Composer ein Marker am selben Frame,
 * trägt der Link dessen Nummer; Hover verknüpft beide (§9.4; die Klassen setzt das Director-Panel).
 */
export function DirectorMarkdown({ text }: { text: string }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const doc = useViewDocument();
  const fps = doc?.kind === 'timeline' ? doc.fps : null;
  const signature = useStudio((s) => timeNumbersSignature(s.refNumbers));
  const numbers = useMemo(() => new Map(signature ? signature.split(',').map((pair) => [pair.split('=')[0]!, Number(pair.split('=')[1])] as const) : []), [signature]);
  return (
    <Markdown
      text={text}
      onTimecode={fps ? (seconds) => actions.revealRef({ kind: 'time', frame: secondsToFrames(seconds, fps) }) : undefined}
      timecodeLabel={(tc, seconds) => t('director.seek', { time: fps ? formatTc(secondsToFrames(seconds, fps), fps, 'short') : tc })}
      renderTimecode={
        fps
          ? (seconds) => {
              const frame = secondsToFrames(seconds, fps);
              const key = refKey({ kind: 'time', frame });
              const n = numbers.get(key);
              const { head, frames } = tcParts(frame, fps, 'short');
              return (
                <span className="tc-link-body" data-ref-key={key} onMouseEnter={() => actions.setHoveredRef(key)} onMouseLeave={() => actions.setHoveredRef(null)}>
                  {n !== undefined && <span className="n">{n}</span>}
                  {head}
                  <span className="ff">{frames}</span>
                </span>
              );
            }
          : undefined
      }
      onLink={(href) => void api.openExternal(href)}
    />
  );
}
