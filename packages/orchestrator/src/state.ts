import {
  attachAnswers,
  canStartImplementation,
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
  type StartBlocker,
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
  createdAt: string;
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
  evidenceComment?: { url: string; createdAt: string };
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
  /** Étiquettes qui ne sont pas à nous, conservées à chaque réécriture. */
  otherLabels: readonly string[];
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
  return String(skill.split('@')[0]);
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
  let evidence: { value: Evidence; comment: CommentData } | undefined;
  for (const c of comments) {
    const card = parseCard(c.body);
    if (card.ok) {
      cards.push({
        card: card.value,
        location: { place, number, commentId: c.id, url: c.url, createdAt: c.createdAt },
      });
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
    if (ev.ok) evidence = { value: ev.value, comment: c };
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
  const pull = input.pull
    ? { ...input.pull, parsed: collect(input.pull.comments, 'pr', input.pull.data.number) }
    : undefined;
  const fromPull = pull?.parsed;
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
    otherLabels: labels.value.others,
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
  if (pull) {
    const p = pull.data;
    state.pr = {
      number: p.number,
      draft: p.draft,
      headRef: p.headRef,
      headSha: p.headSha,
      merged: p.merged,
      open: p.state === 'open',
      url: p.url,
      ci: ciStatusOf(pull.ci),
    };
    if (pull.parsed.evidence) {
      const { value, comment } = pull.parsed.evidence;
      state.pr.evidence = value;
      state.pr.evidenceCommentId = comment.id;
      state.pr.evidenceComment = { url: comment.url, createdAt: comment.createdAt };
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
  kind: CardKind | 'item' | 'evidence';
  title: string;
  context: string;
  options: CardOption[];
  recommendation?: { letter: string; text: string };
  changeCost?: string;
  reversibility?: Reversibility;
  origin?: 'framing' | 'implementation';
  skill?: string;
  url?: string;
  /** Date ISO du commentaire source (carte ou preuves) ; absente pour un item de contrat. */
  createdAt?: string;
  /** Item de contrat `pending` (file Valider). */
  item?: ContractItem;
  /** Critère `to-review` de la preuve d'une PR ouverte (file Valider). */
  evidence?: { pr: number; criterion: string; artifactUrl?: string };
}

export interface TaskView {
  issue: number;
  title: string;
  url: string;
  phase: Phase;
  needs: Need[];
  lock?: { active: boolean; failed: boolean; assignee?: string };
  /** Raisons qui empêchent `startImplementation` (`canStartImplementation`) ; vide = lançable. */
  startBlockers: StartBlocker[];
  openCards: number;
  pr?: { number: number; url: string; draft: boolean; merged: boolean; ci: CiStatus };
}

export interface RunView {
  issue: number;
  skill: string;
  startedAt: string;
  lastEvent: FactoryEvent;
  /** Dernier `agent.tool` ou `agent.message` du run ; absent tant qu'il n'y en a pas. */
  lastAgentEvent?: AgentEvent;
}

export type AgentEvent = Extract<FactoryEvent, { type: 'agent.tool' | 'agent.message' }>;

/** Dépôt piloté : `owner/repo` et clone de la factory (`<userData>/repos/<owner>-<repo>`). */
export interface RepoInfo {
  slug: string;
  path: string;
}

export interface InboxState {
  status: 'ready' | 'blocked';
  repo: RepoInfo;
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
    createdAt: c.location.createdAt,
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

const ARTIFACT_URL_RE = /\]\((https?:\/\/[^)\s]+)\)/;

/** Une vue par critère `to-review` de la preuve d'une PR ouverte (D2). */
function evidenceViews(state: TaskState): CardView[] {
  const pr = state.pr;
  if (!pr?.open || !pr.evidence) return [];
  return pr.evidence.lines
    .filter((line) => line.state === 'to-review')
    .map((line) => {
      const text = state.contract?.items.find((i) => i.id === line.criterion)?.text;
      const evidence: NonNullable<CardView['evidence']> = {
        pr: pr.number,
        criterion: line.criterion,
      };
      const artifactUrl = ARTIFACT_URL_RE.exec(line.proof)?.[1];
      if (artifactUrl !== undefined) evidence.artifactUrl = artifactUrl;
      const view: CardView = {
        id: `${String(pr.number)}:${line.criterion}`,
        issue: state.issue,
        issueTitle: state.title,
        kind: 'evidence',
        title: text !== undefined ? `${line.criterion} — ${text}` : line.criterion,
        context: line.proof,
        options: [],
        evidence,
      };
      if (pr.evidenceComment) {
        view.url = pr.evidenceComment.url;
        view.createdAt = pr.evidenceComment.createdAt;
      }
      return view;
    });
}

function startBlockers(contract: Contract | undefined): StartBlocker[] {
  const ready = canStartImplementation(contract ?? { version: 0, skill: '', items: [] });
  return ready.ok ? [] : ready.error;
}

export function taskView(state: TaskState): TaskView {
  const view: TaskView = {
    issue: state.issue,
    title: state.title,
    url: state.url,
    phase: state.phase,
    needs: [...state.needs],
    startBlockers: startBlockers(state.contract),
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
    repo: RepoInfo;
    lastSync: Date;
    errors?: string[];
    blocked?: { message: string; command?: string };
  },
): InboxState {
  const validate: CardView[] = [];
  const arbitrate: CardView[] = [];
  const act: CardView[] = [];
  for (const state of tasks) {
    if (state.closed) continue; // relue pour le nettoyage, plus affichée
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
    validate.push(...evidenceViews(state));
  }
  const inbox: InboxState = {
    status: extra.blocked ? 'blocked' : 'ready',
    repo: extra.repo,
    validate,
    arbitrate,
    act,
    tasks: tasks.filter((t) => !t.closed).map(taskView),
    lastSync: extra.lastSync,
    errors: extra.errors ?? [],
  };
  if (extra.blocked) inbox.blockedReason = extra.blocked;
  if (extra.run) inbox.run = extra.run;
  return inbox;
}
