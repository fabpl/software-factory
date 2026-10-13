import type { Contract } from '@factory/conventions';
import { describe, expect, it } from 'vitest';
import { inject, loadSkill, SINGLE_CALL_RULE } from '../src/index.js';

const contract: Contract = {
  version: 2,
  skill: 'framing@0.1.0',
  items: [
    { id: 'H1', kind: 'hypothesis', text: 'Une hypothèse.', status: 'validated' },
    {
      id: 'C1',
      kind: 'criterion',
      text: 'Un critère.',
      status: 'pending',
      plannedProof: 'test `x`',
    },
  ],
};

describe('inject', () => {
  it('assemble skill, règle d’exécution, contrat et règles dans cet ordre', () => {
    const skill = loadSkill('implementation');
    const text = inject({ skill, contract, rules: '# Règles\n\n## Tranché\n- un point\n' });
    const i = (s: string): number => text.indexOf(s);
    expect(i('# Implémentation')).toBeGreaterThan(-1);
    expect(i('# Implémentation')).toBeLessThan(i(SINGLE_CALL_RULE));
    expect(i(SINGLE_CALL_RULE)).toBeLessThan(i('## Contrat actuel'));
    expect(i('## Contrat actuel')).toBeLessThan(i('**H1**'));
    expect(i('**H1**')).toBeLessThan(i('## Règles du projet'));
    expect(text).toContain('- un point');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('dit l’absence de contrat et de règles', () => {
    const text = inject({ skill: loadSkill('framing') });
    expect(text).toContain('Aucun contrat');
    expect(text).toContain('Aucune règle');
    expect(inject({ skill: loadSkill('framing'), rules: '  \n' })).toContain('Aucune règle');
  });
});
