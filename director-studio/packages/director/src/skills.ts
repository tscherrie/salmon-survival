import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Gebündelte Skills: `packages/director/skills/<name>/SKILL.md` mit Frontmatter `name` + `description`.
 * Der Index (Name + Einzeiler) geht als `<skills_index>` in den Kontext; den Inhalt lädt der Director
 * bei Bedarf mit `load_skill`.
 */

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface Skill extends SkillInfo {
  body: string;
  /** Weitere Dateien im Skill-Ordner (relativ). */
  files: string[];
}

/** Standardordner der gebündelten Skills (relativ zu diesem Modul). */
export function defaultSkillsDir(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url));
}

export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { data: {}, body: normalized };
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    data[m[1]!] = value;
  }
  return { data, body: normalized.slice(match[0].length) };
}

export class SkillLibrary {
  private readonly infos: SkillInfo[];

  private constructor(readonly dir: string, infos: SkillInfo[]) {
    this.infos = infos;
  }

  /** Liest den Index synchron (beim Start; der Ordner ist klein). */
  static fromDirectory(dir: string = defaultSkillsDir()): SkillLibrary {
    const infos: SkillInfo[] = [];
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir).sort()) {
        const file = join(dir, entry, 'SKILL.md');
        if (!existsSync(file)) continue;
        const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
        infos.push({ name: data.name || entry, description: data.description ?? '', path: file });
      }
    }
    return new SkillLibrary(dir, infos);
  }

  list(): SkillInfo[] {
    return [...this.infos];
  }

  has(name: string): boolean {
    return this.infos.some((s) => s.name === name);
  }

  load(name: string): Skill {
    const info = this.infos.find((s) => s.name === name);
    if (!info) throw new Error(`Skill „${name}“ existiert nicht. Verfügbar: ${this.infos.map((s) => s.name).join(', ')}`);
    const { body } = parseFrontmatter(readFileSync(info.path, 'utf8'));
    const skillDir = join(info.path, '..');
    const files = listFiles(skillDir).filter((f) => f !== 'SKILL.md');
    return { ...info, body: body.trim(), files };
  }

  /** Text für den `<skills_index>`-Block. */
  indexText(): string {
    return this.infos.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs, `${prefix}${entry}/`));
    else out.push(`${prefix}${entry}`);
  }
  return out;
}

let defaultLibrary: SkillLibrary | undefined;

export function defaultSkillLibrary(): SkillLibrary {
  defaultLibrary ??= SkillLibrary.fromDirectory();
  return defaultLibrary;
}

/** Name + Beschreibung aller gebündelten Skills. */
export function skillsIndex(dir?: string): Array<{ name: string; description: string }> {
  const lib = dir ? SkillLibrary.fromDirectory(dir) : defaultSkillLibrary();
  return lib.list().map(({ name, description }) => ({ name, description }));
}

export function loadSkill(name: string, dir?: string): Skill {
  const lib = dir ? SkillLibrary.fromDirectory(dir) : defaultSkillLibrary();
  return lib.load(name);
}
