import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadBrowserComponent } from '../src/component-runtime.ts';
import { activateMediaSandbox } from '../src/sandbox-role.ts';

afterEach(() => vi.unstubAllGlobals());
function setup(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'dangerously' });
  Object.defineProperty(dom.window, 'parent', { value: {} }); Object.defineProperty(dom.window, 'origin', { value: 'null' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); activateMediaSandbox(); return dom;
}
const deps = { React: { fixture: true }, jsxRuntime: {}, remotion: {} };
describe('opaque browser component script loader', () => {
  it('runs ordinary CJS exports and allowed dependencies without Function or eval', () => {
    const dom = setup(); const construct = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('Unsafe eval forbidden'); });
    try {
      const component = loadBrowserComponent('module.exports = function(){return require("react").fixture}', deps);
      expect((component as () => unknown)()).toBe(true);
      expect(Object.keys(dom.window).some(key => key.startsWith('__director_component_'))).toBe(false);
      expect(dom.window.document.head.querySelectorAll('script').length).toBe(0);
    } finally { construct.mockRestore(); dom.window.close(); }
  });
  it('retains deterministic Math/Date and shadowed network globals', () => {
    const dom = setup();
    try {
      for (const source of ['Math.random()', 'Date.now()', 'new Date()', 'Date()']) {
        const component = loadBrowserComponent(`exports.default = () => ${source}`, deps);
        expect(() => (component as () => unknown)()).toThrow('nicht erlaubt');
      }
      const deterministic = loadBrowserComponent('exports.default = () => [new Date("2020-01-01").getUTCFullYear(), typeof fetch, typeof Worker]', deps);
      expect((deterministic as () => unknown)()).toEqual([2020, 'undefined', 'undefined']);
    } finally { dom.window.close(); }
  });
  it('rejects unavailable imports and a missing React export', () => {
    const dom = setup();
    try {
      expect(() => loadBrowserComponent('require("node:fs")', deps)).toThrow('nicht verfügbar');
      expect(() => loadBrowserComponent('exports.default = 42', deps)).toThrow('Default-Export');
    } finally { dom.window.close(); }
  });
});
