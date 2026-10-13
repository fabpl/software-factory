import {
  canReachEvidencePhase,
  canReachVerdict,
  canStartImplementation,
  isBlocking,
  queueFor,
  shouldHaveBlocked,
  statusAfter,
  writeContract,
  type Card,
  type CardAnswer,
  type CardStatus,
  type Evidence,
  type Need,
  type Phase,
} from '@factory/conventions';
import { intentOf, openCards, skillForPhase, type TaskCard, type TaskState } from './state.js';

/**
 * Table de réconciliation de SPEC-orchestrator : état observé → actions. Fonction pure, sans
 * horloge ni hasard ; les effets sont dans `orchestrator.ts`, `handlers.ts`, `worktree.ts`.
 */

export type SkillName = 'framing' | 'implementation';

/** Ce que l'orchestrateur sait localement : runs vivants, worktrees présents, reprises CI. */
export interface LocalView {
  runs: ReadonlySet<number>;
  worktrees: ReadonlySet<number>;
  ciRetries: ReadonlyMap<number, number>;
}

export interface RepoView {
  hasWorkflows: boolean;
}

export interface RunRequest {
  skill: SkillName;
  prompt: string;
  /** Session du bloc de run, si reprise. */
  sessionId?: string;
  /** Réponse humaine passée à `resume` ; absente = `start`. */
  answer?: CardAnswer;
  /** Reprise sur CI rouge : comptée pour le plafond `MAX_CI_RETRIES`. */
  ciRetry?: true;
}

export type Action =
  | { type: 'recover-failed-run'; issue: number }
  | { type: 'cleanup'; issue: number; removeRunLabel: boolean; removeWorktree: boolean }
  | {
      type: 'consume-answer';
      issue: number;
      cardId: string;
      /** Commentaire de la carte, à réécrire avec le nouveau statut. */
      commentId: number;
      card: Card;
      newStatus: CardStatus;
      /** Réponse `reverse` contenant « aurait dû bloquer » : ligne à ajouter sous Bloquant dans `rules.md`. */
      blockingRule?: string;
      run?: RunRequest;
    }
  | { type: 'normalize-contract'; issue: number; body: string }
  | { type: 'fix-needs'; issue: number; needs: Need[] }
  | { type: 'start-run'; issue: number; run: RunRequest }
  | {
      type: 'mark-proven';
      issue: number;
      pr: number;
      criteria: string[];
      runUrl: string;
      /** Commentaire de preuves et son nouveau contenu, calculés ici. */
      commentId: number;
      evidence: Evidence;
    }
  | { type: 'publish-action-card'; issue: number; title: string; context: string }
  | { type: 'set-phase'; issue: number; phase: Phase; markReady: boolean };

/** Titres des cartes `action` publiées par l'orchestrateur (idempotence par titre). */
export const CARD_TITLES = {
  runInterrupted: 'Run interrompu, relancer ?',
  noCi: 'Aucune CI configurée',
  ciRed: (sha: string): string => `CI rouge sur ${sha.slice(0, 7)}, intervention nécessaire`,
  merge: 'Fusionner la PR',
  backToFraming: 'Retour en cadrage : supprimer le worktree ?',
  framingNotConverging: 'Cadrage non convergent',
} as const;

export const MAX_CI_RETRIES = 2;

export const PROMPTS = {
  framing: (state: TaskState): string =>
    `Cadrage de l'issue #${String(state.issue)} « ${state.title} ».\n\nIntention de l'humain :\n\n${intentOf(state.body)}`,
  implementation: (state: TaskState): string =>
    `Implémentation du contrat de l'issue #${String(state.issue)} « ${state.title} ». Commence par read_rules, puis découpe les critères validés en tranches.`,
  resumeAfterInterruption:
    'Le run précédent a été interrompu. Reprends là où tu en étais, en relisant le contrat et les règles.',
  reverse: (cardId: string, text: string): string =>
    `L'humain désavoue la décision ${cardId}${text === '' ? '' : ` : ${text}`}. Annule ce choix, applique l'alternative, puis continue.`,
  actionDone: (cardId: string, text: string): string =>
    `L'humain a fait l'action demandée par la carte ${cardId}${text === '' ? '' : ` : ${text}`}. Continue.`,
  ciRed: (runUrl: string, attempt: number): string =>
    `La CI est rouge sur le dernier push (tentative ${String(attempt)} sur ${String(MAX_CI_RETRIES)}). Tu ne peux pas ouvrir son journal (${runUrl}) : relance les commandes du dépôt dans le worktree (tests, lint, typecheck) pour reproduire l'échec, corrige la tranche concernée sans toucher au contrat, puis update_evidence.`,
} as const;

function hasCard(state: TaskState, title: string, status?: CardStatus): boolean {
  return state.cards.some(
    (c) => c.card.title === title && (status === undefined || c.card.status === status),
  );
}

