import { build, type Message, type Plugin } from 'esbuild';
import { ALLOWED_COMPONENT_IMPORTS, COMPILED_COMPONENT_MARKER } from '../component-loader.ts';

/**
 * Übersetzt eine vom Director geschriebene TSX-Komponente (Default-Export = React-Komponente mit
 * `OverlayComponentProps`) mit esbuild zu CommonJS-artigem Code. `react`, `react/jsx-runtime`,
 * `remotion` und `@studio/fx` bleiben extern und werden zur Laufzeit von `loadCompiledComponent`
 * injiziert. Vorher laufen statische Prüfungen (Import-Allowlist, kein Netzwerk, kein eval,
 * Determinismus). Fehlermeldungen sind deutsch und nennen Zeile:Spalte.
 */

export interface CompileResult {
  ok: boolean;
  code?: string;
  errors: string[];
  warnings: string[];
}

export interface CompileOptions {
  fileName?: string;
}

interface Rule {
  re: RegExp;
  message: string;
  warning?: boolean;
}

const RULES: Rule[] = [
  { re: /\bfetch\s*\(/g, message: 'fetch() ist nicht erlaubt (kein Netzwerk in Komponenten)' },
  { re: /\bXMLHttpRequest\b/g, message: 'XMLHttpRequest ist nicht erlaubt (kein Netzwerk in Komponenten)' },
  { re: /\bWebSocket\b/g, message: 'WebSocket ist nicht erlaubt (kein Netzwerk in Komponenten)' },
  { re: /\bEventSource\b/g, message: 'EventSource ist nicht erlaubt (kein Netzwerk in Komponenten)' },
  { re: /\bsendBeacon\b/g, message: 'navigator.sendBeacon ist nicht erlaubt (kein Netzwerk in Komponenten)' },
  { re: /(?<![.\w$])eval\s*\(/g, message: 'eval() ist nicht erlaubt' },
  { re: /\bnew\s+Function\b|(?<![.\w$])Function\s*\(/g, message: 'new Function() ist nicht erlaubt' },
  { re: /(?<![.\w$])import\s*\(/g, message: 'Dynamisches import() ist nicht erlaubt' },
  { re: /(?<![.\w$])process\s*[.[]|\btypeof\s+process\b/g, message: 'process ist in Komponenten nicht verfügbar' },
  { re: /\bDate\s*\.\s*now\s*\(/g, message: 'Date.now() ist nicht erlaubt (nicht deterministisch) – Zeit aus frame/fps ableiten' },
  { re: /\bnew\s+Date\s*\(\s*\)/g, message: 'new Date() ohne Argumente ist nicht erlaubt (nicht deterministisch)' },
  { re: /(?<!new\s+)(?<![.\w$])Date\s*\(/g, message: 'Date() ist nicht erlaubt (nicht deterministisch)' },
  { re: /\bperformance\s*\.\s*now\s*\(/g, message: 'performance.now() ist nicht erlaubt (nicht deterministisch)' },
  { re: /\bMath\s*\.\s*random\b/g, message: 'Math.random ist nicht erlaubt – props.random(salt) verwenden (deterministisch)' },
  { re: /\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b/g, message: 'crypto-Zufall ist nicht erlaubt – props.random(salt) verwenden' },
  { re: /\b(?:localStorage|sessionStorage|indexedDB)\b/g, message: 'Browser-Speicher (localStorage/sessionStorage/indexedDB) ist nicht erlaubt' },
  { re: /\bdocument\s*\.\s*cookie\b/g, message: 'document.cookie ist nicht erlaubt' },
  { re: /\b(?:window|self|globalThis)\s*\.\s*(?:parent|top|opener|frameElement)\b/g, message: 'Zugriff auf window.parent/top/opener ist nicht erlaubt' },
  { re: /\bpostMessage\s*\(/g, message: 'postMessage ist nicht erlaubt' },
  { re: /\bimportScripts\b|\bnew\s+(?:Shared)?Worker\b/g, message: 'Worker/importScripts sind nicht erlaubt' },
  { re: /\b(?:window|self|globalThis)\s*\[/g, message: 'Dynamischer Zugriff auf globale Objekte (window[…]) ist nicht erlaubt' },
  { re: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/g, message: 'Timer/requestAnimationFrame wirken beim Rendern nicht – Animation aus frame berechnen', warning: true },
  { re: /\buse(?:State|Effect|LayoutEffect|Reducer)\s*\(/g, message: 'useState/useEffect: Remotion rendert jeden Frame unabhängig – Zustand über Frames hinweg ist nicht deterministisch', warning: true },
];

/**
 * Ersetzt Kommentare und den Inhalt von String-/Template-Literalen durch Leerzeichen (gleiche Länge,
 * Zeilenumbrüche bleiben), damit Prüfungen nur echten Code sehen. `${…}` in Templates bleibt Code.
 */
export function blankCommentsAndStrings(source: string): string {
  const out = source.split('');
  const blank = (i: number) => {
    if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };
  const templateDepth: number[] = [];
  let i = 0;
  let braceDepth = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }
    if (ch === '/' && next === '*') {
      blank(i++);
      blank(i++);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      if (i < source.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') blank(i++);
        blank(i++);
      }
      i++;
      continue;
    }
    if (ch === '`' || (ch === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === braceDepth)) {
      if (ch === '}') templateDepth.pop();
      i++;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') {
          blank(i++);
          blank(i++);
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          templateDepth.push(braceDepth);
          i += 2;
          break;
        }
        blank(i++);
      }
      if (source[i] === '`') i++;
      continue;
    }
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    i++;
  }
  return out.join('');
}

function lineCol(source: string, index: number): string {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else col++;
  }
  return `Zeile ${line}:${col}`;
}

/** Statische Prüfungen auf dem Quelltext (ohne Übersetzung). */
export function checkComponentSource(source: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = blankCommentsAndStrings(source);
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(code)) !== null) {
      const msg = `${lineCol(source, m.index)}: ${rule.message}`;
      if (!seen.has(msg)) {
        seen.add(msg);
        (rule.warning ? warnings : errors).push(msg);
      }
      if (rule.warning) break;
    }
  }
  // require(…) nur mit erlaubten Modulnamen
  const requireRe = /(?<![.\w$])require\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(code)) !== null) {
    const after = source.slice(m.index + m[0].length);
    const lit = /^\s*(['"])([^'"]+)\1\s*\)/.exec(after);
    if (!lit) errors.push(`${lineCol(source, m.index)}: require() nur mit festem Modulnamen erlaubt`);
    else if (!(ALLOWED_COMPONENT_IMPORTS as readonly string[]).includes(lit[2]!)) {
      errors.push(`${lineCol(source, m.index)}: require("${lit[2]}") ist nicht erlaubt (erlaubt: ${ALLOWED_COMPONENT_IMPORTS.join(', ')})`);
    }
  }
  if (!/\bexport\s+default\b/.test(code) && !/\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(code)) {
    errors.push('Kein Default-Export gefunden – die Komponente muss mit `export default` exportiert werden');
  }
  return { errors, warnings };
}

function formatMessage(msg: Message, kind: 'Fehler' | 'Warnung'): string {
  const loc = msg.location ? `Zeile ${msg.location.line}:${msg.location.column + 1}: ` : '';
  return `${loc}${kind === 'Fehler' ? 'Übersetzungsfehler' : 'Hinweis'}: ${msg.text}`;
}

const allowlistPlugin: Plugin = {
  name: 'studio-import-allowlist',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      if ((ALLOWED_COMPONENT_IMPORTS as readonly string[]).includes(args.path)) return { path: args.path, external: true };
      return {
        errors: [{ text: `Import „${args.path}“ ist nicht erlaubt (erlaubt: ${ALLOWED_COMPONENT_IMPORTS.join(', ')})` }],
      };
    });
  },
};

