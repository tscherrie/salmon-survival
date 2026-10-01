import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { AddressInfo, LookupFunction } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createWebPort, isBlockedAddress } from '../src/main/web.ts';

let server: Server;
let port: number;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/bild.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': '4' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } else if (url.pathname === '/seite') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Café &amp; Kuchen</title></head><body>Hallo</body></html>');
    } else if (url.pathname === '/weiter') {
      res.writeHead(302, { location: '/bild.png' });
      res.end();
    } else if (url.pathname === '/nach-intern') {
      res.writeHead(302, { location: `http://evil.test:${port}/bild.png` });
      res.end();
    } else if (url.pathname === '/gross') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(Buffer.alloc(100, 1));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-web-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Test-DNS: good.test → Loopback (für den Testserver als „öffentlich“ zugelassen), evil.test → privates Netz. */
const lookup = ((hostname: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
  const address = ({ 'good.test': '127.0.0.1', 'evil.test': '10.1.2.3' } as Record<string, string>)[hostname];
  if (!address) return cb(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
  return opts.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
}) as unknown as LookupFunction;
const testPort = (extra: Parameters<typeof createWebPort>[0] = {}) => createWebPort({ lookup, isBlocked: (a) => isBlockedAddress(a) && a !== '127.0.0.1', ...extra });

describe('isBlockedAddress', () => {
  it('sperrt Loopback, private Netze, Link-Local, CGNAT, IPv6-lokal und gemappte Adressen', () => {
    for (const a of ['127.0.0.1', '10.0.0.8', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1', 'kein-ip']) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(a), a).toBe(false);
    }
  });
});

describe('createWebPort().download', () => {
  it('lehnt den lokalen Rechner standardmäßig ab (auch über IP-Literal und localhost)', async () => {
    const web = createWebPort();
    await expect(web.download!(`http://127.0.0.1:${port}/bild.png`, dir)).rejects.toThrow(/lokale\/private Adresse/);
    await expect(web.download!(`http://localhost:${port}/bild.png`, dir)).rejects.toThrow(/lokale\/private Adresse/);
    await expect(web.download!('http://[::1]/x', dir)).rejects.toThrow(/lokale\/private Adresse/);
    await expect(web.download!('http://169.254.169.254/latest/meta-data', dir)).rejects.toThrow(/lokale\/private Adresse/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('lehnt andere Schemata und Zugangsdaten in der URL ab', async () => {
    const web = createWebPort();
    await expect(web.download!('file:///etc/passwd', dir)).rejects.toThrow(/Nur http\(s\)/);
    await expect(web.download!('https://user:pw@example.com/x.png', dir)).rejects.toThrow(/Zugangsdaten/);
  });

  it('lädt eine Datei mit Typ, Größe und endgültiger URL (auch nach Weiterleitung)', async () => {
    const web = testPort();
    const file = await web.download!(`http://good.test:${port}/weiter`, dir);
    expect(file).toMatchObject({ contentType: 'image/png', bytes: 4, finalUrl: `http://good.test:${port}/bild.png` });
    expect([...(await readFile(file.path))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('prüft auch das Ziel einer Weiterleitung (kein Umweg ins lokale Netz)', async () => {
    const web = testPort();
    await expect(web.download!(`http://good.test:${port}/nach-intern`, dir)).rejects.toThrow(/evil\.test \(10\.1\.2\.3\).*nicht erlaubt/);
  });

  it('bricht über der Größengrenze ab und hinterlässt keine Teildatei', async () => {
    const web = testPort({ maxBytes: 10 });
    await expect(web.download!(`http://good.test:${port}/gross`, dir)).rejects.toThrow(/zu groß/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('liest den Seitentitel von HTML-Seiten und meldet HTTP-Fehler', async () => {
    const web = testPort();
    const page = await web.download!(`http://good.test:${port}/seite`, dir);
    expect(page).toMatchObject({ contentType: 'text/html', title: 'Café & Kuchen' });
    expect(page.path.endsWith('.html')).toBe(true);
    await expect(web.download!(`http://good.test:${port}/fehlt`, dir)).rejects.toThrow(/HTTP 404/);
  });
});
