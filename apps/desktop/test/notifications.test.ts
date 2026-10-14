import type { CardView, InboxState, RunView, TaskView } from '@factory/orchestrator';
import { describe, expect, it, vi } from 'vitest';
import { notificationsFor, startNotifier, type Notice } from '../src/main/notifications';
import { createRuntime } from '../src/main/runtime';
import { fakeOrchestrator, inboxState } from './fakes';

const STARTED = new Date('2026-10-14T10:00:00Z');
const AFTER_START = '2026-10-14T10:05:00Z';
const BEFORE_START = '2026-10-14T09:55:00Z';

function card(overrides: Partial<CardView> & Pick<CardView, 'id' | 'kind'>): CardView {
  return {
    issue: 42,
    issueTitle: 'Lire les étiquettes',
    title: `Carte ${overrides.id}`,
    context: '',
    options: [],
    createdAt: AFTER_START,
    ...overrides,
  };
}

function task(issue: number, phase: TaskView['phase']): TaskView {
  return {
    issue,
    title: `Tâche ${String(issue)}`,
    url: `https://github.test/acme/widget/issues/${String(issue)}`,
    phase,
    needs: [],
    startBlockers: [],
    openCards: 0,
  };
}

function run(lastEvent: RunView['lastEvent'], issue = 42): RunView {
  return { issue, skill: 'implementation@0.1.0', startedAt: BEFORE_START, lastEvent };
}

const RUNNING = run({ type: 'agent.tool', runId: 'r', tool: 'Edit', summary: 'x', ok: true });
const FINISHED = run({ type: 'run.finished', runId: 'r', sessionId: 's', turns: 3, costUsd: 0 });
const FAILED = run({
  type: 'run.failed',
  runId: 'r',
  sessionId: 's',
  reason: 'execution',
  detail: 'boum',
});
const WAITING = run({ type: 'run.waiting', runId: 'r', sessionId: 's', cardId: 'card-9' });

const TASKS = [task(42, 'implementation'), task(44, 'evidence')];

function state(overrides: Partial<InboxState> = {}): InboxState {
  return inboxState({ tasks: TASKS, ...overrides });
}

function notices(before: InboxState, after: InboxState): Notice[] {
  return notificationsFor(before, after, STARTED);
}

describe('notificationsFor (H3–H6, C2) : exactement une notification', () => {
  it('nouvelle carte Arbitrer', () => {
    const c = card({ id: 'card-1', kind: 'arbitration', title: 'Choisir le schéma' });
    expect(notices(state(), state({ arbitrate: [c] }))).toEqual([
      { title: 'Choisir le schéma', body: '#42 Lire les étiquettes', cardId: 'card-1' },
    ]);
  });

  it('nouvelle question (file Arbitrer)', () => {
    const c = card({ id: 'card-2', kind: 'question' });
    expect(notices(state(), state({ arbitrate: [c] }))).toHaveLength(1);
  });

  it('nouvelle carte Agir', () => {
    const c = card({ id: 'card-3', kind: 'action', title: 'Fournir un jeton', issue: 44 });
    expect(notices(state(), state({ act: [c] }))).toEqual([
      { title: 'Fournir un jeton', body: '#44 Lire les étiquettes', cardId: 'card-3' },
    ]);
  });

  it('fin de run run.finished : « Run terminé », sans carte visée', () => {
    expect(notices(state({ run: FINISHED }), state())).toEqual([
      { title: 'Run terminé', body: '#42 Tâche 42' },
    ]);
  });

  it('fin de run run.failed : « Run échoué »', () => {
    expect(notices(state({ run: FAILED }), state())).toEqual([
      { title: 'Run échoué', body: '#42 Tâche 42' },
    ]);
  });

  it('fin de run sans événement terminal : « Run échoué »', () => {
    expect(notices(state({ run: RUNNING }), state())).toEqual([
      { title: 'Run échoué', body: '#42 Tâche 42' },
    ]);
  });

  it('run remplacé par un run d’une autre issue : fin du premier', () => {
    const other = { ...RUNNING, issue: 44 };
    expect(notices(state({ run: FINISHED }), state({ run: other }))).toEqual([
      { title: 'Run terminé', body: '#42 Tâche 42' },
    ]);
  });

  it('issue absente des tâches : le corps garde le numéro', () => {
    const lost = { ...FINISHED, issue: 99 };
    expect(notices(state({ run: lost }), state())).toEqual([{ title: 'Run terminé', body: '#99' }]);
  });

  it('run échoué + carte Agir « Run interrompu » de la même issue : une seule, sur la carte', () => {
    const interrupted = card({ id: 'card-7', kind: 'action', title: 'Run interrompu, relancer ?' });
    expect(notices(state({ run: FAILED }), state({ act: [interrupted] }))).toEqual([
      { title: 'Run échoué', body: '#42 Tâche 42', cardId: 'card-7' },
    ]);
  });

  it('passage en verdict : cible la première preuve de l’issue', () => {
    const proof = card({ id: '45:C1', kind: 'evidence', issue: 44, createdAt: BEFORE_START });
    const other = card({ id: '43:C1', kind: 'evidence', issue: 42, createdAt: BEFORE_START });
    const after = state({ tasks: [task(42, 'implementation'), task(44, 'verdict')] });
    expect(notices(state(), { ...after, validate: [other, proof] })).toEqual([
      { title: 'En verdict', body: '#44 Tâche 44', cardId: '45:C1' },
    ]);
  });

  it('passage en verdict sans preuve : ouvre l’inbox', () => {
    const after = state({ tasks: [task(42, 'implementation'), task(44, 'verdict')] });
    expect(notices(state(), after)).toEqual([{ title: 'En verdict', body: '#44 Tâche 44' }]);
  });
});

