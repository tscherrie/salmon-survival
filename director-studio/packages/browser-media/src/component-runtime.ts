import type { ComponentType } from 'react';
import { ALLOWED_COMPONENT_IMPORTS, studioFx, type ComponentDeps, type OverlayComponentProps } from '@studio/render/browser';
import { BrowserCapabilityError } from './types.ts';
import { assertMediaSandboxRole } from './sandbox-role.ts';

const shadowed = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'localStorage', 'sessionStorage', 'indexedDB', 'postMessage', 'importScripts', 'Worker', 'SharedWorker'];
function safeMath(): Math {
  return Object.create(Math, { random: { value: () => { throw new Error('Math.random() ist nicht erlaubt – props.random(salt) verwenden (deterministisch)'); } } }) as Math;
}
function safeDate(): DateConstructor {
  const RealDate = Date;
  function SafeDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) throw new Error('Date() ist nicht erlaubt (nicht deterministisch)');
    if (!args.length) throw new Error('new Date() ohne Argumente ist nicht erlaubt (nicht deterministisch)');
    return Reflect.construct(RealDate, args, new.target);
  }
  SafeDate.prototype = RealDate.prototype;
  Object.assign(SafeDate, { now: () => { throw new Error('Date.now() ist nicht erlaubt (nicht deterministisch) – Zeit aus frame/fps ableiten'); }, UTC: RealDate.UTC, parse: RealDate.parse });
  return SafeDate as unknown as DateConstructor;
}
/** Uses ordinary script execution in the opaque frame; CSP unsafe-eval is unnecessary. */
export function loadBrowserComponent(code: string, deps: ComponentDeps): ComponentType<OverlayComponentProps> {
  assertMediaSandboxRole();
  const modules: Record<string, unknown> = { react: deps.React, 'react/jsx-runtime': deps.jsxRuntime, remotion: deps.remotion, '@studio/fx': deps.fx ?? studioFx };
  const require = (id: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(modules, id) && modules[id] !== undefined) return modules[id];
    throw new Error(`Modul „${id}“ ist in Komponenten nicht verfügbar (erlaubt: ${ALLOWED_COMPONENT_IMPORTS.join(', ')})`);
  };
  const module = { exports: {} as unknown };
  const record = { require, module, Math: safeMath(), Date: safeDate(), complete: false, error: undefined as unknown };
  const key = `__director_component_${crypto.randomUUID().replaceAll('-', '')}`;
  const scope = window as unknown as Record<string, unknown>; scope[key] = record;
  const script = document.createElement('script');
  // Deleting the registry before invoking authored code keeps the trusted dependency handoff local.
  script.textContent = `(function(){const record=window[${JSON.stringify(key)}];delete window[${JSON.stringify(key)}];try{const factory=function(require,module,exports,Math,Date,${shadowed.join(',')}){\n${code}\n};factory(record.require,record.module,record.module.exports,record.Math,record.Date,${shadowed.map(() => 'undefined').join(',')});record.complete=true;}catch(error){record.error=error;record.complete=true;}})();`;
  try { document.head.append(script); }
  finally { script.remove(); delete scope[key]; }
  if (!record.complete) throw new BrowserCapabilityError('component-script', 'Die isolierte Komponente konnte nicht starten; Inline-Skripte werden durch die Host-CSP blockiert oder der Quelltext ist ungültig');
  if (record.error) throw record.error;
  const exported = module.exports as { default?: unknown } | ((...args: unknown[]) => unknown);
  const candidate = typeof exported === 'function' ? exported : exported?.default ?? exported;
  if (typeof candidate === 'function' || (candidate && typeof candidate === 'object' && '$$typeof' in candidate)) return candidate as ComponentType<OverlayComponentProps>;
  throw new Error('Die Komponente hat keinen gültigen Default-Export (React-Komponente erwartet)');
}
