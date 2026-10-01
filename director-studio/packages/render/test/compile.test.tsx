import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as remotion from 'remotion';
import { describe, expect, it } from 'vitest';
import { blankCommentsAndStrings, checkComponentSource, compileComponent, isCompiledComponent, loadCompiledComponent, makeClipRandom, type OverlayComponentProps } from '../src/index.ts';

const GOOD = `
import { interpolate } from 'remotion';
import { onTwos, jitter } from '@studio/fx';
import type { OverlayComponentProps } from '@studio/render';

type Props = { color?: string };

// Kommentar mit fetch(...) und Math.random() wird ignoriert
export default function PaperTitle({ frame, durationInFrames, props, random, width }: OverlayComponentProps) {
  const p = props as Props;
  const t = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp' });
  const boil = onTwos(frame);
  const dx = jitter(random, 4, 'x' + boil);
  const label = \`Bild \${frame} von \${durationInFrames}\`;
  return (
    <div data-t={t.toFixed(2)} data-dx={dx.toFixed(4)} style={{ color: p.color ?? 'black', width }}>
      {label} – "fetch(" steht nur im Text
    </div>
  );
}
`;

function props(overrides: Partial<OverlayComponentProps> = {}): OverlayComponentProps {
  return {
    clip: { id: 'ov1', start: 0, duration: 30, in: 0, speed: 1 },
    frame: 15,
    durationInFrames: 30,
    fps: 30,
    width: 1920,
    height: 1080,
    props: { color: 'tomato' },
    assets: {},
    words: [],
    random: makeClipRandom('ov1', 15),
    ...overrides,
  };
}

describe('compileComponent', () => {
  it('übersetzt eine gültige Komponente, die sich laden und rendern lässt', async () => {
    const result = await compileComponent(GOOD, { fileName: 'PaperTitle.tsx' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(isCompiledComponent(result.code!)).toBe(true);
    expect(result.code).toContain('require("remotion")');
    const Comp = loadCompiledComponent(result.code!, { React, jsxRuntime, remotion });
    const html = renderToStaticMarkup(<Comp {...props()} />);
    expect(html).toContain('data-t="0.50"');
    expect(html).toContain('color:tomato');
    expect(html).toContain('Bild 15 von 30');
    // deterministisch
    expect(renderToStaticMarkup(<Comp {...props()} />)).toBe(html);
  });

  it.each([
    ['fetch', `export default () => { fetch('https://x'); return null; }`, 'fetch() ist nicht erlaubt'],
    ['XMLHttpRequest', `export default () => { new XMLHttpRequest(); return null; }`, 'XMLHttpRequest ist nicht erlaubt'],
    ['WebSocket', `export default () => { new WebSocket('ws://x'); return null; }`, 'WebSocket ist nicht erlaubt'],
    ['eval', `export default () => { eval('1'); return null; }`, 'eval() ist nicht erlaubt'],
    ['new Function', `export default () => { new Function('return 1'); return null; }`, 'new Function() ist nicht erlaubt'],
    ['import()', `export default () => { import('./x'); return null; }`, 'Dynamisches import() ist nicht erlaubt'],
    ['require', `const fs = require('fs'); export default () => null;`, 'require("fs") ist nicht erlaubt'],
    ['process', `export default () => <div>{process.env.HOME}</div>;`, 'process ist in Komponenten nicht verfügbar'],
    ['Date.now', `export default () => <div>{Date.now()}</div>;`, 'Date.now() ist nicht erlaubt'],
    ['new Date()', `export default () => <div>{String(new Date())}</div>;`, 'new Date() ohne Argumente'],
    ['Math.random', `export default () => <div>{Math.random()}</div>;`, 'Math.random ist nicht erlaubt'],
    ['localStorage', `export default () => <div>{localStorage.getItem('x')}</div>;`, 'Browser-Speicher'],
    ['document.cookie', `export default () => <div>{document.cookie}</div>;`, 'document.cookie ist nicht erlaubt'],
    ['window.parent', `export default () => <div>{String(window.parent)}</div>;`, 'window.parent/top/opener'],
    ['window.top', `export default () => <div>{String(window.top)}</div>;`, 'window.parent/top/opener'],
    ['postMessage', `export default () => { postMessage('x', '*'); return null; }`, 'postMessage ist nicht erlaubt'],
    ['Import-Allowlist', `import fs from 'node:fs';\nexport default () => <div>{String(fs)}</div>;`, 'Import „node:fs“ ist nicht erlaubt'],
    ['relativer Import', `import x from './util';\nexport default () => <div>{x}</div>;`, 'Import „./util“ ist nicht erlaubt'],
    ['kein Default-Export', `export const A = () => null;`, 'Kein Default-Export gefunden'],
    ['Syntaxfehler', `export default () => <div>`, 'Übersetzungsfehler'],
  ])('lehnt %s ab (deutsche Meldung)', async (_name, source, expected) => {
    const result = await compileComponent(source);
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.errors.join('\n')).toContain(expected);
  });

  it('nennt Zeile und Spalte', () => {
    const { errors } = checkComponentSource(`export default () => {\n  const x = 1;\n  return Math.random();\n};`);
    expect(errors).toEqual(['Zeile 3:10: Math.random ist nicht erlaubt – props.random(salt) verwenden (deterministisch)']);
  });

  it('Warnungen für Timer und Zustand, erlaubte Datumswerte mit Argumenten', async () => {
    const result = await compileComponent(`import { useState } from 'react';\nexport default () => { const [s] = useState(new Date(2020, 1, 1).getFullYear()); setTimeout(() => {}, 1); return <b>{s}</b>; };`);
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toContain('Timer/requestAnimationFrame');
    expect(result.warnings.join('\n')).toContain('useState/useEffect');
  });

  it('blendet Kommentare und Strings aus, behält Template-Ausdrücke', () => {
    const src = 'a("fetch(") /* eval( */ `x ${fetch(1)} y` // Math.random\n';
    const blanked = blankCommentsAndStrings(src);
    expect(blanked.length).toBe(src.length);
    expect(blanked).not.toContain('eval');
    expect(blanked).not.toContain('Math.random');
    expect(blanked).toContain('fetch(1)');
    expect(blanked.indexOf('fetch(')).toBe(src.indexOf('fetch(1)'));
  });

  it('Laufzeit-Schutz: Math.random/Date.now werfen auch bei verschleiertem Zugriff, fetch ist überschattet', () => {
    const code = `${'/* @studio/component v1 */'}\nmodule.exports = { default: function C(){ const M = Math; const D = Date; let out = []; try { M['ran'+'dom'](); } catch (e) { out.push(e.message); } try { D['no'+'w'](); } catch (e) { out.push(e.message); } out.push(typeof fetch); return out.join('|'); } };`;
    const Comp = loadCompiledComponent(code, { React, jsxRuntime, remotion }) as unknown as () => string;
    const out = Comp();
    expect(out).toContain('Math.random() ist nicht erlaubt');
    expect(out).toContain('Date.now() ist nicht erlaubt');
    expect(out.endsWith('undefined')).toBe(true);
    expect(() => loadCompiledComponent('module.exports = { default: 42 };', { React, jsxRuntime, remotion })).toThrow('keinen gültigen Default-Export');
    expect(() => loadCompiledComponent('require("fs");', { React, jsxRuntime, remotion })).toThrow('Modul „fs“ ist in Komponenten nicht verfügbar');
  });
});