describe('notificationsFor (H3–H6, C2) : aucune notification', () => {
  const blocking = card({ id: 'card-1', kind: 'arbitration' });

  it('même état deux fois', () => {
    const s = state({ arbitrate: [blocking], run: RUNNING });
    expect(notices(s, s)).toEqual([]);
  });

  it('premier état vide puis premier tick avec des cartes créées avant le démarrage', () => {
    const old = card({ id: 'card-1', kind: 'arbitration', createdAt: BEFORE_START });
    const oldAct = card({ id: 'card-2', kind: 'action', createdAt: BEFORE_START });
    const undated = card({ id: 'card-3', kind: 'question' });
    delete undated.createdAt;
    expect(notices(inboxState(), state({ arbitrate: [old, undated], act: [oldAct] }))).toEqual([]);
  });

  it('carte qui disparaît', () => {
    expect(notices(state({ arbitrate: [blocking] }), state())).toEqual([]);
  });

  it('nouvelle carte Valider', () => {
    const decision = card({ id: 'card-4', kind: 'decision' });
    expect(notices(state(), state({ validate: [decision] }))).toEqual([]);
  });

  it('run disparu après run.waiting', () => {
    expect(notices(state({ run: WAITING }), state())).toEqual([]);
  });

  it('run toujours là : pas de fin', () => {
    expect(notices(state({ run: RUNNING }), state({ run: FINISHED }))).toEqual([]);
  });

  it('tâche déjà en verdict, ou nouvelle tâche directement en verdict', () => {
    const before = state({ tasks: [task(44, 'verdict')] });
    expect(notices(before, before)).toEqual([]);
    expect(notices(state({ tasks: [] }), state({ tasks: [task(44, 'verdict')] }))).toEqual([]);
  });
});

describe('startNotifier (H2)', () => {
  it('s’abonne au runtime, compare chaque état au précédent et survit à retry()', async () => {
    const first = fakeOrchestrator(state());
    const second = fakeOrchestrator(state());
    const boot = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const runtime = await createRuntime({ bootstrap: boot, home: '/tmp/maison' });
    const show = vi.fn<(notice: Notice) => void>();
    startNotifier({ runtime, startedAt: STARTED, show });
    expect(show).not.toHaveBeenCalled();

    const c = card({ id: 'card-1', kind: 'arbitration' });
    first.publish(state({ arbitrate: [c] }));
    first.publish(state({ arbitrate: [c] }));
    expect(show).toHaveBeenCalledTimes(1);

    await runtime.retry();
    second.publish(state({ act: [card({ id: 'card-2', kind: 'action' })] }));
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ cardId: 'card-2' }));
  });
});
