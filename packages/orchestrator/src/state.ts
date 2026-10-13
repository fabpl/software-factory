import {
  attachAnswers,
  cardNumber,
  findDelimitedBlock,
  parseAnswer,
  parseCard,
  parseContract,
  parseEvidence,
  parseLabels,
  parseRunBlock,
  serializeContract,
  type Card,
  type CardAnswer,
  type CardKind,
  type CardOption,
  type Contract,
  type ContractItem,
  type Evidence,
  type LabelsError,
  type Need,
  type Phase,
  type Reversibility,
  type RunBlock,
} from '@factory/conventions';
import type { FactoryEvent } from '@factory/agent-adapter';
import {
  ciStatusOf,
  type CiRun,
  type CiStatus,
  type CommentData,
  type IssueData,
  type PullData,
} from './github.js';

/** Où vit un commentaire : l'issue (cadrage) ou la PR (implémentation). */
export interface CommentLocation {
  place: 'issue' | 'pr';
  number: number;
  commentId: number;
  url: string;
}

export interface TaskCard {
  card: Card;
  answer?: CardAnswer;
  location: CommentLocation;
}

export interface TaskPull {
  number: number;
  draft: boolean;
  headRef: string;
  headSha: string;
  merged: boolean;
  open: boolean;
  url: string;
  evidence?: Evidence;
  evidenceCommentId?: number;
  ci: CiStatus;
}

/** État observé d'une tâche, calculé à chaque tick, jamais stocké (SPEC-orchestrator). */
export interface TaskState {
  issue: number;
  title: string;
  body: string;
  url: string;
  closed: boolean;
  phase: Phase;
  needs: ReadonlySet<Need>;
  lock?: { active: boolean; failed: boolean; assignee?: string };
  contract?: Contract;
  /** Le bloc contrat du corps diffère de sa forme canonique (case cochée à la main…). */
  contractDirty: boolean;
  cards: TaskCard[];
  /** Bloc de run de la skill de la phase courante (issue pour `framing`, PR sinon). */
  run?: RunBlock;
  pr?: TaskPull;
}

export type StateError =
  { issue: number; kind: 'labels'; error: LabelsError } | { issue: number; kind: 'no-phase' };

export interface TaskInput {
  issue: IssueData;
  comments: readonly CommentData[];
  pull?: { data: PullData; comments: readonly CommentData[]; ci: CiRun | undefined };
}

export function skillForPhase(phase: Phase): 'framing' | 'implementation' {
  return phase === 'intent' || phase === 'framing' ? 'framing' : 'implementation';
}

function skillName(skill: string): string {
  return skill.split('@')[0] ?? '';
}

/** Intention : tout le corps hors bloc contrat. */
export function intentOf(body: string): string {
  const block = findDelimitedBlock(body, 'contract');
  const text = block ? body.slice(0, block.start) + body.slice(block.end) : body;
  return text.trim();
}

function collect(comments: readonly CommentData[], place: 'issue' | 'pr', number: number) {
  const cards: TaskCard[] = [];
  const answers: CardAnswer[] = [];
  const runs: RunBlock[] = [];
  let evidence: { value: Evidence; commentId: number } | undefined;
  for (const c of comments) {
    const card = parseCard(c.body);
    if (card.ok) {
      cards.push({ card: card.value, location: { place, number, commentId: c.id, url: c.url } });
      continue;
    }
    const answer = parseAnswer(c.body);
    if (answer.ok) {
      answers.push(answer.value);
      continue;
    }
    const run = parseRunBlock(c.body);
    if (run.ok) {
      runs.push(run.value);
      continue;
    }
    const ev = parseEvidence(c.body);
    if (ev.ok) evidence = { value: ev.value, commentId: c.id };
  }
  return { cards, answers, runs, evidence };
}

export function buildTaskState(
  input: TaskInput,
): { ok: true; value: TaskState } | { ok: false; error: StateError } {
  const { issue } = input;
  const labels = parseLabels(issue.labels);
  if (!labels.ok)
    return { ok: false, error: { issue: issue.number, kind: 'labels', error: labels.error } };
  if (labels.value.phase === undefined)
    return { ok: false, error: { issue: issue.number, kind: 'no-phase' } };
  const phase = labels.value.phase;

  const fromIssue = collect(input.comments, 'issue', issue.number);
  const fromPull = input.pull
    ? collect(input.pull.comments, 'pr', input.pull.data.number)
    : undefined;
  const cards = [...fromIssue.cards, ...(fromPull?.cards ?? [])];
  const answers = [...fromIssue.answers, ...(fromPull?.answers ?? [])];
  const attached = attachAnswers(
    cards.map((c) => c.card),
    answers,
  );
  for (const c of cards) {
    const a = attached.get(c.card.id);
    if (a) c.answer = a;
  }

  const wanted = skillForPhase(phase);
  const runs = [...(fromPull?.runs ?? []), ...fromIssue.runs];
  const run = runs.find((r) => skillName(r.skill) === wanted);

  const parsed = parseContract(issue.body);
  const contract = parsed.ok ? parsed.value : undefined;
  const block = findDelimitedBlock(issue.body, 'contract');
  const contractDirty =
    contract !== undefined &&
    block !== undefined &&
    issue.body.slice(block.start, block.end) !== serializeContract(contract);

  const state: TaskState = {
    issue: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    closed: issue.state === 'closed',
    phase,
    needs: labels.value.needs,
    contractDirty,
    cards,
  };
  if (labels.value.run !== undefined) {
    state.lock = { active: labels.value.run === 'active', failed: labels.value.run === 'failed' };
    const assignee = issue.assignees[0];
    if (assignee !== undefined) state.lock.assignee = assignee;
  }
  if (contract) state.contract = contract;
  if (run) state.run = run;
  if (input.pull) {
    const p = input.pull.data;
    state.pr = {
      number: p.number,
      draft: p.draft,
      headRef: p.headRef,
      headSha: p.headSha,
      merged: p.merged,
      open: p.state === 'open',
      url: p.url,
      ci: ciStatusOf(input.pull.ci),
    };
    if (fromPull?.evidence) {
      state.pr.evidence = fromPull.evidence.value;
      state.pr.evidenceCommentId = fromPull.evidence.commentId;
    }
  }
  return { ok: true, value: state };
}

