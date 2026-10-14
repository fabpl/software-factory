import { describe, expect, it } from 'vitest';
import {
  buildInboxState,
  buildTaskState,
  intentOf,
  nextCardId,
  skillForPhase,
  taskView,
  type TaskInput,
} from '../src/state.js';
import { CONTRACT_FULL, task } from './helpers.js';

const issue = (labels: string[], extra: Partial<TaskInput['issue']> = {}): TaskInput['issue'] => ({
  number: 7,
  title: 'Un titre',
  body: 'Intention.\n',
  labels,
  state: 'open',
  assignees: [],
  url: 'u',
  ...extra,
});

const AT = '2026-10-14T10:00:00Z';

const CARD = (id: string, kind: string, origin: string, status = 'open'): string =>
  `<!-- factory:card id=${id} kind=${kind} origin=${origin} reversibility=reversible status=${status} skill=framing@0.1.0 -->\n### ❓ Q — Titre ${id}\n\n**Contexte** — x\n\n**Options**\n- **A.** a\n- **B.** b\n`;

describe('state — buildTaskState', () => {
  it('refuse les étiquettes incohérentes et l’absence de phase', () => {
    expect(
      buildTaskState({ issue: issue(['phase:intent', 'phase:framing']), comments: [] }),
    ).toMatchObject({
      ok: false,
      error: { issue: 7, kind: 'labels' },
    });
    expect(buildTaskState({ issue: issue(['bug']), comments: [] })).toEqual({
      ok: false,
      error: { issue: 7, kind: 'no-phase' },
    });
  });

  it('assemble cartes de l’issue et de la PR, réponses, bloc de run de la phase, preuves, verrou', () => {
    const built = buildTaskState({
      issue: issue(['phase:implementation', 'needs:arbitration', 'run:active', 'bug'], {
        assignees: ['bot'],
        body: 'Intention.\n\n' + contractBody(),
      }),
      comments: [
        {
          id: 1,
          body: CARD('card-1', 'question', 'framing', 'answered'),
          url: 'c1',
          createdAt: AT,
        },
        { id: 2, body: '<!-- factory:answer card=card-1 choice=A -->', url: 'a1', createdAt: AT },
        {
          id: 3,
          body: '<!-- factory:run session=s-f skill=framing@0.1.0 turns=1 cost_usd=0.10 updated=2026-10-13T10:00:00Z status=finished -->',
          url: 'r1',
          createdAt: AT,
        },
        { id: 4, body: 'commentaire humain', url: 'h', createdAt: AT },
      ],
      pull: {
        data: {
          number: 20,
          title: 't',
          body: '',
          draft: true,
          headRef: 'factory/7-x',
          headSha: 'abc',
          merged: false,
          state: 'open',
          url: 'p',
        },
        comments: [
          {
            id: 5,
            body: CARD('card-2', 'arbitration', 'implementation'),
            url: 'c2',
            createdAt: AT,
          },
          {
            id: 6,
            body: '<!-- factory:answer card=card-2 choice=B -->\nok',
            url: 'a2',
            createdAt: AT,
          },
          {
            id: 7,
            body: '<!-- factory:run session=s-i skill=implementation@0.1.0 turns=2 cost_usd=0.20 updated=2026-10-13T10:00:00Z status=waiting card=card-2 -->',
            url: 'r2',
            createdAt: AT,
          },
          {
            id: 8,
            body: '<!-- factory:evidence contract=2 skill=implementation@0.1.0 -->\n## Preuves\n\n| Critère | Preuve | État |\n|---|---|---|\n| C1 | `a` | `pending` |',
            url: 'e',
            createdAt: AT,
          },
        ],
        ci: { url: 'ci', status: 'completed', conclusion: 'failure' },
      },
    });
    if (!built.ok) throw new Error('état attendu');
    const s = built.value;
    expect(s).toMatchObject({
      phase: 'implementation',
      otherLabels: ['bug'],
      lock: { active: true, failed: false, assignee: 'bot' },
      contractDirty: false,
      run: { session: 's-i', status: 'waiting', card: 'card-2' },
      pr: {
        number: 20,
        open: true,
        ci: { kind: 'red', url: 'ci' },
        evidenceCommentId: 8,
        evidence: { contract: 2 },
      },
    });
    expect(s.needs).toEqual(new Set(['arbitration']));
    expect(s.cards.map((c) => [c.card.id, c.location.place, c.answer?.cardId])).toEqual([
      ['card-1', 'issue', 'card-1'],
      ['card-2', 'pr', 'card-2'],
    ]);
    expect(s.contract?.version).toBe(2);
    expect(nextCardId(s.cards)).toBe('card-3');
    expect(intentOf(s.body)).toBe('Intention.');
    expect(intentOf('Sans contrat')).toBe('Sans contrat');
  });

  it('contrat édité à la main (case cochée) → contractDirty ; bloc de run de cadrage en phase framing', () => {
    const body = 'x\n\n' + contractBody().replace('- [ ] **H1**', '- [x] **H1**');
    const built = buildTaskState({
      issue: issue(['phase:framing', 'run:failed'], { body }),
      comments: [
        {
          id: 3,
          body: '<!-- factory:run session=s-f skill=framing@0.1.0 turns=1 cost_usd=0.10 updated=2026-10-13T10:00:00Z status=finished -->',
          url: 'r',
          createdAt: AT,
        },
      ],
    });
    expect(built.ok && built.value).toMatchObject({
      contractDirty: true,
      run: { session: 's-f' },
      lock: { active: false, failed: true },
    });
    expect(built.ok && built.value.lock?.assignee).toBeUndefined();
    expect(skillForPhase('intent')).toBe('framing');
    expect(skillForPhase('verdict')).toBe('implementation');
  });
});

