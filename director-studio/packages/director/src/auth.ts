import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings, AuthStatus, DirectorRuntimeId } from '@studio/core';

export interface SelectRuntimeInput {
  settings: AppSettings;
  anthropicApiKey?: string | null | undefined;
  /** Ergebnis von {@link detectAnthropicProfile}. */
  hasAnthropicProfile: boolean;
  falApiKey?: string | null | undefined;
  /** `@anthropic-ai/claude-agent-sdk` ist installiert (siehe {@link isAgentSdkAvailable}). */
  agentSdkAvailable: boolean;
}

/**
 * Anmeldekette: 1. Anthropic (API-Key oder `ant auth login`-Profil) → 2. Agent SDK mit Claude-Abo (nur
 * wenn in den Einstellungen erlaubt; nur Eigennutzung) → 3. fal-Router. Eine bevorzugte Laufzeit
 * (`settings.preferredRuntime`) gewinnt, wenn sie verfügbar ist.
 */
export function selectRuntime(input: SelectRuntimeInput): { active: DirectorRuntimeId | null; runtimes: AuthStatus['runtimes'] } {
  const key = input.anthropicApiKey?.trim();
  const fal = input.falApiKey?.trim();
  const runtimes: AuthStatus['runtimes'] = [
    {
      id: 'anthropic',
      available: !!key || input.hasAnthropicProfile,
      detail: key ? 'Anthropic API-Key' : input.hasAnthropicProfile ? 'Anthropic-Login (ant auth login)' : 'Nicht angemeldet – API-Key hinterlegen oder „ant auth login“ ausführen',
    },
    {
      id: 'agent-sdk',
      available: input.settings.allowClaudeSubscription && input.agentSdkAvailable,
      detail: !input.settings.allowClaudeSubscription
        ? 'Claude-Abo-Login ist in den Einstellungen deaktiviert (nur Eigennutzung)'
        : input.agentSdkAvailable
          ? 'Claude Agent SDK (Claude-Abo, nur Eigennutzung)'
          : 'Claude Agent SDK ist nicht installiert',
    },
    {
      id: 'fal',
      available: !!fal,
      detail: fal ? 'Claude über den fal-LLM-Router (eingeschränkte Fähigkeiten)' : 'Kein fal-Key hinterlegt',
    },
  ];
  const preferred = input.settings.preferredRuntime;
  if (preferred !== 'auto') {
    const hit = runtimes.find((r) => r.id === preferred && r.available);
    if (hit) return { active: hit.id, runtimes };
  }
  const first = runtimes.find((r) => r.available);
  return { active: first?.id ?? null, runtimes };
}

/** Konfigurationsordner des Anthropic-SDK (wie `@anthropic-ai/sdk` ihn auflöst). */
export function anthropicConfigDir(env: Record<string, string | undefined>, homedir: string, platform: NodeJS.Platform | string): string | null {
  if (env.ANTHROPIC_CONFIG_DIR) return env.ANTHROPIC_CONFIG_DIR;
  if (platform === 'win32') {
    if (env.APPDATA) return join(env.APPDATA, 'Anthropic');
    const profile = env.USERPROFILE ?? homedir;
    return profile ? join(profile, 'AppData', 'Roaming', 'Anthropic') : null;
  }
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'anthropic');
  const home = env.HOME ?? homedir;
  return home ? join(home, '.config', 'anthropic') : null;
}

/**
 * Prüft, ob ein OAuth-Profil aus `ant auth login` existiert: `ANTHROPIC_PROFILE` bzw. `active_config`
 * (Standard „default“) → `<config_dir>/credentials/<profile>.json` oder `configs/<profile>.json`.
 * Ohne aktives Profil zählt jede Datei unter `credentials/*.json`.
 */
export function detectAnthropicProfile(env: Record<string, string | undefined>, homedir: string, platform: NodeJS.Platform | string): boolean {
  const dir = anthropicConfigDir(env, homedir, platform);
  if (!dir || !existsSync(dir)) return false;
  let profile = env.ANTHROPIC_PROFILE?.trim();
  if (!profile) {
    try {
      profile = readFileSync(join(dir, 'active_config'), 'utf8').trim() || undefined;
    } catch {
      profile = undefined;
    }
  }
  // Wie das SDK: ohne ANTHROPIC_PROFILE/active_config gilt das Profil „default“.
  const name = profile ?? 'default';
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return false;
  if (existsSync(join(dir, 'credentials', `${name}.json`)) || existsSync(join(dir, 'configs', `${name}.json`))) return true;
  return false;
}

/** Alle Profile mit Anmeldedaten (`credentials/*.json`), z. B. für die Einstellungsseite. */
export function listAnthropicProfiles(env: Record<string, string | undefined>, homedir: string, platform: NodeJS.Platform | string): string[] {
  const dir = anthropicConfigDir(env, homedir, platform);
  if (!dir) return [];
  try {
    return readdirSync(join(dir, 'credentials'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/** Prüft per dynamischem Import, ob das (optionale) Agent SDK installiert ist. */
export async function isAgentSdkAvailable(load: () => Promise<unknown> = () => import('@anthropic-ai/claude-agent-sdk')): Promise<boolean> {
  try {
    const mod = (await load()) as { query?: unknown };
    return typeof mod.query === 'function';
  } catch {
    return false;
  }
}