export function openCards(state: TaskState): TaskCard[] {
  return state.cards.filter((c) => c.card.status === 'open');
}

/** Prochain identifiant de carte : max sur l'issue et la PR + 1 (jamais réutilisé). */
export function nextCardId(cards: readonly { card: Card }[]): string {
  const max = cards.reduce((m, c) => Math.max(m, cardNumber(c.card.id)), 0);
  return `card-${String(max + 1)}`;
}

// ---------------------------------------------------------------------------
// Vue pour l'inbox.

export interface CardView {
  id: string;
  issue: number;
  issueTitle: string;
  kind: CardKind | 'item';
  title: string;
  context: string;
  options: CardOption[];
  recommendation?: { letter: string; text: string };
  changeCost?: string;
  reversibility?: Reversibility;
  origin?: 'framing' | 'implementation';
  skill?: string;
  url?: string;
  /** Item de contrat `pending` (file Valider). */
  item?: ContractItem;
}

export interface TaskView {
  issue: number;
  title: string;
  url: string;
  phase: Phase;
  needs: Need[];
  lock?: { active: boolean; failed: boolean; assignee?: string };
  contractComplete: boolean;
  openCards: number;
  pr?: { number: number; url: string; draft: boolean; merged: boolean; ci: CiStatus };
}

export interface RunView {
  issue: number;
  skill: string;
  startedAt: string;
  lastEvent: FactoryEvent;
}

export interface InboxState {
  status: 'ready' | 'blocked';
  blockedReason?: { message: string; command?: string };
  validate: CardView[];
  arbitrate: CardView[];
  act: CardView[];
  tasks: TaskView[];
  run?: RunView;
  lastSync: Date;
  /** Tâches ignorées ce tick (étiquettes incohérentes…), en clair. */
  errors: string[];
}

function cardView(state: TaskState, c: TaskCard): CardView {
  const view: CardView = {
    id: c.card.id,
    issue: state.issue,
    issueTitle: state.title,
    kind: c.card.kind,
    title: c.card.title,
    context: c.card.context,
    options: c.card.options,
    reversibility: c.card.reversibility,
    origin: c.card.origin,
    skill: c.card.skill,
    url: c.location.url,
  };
  if (c.card.recommendation) view.recommendation = c.card.recommendation;
  if (c.card.changeCost !== undefined) view.changeCost = c.card.changeCost;
  return view;
}

function itemView(state: TaskState, item: ContractItem): CardView {
  return {
    id: `${String(state.issue)}:${item.id}`,
    issue: state.issue,
    issueTitle: state.title,
    kind: 'item',
    title: `${item.id} — ${item.text}`,
    context: item.plannedProof !== undefined ? `Preuve prévue : ${item.plannedProof}` : '',
    options: [],
    url: state.url,
    item,
  };
}

export function taskView(state: TaskState): TaskView {
  const view: TaskView = {
    issue: state.issue,
    title: state.title,
    url: state.url,
    phase: state.phase,
    needs: [...state.needs],
    contractComplete:
      state.contract?.items.every((i) => i.status !== 'pending' && i.status !== 'discussing') ??
      false,
    openCards: openCards(state).length,
  };
  if (state.lock) view.lock = state.lock;
  if (state.pr) {
    view.pr = {
      number: state.pr.number,
      url: state.pr.url,
      draft: state.pr.draft,
      merged: state.pr.merged,
      ci: state.pr.ci,
    };
  }
  return view;
}

export function buildInboxState(
  tasks: readonly TaskState[],
  extra: {
    run?: RunView;
    lastSync: Date;
    errors?: string[];
    blocked?: { message: string; command?: string };
  },
): InboxState {
  const validate: CardView[] = [];
  const arbitrate: CardView[] = [];
  const act: CardView[] = [];
  for (const state of tasks) {
    for (const c of openCards(state)) {
      const view = cardView(state, c);
      if (c.card.kind === 'decision') validate.push(view);
      else if (c.card.kind === 'action') act.push(view);
      else arbitrate.push(view);
    }
    if (state.phase === 'framing' || state.phase === 'intent') {
      for (const item of state.contract?.items ?? []) {
        if (item.status === 'pending') validate.push(itemView(state, item));
      }
    }
  }
  const inbox: InboxState = {
    status: extra.blocked ? 'blocked' : 'ready',
    validate,
    arbitrate,
    act,
    tasks: tasks.map(taskView),
    lastSync: extra.lastSync,
    errors: extra.errors ?? [],
  };
  if (extra.blocked) inbox.blockedReason = extra.blocked;
  if (extra.run) inbox.run = extra.run;
  return inbox;
}
