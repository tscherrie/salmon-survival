import { secondsToFrames } from '@studio/core';
import { useT } from '../../i18n.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { useActions, useApi, useViewDocument } from '../../state/context.tsx';

/** Markdown des Directors: Timecodes springen im Monitor dorthin, Links öffnen extern. */
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
      timecodeLabel={(tc) => t('director.seek', { time: tc })}
      onLink={(href) => void api.openExternal(href)}
    />
  );
}
