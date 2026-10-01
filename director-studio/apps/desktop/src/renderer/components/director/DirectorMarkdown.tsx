import { secondsToFrames } from '@studio/core';
import { useT } from '../../i18n.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { formatTc, tcParts } from '../../lib/timecode.ts';
import { useActions, useApi, useViewDocument } from '../../state/context.tsx';

/**
 * Markdown des Directors: Timecodes springen im Monitor dorthin, Links öffnen extern. Der Director schreibt Zeiten
 * als `mm:ss.mmm` (Datenformat aus Core); angezeigt werden sie im Format der Chips, `MM:SS:FF` (DESIGN.md §9.2).
 */
export function DirectorMarkdown({ text }: { text: string }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const doc = useViewDocument();
  const fps = doc?.kind === 'timeline' ? doc.fps : null;
  return (
    <Markdown
      text={text}
      onTimecode={fps ? (seconds) => actions.requestSeek(secondsToFrames(seconds, fps)) : undefined}
      timecodeLabel={(tc, seconds) => t('director.seek', { time: fps ? formatTc(secondsToFrames(seconds, fps), fps, 'short') : tc })}
      renderTimecode={
        fps
          ? (seconds) => {
              const { head, frames } = tcParts(secondsToFrames(seconds, fps), fps, 'short');
              return (
                <>
                  {head}
                  <span className="ff">{frames}</span>
                </>
              );
            }
          : undefined
      }
      onLink={(href) => void api.openExternal(href)}
    />
  );
}