/** Übersetzt eine Director-Komponente; `ok: false` mit deutschen Fehlermeldungen bei Verstößen. */
export async function compileComponent(source: string, opts: CompileOptions = {}): Promise<CompileResult> {
  const fileName = opts.fileName ?? 'component.tsx';
  const checks = checkComponentSource(source);
  const errors = [...checks.errors];
  const warnings = [...checks.warnings];
  const loader = /\.tsx$/.test(fileName) ? 'tsx' : /\.ts$/.test(fileName) ? 'ts' : /\.jsx$/.test(fileName) ? 'jsx' : /\.js$/.test(fileName) ? 'jsx' : 'tsx';
  let code: string | undefined;
  try {
    const result = await build({
      stdin: { contents: source, loader, sourcefile: fileName, resolveDir: '/' },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      jsxImportSource: 'react',
      plugins: [allowlistPlugin],
      logLevel: 'silent',
      legalComments: 'none',
      charset: 'utf8',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    for (const w of result.warnings) warnings.push(formatMessage(w, 'Warnung'));
    code = `${COMPILED_COMPONENT_MARKER}\n${result.outputFiles[0]?.text ?? ''}`;
  } catch (error) {
    const failure = error as { errors?: Message[]; warnings?: Message[]; message?: string };
    if (failure.errors?.length) {
      for (const e of failure.errors) {
        const text = formatMessage(e, 'Fehler');
        // Import-Verstöße kommen schon aus dem Plugin – nicht doppelt melden
        if (!errors.includes(text)) errors.push(text.replace('Übersetzungsfehler: Import', 'Import'));
      }
    } else {
      errors.push(`Übersetzungsfehler: ${failure.message ?? String(error)}`);
    }
  }
  const ok = errors.length === 0 && code !== undefined;
  return ok ? { ok, code: code!, errors, warnings } : { ok: false, errors, warnings };
}

/** Prüft, ob ein String bereits übersetzter Komponenten-Code ist. */
export function isCompiledComponent(code: string): boolean {
  return code.startsWith(COMPILED_COMPONENT_MARKER);
}
