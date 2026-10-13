import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContract, type Contract } from '../src/contract.js';
import {
  canReachEvidencePhase,
  canReachVerdict,
  evidenceByCriterion,
  missingFor,
  parseEvidence,
  serializeEvidence,
  validateAgentEvidence,
  validateProven,
  type Evidence,
} from '../src/evidence.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replace(/\n$/, '');

function evidence(): Evidence {
  const r = parseEvidence(fixture('evidence.md'));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function contract(): Contract {
  const r = parseContract(fixture('contract-full.md'));
  if (!r.ok) throw new Error('fixture');
  for (const item of r.value.items) if (item.kind === 'criterion') item.status = 'validated';
  return r.value;
}

describe('parseEvidence', () => {
  it('lit la fixture de la spec', () => {
    const e = evidence();
    expect(e.contract).toBe(3);
    expect(e.lines.map((l) => [l.criterion, l.state])).toEqual([
      ['C1', 'proven'],
      ['C2', 'pending'],
      ['C3', 'to-review'],
      ['C4', 'blocked'],
    ]);
    expect(e.lines[3]?.note).toBe('nécessite un token (carte #9)');
    expect(e.lines[3]?.proof).toBe('—');
  });

  it('refuse marqueur absent, attribut invalide, ligne, état, doublon', () => {
    expect(parseEvidence('rien')).toEqual({ ok: false, error: { kind: 'missing-marker' } });
    expect(parseEvidence('<!-- factory:evidence -->')).toEqual({
      ok: false,
      error: { kind: 'bad-attr', attr: 'contract', value: '' },
    });
    const head =
      '<!-- factory:evidence contract=1 -->\n| Critère | Preuve | État |\n|---|---|---|\n';
    expect(parseEvidence(`${head}| C1 | mal formée`)).toEqual({
      ok: false,
      error: { kind: 'bad-row', line: '| C1 | mal formée' },
    });
    expect(parseEvidence(`${head}| C1 | x | \`maybe\` |`)).toEqual({
      ok: false,
      error: { kind: 'unknown-state', criterion: 'C1', state: 'maybe' },
    });
    expect(parseEvidence(`${head}| C1 | x | \`pending\` |\n| C1 | y | \`pending\` |`)).toEqual({
      ok: false,
      error: { kind: 'duplicate-criterion', criterion: 'C1' },
    });
  });

  it('fait l’aller-retour exact', () => {
    expect(serializeEvidence(evidence())).toBe(fixture('evidence.md'));
  });
});

describe('autorité sur proven', () => {
  it('l’agent ne peut écrire que pending, to-review, blocked', () => {
    expect(validateAgentEvidence(evidence())).toEqual({
      ok: false,
      error: { kind: 'state-not-allowed-for-agent', criterion: 'C1', state: 'proven' },
    });
    const agentOnly: Evidence = {
      contract: 1,
      lines: evidence().lines.filter((l) => l.state !== 'proven'),
    };
    expect(validateAgentEvidence(agentOnly)).toEqual({ ok: true, value: true });
  });

  it('une ligne proven exige une URL', () => {
    expect(validateProven(evidence())).toEqual({ ok: true, value: true });
    const bad: Evidence = {
      contract: 1,
      lines: [{ criterion: 'C1', proof: 'je le jure', state: 'proven' }],
    };
    expect(validateProven(bad)).toEqual({
      ok: false,
      error: { kind: 'proven-without-url', criterion: 'C1' },
    });
  });
});

describe('état par critère', () => {
  it('calcule missing pour les critères validés sans ligne', () => {
    const c = contract(); // C1, C2 validés
    const e: Evidence = { contract: 3, lines: [{ criterion: 'C1', proof: 'x', state: 'pending' }] };
    expect([...evidenceByCriterion(c, e)]).toEqual([
      ['C1', 'pending'],
      ['C2', 'missing'],
    ]);
    expect(missingFor(c, e)).toEqual(['C2']);
    expect(missingFor(c, undefined)).toEqual(['C1', 'C2']);
  });

  it('canReachEvidencePhase et canReachVerdict', () => {
    const c = contract();
    const proven = (crit: string) => ({
      criterion: crit,
      proof: '[run](https://github.com/o/r/actions/runs/1)',
      state: 'proven' as const,
    });
    const allProven: Evidence = { contract: 3, lines: [proven('C1'), proven('C2')] };
    const oneReview: Evidence = {
      contract: 3,
      lines: [proven('C1'), { criterion: 'C2', proof: 'x', state: 'to-review' }],
    };
    const onePending: Evidence = {
      contract: 3,
      lines: [proven('C1'), { criterion: 'C2', proof: 'x', state: 'pending' }],
    };
    expect(canReachEvidencePhase(c, allProven)).toBe(true);
    expect(canReachEvidencePhase(c, oneReview)).toBe(true);
    expect(canReachEvidencePhase(c, onePending)).toBe(false);
    expect(canReachVerdict(c, allProven)).toBe(true);
    expect(canReachVerdict(c, oneReview)).toBe(false);
    const noCriteria: Contract = { version: 1, skill: 'f@0.1.0', items: [] };
    expect(canReachVerdict(noCriteria, allProven)).toBe(false);
    expect(canReachEvidencePhase(noCriteria, undefined)).toBe(false);
  });
});
