import { afterEach, expect, it, vi } from 'vitest';
import { activateMediaSandbox, assertMediaSandboxRole } from '../src/sandbox-role.ts';

afterEach(() => vi.unstubAllGlobals());
it('rejects an opaque editor and accepts only an explicitly activated isolated media document', () => {
  const parent = {}; Object.defineProperty(parent, 'document', { get: () => { throw new DOMException('Opaque origin', 'SecurityError'); } });
  const outer = { parent, origin: 'null' }; vi.stubGlobal('window', outer);
  expect(() => assertMediaSandboxRole()).toThrow('separate Medienframe');
  activateMediaSandbox(); expect(() => assertMediaSandboxRole()).not.toThrow();
  vi.stubGlobal('window', { parent: { document: {} }, origin: 'null' });
  expect(() => assertMediaSandboxRole()).toThrow('keinen Zugriff');
});
