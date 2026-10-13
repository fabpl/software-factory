import { describe, expect, it } from 'vitest';
import {
  LABEL_DEFINITIONS,
  NEEDS,
  PHASES,
  RUN_STATES,
  canTransition,
  labelsFor,
  nextPhases,
  parseLabels,
} from '../src/labels.js';

describe('transitions de phase', () => {
  it('suit le diagramme de la spec', () => {
    expect(canTransition('intent', 'framing', 'human')).toBe(true);
    expect(canTransition('framing', 'implementation', 'human')).toBe(true);
    expect(canTransition('implementation', 'evidence', 'orchestrator')).toBe(true);
    expect(canTransition('evidence', 'verdict', 'orchestrator')).toBe(true);
  });

  it('autorise le retour en cadrage par l’humain depuis les trois dernières phases', () => {
    for (const from of ['implementation', 'evidence', 'verdict'] as const) {
      expect(canTransition(from, 'framing', 'human')).toBe(true);
      expect(canTransition(from, 'framing', 'orchestrator')).toBe(false);
    }
  });

  it('refuse ce que la spec ne liste pas', () => {
    expect(canTransition('intent', 'implementation', 'human')).toBe(false);
    expect(canTransition('framing', 'implementation', 'orchestrator')).toBe(false);
    expect(canTransition('implementation', 'evidence', 'human')).toBe(false);
    expect(canTransition('verdict', 'intent', 'human')).toBe(false);
  });

  it('liste les phases suivantes possibles par acteur', () => {
    expect(nextPhases('evidence', 'human')).toEqual(['framing']);
    expect(nextPhases('evidence', 'orchestrator')).toEqual(['verdict']);
    expect(nextPhases('verdict', 'orchestrator')).toEqual([]);
  });
});

describe('définitions', () => {
  it('couvre toutes les valeurs de phase, needs et run', () => {
    const names = LABEL_DEFINITIONS.map((d) => d.name);
    for (const p of PHASES) expect(names).toContain(`phase:${p}`);
    for (const n of NEEDS) expect(names).toContain(`needs:${n}`);
    for (const r of RUN_STATES) expect(names).toContain(`run:${r}`);
    expect(names).toHaveLength(PHASES.length + NEEDS.length + RUN_STATES.length);
  });
});

describe('parseLabels', () => {
  it('lit phase, needs et run, conserve le reste', () => {
    const r = parseLabels([
      'bug',
      'phase:framing',
      'needs:arbitration',
      'run:active',
      'needs:action',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.phase).toBe('framing');
    expect([...r.value.needs].sort()).toEqual(['action', 'arbitration']);
    expect(r.value.run).toBe('active');
    expect(r.value.others).toEqual(['bug']);
  });

  it('traite une issue sans étiquette phase comme non gérée', () => {
    const r = parseLabels(['enhancement']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.phase).toBeUndefined();
    expect(r.value.run).toBeUndefined();
    expect(r.value.needs.size).toBe(0);
  });

  it('tolère les préfixes connus avec des valeurs inconnues', () => {
    const r = parseLabels(['phase:foo', 'needs:bar', 'run:baz']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.phase).toBeUndefined();
    expect(r.value.others).toEqual(['phase:foo', 'needs:bar', 'run:baz']);
  });

  it('refuse deux phases ou deux états de run', () => {
    const p = parseLabels(['phase:intent', 'phase:framing']);
    expect(p).toEqual({
      ok: false,
      error: { kind: 'multiple-phases', phases: ['intent', 'framing'] },
    });
    const r = parseLabels(['run:active', 'run:failed']);
    expect(r).toEqual({ ok: false, error: { kind: 'multiple-runs', runs: ['active', 'failed'] } });
  });
});

describe('labelsFor', () => {
  it('produit un ordre stable, étrangères triées à la fin', () => {
    expect(
      labelsFor({
        phase: 'implementation',
        needs: new Set(['action', 'validation']),
        run: 'active',
        others: ['zeta', 'alpha'],
      }),
    ).toEqual([
      'phase:implementation',
      'needs:validation',
      'needs:action',
      'run:active',
      'alpha',
      'zeta',
    ]);
  });

  it('omet ce qui est absent', () => {
    expect(labelsFor({ needs: new Set(), others: [] })).toEqual([]);
  });

  it('est l’inverse de parseLabels', () => {
    const labels = ['phase:evidence', 'needs:validation', 'run:failed', 'docs'];
    const parsed = parseLabels(labels);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(labelsFor(parsed.value)).toEqual(labels);
  });
});
