import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCard,
  parseEvidence,
  parseRunBlock,
  serializeContract,
  serializeEvidence,
  type CardAnswer,
} from '@factory/conventions';
import {
  FakeAdapter,
  type AgentAdapter,
  type FactoryEvent,
  type RunSpec,
} from '@factory/agent-adapter';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IssueData } from '../src/github.js';
import { createLog } from '../src/log.js';
import { Orchestrator, type OrchestratorOptions } from '../src/orchestrator.js';
import { CARD_TITLES } from '../src/reconcile.js';
import { createWorktrees, type WorktreePort } from '../src/worktree.js';
import { FakeGitHub } from './fakes/github.js';
import { IDENTITY, tempRepo, type TempRepo } from './fakes/repo.js';
import { CONTRACT_FULL, QUESTION } from './helpers.js';

/** Adaptateur programmable : une liste d'événements, ou une fonction qui voit le `RunSpec`. */
function adapterOf(
  play: (spec: RunSpec, answer?: CardAnswer) => AsyncIterable<FactoryEvent>,
): AgentAdapter & { cancelled: string[] } {
  const cancelled: string[] = [];
  return {
    id: 'fake',
    cancelled,
    start: (spec) => play(spec),
    resume: (spec, answer) => play(spec, answer),
    cancel: (runId) => {
      cancelled.push(runId);
      return Promise.resolve();
    },
  };
}

type Loose = FactoryEvent extends infer E ? (E extends unknown ? Omit<E, 'runId'> : never) : never;

async function* events(spec: RunSpec, list: Loose[]): AsyncIterable<FactoryEvent> {
  for (const e of list) yield { ...e, runId: spec.runId };
  await Promise.resolve();
}

const CONTRACT_BODY = 'Intention.\n\n' + serializeContract(CONTRACT_FULL) + '\n';

function issueOf(github: FakeGitHub, number: number): IssueData {
  const issue = github.issues.get(number);
  if (!issue) throw new Error(`issue ${String(number)} absente`);
  return issue;
}