describe('state — vues inbox', () => {
  it('files Valider / Arbitrer / Agir, items pending en cadrage seulement, run et blocage', () => {
    const framing = task({
      issue: 1,
      contract: {
        ...CONTRACT_FULL,
        items: [
          { id: 'H1', kind: 'hypothesis', text: 'h', status: 'pending' },
          { id: 'C1', kind: 'criterion', text: 'c', status: 'pending', plannedProof: 'p' },
        ],
      },
    });
    const impl = task({
      issue: 2,
      phase: 'implementation',
      contract: CONTRACT_FULL,
      lock: { active: true, failed: false },
      pr: {
        number: 9,
        draft: true,
        headRef: 'f',
        headSha: 's',
        merged: false,
        open: true,
        url: 'p',
        ci: { kind: 'none' },
      },
      cards: [
        {
          card: {
            id: 'card-1',
            kind: 'decision',
            origin: 'implementation',
            status: 'open',
            skill: 's@1.0.0',
            title: 'd',
            context: 'c',
            options: [
              { letter: 'A', text: 'a' },
              { letter: 'B', text: 'b' },
            ],
            reversibility: 'reversible',
            recommendation: { letter: 'A', text: 'r' },
            changeCost: 'faible',
          },
          location: { place: 'pr', number: 9, commentId: 1, url: 'c1', createdAt: AT },
        },
        {
          card: {
            id: 'card-2',
            kind: 'action',
            origin: 'implementation',
            status: 'open',
            skill: 's@1.0.0',
            title: 'a',
            context: 'c',
            options: [],
            reversibility: 'reversible',
          },
          location: { place: 'pr', number: 9, commentId: 2, url: 'c2', createdAt: AT },
        },
        {
          card: {
            id: 'card-3',
            kind: 'arbitration',
            origin: 'implementation',
            status: 'answered',
            skill: 's@1.0.0',
            title: 'x',
            context: 'c',
            options: [
              { letter: 'A', text: 'a' },
              { letter: 'B', text: 'b' },
            ],
            reversibility: 'irreversible',
          },
          location: { place: 'pr', number: 9, commentId: 3, url: 'c3', createdAt: AT },
        },
        {
          card: {
            id: 'card-4',
            kind: 'question',
            origin: 'implementation',
            status: 'open',
            skill: 's@1.0.0',
            title: 'q',
            context: 'c',
            options: [
              { letter: 'A', text: 'a' },
              { letter: 'B', text: 'b' },
            ],
            reversibility: 'reversible',
          },
          location: { place: 'pr', number: 9, commentId: 4, url: 'c4', createdAt: AT },
        },
      ],
    });
    const lastSync = new Date('2026-10-13T10:00:00Z');
    const run = {
      issue: 2,
      skill: 'implementation',
      startedAt: 'now',
      lastEvent: { type: 'agent.message' as const, runId: 'r', text: 'hi' },
    };
    const closed = task({ issue: 4, closed: true, cards: impl.cards });
    const inbox = buildInboxState([framing, impl, closed], { lastSync, run, errors: ['e'] });
    expect(inbox.tasks.map((t) => t.issue)).toEqual([1, 2]);
    expect(inbox.status).toBe('ready');
    expect(inbox.validate.map((c) => c.id)).toEqual(['1:H1', '1:C1', 'card-1']);
    expect(inbox.validate[1]).toMatchObject({
      kind: 'item',
      title: 'C1 — c',
      context: 'Preuve prévue : p',
      item: { id: 'C1' },
    });
    expect(inbox.validate[0]?.context).toBe('');
    expect(inbox.validate[2]).toMatchObject({
      kind: 'decision',
      recommendation: { letter: 'A' },
      changeCost: 'faible',
      url: 'c1',
      issueTitle: 'Un titre',
    });
    expect(inbox.arbitrate.map((c) => c.id)).toEqual(['card-4']);
    expect(inbox.arbitrate[0]?.recommendation).toBeUndefined();
    expect(inbox.act.map((c) => c.id)).toEqual(['card-2']);
    expect(inbox.run).toBe(run);
    expect(inbox.errors).toEqual(['e']);
    expect(inbox.tasks[1]).toEqual({
      issue: 2,
      title: 'Un titre',
      url: 'https://github.test/acme/widget/issues/7',
      phase: 'implementation',
      needs: ['validation', 'action', 'arbitration'],
      lock: { active: true, failed: false },
      contractComplete: true,
      openCards: 3,
      pr: { number: 9, url: 'p', draft: true, merged: false, ci: { kind: 'none' } },
    });
    expect(taskView(framing)).toMatchObject({ contractComplete: false, openCards: 0 });
    expect(taskView(task({ issue: 3 })).contractComplete).toBe(false);

    const blocked = buildInboxState([], {
      lastSync,
      blocked: { message: 'gh', command: 'gh auth login' },
    });
    expect(blocked).toMatchObject({
      status: 'blocked',
      blockedReason: { command: 'gh auth login' },
      errors: [],
    });
    expect(blocked.run).toBeUndefined();
  });
});

