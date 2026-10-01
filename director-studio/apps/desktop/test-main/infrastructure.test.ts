import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssetUrl, createAssetHandler, parseAssetUrl, parseRange } from '../src/main/asset-protocol.ts';
import { channelFor, STUDIO_METHODS } from '../src/main/ipc-contract.ts';
import { SecretStore, type SecretCipher } from '../src/main/secrets.ts';
import { defaultSettings, SettingsStore } from '../src/main/settings.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dstudio-main-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Spielzeug-Cipher (XOR) – echte Verschlüsselung macht Electron safeStorage. */
const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain)].map((b) => b ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((b) => b ^ 0x5a)).toString(),
};

describe('SecretStore', () => {
  it('stores secrets encrypted and never in plain text', async () => {
    const store = new SecretStore(dir, fakeCipher);
    expect(await store.get('fal')).toBeNull();
    await store.set('fal', '  key-123  ');
    await store.set('anthropic', 'sk-ant-xyz');
    const raw = await readFile(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('key-123');
    expect(raw).not.toContain('sk-ant');
    const reopened = new SecretStore(dir, fakeCipher);
    expect(await reopened.get('fal')).toBe('key-123');
    await reopened.set('fal', null);
    expect(await reopened.has('fal')).toBe(false);
    expect(await reopened.get('anthropic')).toBe('sk-ant-xyz');
  });

  it('refuses to store when encryption is unavailable', async () => {
    const store = new SecretStore(dir, { ...fakeCipher, isAvailable: () => false });
    await expect(store.set('fal', 'x')).rejects.toThrow(/nicht verfügbar/);
  });
});

describe('SettingsStore', () => {
  it('merges defaults and sanitizes values', async () => {
    const store = new SettingsStore(dir, defaultSettings('/home/u/Documents'));
    expect(await store.get()).toEqual({
      language: 'de',
      defaultEffort: 'xhigh',
      preferredRuntime: 'auto',
      projectsDir: '/home/u/Documents/Director Studio',
      allowClaudeSubscription: false,
    });
    const updated = await store.update({ language: 'en', defaultEffort: 'bogus' as never, preferredRuntime: 'fal', allowClaudeSubscription: true });
    expect(updated).toMatchObject({ language: 'en', defaultEffort: 'xhigh', preferredRuntime: 'fal', allowClaudeSubscription: true });
    const again = new SettingsStore(dir, defaultSettings('/x'));
    expect((await again.get()).preferredRuntime).toBe('fal');
  });
});

describe('asset protocol', () => {
  it('builds and parses urls', () => {
    const url = buildAssetUrl('prj_1', 'ast 2', 'thumb');
    expect(url).toBe('studio-asset://prj_1/ast%202?v=thumb');
    expect(parseAssetUrl(url)).toEqual({ projectId: 'prj_1', assetId: 'ast 2', variant: 'thumb' });
    expect(parseAssetUrl('studio-asset://prj_1/a')).toEqual({ projectId: 'prj_1', assetId: 'a', variant: 'original' });
    expect(parseAssetUrl('https://x/y')).toBeNull();
    expect(parseAssetUrl('studio-asset://prj/../etc/passwd')).toBeNull();
  });

  it('parses ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=200-300', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });

  it('serves files with range support', async () => {
    const file = join(dir, 'clip.mp4');
    await writeFile(file, '0123456789');
    const handler = createAssetHandler(async (projectId, assetId, variant) =>
      projectId === 'p' && assetId === 'a' && variant === 'original' ? { path: file, mime: 'video/mp4' } : null,
    );
    const full = await handler(new Request('studio-asset://p/a'));
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(await full.text()).toBe('0123456789');
    const partial = await handler(new Request('studio-asset://p/a', { headers: { range: 'bytes=2-5' } }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await partial.text()).toBe('2345');
    expect((await handler(new Request('studio-asset://p/a', { headers: { range: 'bytes=50-' } }))).status).toBe(416);
    expect((await handler(new Request('studio-asset://p/missing'))).status).toBe(404);
    expect((await handler(new Request('studio-asset://p/a', { method: 'POST' }))).status).toBe(405);
  });
});

describe('ipc contract', () => {
  it('has unique channels', () => {
    const channels = STUDIO_METHODS.map(channelFor);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toContain('studio:sendMessage');
  });
});