describe('orchestrator', () => {
  let repo: TempRepo;
  let worktrees: WorktreePort;
  let next = 100;

  const setup = (
    over: Partial<OrchestratorOptions> = {},
  ): { github: FakeGitHub; options: OrchestratorOptions; issue: number } => {
    const github = new FakeGitHub();
    const issue = next++;
    return {
      github,
      issue,
      options: {
        github,
        adapter: new FakeAdapter({ start: [] }),
        worktrees,
        log: createLog(join(repo.userData, 'logs', String(issue))),
        newRunId: () => `run-${String(issue)}`,
        ...over,
      },
    };
  };

  beforeAll(async () => {
    repo = await tempRepo();
    worktrees = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
      identity: IDENTITY,
    });
  });

  it('bloqué : état exposé, commandes refusées, start et tick sans effet', async () => {
    const { github, options } = setup();
    const o = Orchestrator.blocked(
      { message: 'gh non connecté', command: 'gh auth login' },
      options,
    );
    expect(o.getState()).toMatchObject({
      status: 'blocked',
      blockedReason: { command: 'gh auth login' },
      tasks: [],
    });
    o.start();
    await o.tick();
    await o.stop();
    expect(github.labelsCreated).toEqual([]);
    await expect(o.startFraming(1)).rejects.toThrow(/bloqué/);
    await expect(
      o.answerCard('card-1', { cardId: 'card-1', choice: { kind: 'done' }, text: '' }),
    ).rejects.toThrow(/bloqué/);
    await expect(o.markEvidenceReviewed(1, 'C1', 'proven')).rejects.toThrow(/bloqué/);
  });

  it('start lance un tick tout de suite puis à intervalle ; stop annule le run en cours', async () => {
    let release: (() => void) | undefined;
    const adapter = adapterOf(async function* (spec) {
      yield { type: 'run.started', runId: spec.runId, sessionId: 's', model: 'm', tools: [] };
      await new Promise<void>((r) => (release = r));
      yield {
        type: 'run.failed',
        runId: spec.runId,
        sessionId: 's',
        reason: 'cancelled',
        detail: 'annulé',
      };
    });
    const { github, options, issue } = setup({ adapter, tickIntervalMs: 20 });
    github.addIssue({ number: issue, title: 'Horloge', labels: ['phase:framing'] });
    const o = new Orchestrator(options);
    const seen: string[] = [];
    const unsubscribe = o.subscribe((s) =>
      seen.push(s.status + ':' + String(s.tasks.length) + (s.run ? ':run' : '')),
    );
    o.start();
    o.start();
    for (let i = 0; i < 200 && !o.getState().run; i += 1)
      await new Promise((r) => setTimeout(r, 25));
    expect(github.labelsCreated).toHaveLength(10);
    expect(o.getState().run).toMatchObject({
      issue,
      skill: 'framing',
      lastEvent: { type: 'run.started' },
    });
    expect(seen[0]).toBe('ready:0');
    expect(seen).toContain('ready:1:run');
    unsubscribe();
    const stopped = o.stop();
    release?.();
    await stopped;
    expect(adapter.cancelled).toEqual([`run-${String(issue)}`]);
    await o.waitForRun();
    expect(github.issues.get(issue)?.labels).toEqual([
      'phase:framing',
      'needs:action',
      'run:failed',
    ]);
    const cards = github
      .commentsOf(issue)
      .map((c) => parseCard(c.body))
      .flatMap((r) => (r.ok ? [r.value] : []));
    expect(cards).toMatchObject([{ title: CARD_TITLES.runInterrupted, status: 'open' }]);
    expect(cards[0]?.context).toContain('cancelled : annulé');
    expect(
      github
        .commentsOf(issue)
        .map((c) => parseRunBlock(c.body))
        .filter((r) => r.ok),
    ).toHaveLength(1);
    const after = seen.length;
    await o.tick();
    expect(seen.length).toBe(after);
  });

  it('identifiant de run et horloge par défaut ; options de run transmises au RunSpec', async () => {
    let spec: RunSpec | undefined;
    const adapter = adapterOf((s) => {
      spec = s;
      return events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0.5 }]);
    });
    const { github, issue } = setup();
    github.addIssue({ number: issue, title: 'Options', labels: ['phase:framing'] });
    const o = new Orchestrator({
      github,
      adapter,
      worktrees,
      log: createLog(join(repo.userData, 'logs', 'defaults')),
      policy: { bashPrefixes: ['ls'] },
      model: 'claude-x',
      maxTurns: 7,
      maxBudgetUsd: 1.5,
    });
    await o.tick();
    await o.waitForRun();
    expect(spec).toMatchObject({
      policy: { bashPrefixes: ['ls'] },
      model: 'claude-x',
      maxTurns: 7,
      maxBudgetUsd: 1.5,
    });
    expect(spec?.runId).toMatch(/^run-\d{14}-1$/);
    expect(spec?.sessionId).toBeUndefined();
    expect(
      github
        .commentsOf(issue)
        .map((c) => parseRunBlock(c.body))
        .flatMap((r) => (r.ok ? [r.value] : [])),
    ).toMatchObject([{ session: 'x', turns: 1, costUsd: 0.5, status: 'finished' }]);
  });

  it('startFraming / startImplementation / sendBackToFraming : transitions permises et refus', async () => {
    const { github, options, issue } = setup();
    github.addIssue({
      number: issue,
      title: 'T',
      labels: ['phase:implementation', 'bug'],
      body: CONTRACT_BODY,
    });
    github.addIssue({ number: issue + 1, title: 'T', labels: ['bug'] });
    github.addIssue({ number: issue + 2, title: 'T', labels: ['phase:intent', 'phase:framing'] });
    github.addIssue({
      number: issue + 3,
      title: 'T',
      labels: ['phase:framing'],
      body: 'sans contrat',
    });
    next += 4;
    const o = new Orchestrator({
      ...options,
      adapter: adapterOf((s) =>
        events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0 }]),
      ),
    });
    await expect(o.startFraming(issue)).rejects.toThrow(
      /passage implementation → framing interdit/,
    );
    await expect(o.startFraming(issue + 1)).rejects.toThrow(/aucune phase/);
    await expect(o.startFraming(issue + 2)).rejects.toThrow(/incohérentes/);
    await expect(o.startFraming(9999)).rejects.toThrow(/introuvable/);
    await expect(o.startImplementation(issue + 3)).rejects.toThrow(/aucun contrat lisible/);

    await o.sendBackToFraming(issue, 'le critère C2 est faux');
    await o.waitForRun();
    expect(github.issues.get(issue)?.labels).toEqual(['phase:framing', 'bug']);
    expect(
      github
        .commentsOf(issue)
        .some((c) => c.body === 'Renvoyé en cadrage : le critère C2 est faux'),
    ).toBe(true);
    const comments = github.commentsOf(issue).length;
    await o.sendBackToFraming(issue, 'encore');
    expect(github.commentsOf(issue).length).toBe(comments);
    await o.startFraming(issue);
    await o.startImplementation(issue);
    await o.waitForRun();
    expect(github.issues.get(issue)?.labels).toEqual(['phase:implementation', 'bug']);
    expect(github.pulls).toHaveLength(0);
  });

  it('startFraming sur une tâche déjà en cadrage : relance si le bloc est finished, sinon rien', async () => {
    const prompts: string[] = [];
    const adapter = adapterOf((s) => {
      prompts.push(s.prompt);
      return events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0 }]);
    });
    const { github, options, issue } = setup({ adapter });
    github.addIssue({
      number: issue,
      title: 'Relance',
      labels: ['phase:framing'],
      body: CONTRACT_BODY,
    });
    github.addComment(
      issue,
      '<!-- factory:run session=s1 skill=framing@0.1.0 turns=1 cost_usd=0.10 updated=2026-10-13T10:00:00Z status=finished -->',
    );
    const o = new Orchestrator(options);
    await o.tick();
    await o.waitForRun();
    expect(prompts).toHaveLength(0);
    await o.startFraming(issue);
    await o.waitForRun();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Cadrage relancé');
    expect(
      github
        .commentsOf(issue)
        .map((c) => parseRunBlock(c.body))
        .filter((r) => r.ok),
    ).toHaveLength(1);
    // Bloc `waiting` (carte ouverte) : start-framing ne force rien.
    github.addComment(
      issue,
      '<!-- factory:card id=card-1 kind=question origin=framing reversibility=reversible status=open skill=framing@0.1.0 -->\n### ❓ Question 1 — Q\n\n**Contexte** — c\n\n**Options**\n- **A.** a\n- **B.** b\n',
    );
    await o.startFraming(issue);
    await o.waitForRun();
    expect(prompts).toHaveLength(1);
    // Sans bloc de run, ou bloc illisible : rien à relancer.
    github.addIssue({
      number: issue + 1,
      title: 'Sans bloc',
      labels: ['phase:framing'],
      body: CONTRACT_BODY,
    });
    github.addIssue({
      number: issue + 2,
      title: 'Bloc cassé',
      labels: ['phase:framing'],
      body: CONTRACT_BODY,
    });
    github.addComment(issue + 2, '<!-- factory:run skill=framing@0.1.0 -->');
    github.addComment(
      issue + 2,
      '<!-- factory:card id=card-1 kind=question origin=framing reversibility=reversible status=open skill=framing@0.1.0 -->\n### ❓ Question 1 — Q\n\n**Contexte** — c\n\n**Options**\n- **A.** a\n- **B.** b\n',
    );
    github.addComment(
      issue + 1,
      '<!-- factory:card id=card-1 kind=question origin=framing reversibility=reversible status=open skill=framing@0.1.0 -->\n### ❓ Question 1 — Q\n\n**Contexte** — c\n\n**Options**\n- **A.** a\n- **B.** b\n',
    );
    next += 3;
    await o.startFraming(issue + 1);
    await o.startFraming(issue + 2);
    await o.waitForRun();
    expect(prompts).toHaveLength(1);
    await worktrees.remove(issue);
  });

  it('answerCard : carte inconnue, réponse refusée, pas de doublon de réponse', async () => {
    const { github, options, issue } = setup();
    github.addIssue({ number: issue, title: 'T', labels: ['phase:framing', 'needs:arbitration'] });
    const adapter = adapterOf((s) =>
      events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0 }]),
    );
    github.addComment(
      issue,
      '<!-- factory:card id=card-1 kind=question origin=framing reversibility=reversible status=open skill=framing@0.1.0 -->\n### ❓ Question 1 — Q\n\n**Contexte** — c\n\n**Options**\n- **A.** a\n- **B.** b\n',
    );
    github.addComment(
      issue,
      '<!-- factory:run session=s1 skill=framing@0.1.0 turns=1 cost_usd=0.10 updated=2026-10-13T10:00:00Z status=waiting card=card-1 -->',
    );
    const o = new Orchestrator({ ...options, adapter });
    await expect(
      o.answerCard('card-1', {
        cardId: 'card-1',
        choice: { kind: 'option', letter: 'A' },
        text: '',
      }),
    ).rejects.toThrow(/inconnue/);
    await o.tick();
    await expect(
      o.answerCard('card-1', { cardId: 'card-1', choice: { kind: 'keep' }, text: '' }),
    ).rejects.toThrow(/réponse refusée/);
    github.addComment(issue, '<!-- factory:answer card=card-1 choice=B -->');
    const before = github.writes.filter((w) => w.startsWith('comment')).length;
    await o.answerCard('card-1', {
      cardId: 'card-1',
      choice: { kind: 'option', letter: 'A' },
      text: '',
    });
    await o.waitForRun();
    expect(github.writes.filter((w) => w.startsWith('comment')).length).toBe(before);
    expect(
      github
        .commentsOf(issue)
        .map((c) => parseCard(c.body))
        .flatMap((r) => (r.ok ? [r.value.status] : [])),
    ).toEqual(['answered']);
    expect(github.issues.get(issue)?.labels).toEqual(['phase:framing']);
  });

  it('validateItem : refus et idempotence', async () => {
    const { github, options, issue } = setup();
    github.addIssue({ number: issue, title: 'T', labels: ['phase:framing'], body: 'sans contrat' });
    github.addIssue({
      number: issue + 1,
      title: 'T',
      labels: ['phase:framing'],
      body: CONTRACT_BODY.replace('`validated`', '`pending`'),
    });
    next += 2;
    const o = new Orchestrator(options);
    await expect(o.validateItem(issue, 'H1', 'validated')).rejects.toThrow(/aucun contrat/);
    await expect(o.validateItem(issue + 1, 'Z9', 'validated')).rejects.toThrow(/item Z9 inconnu/);
    await o.validateItem(issue + 1, 'H1', 'validated', 'vu');
    expect(github.bodyOf(issue + 1)).toContain('**H1** — Une hypothèse. `validated` (vu)');
    const writes = github.writes.length;
    await o.validateItem(issue + 1, 'H1', 'validated', 'vu');
    await o.validateItem(issue + 1, 'H1', 'validated');
    expect(github.writes.length).toBe(writes);
  });

  it('markEvidenceReviewed : erreurs, note, blocage, URL déjà présente, PR introuvable', async () => {
    const { github, options, issue } = setup();
    github.addIssue({ number: issue, title: 'T', labels: ['phase:evidence'], body: CONTRACT_BODY });
    const o = new Orchestrator(options);
    await expect(o.markEvidenceReviewed(50, 'C1', 'proven')).rejects.toThrow(
      /aucun commentaire de preuves/,
    );
    github.addComment(
      50,
      serializeEvidence({
        contract: 2,
        skill: 'implementation@0.1.0',
        lines: [
          { criterion: 'C1', proof: '`a`', state: 'to-review' },
          { criterion: 'C2', proof: '[x](https://x)', state: 'to-review' },
        ],
      }),
    );
    await expect(o.markEvidenceReviewed(50, 'C9', 'proven')).rejects.toThrow(/critère C9 absent/);
    await expect(o.markEvidenceReviewed(50, 'C1', 'proven')).rejects.toThrow(/PR #50 introuvable/);
    await o.markEvidenceReviewed(50, 'C1', 'blocked', 'secret manquant');
    await o.markEvidenceReviewed(50, 'C2', 'proven');
    const read = () => {
      const parsed = github
        .commentsOf(50)
        .map((c) => parseEvidence(c.body))
        .find((r) => r.ok);
      return parsed?.ok ? parsed.value.lines : [];
    };
    expect(read()).toEqual([
      { criterion: 'C1', proof: '`a`', state: 'blocked', note: 'secret manquant' },
      { criterion: 'C2', proof: '[x](https://x)', state: 'proven' },
    ]);
    const writes = github.writes.length;
    await o.markEvidenceReviewed(50, 'C1', 'blocked', 'secret manquant');
    expect(github.writes.length).toBe(writes);
    await o.markEvidenceReviewed(50, 'C2', 'blocked');
    expect(read()[1]).toEqual({ criterion: 'C2', proof: '[x](https://x)', state: 'blocked' });
  });

  it('start sans intervalle explicite, puis stop sans run', async () => {
    const { github, options } = setup();
    const o = new Orchestrator(options);
    o.start();
    await o.waitForRun();
    await o.stop();
    expect(github.labelsCreated).toHaveLength(10);
  });

  it('contrat coché à la main → réécrit sous forme canonique', async () => {
    const { github, options, issue } = setup();
    const body = CONTRACT_BODY.replace(
      '- [ ] **H1** — Une hypothèse. `validated`',
      '- [ ] **H1** — Une hypothèse. `validated`',
    ).replace('- [x] **H1**', '- [ ] **H1**');
    github.addIssue({ number: issue, title: 'T', labels: ['phase:framing'], body, state: 'open' });
    const o = new Orchestrator({
      ...options,
      adapter: adapterOf((s) =>
        events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0 }]),
      ),
    });
    await o.tick();
    await o.waitForRun();
    expect(github.bodyOf(issue)).toContain('- [ ] **H1** — Une hypothèse. `pending`');
    expect(github.writes.filter((w) => w.startsWith('body'))).toHaveLength(1);
    await worktrees.remove(issue);
  });

  it('PR fusionnée sur une issue encore ouverte : le verrou résiduel est retiré', async () => {
    const { github, options, issue } = setup();
    github.addIssue({ number: issue, title: 'T', labels: ['phase:verdict', 'run:failed'] });
    const pull = await github.createDraftPull({
      head: `factory/${String(issue)}-x`,
      base: 'main',
      title: 't',
      body: '',
    });
    github.merge(pull.number);
    github.writes.length = 0;
    const o = new Orchestrator(options);
    await o.tick();
    expect(github.issues.get(issue)?.labels).toEqual(['phase:verdict']);
    await o.tick();
    expect(github.writes.filter((w) => w.startsWith('labels'))).toHaveLength(1);
  });

  it('tick : erreur GitHub journalisée, tâche aux étiquettes incohérentes ignorée, tick pendant un tick', async () => {
    const { github, options, issue } = setup();
    github.addIssue({ number: issue, title: 'T', labels: ['phase:intent', 'phase:framing'] });
    const o = new Orchestrator(options);
    const p1 = o.tick();
    const p2 = o.tick();
    expect(p2).toBe(p1);
    await p1;
    await o.waitForRun();
    expect(o.getState().errors).toEqual([`#${String(issue)} ignorée : labels`]);
    const spy = vi.spyOn(github, 'listManagedIssues').mockRejectedValueOnce(new Error('panne'));
    await o.refresh();
    expect(o.getState().errors).toEqual(['panne']);
    spy.mockRejectedValueOnce('panne brute');
    await o.refresh();
    expect(o.getState().errors).toEqual(['panne brute']);
    spy.mockRestore();
    expect(readFileSync(join(options.log.dir, 'repo.jsonl'), 'utf8')).toContain('tick-error');
  });

  it('issue fermée avec worktree, ou worktree orphelin : nettoyage sans doublon', async () => {
    const { github, options, issue } = setup();
    github.addIssue({
      number: issue,
      title: 'T',
      labels: ['phase:verdict', 'run:failed'],
      state: 'closed',
    });
    await worktrees.create(issue, `factory/${String(issue)}-x`, 'main');
    await worktrees.create(issue + 1, `factory/${String(issue + 1)}-x`, 'main');
    next += 2;
    const o = new Orchestrator(options);
    await o.tick();
    expect(worktrees.has(issue)).toBe(false);
    expect(worktrees.has(issue + 1)).toBe(true);
    expect(github.issues.get(issue)?.labels).toEqual(['phase:verdict']);
    expect(o.getState().tasks).toHaveLength(0);
    await worktrees.remove(issue + 1);
  });

  it('run.failed sans session : pas de bloc de run ; flux sans terminal ; flux qui lève', async () => {
    const cases: [string, (spec: RunSpec) => AsyncIterable<FactoryEvent>][] = [
      [
        'max_turns : trop long',
        (s) => events(s, [{ type: 'run.failed', reason: 'max_turns', detail: 'trop long' }]),
      ],
      [
        'flux terminé sans événement terminal',
        (s) => events(s, [{ type: 'run.started', sessionId: '', model: 'm', tools: [] }]),
      ],
      [
        'flux terminé sans événement terminal',
        async function* (spec) {
          yield* events(spec, [{ type: 'run.started', sessionId: 's', model: 'm', tools: [] }]);
          throw new Error('cassé');
        },
      ],
    ];
    for (const [expected, play] of cases) {
      const { github, options, issue } = setup({ adapter: adapterOf(play) });
      github.addIssue({
        number: issue,
        title: 'T',
        labels: ['phase:implementation'],
        body: CONTRACT_BODY,
      });
      const o = new Orchestrator(options);
      await o.tick();
      await o.waitForRun();
      expect(github.issues.get(issue)?.labels).toEqual([
        'phase:implementation',
        'needs:action',
        'run:failed',
      ]);
      const cards = github
        .commentsOf(issue)
        .map((c) => parseCard(c.body))
        .flatMap((r) => (r.ok ? [r.value] : []));
      expect(cards).toHaveLength(1);
      expect(cards[0]?.context).toContain(expected);
      expect(github.commentsOf(issue).some((c) => c.body.includes('factory:run'))).toBe(false);
      // Verrou orphelin alors que la carte est encore ouverte : pas de seconde carte.
      issueOf(github, issue).labels = ['phase:implementation', 'needs:action', 'run:active'];
      await o.tick();
      expect(
        github
          .commentsOf(issue)
          .map((c) => parseCard(c.body))
          .filter((r) => r.ok),
      ).toHaveLength(1);
      expect(github.issues.get(issue)?.labels).toEqual([
        'phase:implementation',
        'needs:action',
        'run:failed',
      ]);
      await worktrees.remove(issue);
    }
  });

  it('cadrage : le prototype est poussé sur framing/<issue> ; un worktree d’implémentation existant est gardé', async () => {
    const adapter = adapterOf(async function* (spec) {
      mkdirSync(join(spec.cwd, 'prototype'), { recursive: true });
      writeFileSync(join(spec.cwd, 'prototype', 'essai.ts'), '// jetable\n');
      yield* events(spec, [{ type: 'run.finished', sessionId: 'f', turns: 1, costUsd: 0 }]);
    });
    const { github, options, issue } = setup({ adapter });
    github.addIssue({ number: issue, title: 'Proto', labels: ['phase:framing'] });
    const o = new Orchestrator(options);
    await o.tick();
    await o.waitForRun();
    expect((await worktrees.open(issue))?.branch).toBe(`framing/${String(issue)}`);
    expect(await repo.log(`framing/${String(issue)}`)).toEqual([
      `chore(#${String(issue)}): prototype de cadrage`,
      'chore: seed',
    ]);
    await worktrees.remove(issue);

    // Retour en cadrage avec worktree d'implémentation : il est gardé, le run de cadrage tourne dedans.
    const kept = await worktrees.create(issue, `factory/${String(issue)}-kept`, 'main');
    let cwd = '';
    const spy = adapterOf((spec) => {
      cwd = spec.cwd;
      return events(spec, [{ type: 'run.finished', sessionId: 'g', turns: 1, costUsd: 0 }]);
    });
    issueOf(github, issue).labels = ['phase:framing'];
    github.comments.delete(issue);
    const o2 = new Orchestrator({ ...options, adapter: spy });
    await o2.tick();
    await o2.waitForRun();
    expect(cwd).toBe(kept.path);
    await worktrees.remove(issue);
  });

  it('implémentation : reprise sur CI rouge recrée le worktree depuis la branche distante de la PR', async () => {
    const branch = 'factory/77-remote';
    const seed = await worktrees.create(77, branch, 'main');
    writeFileSync(join(seed.path, 'r.txt'), 'r\n');
    await worktrees.commitAll(seed.path, 'feat(#77): r');
    await worktrees.push(seed.path, branch);
    await worktrees.remove(77);

    let cwd = '';
    const adapter = adapterOf((spec) => {
      cwd = spec.cwd;
      return events(spec, [{ type: 'run.finished', sessionId: 'i', turns: 1, costUsd: 0 }]);
    });
    const { github, options } = setup({ adapter });
    github.addIssue({
      number: 77,
      title: 'Remote',
      labels: ['phase:implementation'],
      body: CONTRACT_BODY,
    });
    const pull = await github.createDraftPull({
      head: branch,
      base: 'main',
      title: '#77',
      body: '',
    });
    github.addComment(
      pull.number,
      serializeEvidence({
        contract: 2,
        skill: 'implementation@0.1.0',
        lines: [{ criterion: 'C1', proof: '`a`', state: 'pending' }],
      }),
    );
    github.addComment(
      pull.number,
      '<!-- factory:run session=sess-i skill=implementation@0.1.0 turns=1 cost_usd=0.10 updated=2026-10-13T10:00:00Z status=finished -->',
    );
    github.ciRuns.set(pull.headSha, {
      url: 'https://ci/red',
      status: 'completed',
      conclusion: 'failure',
    });
    github.writes.length = 0;
    const o = new Orchestrator(options);
    await o.tick();
    await o.waitForRun();
    const w = await worktrees.open(77);
    expect(w?.branch).toBe(branch);
    expect(cwd).toBe(w?.path);
    expect(readFileSync(join(w?.path ?? '', 'r.txt'), 'utf8')).toBe('r\n');
    expect(
      github
        .commentsOf(pull.number)
        .map((c) => parseRunBlock(c.body))
        .filter((r) => r.ok),
    ).toHaveLength(1);
    await worktrees.remove(77);
  });

  it('verrou : l’issue disparue ou aux étiquettes cassées pendant le run ne fait pas planter la fin de run', async () => {
    let release: (() => void) | undefined;
    const adapter = adapterOf(async function* (spec) {
      yield { type: 'run.started', runId: spec.runId, sessionId: 's', model: 'm', tools: [] };
      await new Promise<void>((r) => (release = r));
      yield { type: 'run.finished', runId: spec.runId, sessionId: 's', turns: 1, costUsd: 0 };
    });
    const { github, options, issue } = setup({ adapter });
    github.addIssue({ number: issue, title: 'T', labels: ['phase:framing'] });
    const o = new Orchestrator(options);
    await o.tick();
    issueOf(github, issue).labels = ['phase:framing', 'phase:intent', 'run:active'];
    release?.();
    await o.waitForRun();
    expect(github.issues.get(issue)?.labels).toEqual([
      'phase:framing',
      'phase:intent',
      'run:active',
    ]);
    expect(github.issues.get(issue)?.assignees).toEqual([]);

    const o2 = new Orchestrator(options);
    issueOf(github, issue).labels = ['phase:framing'];
    github.comments.delete(issue);
    await o2.tick();
    issueOf(github, issue).labels = ['bug'];
    release?.();
    await o2.waitForRun();
    expect(github.issues.get(issue)?.labels).toEqual(['bug']);

    const o3 = new Orchestrator(options);
    issueOf(github, issue).labels = ['phase:framing'];
    github.comments.delete(issue);
    await o3.tick();
    github.issues.delete(issue);
    release?.();
    await o3.waitForRun();
    const log = readFileSync(join(options.log.dir, `${String(issue)}.jsonl`), 'utf8');
    expect(log).toContain('finalize-error');
    await worktrees.remove(issue);
  });

  it('questions : la carte émise pendant le run apparaît dans la file Arbitrer, les décisions dans Valider', async () => {
    const adapter = new FakeAdapter({ start: [{ tool: 'emit_card', input: QUESTION }] });
    const { github, options, issue } = setup({ adapter });
    github.addIssue({ number: issue, title: 'T', labels: ['phase:framing'] });
    const o = new Orchestrator(options);
    await o.tick();
    await o.waitForRun();
    expect(o.getState().arbitrate.map((c) => c.title)).toEqual([QUESTION.title]);
    expect(o.getState().tasks[0]).toMatchObject({ openCards: 1, needs: ['arbitration'] });
    await worktrees.remove(issue);
  });
});

