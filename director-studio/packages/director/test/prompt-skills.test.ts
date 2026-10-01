import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIRECTOR_BASE_PROMPT, DIRECTOR_SYSTEM_PROMPT, loadSkill, parseFrontmatter, SkillLibrary, skillsIndex, STUDIO_MECHANICS } from '../src/index.ts';
import { createProject, makeEnv, tempRoot } from './helpers.ts';
import { buildDirectorTools } from '../src/index.ts';

const DOCS = fileURLToPath(new URL('../../../../docs/director-studio/DIRECTOR_SYSTEM_PROMPT.md', import.meta.url));

describe('Systemprompt', () => {
  it('entspricht exakt dem ```text-Block der Dokumentation', () => {
    const doc = readFileSync(DOCS, 'utf8');
    const match = /```text\n([\s\S]*?)\n```/.exec(doc);
    expect(match).not.toBeNull();
    expect(DIRECTOR_BASE_PROMPT).toBe(match![1]);
  });

  it('ist statisch (keine Zeitstempel/Projektdaten) und enthält die Studio-Mechanik', () => {
    expect(DIRECTOR_SYSTEM_PROMPT.startsWith(DIRECTOR_BASE_PROMPT)).toBe(true);
    expect(DIRECTOR_SYSTEM_PROMPT.endsWith(STUDIO_MECHANICS)).toBe(true);
    expect(DIRECTOR_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    for (const term of ['apply_document_ops', 'asset:<assetId>', 'await_generations', 'untrusted_data', "producer's language", '<ref']) {
      expect(DIRECTOR_SYSTEM_PROMPT).toContain(term);
    }
  });
});

const REQUIRED_SKILLS = [
  'h3-max',
  'image-models',
  'voice-and-music',
  'lipsync-workflow',
  'music-video',
  'short-film',
  'social-ads',
  'explainer',
  'audio-edit',
  'slides',
  'collage',
  'web-design',
  'kinetic-typography',
  'rotoscope-overlay',
  'anti-slop',
  'review-checklist',
  'sound-mix-loudness',
];

describe('Skills', () => {
  it('skillsIndex listet alle gebündelten Skills mit Beschreibung', () => {
    const index = skillsIndex();
    for (const name of REQUIRED_SKILLS) {
      const skill = index.find((s) => s.name === name);
      expect(skill, name).toBeDefined();
      expect(skill!.description.length, name).toBeGreaterThan(30);
    }
  });

  it('lädt Skill-Inhalte ohne Frontmatter', () => {
    const skill = loadSkill('h3-max');
    expect(skill.body).toContain('reference-to-video');
    expect(skill.body).toContain('4:5');
    expect(skill.body.startsWith('---')).toBe(false);
    const kt = loadSkill('kinetic-typography');
    for (const prop of ['clip', 'frame', 'durationInFrames', 'fps', 'width', 'height', 'props', 'assets', 'words', 'random']) expect(kt.body).toContain(prop);
    expect(() => loadSkill('gibt-es-nicht')).toThrow(/existiert nicht/);
  });

  it('parseFrontmatter liest name/description', () => {
    expect(parseFrontmatter('---\nname: x\ndescription: "Hallo: Welt"\n---\nBody')).toEqual({ data: { name: 'x', description: 'Hallo: Welt' }, body: 'Body' });
  });

  it('load_skill-Tool liefert den Inhalt bzw. einen Fehler', async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const project = await createProject(root);
      const env = makeEnv(project, { skills: SkillLibrary.fromDirectory() });
      const tool = buildDirectorTools().find((t) => t.name === 'load_skill')!;
      const ok = await tool.run({ name: 'anti-slop' }, env.ctx);
      expect(ok.isError).toBeUndefined();
      expect(ok.content[0]).toMatchObject({ type: 'text' });
      const bad = await tool.run({ name: 'nope' }, env.ctx);
      expect(bad.isError).toBe(true);
      project.close();
    } finally {
      await cleanup();
    }
  });
});
