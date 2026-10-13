import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCard, parseEvidence, parseRunBlock, type CardStatus } from '@factory/conventions';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLog } from '../src/log.js';
import { Orchestrator } from '../src/orchestrator.js';
import { CARD_TITLES } from '../src/reconcile.js';
import { createWorktrees, type WorktreePort } from '../src/worktree.js';
import { RoutedAdapter } from './fakes/adapter.js';
import { FakeGitHub } from './fakes/github.js';
import { IDENTITY, tempRepo, type TempRepo } from './fakes/repo.js';

const scenarios = JSON.parse(
  readFileSync(new URL('./fixtures/full-loop.json', import.meta.url), 'utf8'),
) as ConstructorParameters<typeof RoutedAdapter>[0];

let clockMs = Date.parse('2026-10-13T10:00:00Z');
const clock = (): Date => new Date((clockMs += 1000));

describe('scénario complet : intention → framing → implementation → evidence → verdict', () => {
  let repo: TempRepo;
  let worktrees: WorktreePort;
  let github: FakeGitHub;
  let adapter: RoutedAdapter;
  let runs = 0;

  const orchestrator = (): Orchestrator =>
    new Orchestrator({
      github,
      adapter,
      worktrees,
      log: createLog(join(repo.userData, 'logs')),
      clock,
      newRunId: () => `run-${String(++runs)}`,
    });

  const cardsOf = (number: number): { id: string; title: string; status: CardStatus }[] =>
    github
      .commentsOf(number)
      .map((c) => parseCard(c.body))
      .flatMap((r) =>
        r.ok ? [{ id: r.value.id, title: r.value.title, status: r.value.status }] : [],
      );
  const runBlocksOf = (number: number) =>
    github
      .commentsOf(number)
      .map((c) => parseRunBlock(c.body))
      .flatMap((r) => (r.ok ? [r.value] : []));
  const evidenceOf = (number: number) => {
    const found = github
      .commentsOf(number)
      .map((c) => parseEvidence(c.body))
      .filter((r) => r.ok);
    expect(found).toHaveLength(1);
    return found[0]?.ok ? found[0].value : undefined;
  };
  /** Force un verrou orphelin : comme si le processus était mort en plein run. */
  const simulateCrash = (): void => {
    const issue = github.issues.get(1);
    if (!issue) throw new Error('issue 1');
    issue.labels = [...issue.labels.filter((l) => !l.startsWith('run:')), 'run:active'];
    issue.assignees = ['factory-bot'];
  };

  beforeAll(async () => {
    repo = await tempRepo();
    worktrees = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
      identity: IDENTITY,
    });
    github = new FakeGitHub();
    github.addIssue({
      number: 1,
      title: 'Lire les étiquettes sans Project',
      body: 'Je veux que l’app lise les étiquettes sans configurer un Project.\n',
      labels: ['phase:intent'],
    });
    adapter = new RoutedAdapter(scenarios);
  });

  it('cadrage : première carte, run arrêté, bloc de run en attente', async () => {
    const a = orchestrator();
    expect(a.getState()).toMatchObject({ status: 'ready', tasks: [] });
    await a.tick();
    expect(github.labelsCreated).toHaveLength(10);
    expect(a.getState().tasks).toHaveLength(1);
    expect(a.getState().tasks[0]).toMatchObject({ phase: 'intent', openCards: 0 });

    await a.startFraming(1);
    await a.waitForRun();
    expect(github.issues.get(1)?.labels).toEqual(['phase:framing', 'needs:arbitration']);
    expect(github.issues.get(1)?.assignees).toEqual([]);
    expect(cardsOf(1)).toEqual([{ id: 'card-1', title: "Où stocker l'état ?", status: 'open' }]);
    expect(runBlocksOf(1)).toMatchObject([
      { session: 'fake-session', skill: 'framing@0.1.0', status: 'waiting', card: 'card-1' },
    ]);
    expect(github.bodyOf(1)).toContain('<!-- factory:contract version=1 skill=framing@0.1.0 -->');
    expect(github.bodyOf(1).startsWith('Je veux que l’app lise')).toBe(true);
    expect(a.getState().arbitrate.map((c) => c.id)).toEqual(['card-1']);
    expect(a.getState().validate.map((c) => c.id)).toEqual(['1:H1', '1:C1']);

    const writes = github.writes.length;
    await a.tick();
    await a.tick();
    expect(github.writes.length).toBe(writes);
  });

  it('redémarrage après crash : une seule carte « Run interrompu », reprise par la réponse à la question', async () => {
    simulateCrash();
    const b = orchestrator();
    await b.tick();
    await b.tick();
    expect(github.issues.get(1)?.labels).toEqual([
      'phase:framing',
      'needs:arbitration',
      'needs:action',
      'run:failed',
    ]);
    expect(cardsOf(1)).toEqual([
      { id: 'card-1', title: "Où stocker l'état ?", status: 'open' },
      { id: 'card-2', title: CARD_TITLES.runInterrupted, status: 'open' },
    ]);
    expect(b.getState().act.map((c) => c.id)).toEqual(['card-2']);

    // « fait » sur Run interrompu alors que le bloc attend card-1 encore ouverte : rien à relancer.
    await b.markActionDone('card-2');
    await b.waitForRun();
    expect(cardsOf(1).map((c) => c.status)).toEqual(['open', 'done']);
    expect(adapter.framing.answers).toHaveLength(0);

    await b.answerCard('card-1', {
      cardId: 'card-1',
      choice: { kind: 'option', letter: 'B' },
      text: '',
    });
    await b.waitForRun();
    expect(adapter.framing.answers.map((x) => x.cardId)).toEqual(['card-1']);
    expect(cardsOf(1)).toEqual([
      { id: 'card-1', title: "Où stocker l'état ?", status: 'answered' },
      { id: 'card-2', title: CARD_TITLES.runInterrupted, status: 'done' },
      { id: 'card-3', title: "Faut-il une capture d'écran ?", status: 'open' },
    ]);
    expect(runBlocksOf(1)).toMatchObject([{ status: 'waiting', card: 'card-3' }]);
    expect(github.issues.get(1)?.labels).toEqual(['phase:framing', 'needs:arbitration']);

    await b.answerCard('card-3', {
      cardId: 'card-3',
      choice: { kind: 'other' },
      text: 'Oui, mais une seule.',
    });
    await b.waitForRun();
    expect(runBlocksOf(1)).toMatchObject([{ status: 'finished' }]);
    expect(github.bodyOf(1)).toContain('version=3');
    const state = b.getState();
    expect(state.arbitrate).toEqual([]);
    expect(state.validate.map((c) => c.id)).toEqual(['1:H2', '1:D1', '1:C1', '1:C2']);
    expect(state.tasks[0]).toMatchObject({
      phase: 'framing',
      contractComplete: false,
      openCards: 0,
    });
    await b.tick();
    expect(cardsOf(1)).toHaveLength(3);
    await expect(b.startImplementation(1)).rejects.toThrow(/contrat incomplet/);
  });

  it('implémentation : contrat validé, worktree et PR brouillon, décision puis arbitrage bloquant', async () => {
    const b = orchestrator();
    for (const id of ['H2', 'D1', 'C1', 'C2']) await b.validateItem(1, id, 'validated');
    await b.validateItem(1, 'C2', 'validated');
    expect(github.bodyOf(1)).toContain('version=7');
    expect(b.getState().validate).toEqual([]);
    expect(b.getState().tasks[0]?.contractComplete).toBe(true);

    await b.startImplementation(1);
    await b.waitForRun();
    expect(github.pulls).toHaveLength(1);
    const pr = github.pulls[0];
    expect(pr).toMatchObject({
      number: 2,
      draft: true,
      headRef: 'factory/1-lire-les-etiquettes-sans-project',
      title: '#1 Lire les étiquettes sans Project',
    });
    expect((await worktrees.open(1))?.branch).toBe('factory/1-lire-les-etiquettes-sans-project');
    // L'agent fake n'écrit aucun fichier : seul le commit vide d'ouverture de la PR existe.
    expect(await repo.log('factory/1-lire-les-etiquettes-sans-project')).toEqual([
      'feat(#1): Nom du module',
      'chore: seed',
    ]);
    expect(cardsOf(2)).toEqual([
      { id: 'card-4', title: 'Nom du module', status: 'open' },
      { id: 'card-5', title: 'Nouvelle dépendance de production', status: 'open' },
    ]);
    expect(evidenceOf(2)).toMatchObject({
      contract: 7,
      lines: [
        { criterion: 'C1', state: 'pending' },
        { criterion: 'C2', state: 'to-review' },
      ],
    });
    expect(runBlocksOf(2)).toMatchObject([
      { skill: 'implementation@0.1.0', status: 'waiting', card: 'card-5' },
    ]);
    expect(github.issues.get(1)?.labels).toEqual([
      'phase:implementation',
      'needs:validation',
      'needs:arbitration',
    ]);
    const state = b.getState();
    expect(state.validate.map((c) => c.id)).toEqual(['card-4']);
    expect(state.arbitrate.map((c) => c.id)).toEqual(['card-5']);
    expect(state.tasks[0]?.pr).toMatchObject({ number: 2, draft: true, ci: { kind: 'none' } });
  });

  it('redémarrage propre : rien ne bouge, puis l’arbitrage répondu produit l’ADR et termine le run', async () => {
    const c = orchestrator();
    const writes = github.writes.length;
    await c.tick();
    expect(github.writes.length).toBe(writes);

    await c.answerCard('card-5', {
      cardId: 'card-5',
      choice: { kind: 'option', letter: 'B' },
      text: 'Note-le dans l’ADR.',
    });
    await c.waitForRun();
    expect(adapter.implementation.answers.map((x) => x.cardId)).toEqual(['card-5']);
    const w = await worktrees.open(1);
    expect(existsSync(join(w?.path ?? '', 'docs', 'adr', '0001-parseur-maison.md'))).toBe(true);
    expect(readFileSync(join(w?.path ?? '', '.factory', 'rules.md'), 'utf8')).toContain(
      '## Tranché\n- 2026-10-13 · #1 · Parseur maison plutôt que yaml : Parseur maison. (ADR 0001, carte card-5)',
    );
    expect(await repo.log('factory/1-lire-les-etiquettes-sans-project')).toContain(
      'docs(#1): ADR 0001 parseur-maison',
    );
    expect(runBlocksOf(2)).toMatchObject([{ status: 'finished', session: 'fake-session' }]);
    expect(cardsOf(2).map((x) => x.status)).toEqual(['open', 'answered']);
    expect(github.issues.get(1)?.labels).toEqual(['phase:implementation', 'needs:validation']);
  });

  it('crash en fin de run puis désaveu de la décision : la carte Run interrompu est annulée, la règle Bloquant écrite', async () => {
    simulateCrash();
    const d = orchestrator();
    await d.tick();
    expect(cardsOf(2)).toEqual([
      { id: 'card-4', title: 'Nom du module', status: 'open' },
      { id: 'card-5', title: 'Nouvelle dépendance de production', status: 'answered' },
      { id: 'card-6', title: CARD_TITLES.runInterrupted, status: 'open' },
    ]);
    await d.tick();
    expect(cardsOf(2)).toHaveLength(3);

    await d.answerCard('card-4', {
      cardId: 'card-4',
      choice: { kind: 'reverse' },
      text: 'Ça aurait dû me bloquer : le nom est public.',
    });
    await d.waitForRun();
    expect(cardsOf(2).map((x) => x.status)).toEqual(['reversed', 'answered', 'cancelled']);
    const w = await worktrees.open(1);
    const rules = readFileSync(join(w?.path ?? '', '.factory', 'rules.md'), 'utf8');
    expect(rules).toContain(
      '## Bloquant\n- Nom du module (désaveu sur #1, carte card-4) : Ça aurait dû me bloquer : le nom est public.',
    );
    expect(await repo.log('factory/1-lire-les-etiquettes-sans-project')).toContain(
      'chore(#1): règle Bloquant depuis la carte card-4',
    );
    expect(adapter.implementation.answers.map((x) => x.cardId)).toEqual(['card-5', 'card-4']);
    expect(runBlocksOf(2)).toMatchObject([{ status: 'finished' }]);
    expect(github.issues.get(1)?.labels).toEqual(['phase:implementation']);
  });

  it('CI verte → proven, phase evidence, PR prête ; preuve examinée → verdict ; fusion → nettoyage', async () => {
    const d = orchestrator();
    await d.tick();
    expect(github.issues.get(1)?.labels).toEqual(['phase:implementation']);
    const sha = github.advanceHead('factory/1-lire-les-etiquettes-sans-project');
    github.ciRuns.set(sha, { url: 'https://ci/run/1', status: 'in_progress', conclusion: null });
    await d.tick();
    expect(evidenceOf(2)?.lines[0]).toMatchObject({ state: 'pending' });
    github.ciRuns.set(sha, { url: 'https://ci/run/1', status: 'completed', conclusion: 'success' });
    await d.tick();
    expect(evidenceOf(2)?.lines[0]).toEqual({
      criterion: 'C1',
      proof: '[run CI](https://ci/run/1) — `labels.parse`',
      state: 'proven',
    });
    await d.tick();
    expect(github.issues.get(1)?.labels).toEqual(['phase:evidence']);
    expect(github.pulls[0]?.draft).toBe(false);
    await d.tick();
    expect(github.issues.get(1)?.labels).toEqual(['phase:evidence']);

    await d.markEvidenceReviewed(2, 'C2', 'proven', 'vu');
    await d.markEvidenceReviewed(2, 'C2', 'proven', 'vu');
    expect(evidenceOf(2)?.lines[1]).toEqual({
      criterion: 'C2',
      proof: `[docs/evidence/1.png](https://github.com/acme/widget/blob/${sha}/docs/evidence/1.png)`,
      state: 'proven',
      note: 'vu',
    });
    expect(github.issues.get(1)?.labels).toEqual(['phase:verdict']);
    await d.tick();
    expect(github.issues.get(1)?.labels).toEqual(['phase:verdict', 'needs:action']);
    expect(cardsOf(2).at(-1)).toEqual({ id: 'card-7', title: CARD_TITLES.merge, status: 'open' });
    expect(d.getState().act.map((c) => c.id)).toEqual(['card-7']);
    await d.tick();
    expect(cardsOf(2)).toHaveLength(4);

    github.merge(2);
    await d.tick();
    expect(worktrees.has(1)).toBe(false);
    const writes = github.writes.length;
    await d.tick();
    expect(github.writes.length).toBe(writes);

    // Aucun doublon : 3 cartes dans l'issue, 4 dans la PR, 5 réponses, 1 commentaire de preuves,
    // 1 bloc de run par lieu. Tout le reste est édité en place.
    expect(github.writes.filter((x) => x.startsWith('comment ')).length).toBe(3 + 4 + 5 + 1 + 2);
    expect(runBlocksOf(1)).toHaveLength(1);
    expect(runBlocksOf(2)).toHaveLength(1);
  });
});
