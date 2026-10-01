import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaToolSource, MediaToolsStatus } from '@studio/core';

/**
 * Arbeitsordner der ausgelieferten App. Aus Finder, Dock oder Startmenü gestartet, ist der Arbeitsordner `/` bzw. der
 * Installationsordner – beides nicht beschreibbar. Remotion legt seine Chromium-Headless-Shell aber relativ zum
 * Arbeitsordner ab (`<nächster Ordner mit package.json>/node_modules/.remotion`). Die gepackte App wechselt deshalb
 * nach `<userData>/runtime`; das eigene `package.json` dort beendet Remotions Suche nach oben.
 */
export function prepareRuntimeDir(userData: string): string {
  const dir = join(userData, 'runtime');
  mkdirSync(dir, { recursive: true });
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg)) {
    writeFileSync(pkg, `${JSON.stringify({ name: 'director-studio-runtime', private: true, description: 'Arbeitsordner von Director Studio (Chromium-Download von Remotion). Kann gelöscht werden.' }, null, 2)}\n`);
  }
  return dir;
}

const SOURCE_LABELS: Record<MediaToolSource, string> = {
  settings: 'Einstellung „ffmpegPath“',
  env: 'Umgebungsvariable',
  bundled: 'mit der App geliefert',
  system: 'Systeminstallation',
  path: 'PATH',
};

/**
 * Text für den Dialog „Systemprüfung“ (Hilfe-Menü). `chromium`: in dieser Sitzung verwendeter Pfad
 * (`STUDIO_CHROMIUM_PATH`); `cachedChromium`: in einer früheren Sitzung geladene Headless-Shell (Remotions Cache).
 */
export function systemCheckText(input: {
  media: MediaToolsStatus;
  chromium: string | null;
  cachedChromium?: { path: string; version: string | null } | null | undefined;
  provisionChromium: boolean;
  userData: string;
}): {
  ok: boolean;
  message: string;
  detail: string;
} {
  const { media } = input;
  const ok = Boolean(media.ffmpeg && media.ffprobe);
  const where = media.source ? ` (${SOURCE_LABELS[media.source]})` : '';
  const cached = input.cachedChromium ? `${input.cachedChromium.path} (bereits geladen${input.cachedChromium.version ? `, Version ${input.cachedChromium.version}` : ''})` : null;
  const chromium =
    input.chromium ?? cached ?? (input.provisionChromium ? 'wird beim ersten Rendern automatisch geladen (einmalig ca. 100 MB)' : 'Standard von Playwright/Remotion');
  const lines = [
    `ffmpeg: ${media.ffmpeg ?? 'nicht gefunden'}${media.ffmpeg ? where : ''}`,
    `ffprobe: ${media.ffprobe ?? 'nicht gefunden'}`,
    `Chromium: ${chromium}`,
    `Datenordner: ${input.userData}`,
  ];
  if (media.message) lines.push('', media.message.replace(/\*\*/g, '').replace(/`/g, ''));
  return { ok, message: ok ? 'Alle lokalen Werkzeuge sind bereit.' : 'ffmpeg fehlt – Vorschauen, Ton und Video-Export funktionieren erst nach der Installation.', detail: lines.join('\n') };
}