function expectedNeeds(state: TaskState): Need[] {
  const needs = new Set<Need>();
  for (const c of openCards(state)) {
    const queue = queueFor(c.card.kind);
    needs.add(
      queue === 'validate' ? 'validation' : queue === 'arbitrate' ? 'arbitration' : 'action',
    );
  }
  return [...needs];
}

function sameNeeds(a: ReadonlySet<Need>, b: readonly Need[]): boolean {
  return a.size === b.length && b.every((n) => a.has(n));
}

/** Reprise d'un run arrêté sur cette carte, ou run neuf si le bloc de run est absent. */
function resumeRun(
  state: TaskState,
  skill: SkillName,
  answer: CardAnswer,
  prompt: string,
  cardId: string,
): RunRequest {
  const run: RunRequest = { skill, prompt, answer };
  if (state.run?.status === 'waiting' && state.run.card === cardId)
    run.sessionId = state.run.session;
  return run;
}

function consumeAnswer(state: TaskState, c: TaskCard, answer: CardAnswer): Action {
  const skill = skillForPhase(state.phase);
  const base = {
    type: 'consume-answer' as const,
    issue: state.issue,
    cardId: c.card.id,
    commentId: c.location.commentId,
    card: c.card,
    newStatus: statusAfter(answer),
  };
  const kind = c.card.kind;

  if (kind === 'question' || kind === 'arbitration') {
    const prompt = skill === 'framing' ? PROMPTS.framing(state) : PROMPTS.implementation(state);
    return { ...base, run: resumeRun(state, skill, answer, prompt, c.card.id) };
  }
  if (kind === 'decision') {
    if (answer.choice.kind !== 'reverse') return base;
    const run: RunRequest = { skill, prompt: PROMPTS.reverse(c.card.id, answer.text), answer };
    if (state.run !== undefined) run.sessionId = state.run.session;
    if (!shouldHaveBlocked(answer)) return { ...base, run };
    const blockingRule = `${c.card.title} (désaveu sur #${String(state.issue)}, carte ${c.card.id}) : ${answer.text}`;
    return { ...base, blockingRule, run };
  }
  // action
  if (c.card.title === CARD_TITLES.runInterrupted) {
    // Le run attendait une carte encore ouverte : c'est la réponse à cette carte qui relancera.
    const waitingOn = state.run?.status === 'waiting' ? state.run.card : undefined;
    if (waitingOn !== undefined && openCards(state).some((o) => o.card.id === waitingOn))
      return base;
    const run: RunRequest = { skill, prompt: PROMPTS.resumeAfterInterruption, answer };
    if (state.run !== undefined) run.sessionId = state.run.session;
    return { ...base, run };
  }
  if (state.run?.status === 'waiting' && state.run.card === c.card.id) {
    const prompt = PROMPTS.actionDone(c.card.id, answer.text);
    return { ...base, run: resumeRun(state, skill, answer, prompt, c.card.id) };
  }
  return base;
}

function framingActions(state: TaskState, local: LocalView): Action[] {
  if (state.pr?.open === true && !hasCard(state, CARD_TITLES.backToFraming, 'open')) {
    const done = state.cards.find(
      (c) => c.card.title === CARD_TITLES.backToFraming && c.card.status === 'done',
    );
    if (!done) {
      return [
        {
          type: 'publish-action-card',
          issue: state.issue,
          title: CARD_TITLES.backToFraming,
          context: `La tâche est revenue en cadrage alors que la PR #${String(state.pr.number)} est ouverte. Le worktree est gardé jusqu'à votre réponse ; « fait » le supprime avec sa branche locale.`,
        },
      ];
    }
    if (local.worktrees.has(state.issue)) {
      return [{ type: 'cleanup', issue: state.issue, removeRunLabel: false, removeWorktree: true }];
    }
  }
  if (state.lock !== undefined) return [];
  if (openCards(state).length > 0) return [];
  if (state.run?.status === 'finished') return [];
  return [
    {
      type: 'start-run',
      issue: state.issue,
      run: { skill: 'framing', prompt: PROMPTS.framing(state) },
    },
  ];
}

