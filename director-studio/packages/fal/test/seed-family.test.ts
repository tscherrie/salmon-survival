import { describe, expect, it } from 'vitest';
import { modelFamily } from '@studio/core';
import { SEED_MODELS } from '../src/index.ts';

describe('Seed-Katalog: Familien-Tags', () => {
  it('jedes „familie:“-Tag entspricht modelFamily() (Turbo-Varianten gehören zu h3-max)', () => {
    const tagged = SEED_MODELS.filter((m) => (m.tags ?? []).some((t) => t.startsWith('familie:')));
    expect(tagged.length).toBeGreaterThan(0);
    for (const model of tagged) {
      const tag = (model.tags ?? []).find((t) => t.startsWith('familie:'))!;
      const family = modelFamily(model.id);
      // Tag ohne Anbieter-Präfix: `minimax/h3-max` → `familie:h3-max`
      expect(tag, model.id).toBe(`familie:${family.split('/').slice(1).join('/')}`);
    }
    const turbo = SEED_MODELS.filter((m) => m.id.startsWith('minimax/h3-max-turbo/'));
    expect(turbo.length).toBeGreaterThan(0);
    for (const model of turbo) expect(model.tags).toContain('familie:h3-max');
  });
});
