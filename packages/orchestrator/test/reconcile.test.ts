import { describe, expect, it } from 'vitest';
import { CARD_TITLES, PROMPTS, reconcile, type Action } from '../src/reconcile.js';
import {
  ACTION,
  ARBITRATION,
  CONTRACT_FULL,
  CONTRACT_PENDING,
  DECISION,
  QUESTION,
  REPO,
  card,
  evidence,
  local,
  option,
  pull,
  runBlock,
  simple,
  task,
} from './helpers.js';

const types = (actions: Action[]): string[] => actions.map((a) => a.type);

describe('reconcile — verrou et run vivant', () => {
  it('run:active sans run local vivant → run interrompu', () => {
    const state = task({ lock: { active: true, failed: false, assignee: 'factory-bot' } });
    expect(reconcile(state, local(), REPO)).toEqual([{ type: 'recover-failed-run', issue: 7 }]);
  });

  it('run:active avec run local vivant → rien', () => {
    const state = task({ lock: { active: true, failed: false } });
    expect(reconcile(state, local({ runs: [7] }), REPO)).toEqual([]);
  });

  it('un run vivant sur une autre tâche bloque tout', () => {
    expect(reconcile(task(), local({ runs: [3] }), REPO)).toEqual([]);
  });

  it('phase intent → rien', () => {
    expect(reconcile(task({ phase: 'intent' }), local(), REPO)).toEqual([]);
  });
});