function implementationActions(state: TaskState, local: LocalView, repo: RepoView): Action[] {
  const { pr, contract } = state;
  if (pr?.open !== true) {
    if (state.lock !== undefined || contract === undefined || !canStartImplementation(contract).ok)
      return [];
    if (openCards(state).length > 0 || state.run !== undefined) return [];
    return [
      {
        type: 'start-run',
        issue: state.issue,
        run: { skill: 'implementation', prompt: PROMPTS.implementation(state) },
      },
    ];
  }
  const lines = pr.evidence?.lines ?? [];
  const pending = lines.filter((l) => l.state === 'pending').map((l) => l.criterion);

  if (
    pr.ci.kind === 'green' &&
    pending.length > 0 &&
    pr.evidence &&
    pr.evidenceCommentId !== undefined
  ) {
    const runUrl = pr.ci.url;
    const evidence: Evidence = {
      ...pr.evidence,
      lines: pr.evidence.lines.map((l) =>
        l.state === 'pending'
          ? { ...l, state: 'proven', proof: `[run CI](${runUrl}) — ${l.proof}` }
          : l,
      ),
    };
    return [
      {
        type: 'mark-proven',
        issue: state.issue,
        pr: pr.number,
        criteria: pending,
        runUrl,
        commentId: pr.evidenceCommentId,
        evidence,
      },
    ];
  }
  if (pr.ci.kind === 'red' && state.run?.status === 'finished' && state.lock === undefined) {
    const attempt = (local.ciRetries.get(state.issue) ?? 0) + 1;
    if (attempt <= MAX_CI_RETRIES) {
      return [
        {
          type: 'start-run',
          issue: state.issue,
          run: {
            skill: 'implementation',
            prompt: PROMPTS.ciRed(pr.ci.url, attempt),
            sessionId: state.run.session,
            ciRetry: true,
          },
        },
      ];
    }
    const title = CARD_TITLES.ciRed(pr.headSha);
    if (!hasCard(state, title)) {
      return [
        {
          type: 'publish-action-card',
          issue: state.issue,
          title,
          context: `Deux reprises n'ont pas suffi : ${pr.ci.url}. Corrigez à la main dans la PR, ou renvoyez en cadrage. « fait » ne relance rien : le tick suivant relit la CI.`,
        },
      ];
    }
    return [];
  }
  if (!repo.hasWorkflows && pending.length > 0 && !hasCard(state, CARD_TITLES.noCi)) {
    return [
      {
        type: 'publish-action-card',
        issue: state.issue,
        title: CARD_TITLES.noCi,
        context: `Des preuves attendent la CI (${pending.join(', ')}) mais le dépôt n'a aucun workflow Actions. Ajoutez-en un, ou marquez les preuves à la main.`,
      },
    ];
  }
  if (
    state.run?.status === 'finished' &&
    state.lock === undefined &&
    openCards(state).length === 0 &&
    contract !== undefined &&
    canReachEvidencePhase(contract, pr.evidence) &&
    (pr.ci.kind === 'green' || (!repo.hasWorkflows && pending.length === 0))
  ) {
    return [{ type: 'set-phase', issue: state.issue, phase: 'evidence', markReady: pr.draft }];
  }
  return [];
}

function evidenceActions(state: TaskState): Action[] {
  const { pr, contract } = state;
  if (!pr || contract === undefined) return [];
  if (!canReachVerdict(contract, pr.evidence)) return [];
  return [{ type: 'set-phase', issue: state.issue, phase: 'verdict', markReady: pr.draft }];
}

function verdictActions(state: TaskState): Action[] {
  if (!state.pr || hasCard(state, CARD_TITLES.merge)) return [];
  return [
    {
      type: 'publish-action-card',
      issue: state.issue,
      title: CARD_TITLES.merge,
      context: `Toutes les preuves sont acquises. Fusionnez la PR #${String(state.pr.number)} (${state.pr.url}) ; l'orchestrateur nettoie ensuite le worktree.`,
    },
  ];
}

export function reconcile(state: TaskState, local: LocalView, repo: RepoView): Action[] {
  if (state.lock?.active === true && !local.runs.has(state.issue)) {
    return [{ type: 'recover-failed-run', issue: state.issue }];
  }
  if (local.runs.size > 0) return []; // un seul run à la fois

  if (state.closed || state.pr?.merged === true) {
    const removeRunLabel = state.lock !== undefined;
    const removeWorktree = local.worktrees.has(state.issue);
    return removeRunLabel || removeWorktree
      ? [{ type: 'cleanup', issue: state.issue, removeRunLabel, removeWorktree }]
      : [];
  }

  const answered = openCards(state).find((c) => c.answer !== undefined);
  if (answered?.answer) return [consumeAnswer(state, answered, answered.answer)];

  if (state.contractDirty && state.contract) {
    return [
      {
        type: 'normalize-contract',
        issue: state.issue,
        body: writeContract(state.body, state.contract),
      },
    ];
  }

  let actions: Action[];
  switch (state.phase) {
    case 'intent':
      actions = [];
      break;
    case 'framing':
      actions = framingActions(state, local);
      break;
    case 'implementation':
      actions = implementationActions(state, local, repo);
      break;
    case 'evidence':
      actions = evidenceActions(state);
      break;
    case 'verdict':
      actions = verdictActions(state);
      break;
  }
  if (actions.length > 0) return actions;

  const needs = expectedNeeds(state);
  if (!sameNeeds(state.needs, needs)) return [{ type: 'fix-needs', issue: state.issue, needs }];
  return [];
}

/** Une carte publiée par l'agent bloque-t-elle le run ? Réexporté pour les handlers. */
export { isBlocking };
