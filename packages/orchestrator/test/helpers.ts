import type {
  Card,
  CardAnswer,
  CardInput,
  Contract,
  Evidence,
  Need,
  RunBlock,
} from '@factory/conventions';
import type { LocalView, RepoView } from '../src/reconcile.js';
import type { TaskCard, TaskPull, TaskState } from '../src/state.js';

export const CONTRACT_FULL: Contract = {
  version: 2,
  skill: 'framing@0.1.0',
  items: [
    { id: 'H1', kind: 'hypothesis', text: 'Une hypothèse.', status: 'validated' },
    { id: 'D1', kind: 'decision', text: 'Une décision.', status: 'validated', note: 'carte #1' },
    {
      id: 'C1',
      kind: 'criterion',
      text: 'Un critère.',
      status: 'validated',
      plannedProof: 'test `a` vert en CI',
    },
    {
      id: 'C2',
      kind: 'criterion',
      text: 'Un autre.',
      status: 'validated',
      plannedProof: 'capture commitée',
    },
  ],
};

export const CONTRACT_PENDING: Contract = {
  ...CONTRACT_FULL,
  items: CONTRACT_FULL.items.map((i) => (i.id === 'H1' ? { ...i, status: 'pending' } : i)),
};

export function evidence(lines: Evidence['lines'], contract = 2): Evidence {
  return { contract, skill: 'implementation@0.1.0', lines };
}

export const QUESTION: CardInput = {
  kind: 'question',
  title: 'Où stocker ?',
  context: 'Confiance : 40 % — manque : le lieu.',
  options: [
    { letter: 'A', text: 'Fichier', consequence: 'Perdu.' },
    { letter: 'B', text: 'Commentaire', consequence: 'Durable.' },
  ],
  recommendation: { letter: 'B', text: 'Durable.' },
  reversibility: 'reversible',
};

export const DECISION: CardInput = {
  kind: 'decision',
  title: 'Nommage',
  context: 'Réversible.',
  options: [
    { letter: 'A', text: 'inbox', consequence: 'court' },
    { letter: 'B', text: 'mailbox', consequence: 'long' },
  ],
  recommendation: { letter: 'A', text: 'Court.' },
  reversibility: 'reversible',
};

export const ARBITRATION: CardInput = {
  kind: 'arbitration',
  title: 'Nouvelle dépendance',
  context: 'Bloquant.',
  options: [
    { letter: 'A', text: 'Oui', consequence: '+1 dépendance' },
    { letter: 'B', text: 'Non', consequence: 'code maison' },
  ],
  recommendation: { letter: 'B', text: 'Code maison.' },
  reversibility: 'irreversible',
};

export const ACTION: CardInput = {
  kind: 'action',
  title: 'Fournir un token',
  context: 'Nécessite un secret.',
  options: [],
  reversibility: 'reversible',
};

export function card(
  input: CardInput,
  extra: Partial<Card> & { answer?: CardAnswer; place?: 'issue' | 'pr' } = {},
): TaskCard {
  const { answer, place, ...rest } = extra;
  const c: Card = {
    id: 'card-1',
    origin: input.kind === 'question' ? 'framing' : 'implementation',
    status: 'open',
    skill: 'framing@0.1.0',
    ...input,
    ...rest,
  };
  const out: TaskCard = {
    card: c,
    location: {
      place: place ?? (c.origin === 'framing' ? 'issue' : 'pr'),
      number: place === 'pr' ? 20 : 7,
      commentId: 1,
      url: 'https://github.test/acme/widget/issues/7#issuecomment-1',
      createdAt: '2026-10-14T10:00:00Z',
    },
  };
  if (answer) out.answer = answer;
  return out;
}

export function option(cardId: string, letter: string, text = ''): CardAnswer {
  return { cardId, choice: { kind: 'option', letter }, text };
}

export function simple(cardId: string, kind: 'keep' | 'reverse' | 'done', text = ''): CardAnswer {
  return { cardId, choice: { kind }, text };
}

export function runBlock(overrides: Partial<RunBlock> = {}): RunBlock {
  return {
    session: 'sess-1',
    skill: 'framing@0.1.0',
    turns: 3,
    costUsd: 0.1,
    updated: '2026-10-13T10:00:00Z',
    status: 'finished',
    ...overrides,
  };
}

export function pull(overrides: Partial<TaskPull> = {}): TaskPull {
  return {
    number: 20,
    draft: true,
    headRef: 'factory/7-un-titre',
    headSha: 'abc1234def',
    merged: false,
    open: true,
    url: 'https://github.test/acme/widget/pull/20',
    ci: { kind: 'none' },
    ...overrides,
  };
}

/** `needs` par défaut cohérent avec les cartes ouvertes, pour ne tester la dérive qu'explicitement. */
function needsFor(cards: readonly TaskCard[]): Set<Need> {
  const needs = new Set<Need>();
  for (const c of cards) {
    if (c.card.status !== 'open') continue;
    needs.add(
      c.card.kind === 'decision'
        ? 'validation'
        : c.card.kind === 'action'
          ? 'action'
          : 'arbitration',
    );
  }
  return needs;
}

export function task(overrides: Partial<TaskState> = {}): TaskState {
  return {
    issue: 7,
    title: 'Un titre',
    body: 'Intention.\n',
    url: 'https://github.test/acme/widget/issues/7',
    closed: false,
    phase: 'framing',
    needs: needsFor(overrides.cards ?? []),
    otherLabels: [],
    contractDirty: false,
    cards: [],
    ...overrides,
  };
}

export function local(
  overrides: Partial<{ runs: number[]; worktrees: number[]; ciRetries: [number, number][] }> = {},
): LocalView {
  return {
    runs: new Set(overrides.runs ?? []),
    worktrees: new Set(overrides.worktrees ?? []),
    ciRetries: new Map(overrides.ciRetries ?? []),
  };
}

export const REPO: RepoView = { hasWorkflows: true };
