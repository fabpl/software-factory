import type { CardInput } from '@factory/conventions';
import { vi } from 'vitest';
import { DEFAULT_POLICY, type FactoryToolHandlers, type RunSpec } from '../src/index.js';

export function fakeTools(): FactoryToolHandlers & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    emit_card: vi.fn(async (card: CardInput) => {
      calls.push(`emit_card:${card.kind}`);
      n += 1;
      return Promise.resolve({ cardId: `card-${String(n)}` });
    }),
    update_contract: vi.fn(async () => {
      calls.push('update_contract');
      await Promise.resolve();
    }),
    update_evidence: vi.fn(async () => {
      calls.push('update_evidence');
      await Promise.resolve();
    }),
    request_adr: vi.fn(async () => {
      calls.push('request_adr');
      await Promise.resolve();
    }),
    read_rules: vi.fn(async () => {
      calls.push('read_rules');
      return Promise.resolve('# Règles\n\n## Tranché\n- rien\n');
    }),
  };
}

export function spec(overrides: Partial<RunSpec> = {}): RunSpec {
  return {
    runId: 'run-1',
    cwd: '/tmp/worktree',
    instructions: 'skill',
    prompt: 'intention',
    requiredTools: ['emit_card', 'update_contract', 'read_rules'],
    tools: fakeTools(),
    policy: DEFAULT_POLICY,
    ...overrides,
  };
}

export const QUESTION: CardInput = {
  kind: 'question',
  title: 'Où stocker ?',
  context: 'Confiance : 40 % — manque : le lieu.',
  options: [
    { letter: 'A', text: 'Fichier', consequence: 'Perdu si worktree supprimé.' },
    { letter: 'B', text: 'Commentaire PR', consequence: 'Reconstructible.' },
  ],
  recommendation: { letter: 'B', text: 'Cohérent avec le principe 7.' },
  reversibility: 'reversible',
};

export const DECISION: CardInput = {
  kind: 'decision',
  title: 'Nommage du module',
  context: 'Hors contrat, réversible.',
  options: [
    { letter: 'A', text: 'inbox', consequence: 'court' },
    { letter: 'B', text: 'mailbox', consequence: 'long' },
  ],
  recommendation: { letter: 'A', text: 'Plus court.' },
  reversibility: 'reversible',
};

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