describe('state — preuves à revoir et dates (C6)', () => {
  const EVIDENCE_BODY = [
    '<!-- factory:evidence contract=2 skill=implementation@0.1.0 -->',
    '## Preuves',
    '',
    '| Critère | Preuve | État |',
    '|---|---|---|',
    '| C1 | [capture](https://github.test/acme/widget/blob/f/docs/c1.png) | `to-review` |',
    '| C2 | `labels.unknown` | `pending` |',
    '| C3 | [run](https://github.test/acme/widget/actions/runs/1) | `proven` |',
    '| C4 | — | `blocked` : nécessite un token |',
    '| C5 | `docs/c5.md` | `to-review` |',
  ].join('\n');

  function implTask(prState: 'open' | 'closed' = 'open') {
    const built = buildTaskState({
      issue: issue(['phase:implementation'], { body: 'Intention.\n\n' + contractBody() }),
      comments: [
        {
          id: 1,
          body: CARD('card-1', 'question', 'framing'),
          url: 'c1',
          createdAt: '2026-10-14T09:00:00Z',
        },
      ],
      pull: {
        data: {
          number: 20,
          title: 't',
          body: '',
          draft: true,
          headRef: 'factory/7-x',
          headSha: 'abc',
          merged: false,
          state: prState,
          url: 'p',
        },
        comments: [
          {
            id: 5,
            body: CARD('card-2', 'decision', 'implementation'),
            url: 'c2',
            createdAt: '2026-10-14T09:30:00Z',
          },
          { id: 8, body: EVIDENCE_BODY, url: 'e', createdAt: '2026-10-14T09:45:00Z' },
        ],
        ci: undefined,
      },
    });
    if (!built.ok) throw new Error('état attendu');
    return built.value;
  }

  it('une CardView evidence par critère to-review, publiée dans Valider après les items', () => {
    const inbox = buildInboxState([implTask()], { lastSync: new Date() });
    const evidences = inbox.validate.filter((c) => c.kind === 'evidence');
    expect(evidences.map((c) => c.evidence?.criterion)).toEqual(['C1', 'C5']);
    expect(inbox.validate.map((c) => c.id)).toEqual(['card-2', '20:C1', '20:C5']);
    expect(evidences[0]).toMatchObject({
      issue: 7,
      issueTitle: 'Un titre',
      title: 'C1 — Un critère.',
      url: 'e',
      createdAt: '2026-10-14T09:45:00Z',
      evidence: {
        pr: 20,
        criterion: 'C1',
        artifactUrl: 'https://github.test/acme/widget/blob/f/docs/c1.png',
      },
    });
    expect(evidences[1]?.evidence).toEqual({ pr: 20, criterion: 'C5' });
    expect(evidences[1]?.context).toBe('`docs/c5.md`');
  });

  it('critère absent du contrat (ou pas de contrat) : l’identifiant seul sert de titre', () => {
    const inbox = buildInboxState([implTask()], { lastSync: new Date() });
    expect(inbox.validate.find((c) => c.id === '20:C5')?.title).toBe('C5');
    const t = implTask();
    delete t.contract;
    const bare = buildInboxState([t], { lastSync: new Date() });
    expect(bare.validate.find((c) => c.id === '20:C1')?.title).toBe('C1');
  });

  it('preuves sans commentaire source connu : ni url ni createdAt', () => {
    const t = implTask();
    if (t.pr) delete t.pr.evidenceComment;
    const inbox = buildInboxState([t], { lastSync: new Date() });
    const view = inbox.validate.find((c) => c.id === '20:C1');
    expect(view?.url).toBeUndefined();
    expect(view?.createdAt).toBeUndefined();
  });

  it('aucune CardView evidence pour proven / blocked / pending, ni pour une PR fermée', () => {
    const open = buildInboxState([implTask()], { lastSync: new Date() });
    const criteria = open.validate.flatMap((c) => (c.evidence ? [c.evidence.criterion] : []));
    expect(criteria).not.toContain('C2');
    expect(criteria).not.toContain('C3');
    expect(criteria).not.toContain('C4');
    const closed = buildInboxState([implTask('closed')], { lastSync: new Date() });
    expect(closed.validate.filter((c) => c.kind === 'evidence')).toEqual([]);
  });

  it('chaque CardView de carte porte le createdAt de son commentaire', () => {
    const inbox = buildInboxState([implTask()], { lastSync: new Date() });
    expect(inbox.arbitrate[0]).toMatchObject({ id: 'card-1', createdAt: '2026-10-14T09:00:00Z' });
    expect(inbox.validate[0]).toMatchObject({ id: 'card-2', createdAt: '2026-10-14T09:30:00Z' });
  });
});

function contractBody(): string {
  return [
    '<!-- factory:contract version=2 skill=framing@0.1.0 -->',
    '## Contrat',
    '',
    '### Hypothèses',
    '- [ ] **H1** — Une hypothèse. `pending`',
    '',
    '### Décisions',
    '',
    "### Critères d'acceptation",
    '- [x] **C1** — Un critère. `validated`',
    '  Preuve prévue : test `a`',
    '<!-- /factory:contract -->',
  ].join('\n');
}
