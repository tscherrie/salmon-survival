import type { ComponentType } from 'react';
import * as studioFxModule from './fx/index.ts';
import type { OverlayComponentProps } from './composition/types.ts';

/**
 * Lädt eine mit `compileComponent` übersetzte Director-Komponente (CommonJS-artiger Code, der
 * `react`, `react/jsx-runtime`, `remotion` und `@studio/fx` per `require` erwartet).
 *
 * SICHERHEIT: Das führt Code aus (`new Function`). Erlaubt ist das NUR dort, wo ohnehin fremder Code
 * laufen darf: im Render-Worker (Headless-Chromium von Remotion) und in einer isolierten Vorschau
 * (sandboxed iframe ohne `allow-same-origin` bzw. eigene `WebContentsView` ohne Preload/Node).
 * Niemals im privilegierten App-Renderer aufrufen. Die statischen Prüfungen von `compileComponent`
 * sind eine Leitplanke, keine Sandbox; zusätzlich werden hier gefährliche/nicht deterministische
 * Globale im Modul-Scope überschattet (`fetch`, `XMLHttpRequest`, `WebSocket`, `process`,
 * Storage, `postMessage`; `Math.random`, `Date.now()` und `new Date()` werfen).
 */

export const COMPILED_COMPONENT_MARKER = '/* @studio/component v1 */';
export const ALLOWED_COMPONENT_IMPORTS = ['react', 'react/jsx-runtime', 'remotion', '@studio/fx'] as const;

export interface ComponentDeps {
  React: unknown;
  jsxRuntime: unknown;
  remotion: unknown;
  /** Standard: eingebaute `@studio/fx`-Helfer. */
  fx?: unknown;
}

const SHADOWED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'process',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'postMessage',
  'importScripts',
  'Worker',
  'SharedWorker',
] as const;

function deterministicMath(): Math {
  return Object.create(Math, {
    random: {
      value: () => {
        throw new Error('Math.random() ist nicht erlaubt – props.random(salt) verwenden (deterministisch)');
      },
    },
  }) as Math;
}

function deterministicDate(): DateConstructor {
  const RealDate = Date;
  function SafeDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) throw new Error('Date() ist nicht erlaubt (nicht deterministisch)');
    if (args.length === 0) throw new Error('new Date() ohne Argumente ist nicht erlaubt (nicht deterministisch)');
    return Reflect.construct(RealDate, args, new.target);
  }
  SafeDate.prototype = RealDate.prototype;
  Object.assign(SafeDate, {
    now: () => {
      throw new Error('Date.now() ist nicht erlaubt (nicht deterministisch) – Zeit aus frame/fps ableiten');
    },
    UTC: RealDate.UTC,
    parse: RealDate.parse,
  });
  return SafeDate as unknown as DateConstructor;
}

/** Führt kompilierten Komponenten-Code aus und liefert den Default-Export (React-Komponente). */
export function loadCompiledComponent(code: string, deps: ComponentDeps): ComponentType<OverlayComponentProps> {
  const modules: Record<string, unknown> = {
    react: deps.React,
    'react/jsx-runtime': deps.jsxRuntime,
    remotion: deps.remotion,
    '@studio/fx': deps.fx ?? studioFxModule,
  };
  const requireShim = (id: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(modules, id) && modules[id] !== undefined) return modules[id];
    throw new Error(`Modul „${id}“ ist in Komponenten nicht verfügbar (erlaubt: ${ALLOWED_COMPONENT_IMPORTS.join(', ')})`);
  };
  const module: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('require', 'module', 'exports', 'Math', 'Date', ...SHADOWED_GLOBALS, code) as (...args: unknown[]) => void;
  factory(requireShim, module, module.exports, deterministicMath(), deterministicDate(), ...SHADOWED_GLOBALS.map(() => undefined));
  const exported = module.exports as { default?: unknown } | ((...args: unknown[]) => unknown);
  const candidate = typeof exported === 'function' ? exported : (exported.default ?? exported);
  if (typeof candidate === 'function') return candidate as ComponentType<OverlayComponentProps>;
  if (candidate && typeof candidate === 'object' && '$$typeof' in candidate) return candidate as unknown as ComponentType<OverlayComponentProps>;
  throw new Error('Die Komponente hat keinen gültigen Default-Export (React-Komponente erwartet)');
}