describe('orchestrator — observe (lecture seule)', () => {
  it('relit GitHub sans exécuter d’action, même pendant un tick ; bloqué → état figé ; panne → erreur', async () => {
    const repo = await tempRepo();
    const worktrees = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
      identity: IDENTITY,
    });
    const github = new FakeGitHub();
    github.addIssue({ number: 1, title: 'Lecture', labels: ['phase:framing'] });
    const options: OrchestratorOptions = {
      github,
      adapter: adapterOf((s) =>
        events(s, [{ type: 'run.finished', sessionId: 'x', turns: 1, costUsd: 0 }]),
      ),
      worktrees,
      log: createLog(join(repo.userData, 'logs')),
    };
    const o = new Orchestrator(options);
    const observed = await o.observe();
    expect(observed.tasks).toMatchObject([{ issue: 1, phase: 'framing' }]);
    expect(github.writes).toEqual([]);
    expect(github.issues.get(1)?.labels).toEqual(['phase:framing']);

    const ticking = o.tick();
    const during = await o.observe();
    await ticking;
    await o.waitForRun();
    expect(during.tasks).toHaveLength(1);
    expect(o.getState().tasks[0]?.lock).toBeUndefined();

    const spy = vi.spyOn(github, 'listManagedIssues').mockRejectedValueOnce(new Error('panne'));
    expect((await o.observe()).errors).toEqual(['panne']);
    spy.mockRejectedValueOnce('panne brute');
    expect((await o.observe()).errors).toEqual(['panne brute']);
    spy.mockRestore();

    const blocked = Orchestrator.blocked({ message: 'gh', command: 'gh auth login' }, options);
    expect((await blocked.observe()).status).toBe('blocked');
  });
});