describe('reconcile — cadrage', () => {
  it('framing sans run, sans carte ouverte, sans bloc finished → démarre framing', () => {
    const actions = reconcile(task({ body: 'Intention.\n' }), local(), REPO);
    expect(actions).toEqual([
      { type: 'start-run', issue: 7, run: { skill: 'framing', prompt: PROMPTS.framing(task()) } },
    ]);
    expect(PROMPTS.framing(task())).toContain('Intention.');
  });

  it('framing avec run:failed → attend la carte Run interrompu', () => {
    expect(reconcile(task({ lock: { active: false, failed: true } }), local(), REPO)).toEqual([]);
  });

  it('framing avec carte ouverte sans réponse → rien', () => {
    expect(reconcile(task({ cards: [card(QUESTION)] }), local(), REPO)).toEqual([]);
  });

  it('framing avec bloc de run finished → rien (le cadrage est fini, items à valider)', () => {
    expect(reconcile(task({ run: runBlock() }), local(), REPO)).toEqual([]);
  });

  it('question répondue avec run en attente sur cette carte → reprise de session', () => {
    const state = task({
      cards: [card(QUESTION, { answer: option('card-1', 'B', 'et note-le') })],
      run: runBlock({ status: 'waiting', card: 'card-1' }),
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({
      type: 'consume-answer',
      cardId: 'card-1',
      newStatus: 'answered',
      addBlockingRule: false,
      run: { skill: 'framing', sessionId: 'sess-1', answer: { cardId: 'card-1' } },
    });
  });

  it('question répondue sans bloc de run → run neuf avec la réponse', () => {
    const state = task({ cards: [card(QUESTION, { answer: option('card-1', 'A') })] });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({
      type: 'consume-answer',
      run: { skill: 'framing', answer: { cardId: 'card-1' } },
    });
    expect(action?.type === 'consume-answer' && action.run?.sessionId).toBeUndefined();
  });

  it('question répondue alors que le bloc attend une autre carte → run neuf', () => {
    const state = task({
      cards: [card(QUESTION, { answer: option('card-1', 'A') })],
      run: runBlock({ status: 'waiting', card: 'card-9' }),
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action?.type === 'consume-answer' && action.run?.sessionId).toBeUndefined();
  });

  it('item coché à la main → contrat réécrit', () => {
    expect(reconcile(task({ contractDirty: true }), local(), REPO)).toEqual([
      { type: 'normalize-contract', issue: 7 },
    ]);
  });

  it('phase:framing posée à la main avec PR ouverte → carte Retour en cadrage, une fois', () => {
    const state = task({ pr: pull() });
    const [action] = reconcile(state, local({ worktrees: [7] }), REPO);
    expect(action).toMatchObject({ type: 'publish-action-card', title: CARD_TITLES.backToFraming });
    const withCard = task({
      pr: pull(),
      cards: [card({ ...ACTION, title: CARD_TITLES.backToFraming })],
    });
    expect(reconcile(withCard, local({ worktrees: [7] }), REPO)).toEqual([]);
  });

  it('carte Retour en cadrage faite → worktree supprimé, puis le cadrage démarre', () => {
    const done = card({ ...ACTION, title: CARD_TITLES.backToFraming }, { status: 'done' });
    const state = task({ pr: pull(), cards: [done] });
    expect(reconcile(state, local({ worktrees: [7] }), REPO)).toEqual([
      { type: 'cleanup', issue: 7, removeRunLabel: false, removeWorktree: true },
    ]);
    expect(types(reconcile(state, local(), REPO))).toEqual(['start-run']);
  });
});

describe('reconcile — réponses aux cartes', () => {
  it('décision gardée → statut kept, pas de run', () => {
    const state = task({
      phase: 'implementation',
      cards: [card(DECISION, { answer: simple('card-1', 'keep') })],
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      {
        type: 'consume-answer',
        issue: 7,
        cardId: 'card-1',
        newStatus: 'kept',
        addBlockingRule: false,
      },
    ]);
  });

  it('décision désavouée → reprise avec consigne d’annulation, règle Bloquant si « aurait dû bloquer »', () => {
    const answer = simple('card-1', 'reverse', 'Ça aurait dû me bloquer.');
    const state = task({
      phase: 'implementation',
      cards: [card(DECISION, { answer })],
      run: runBlock({ skill: 'implementation@0.1.0' }),
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({
      type: 'consume-answer',
      newStatus: 'reversed',
      addBlockingRule: true,
      run: {
        skill: 'implementation',
        sessionId: 'sess-1',
        prompt: PROMPTS.reverse('card-1', 'Ça aurait dû me bloquer.'),
      },
    });
  });

  it('décision désavouée sans bloc de run → run neuf, sans règle', () => {
    const state = task({
      phase: 'implementation',
      cards: [card(DECISION, { answer: simple('card-1', 'reverse') })],
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({ type: 'consume-answer', addBlockingRule: false });
    expect(action?.type === 'consume-answer' && action.run?.sessionId).toBeUndefined();
  });

  it('arbitrage répondu en implémentation → reprise avec la réponse', () => {
    const state = task({
      phase: 'implementation',
      cards: [card(ARBITRATION, { answer: option('card-1', 'B') })],
      run: runBlock({ skill: 'implementation@0.1.0', status: 'waiting', card: 'card-1' }),
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({
      type: 'consume-answer',
      newStatus: 'answered',
      run: { skill: 'implementation', sessionId: 'sess-1', prompt: PROMPTS.implementation(state) },
    });
  });

  it('action faite alors qu’un run attendait cette carte → reprise', () => {
    const state = task({
      phase: 'implementation',
      cards: [card(ACTION, { answer: simple('card-1', 'done', 'token posé') })],
      run: runBlock({ skill: 'implementation@0.1.0', status: 'waiting', card: 'card-1' }),
    });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({
      type: 'consume-answer',
      newStatus: 'done',
      run: { sessionId: 'sess-1', prompt: PROMPTS.actionDone('card-1', 'token posé') },
    });
    expect(PROMPTS.actionDone('card-1', '')).not.toContain(':');
  });

  it('action faite sans run en attente → statut done seulement', () => {
    const state = task({
      phase: 'verdict',
      cards: [card({ ...ACTION, title: CARD_TITLES.merge }, { answer: simple('card-1', 'done') })],
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      {
        type: 'consume-answer',
        issue: 7,
        cardId: 'card-1',
        newStatus: 'done',
        addBlockingRule: false,
      },
    ]);
  });

  it('Run interrompu faite → reprise de la session du bloc, ou run neuf', () => {
    const answered = card(
      { ...ACTION, title: CARD_TITLES.runInterrupted },
      { answer: simple('card-1', 'done') },
    );
    const withBlock = task({
      cards: [answered],
      run: runBlock(),
      lock: { active: false, failed: true },
    });
    const [a] = reconcile(withBlock, local(), REPO);
    expect(a).toMatchObject({
      type: 'consume-answer',
      run: { skill: 'framing', sessionId: 'sess-1', prompt: PROMPTS.resumeAfterInterruption },
    });
    const [b] = reconcile(task({ cards: [answered] }), local(), REPO);
    expect(b?.type === 'consume-answer' && b.run?.sessionId).toBeUndefined();
  });
});

describe('reconcile — implémentation et CI', () => {
  const implementation = (over: Parameters<typeof task>[0] = {}) =>
    task({ phase: 'implementation', contract: CONTRACT_FULL, ...over });

  it('contrat complet, pas de run, pas de PR → démarre implementation', () => {
    expect(reconcile(implementation(), local(), REPO)).toEqual([
      {
        type: 'start-run',
        issue: 7,
        run: { skill: 'implementation', prompt: PROMPTS.implementation(implementation()) },
      },
    ]);
  });

  it('contrat incomplet, absent, run:failed, carte ouverte ou bloc de run → pas de démarrage', () => {
    expect(reconcile(implementation({ contract: CONTRACT_PENDING }), local(), REPO)).toEqual([]);
    expect(reconcile(task({ phase: 'implementation' }), local(), REPO)).toEqual([]);
    expect(
      reconcile(implementation({ lock: { active: false, failed: true } }), local(), REPO),
    ).toEqual([]);
    expect(reconcile(implementation({ cards: [card(ACTION)] }), local(), REPO)).toEqual([]);
    expect(
      reconcile(
        implementation({ run: runBlock({ skill: 'implementation@0.1.0', status: 'failed' }) }),
        local(),
        REPO,
      ),
    ).toEqual([]);
  });

  it('CI verte avec lignes pending → proven avec l’URL du run', () => {
    const state = implementation({
      pr: pull({
        ci: { kind: 'green', url: 'https://ci/1' },
        evidence: evidence([
          { criterion: 'C1', proof: '`a`', state: 'pending' },
          { criterion: 'C2', proof: '[capture](https://x/y.png)', state: 'to-review' },
        ]),
      }),
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      { type: 'mark-proven', issue: 7, pr: 20, criteria: ['C1'], runUrl: 'https://ci/1' },
    ]);
  });

  it('CI rouge et run terminé → reprise avec le journal, deux fois, puis carte', () => {
    const state = implementation({
      pr: pull({
        ci: { kind: 'red', url: 'https://ci/2' },
        evidence: evidence([{ criterion: 'C1', proof: '`a`', state: 'pending' }]),
      }),
      run: runBlock({ skill: 'implementation@0.1.0', status: 'finished', session: 'sess-i' }),
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      {
        type: 'start-run',
        issue: 7,
        run: {
          skill: 'implementation',
          prompt: PROMPTS.ciRed('https://ci/2', 1),
          sessionId: 'sess-i',
        },
      },
    ]);
    expect(reconcile(state, local({ ciRetries: [[7, 1]] }), REPO)[0]).toMatchObject({
      run: { prompt: PROMPTS.ciRed('https://ci/2', 2) },
    });
    const [third] = reconcile(state, local({ ciRetries: [[7, 2]] }), REPO);
    expect(third).toMatchObject({
      type: 'publish-action-card',
      title: CARD_TITLES.ciRed('abc1234def'),
    });
    const withCard = implementation({
      ...state,
      cards: [card({ ...ACTION, title: CARD_TITLES.ciRed('abc1234def') }, { place: 'pr' })],
      needs: new Set(['action']),
    });
    expect(reconcile(withCard, local({ ciRetries: [[7, 2]] }), REPO)).toEqual([]);
  });

  it('CI rouge pendant un run en attente de carte → rien', () => {
    const state = implementation({
      pr: pull({ ci: { kind: 'red', url: 'https://ci/2' } }),
      run: runBlock({ skill: 'implementation@0.1.0', status: 'waiting', card: 'card-2' }),
      cards: [card(ARBITRATION, { id: 'card-2' })],
    });
    expect(reconcile(state, local(), REPO)).toEqual([]);
  });

  it('aucun workflow Actions avec lignes pending → carte Aucune CI, une seule fois', () => {
    const state = implementation({
      pr: pull({ evidence: evidence([{ criterion: 'C1', proof: '`a`', state: 'pending' }]) }),
    });
    const [action] = reconcile(state, local(), { hasWorkflows: false });
    expect(action).toMatchObject({ type: 'publish-action-card', title: CARD_TITLES.noCi });
    const done = card({ ...ACTION, title: CARD_TITLES.noCi }, { status: 'done', place: 'pr' });
    expect(
      reconcile(implementation({ ...state, cards: [done] }), local(), { hasWorkflows: false }),
    ).toEqual([]);
  });

  it('run terminé sans carte, zéro missing, zéro pending, CI verte → phase evidence, PR prête', () => {
    const state = implementation({
      pr: pull({
        ci: { kind: 'green', url: 'https://ci/1' },
        evidence: evidence([
          { criterion: 'C1', proof: '[run](https://ci/1)', state: 'proven' },
          { criterion: 'C2', proof: '[capture](https://x/y.png)', state: 'to-review' },
        ]),
      }),
      run: runBlock({ skill: 'implementation@0.1.0', status: 'finished' }),
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      { type: 'set-phase', issue: 7, phase: 'evidence', markReady: true },
    ]);
    expect(
      reconcile(
        implementation({ ...state, pr: pull({ ...state.pr, draft: false }) }),
        local(),
        REPO,
      ),
    ).toEqual([{ type: 'set-phase', issue: 7, phase: 'evidence', markReady: false }]);
  });

  it('sans CI du tout, seulement des to-review → phase evidence quand même', () => {
    const state = implementation({
      pr: pull({
        evidence: evidence([
          { criterion: 'C1', proof: '[f](https://x)', state: 'to-review' },
          { criterion: 'C2', proof: '[g](https://y)', state: 'to-review' },
        ]),
      }),
      run: runBlock({ skill: 'implementation@0.1.0', status: 'finished' }),
    });
    expect(reconcile(state, local(), { hasWorkflows: false })[0]).toMatchObject({
      type: 'set-phase',
      phase: 'evidence',
    });
  });

  it('run terminé mais critère missing, ou CI pas verte, ou contrat absent → rien', () => {
    const base = {
      pr: pull({
        ci: { kind: 'green' as const, url: 'https://ci/1' },
        evidence: evidence([{ criterion: 'C1', proof: '[r](https://ci/1)', state: 'proven' }]),
      }),
      run: runBlock({ skill: 'implementation@0.1.0', status: 'finished' }),
    };
    expect(reconcile(implementation(base), local(), REPO)).toEqual([]);
    const complete = evidence([
      { criterion: 'C1', proof: '[r](https://ci/1)', state: 'proven' },
      { criterion: 'C2', proof: '[c](https://x)', state: 'to-review' },
    ]);
    expect(
      reconcile(
        implementation({
          ...base,
          pr: pull({ ci: { kind: 'pending', url: 'https://ci/3' }, evidence: complete }),
        }),
        local(),
        REPO,
      ),
    ).toEqual([]);
    expect(
      reconcile(
        task({
          phase: 'implementation',
          pr: pull({ ci: { kind: 'green', url: 'u' }, evidence: complete }),
          run: base.run,
        }),
        local(),
        REPO,
      ),
    ).toEqual([]);
  });
});

describe('reconcile — preuves, verdict, nettoyage', () => {
  it('evidence, toutes lignes proven → verdict', () => {
    const state = task({
      phase: 'evidence',
      contract: CONTRACT_FULL,
      pr: pull({
        draft: false,
        evidence: evidence([
          { criterion: 'C1', proof: '[r](https://ci/1)', state: 'proven' },
          { criterion: 'C2', proof: '[c](https://x)', state: 'proven' },
        ]),
      }),
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      { type: 'set-phase', issue: 7, phase: 'verdict', markReady: false },
    ]);
  });

  it('evidence avec une ligne to-review, sans PR ou sans contrat → rien', () => {
    const ev = evidence([
      { criterion: 'C1', proof: '[r](https://ci/1)', state: 'proven' },
      { criterion: 'C2', proof: '[c](https://x)', state: 'to-review' },
    ]);
    expect(
      reconcile(
        task({ phase: 'evidence', contract: CONTRACT_FULL, pr: pull({ evidence: ev }) }),
        local(),
        REPO,
      ),
    ).toEqual([]);
    expect(reconcile(task({ phase: 'evidence', contract: CONTRACT_FULL }), local(), REPO)).toEqual(
      [],
    );
    expect(reconcile(task({ phase: 'evidence', pr: pull() }), local(), REPO)).toEqual([]);
  });

  it('verdict → carte Fusionner la PR, une seule fois', () => {
    const state = task({ phase: 'verdict', contract: CONTRACT_FULL, pr: pull({ draft: false }) });
    const [action] = reconcile(state, local(), REPO);
    expect(action).toMatchObject({ type: 'publish-action-card', title: CARD_TITLES.merge });
    const open = card({ ...ACTION, title: CARD_TITLES.merge }, { place: 'pr' });
    expect(
      reconcile(task({ ...state, cards: [open], needs: new Set(['action']) }), local(), REPO),
    ).toEqual([]);
    expect(reconcile(task({ phase: 'verdict' }), local(), REPO)).toEqual([]);
  });

  it('PR fusionnée ou issue fermée → nettoyage si quelque chose reste', () => {
    const merged = task({
      phase: 'verdict',
      pr: pull({ merged: true, open: false }),
      lock: { active: false, failed: true },
    });
    expect(reconcile(merged, local({ worktrees: [7] }), REPO)).toEqual([
      { type: 'cleanup', issue: 7, removeRunLabel: true, removeWorktree: true },
    ]);
    expect(reconcile(task({ closed: true }), local({ worktrees: [7] }), REPO)).toEqual([
      { type: 'cleanup', issue: 7, removeRunLabel: false, removeWorktree: true },
    ]);
    expect(reconcile(task({ closed: true }), local(), REPO)).toEqual([]);
  });

  it('étiquette needs incohérente avec les cartes ouvertes → corrigée', () => {
    const state = task({
      phase: 'implementation',
      needs: new Set(['arbitration']),
      cards: [card(DECISION), card(ACTION, { id: 'card-2' })],
    });
    expect(reconcile(state, local(), REPO)).toEqual([
      { type: 'fix-needs', issue: 7, needs: ['validation', 'action'] },
    ]);
    const consistent = task({
      phase: 'implementation',
      needs: new Set(['arbitration']),
      cards: [card(ARBITRATION)],
    });
    expect(reconcile(consistent, local(), REPO)).toEqual([]);
  });
});
