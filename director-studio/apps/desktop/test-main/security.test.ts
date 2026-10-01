import { describe, expect, it, vi } from 'vitest';
import {
  GestureGate,
  isAllowedAppSubframeUrl,
  isAppUrl,
  isPreviewNavigationAllowed,
  isPreviewRequestAllowed,
  parsePickMessage,
  PICK_PREFIX,
  pickerBootstrap,
  previewCsp,
  resolvePreviewPath,
  safeExternalUrl,
  validatePickPayload,
  withPreviewCsp,
} from '../src/main/security.ts';

describe('safeExternalUrl', () => {
  it('lässt nur http(s) mit Host und ohne Zugangsdaten durch', () => {
    expect(safeExternalUrl('https://fal.ai/models')).toBe('https://fal.ai/models');
    expect(safeExternalUrl('http://127.0.0.1:5173/about')).toBe('http://127.0.0.1:5173/about');
    for (const bad of [
      'search-ms:query=x&crumb=location:%5C%5Cattacker%5Cshare',
      'smb://attacker/share',
      'zoommtg://attacker',
      'ms-officecmd:{"x":1}',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'vscode://file/x',
      'https://user:pw@example.com/',
      'not a url',
      '',
      42,
      null,
      `https://example.com/${'a'.repeat(5000)}`,
    ]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });
});

describe('GestureGate', () => {
  it('erlaubt genau eine Aktion je echter Eingabe im Zeitfenster', () => {
    let now = 1000;
    const gate = new GestureGate(2000, () => now);
    expect(gate.consume()).toBe(false);
    gate.note('mouseMove');
    expect(gate.consume()).toBe(false);
    gate.note('mouseUp');
    now += 500;
    expect(gate.consume()).toBe(true);
    expect(gate.consume()).toBe(false);
    gate.note('keyDown');
    now += 2500;
    expect(gate.consume()).toBe(false);
  });
});

describe('Navigationssperre des Hauptfensters', () => {
  const prodApp = 'file:///opt/Director%20Studio/resources/app/out/renderer/index.html';
  it('erlaubt in Produktion nur die eigene index.html (file:-Origins sind alle "null")', () => {
    expect(isAppUrl(`${prodApp}#/projekt/1`, prodApp)).toBe(true);
    expect(isAppUrl(`${prodApp}?x=1`, prodApp)).toBe(true);
    expect(isAppUrl('file:///opt/Director Studio/resources/app/out/renderer/index.html', prodApp)).toBe(true);
    expect(isAppUrl('file:///Users/x/Downloads/brandkit.html', prodApp)).toBe(false);
    expect(isAppUrl('file:///opt/Director%20Studio/resources/app/out/renderer/evil.html', prodApp)).toBe(false);
    expect(isAppUrl('studio-asset://prj/ast', prodApp)).toBe(false);
    expect(isAppUrl('data:text/html,<script>1</script>', prodApp)).toBe(false);
    expect(isAppUrl('https://example.com/', prodApp)).toBe(false);
    expect(isAppUrl('kaputt', prodApp)).toBe(false);
  });

  it('erlaubt im Dev-Modus nur den Vite-Origin', () => {
    const dev = 'http://localhost:5173/';
    expect(isAppUrl('http://localhost:5173/index.html', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false);
    expect(isAppUrl('file:///tmp/x.html', dev)).toBe(false);
  });

  it('erlaubt Unterframes nur für srcdoc/about/data/blob bzw. den App-Einstieg', () => {
    expect(isAllowedAppSubframeUrl('about:srcdoc', prodApp)).toBe(true);
    expect(isAllowedAppSubframeUrl('about:blank', prodApp)).toBe(true);
    expect(isAllowedAppSubframeUrl('blob:file:///abc', prodApp)).toBe(true);
    expect(isAllowedAppSubframeUrl('https://example.com/', prodApp)).toBe(false);
    expect(isAllowedAppSubframeUrl('file:///etc/passwd', prodApp)).toBe(false);
  });
});

describe('Vorschau: Netzwerk, Navigation, CSP', () => {
  const host = '127.0.0.1:5173';
  it('lässt nur den lokalen Vorschau-Server (inkl. HMR-WebSocket) durch', () => {
    expect(isPreviewRequestAllowed('http://127.0.0.1:5173/src/main.tsx', host)).toBe(true);
    expect(isPreviewRequestAllowed('ws://127.0.0.1:5173/?token=x', host)).toBe(true);
    expect(isPreviewRequestAllowed('data:image/png;base64,AAAA', host)).toBe(true);
    expect(isPreviewRequestAllowed('blob:http://127.0.0.1:5173/uuid', host)).toBe(true);
    expect(isPreviewRequestAllowed('https://attacker.example/c', host)).toBe(false);
    expect(isPreviewRequestAllowed('https://fonts.googleapis.com/css2?family=Inter', host)).toBe(false);
    expect(isPreviewRequestAllowed('http://127.0.0.1:8080/admin', host)).toBe(false);
    expect(isPreviewRequestAllowed('http://localhost:5173/', host)).toBe(false);
    expect(isPreviewRequestAllowed('file:///etc/passwd', host)).toBe(false);
    expect(isPreviewRequestAllowed('studio-asset://prj/ast', host)).toBe(false);
    expect(isPreviewRequestAllowed('http://127.0.0.1:5173/', null)).toBe(false);
  });

  it('prüft Navigationen und Seitenpfade', () => {
    expect(isPreviewNavigationAllowed('http://127.0.0.1:5173/about', host)).toBe(true);
    expect(isPreviewNavigationAllowed('about:srcdoc', host)).toBe(true);
    expect(isPreviewNavigationAllowed('https://example.com/', host)).toBe(false);
    expect(isPreviewNavigationAllowed('ws://127.0.0.1:5173/', host)).toBe(false);
    expect(resolvePreviewPath('http://127.0.0.1:5173/', '/about?x=1#team')).toBe('http://127.0.0.1:5173/about?x=1#team');
    expect(() => resolvePreviewPath('http://127.0.0.1:5173/', 'https://evil.example/')).toThrow(/Seitenpfad/);
    expect(() => resolvePreviewPath('http://127.0.0.1:5173/', '//evil.example/')).toThrow(/Seitenpfad/);
    expect(() => resolvePreviewPath('http://127.0.0.1:5173/', '/\\evil.example')).toThrow(/Seitenpfad/);
    expect(() => resolvePreviewPath('http://127.0.0.1:5173/', 'about')).toThrow(/Seitenpfad/);
  });

  it('hängt eine strikte CSP an jede Antwort an', () => {
    const csp = previewCsp(host);
    expect(csp).toContain("default-src 'self' data: blob:");
    expect(csp).toContain(`connect-src 'self' ws://${host}`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https:|\*/);
    const headers = withPreviewCsp({ 'content-type': ['text/html'], 'content-security-policy': ["script-src 'none'"] }, host);
    expect(headers['content-security-policy']).toEqual(["script-src 'none'", csp]);
    expect(headers['content-type']).toEqual(['text/html']);
    expect(withPreviewCsp(undefined, null)['Content-Security-Policy']).toEqual(["default-src 'none'"]);
  });
});

describe('Pick-Kanal', () => {
  const token = 'a'.repeat(48);
  const payload = { selector: 'h1', bbox: { x: 0, y: 0, width: 100, height: 40 }, text: 'Hallo', tag: 'h1', dataSid: 'hero', dataSrc: null, page: '/' };

  it('nimmt nur Meldungen mit dem Sitzungs-Token und gültiger Nutzlast an', () => {
    expect(parsePickMessage(`${PICK_PREFIX}${token}:${JSON.stringify(payload)}`, token)).toMatchObject({ selector: 'h1', text: 'Hallo' });
    // Seiten-Skript kennt das Token nicht.
    expect(parsePickMessage(`${PICK_PREFIX}${JSON.stringify(payload)}`, token)).toBeNull();
    expect(parsePickMessage(`${PICK_PREFIX}${'b'.repeat(48)}:${JSON.stringify(payload)}`, token)).toBeNull();
    // Ohne bbox (hätte pickPayloadToRef gesprengt) oder mit Riesen-Selektor.
    expect(parsePickMessage(`${PICK_PREFIX}${token}:${JSON.stringify({ selector: '#x' })}`, token)).toBeNull();
    expect(parsePickMessage(`${PICK_PREFIX}${token}:${JSON.stringify({ ...payload, selector: 'x'.repeat(600) })}`, token)).toBeNull();
    expect(parsePickMessage(`${PICK_PREFIX}${token}:{kaputt`, token)).toBeNull();
    expect(parsePickMessage(`${PICK_PREFIX}${token}:${JSON.stringify(payload)}`, '')).toBeNull();
    expect(validatePickPayload({ ...payload, bbox: { x: 0, y: 0, width: -1, height: 1 } })).toBeNull();
  });

  it('Bootstrap meldet mit Token und verwirft synthetische Klicks', () => {
    const listeners: Array<(ev: unknown) => void> = [];
    let enabled = false;
    const debug = vi.fn();
    const fakeWindow: Record<string, unknown> = {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (type === 'click') listeners.push(fn);
      },
    };
    const stubPicker = `window.__studioPicker = window.__studioPicker || { enable: function () { enabledRef(true); }, disable: function () { enabledRef(false); }, isEnabled: function () { return isEnabledRef(); } }`;
    const run = (on: boolean) =>
      new Function('window', 'console', 'enabledRef', 'isEnabledRef', pickerBootstrap(stubPicker, token, on))(
        fakeWindow,
        { debug },
        (v: boolean) => {
          enabled = v;
        },
        () => enabled,
      );
    run(true);
    run(true); // idempotent: nur ein Klick-Wächter
    expect(enabled).toBe(true);
    expect(listeners).toHaveLength(1);
    (fakeWindow.__studioPickerReport as (p: unknown) => void)(payload);
    const message = debug.mock.calls[0]![0] as string;
    expect(parsePickMessage(message, token)).toMatchObject({ selector: 'h1' });
    const synthetic = { isTrusted: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners[0]!(synthetic);
    expect(synthetic.stopImmediatePropagation).toHaveBeenCalled();
    const real = { isTrusted: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners[0]!(real);
    expect(real.stopImmediatePropagation).not.toHaveBeenCalled();
    run(false);
    expect(enabled).toBe(false);
  });
});
