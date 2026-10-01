import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extendGuiPath, ffmpegMissingMessage, locateFfmpeg, pathDirs, wellKnownDirs } from '../src/main/ffmpeg.ts';

/** Simuliertes Dateisystem: Menge ausführbarer Dateien. */
function fakeFs(files: string[], dirs: Record<string, string[]> = {}) {
  const set = new Set(files);
  return {
    isExecutable: (file: string) => set.has(file),
    listDir: (dir: string) => {
      const entries = dirs[dir];
      if (!entries) throw new Error(`ENOENT ${dir}`);
      return entries;
    },
  };
}

describe('locateFfmpeg – macOS', () => {
  const home = '/Users/test';
  const guiEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };

  it('findet Homebrew (Apple Silicon), obwohl der GUI-PATH es nicht enthält', () => {
    const fs = fakeFs(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe']);
    const loc = locateFfmpeg({ platform: 'darwin', env: guiEnv, homedir: home, ...fs });
    expect(loc).toMatchObject({ ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', source: 'system', message: null });
  });

  it('findet Homebrew (Intel) unter /usr/local/bin', () => {
    const fs = fakeFs(['/usr/local/bin/ffmpeg', '/usr/local/bin/ffprobe']);
    const loc = locateFfmpeg({ platform: 'darwin', env: guiEnv, homedir: home, ...fs });
    expect(loc.ffmpeg).toBe('/usr/local/bin/ffmpeg');
    expect(loc.source).toBe('system');
  });

  it('Reihenfolge: Einstellung vor Umgebungsvariable vor mitgelieferten vor Systemorten vor PATH', () => {
    const all = ['/custom/ffmpeg', '/custom/ffprobe', '/env/ffmpeg', '/env/ffprobe', '/res/ffmpeg/ffmpeg', '/res/ffmpeg/ffprobe', '/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe', '/p/ffmpeg', '/p/ffprobe'];
    const base = { platform: 'darwin' as const, homedir: home, bundledDir: '/res/ffmpeg' };
    const env = { PATH: '/p', FFMPEG_PATH: '/env/ffmpeg' };
    expect(locateFfmpeg({ ...base, env, settingsPath: '/custom/ffmpeg', ...fakeFs(all) })).toMatchObject({ ffmpeg: '/custom/ffmpeg', ffprobe: '/custom/ffprobe', source: 'settings' });
    expect(locateFfmpeg({ ...base, env, ...fakeFs(all) })).toMatchObject({ ffmpeg: '/env/ffmpeg', ffprobe: '/env/ffprobe', source: 'env' });
    expect(locateFfmpeg({ ...base, env: { PATH: '/p' }, ...fakeFs(all) })).toMatchObject({ ffmpeg: '/res/ffmpeg/ffmpeg', source: 'bundled' });
    expect(locateFfmpeg({ ...base, env: { PATH: '/p' }, ...fakeFs(all.filter((f) => !f.startsWith('/res'))) })).toMatchObject({ ffmpeg: '/opt/homebrew/bin/ffmpeg', source: 'system' });
    expect(locateFfmpeg({ ...base, env: { PATH: '/p' }, ...fakeFs(['/p/ffmpeg', '/p/ffprobe']) })).toMatchObject({ ffmpeg: '/p/ffmpeg', ffprobe: '/p/ffprobe', source: 'path' });
  });

  it('Einstellung darf auf den Ordner zeigen; ffprobe kommt aus demselben Ordner', () => {
    const fs = fakeFs(['/tools/ffmpeg', '/tools/ffprobe', '/opt/homebrew/bin/ffprobe']);
    expect(locateFfmpeg({ platform: 'darwin', env: guiEnv, homedir: home, settingsPath: '/tools', ...fs })).toMatchObject({ ffmpeg: '/tools/ffmpeg', ffprobe: '/tools/ffprobe', source: 'settings' });
  });

  it('ungültige ausdrückliche Angabe: Warnung, Suche geht weiter', () => {
    const fs = fakeFs(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe']);
    const loc = locateFfmpeg({ platform: 'darwin', env: { ...guiEnv, FFMPEG_PATH: '/weg/ffmpeg' }, homedir: home, ...fs });
    expect(loc.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg');
    expect(loc.warnings).toEqual([expect.stringContaining('FFMPEG_PATH zeigt auf „/weg/ffmpeg“')]);
    expect(loc.message).toContain('FFMPEG_PATH');
  });

  it('FFPROBE_PATH hat Vorrang vor dem Nachbarn von ffmpeg', () => {
    const fs = fakeFs(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe', '/x/ffprobe']);
    expect(locateFfmpeg({ platform: 'darwin', env: { ...guiEnv, FFPROBE_PATH: '/x/ffprobe' }, homedir: home, ...fs }).ffprobe).toBe('/x/ffprobe');
  });

  it('fehlt ffmpeg: deutscher Hinweis mit brew-Befehl', () => {
    const loc = locateFfmpeg({ platform: 'darwin', env: guiEnv, homedir: home, ...fakeFs([]) });
    expect(loc).toMatchObject({ ffmpeg: null, ffprobe: null, source: null });
    expect(loc.message).toContain('brew install ffmpeg');
    expect(loc.message).toContain('nicht gefunden');
  });

  it('fehlt nur ffprobe: Hinweis nennt ffprobe', () => {
    const loc = locateFfmpeg({ platform: 'darwin', env: guiEnv, homedir: home, ...fakeFs(['/opt/homebrew/bin/ffmpeg']) });
    expect(loc.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg');
    expect(loc.ffprobe).toBeNull();
    expect(loc.message).toMatch(/ffprobe wurde nicht gefunden/);
  });
});

describe('locateFfmpeg – Windows', () => {
  const home = 'C:\\Users\\test';
  const env = {
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    ProgramData: 'C:\\ProgramData',
    Path: 'C:\\Windows\\system32;C:\\Windows',
  };

  it('findet winget-Verknüpfungen (Links)', () => {
    const fs = fakeFs(['C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe', 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe']);
    expect(locateFfmpeg({ platform: 'win32', env, homedir: home, ...fs })).toMatchObject({
      ffmpeg: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
      ffprobe: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe',
      source: 'system',
    });
  });

  it('findet den entpackten winget-Paketordner (Gyan.FFmpeg) ohne Neuanmeldung', () => {
    const pkgs = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Packages';
    const pkg = 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe';
    const bin = `${pkgs}\\${pkg}\\ffmpeg-8.0-full_build\\bin`;
    const fs = fakeFs([`${bin}\\ffmpeg.exe`, `${bin}\\ffprobe.exe`], { [pkgs]: ['Other.Tool_x', pkg], [`${pkgs}\\${pkg}`]: ['ffmpeg-8.0-full_build'] });
    expect(locateFfmpeg({ platform: 'win32', env, homedir: home, ...fs })).toMatchObject({ ffmpeg: `${bin}\\ffmpeg.exe`, ffprobe: `${bin}\\ffprobe.exe`, source: 'system' });
  });

  it('findet Chocolatey und Scoop', () => {
    expect(locateFfmpeg({ platform: 'win32', env, homedir: home, ...fakeFs(['C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe', 'C:\\ProgramData\\chocolatey\\bin\\ffprobe.exe']) }).ffmpeg).toBe(
      'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    );
    expect(locateFfmpeg({ platform: 'win32', env, homedir: home, ...fakeFs(['C:\\Users\\test\\scoop\\shims\\ffmpeg.exe', 'C:\\Users\\test\\scoop\\shims\\ffprobe.exe']) }).ffmpeg).toBe(
      'C:\\Users\\test\\scoop\\shims\\ffmpeg.exe',
    );
  });

  it('nutzt die Windows-Variable „Path“ mit Semikolon', () => {
    expect(pathDirs('win32', { Path: 'C:\\a;"C:\\b c";;' })).toEqual(['C:\\a', 'C:\\b c']);
    const fs = fakeFs(['C:\\b c\\ffmpeg.exe', 'C:\\b c\\ffprobe.exe']);
    expect(locateFfmpeg({ platform: 'win32', env: { ...env, Path: 'C:\\a;C:\\b c' }, homedir: home, ...fs })).toMatchObject({ ffmpeg: 'C:\\b c\\ffmpeg.exe', source: 'path' });
  });

  it('fehlt ffmpeg: Hinweis mit winget-Befehl', () => {
    expect(locateFfmpeg({ platform: 'win32', env, homedir: home, ...fakeFs([]) }).message).toContain('winget install Gyan.FFmpeg');
  });

  it('bekannte Orte enthalten winget, Chocolatey und Scoop', () => {
    const dirs = wellKnownDirs('win32', env, home, () => []);
    expect(dirs).toEqual(
      expect.arrayContaining([
        'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links',
        'C:\\Program Files\\WinGet\\Links',
        'C:\\ProgramData\\chocolatey\\bin',
        'C:\\Users\\test\\scoop\\shims',
        'C:\\ProgramData\\scoop\\shims',
      ]),
    );
  });
});

describe('locateFfmpeg – echtes Dateisystem', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dstudio-ffmpeg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('erkennt nur ausführbare Dateien (Ordner und Dateien ohne x-Bit zählen nicht)', async () => {
    const bin = join(dir, 'bin');
    await mkdir(join(bin, 'ffprobe'), { recursive: true }); // Ordner statt Datei
    await writeFile(join(bin, 'ffmpeg'), '#!/bin/sh\n');
    const settingsPath = join(bin, 'ffmpeg');
    expect(locateFfmpeg({ platform: 'linux', env: {}, homedir: dir, settingsPath }).warnings).toEqual([expect.stringContaining('ffmpegPath')]);
    await chmod(settingsPath, 0o755);
    const loc = locateFfmpeg({ platform: 'linux', env: {}, homedir: dir, settingsPath });
    expect(loc).toMatchObject({ ffmpeg: settingsPath, source: 'settings', warnings: [] });
    expect(loc.ffprobe).not.toBe(join(bin, 'ffprobe'));
    await rm(join(bin, 'ffprobe'), { recursive: true });
    await writeFile(join(bin, 'ffprobe'), '#!/bin/sh\n', { mode: 0o755 });
    expect(locateFfmpeg({ platform: 'linux', env: {}, homedir: dir, settingsPath }).ffprobe).toBe(join(bin, 'ffprobe'));
  });
});

describe('extendGuiPath', () => {
  it('ergänzt unter macOS die Homebrew-Ordner vorne', () => {
    expect(extendGuiPath('darwin', '/usr/bin:/bin:/usr/sbin:/sbin')).toBe('/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });
  it('lässt vorhandene Einträge in Ruhe und ergänzt nur fehlende', () => {
    expect(extendGuiPath('darwin', '/opt/homebrew/bin:/usr/bin')).toBe('/opt/homebrew/sbin:/usr/local/bin:/opt/homebrew/bin:/usr/bin');
  });
  it('ohne PATH: Standardordner', () => {
    expect(extendGuiPath('darwin', undefined)).toBe('/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });
  it('andere Plattformen unverändert', () => {
    expect(extendGuiPath('win32', 'C:\\x')).toBe('C:\\x');
    expect(extendGuiPath('linux', undefined)).toBeUndefined();
  });
});

describe('ffmpegMissingMessage', () => {
  it('nennt je Plattform den Installationsbefehl', () => {
    expect(ffmpegMissingMessage('darwin')).toContain('`brew install ffmpeg`');
    expect(ffmpegMissingMessage('win32')).toContain('`winget install Gyan.FFmpeg`');
    expect(ffmpegMissingMessage('linux')).toContain('apt install ffmpeg');
    expect(ffmpegMissingMessage('darwin')).toContain('neu starten');
  });
});
