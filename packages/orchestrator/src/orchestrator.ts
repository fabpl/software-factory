import {
  canStartImplementation,
  hasUrl,
  labelsFor,
  LABEL_DEFINITIONS,
  parseContract,
  parseEvidence,
  parseLabels,
  serializeAnswer,
  serializeCard,
  serializeEvidence,
  serializeRunBlock,
  slugify,
  validateAnswer,
  withStatus,
  writeContract,
  type Card,
  type CardAnswer,
  type ItemStatus,
  type Need,
  type Phase,
  type RunBlock,
} from '@factory/conventions';
import {
  DEFAULT_POLICY,
  type AgentAdapter,
  type FactoryEvent,
  type Policy,
  type RunSpec,
} from '@factory/agent-adapter';
import { inject, loadSkill, type Skill } from '@factory/skills';
import {
  findMarked,
  findPull,
  framingBranch,
  upsertMarked,
  type GitHubPort,
  type IssueData,
  type PullData,
} from './github.js';
import { createHandlers, type Handlers } from './handlers.js';
import type { Log } from './log.js';
import {
  CARD_TITLES,
  reconcile,
  type Action,
  type RunRequest,
  type SkillName,
} from './reconcile.js';
import { appendRule, readRules } from './rules.js';
import {
  buildInboxState,
  buildTaskState,
  nextCardId,
  openCards,
  skillForPhase,
  type InboxState,
  type RunView,
  type TaskState,
} from './state.js';
import type { WorktreePort } from './worktree.js';

/**
 * Boucle de réconciliation et API vers l'inbox (SPEC-orchestrator). Aucun état indispensable ici :
 * tout se relit depuis GitHub à chaque tick. Zéro Electron : `userData` et le jeton sont injectés.
 */

export interface OrchestratorOptions {
  github: GitHubPort;
  adapter: AgentAdapter;
  worktrees: WorktreePort;
  log: Log;
  skillsDir?: string;
  clock?: () => Date;
  newRunId?: () => string;
  /** 30 s par défaut. */
  tickIntervalMs?: number;
  policy?: Policy;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface BlockedReason {
  message: string;
  command?: string;
}

/** Cartes publiées par l'orchestrateur lui-même : exemptées du contrôle de version de skill. */
export const ORCHESTRATOR_SKILL = 'orchestrator@0.1.0';
export const PROTOTYPE_DIR = 'prototype/';

interface LiveRun {
  issue: number;
  runId: string;
  skill: SkillName;
  startedAt: string;
  lastEvent: FactoryEvent;
  done: Promise<void>;
}

type Listener = (state: InboxState) => void;

export class Orchestrator {
  private readonly listeners = new Set<Listener>();
  private readonly clock: () => Date;
  private readonly newRunId: () => string;
  private readonly ciRetries = new Map<number, number>();
  private tasks: TaskState[] = [];
  private live: LiveRun | undefined;
  private ticking: Promise<void> | undefined;
  private pendingTick = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private labelsEnsured = false;
  private me = '';
  private state: InboxState;
  private runCounter = 0;

  constructor(
    private readonly options: OrchestratorOptions,
    private readonly blocked?: BlockedReason,
  ) {
    this.clock = options.clock ?? ((): Date => new Date());
    this.newRunId =
      options.newRunId ??
      ((): string => {
        this.runCounter += 1;
        return `run-${this.clock().toISOString().replace(/\D/g, '').slice(0, 14)}-${String(this.runCounter)}`;
      });
    this.state = buildInboxState([], {
      lastSync: this.clock(),
      ...(blocked ? { blocked } : {}),
    });
  }

  /** Orchestrateur qui ne démarre pas : prérequis manquant, commande à afficher dans la file Agir. */
  static blocked(reason: BlockedReason, options: OrchestratorOptions): Orchestrator {
    return new Orchestrator(options, reason);
  }

  // -- cycle de vie -----------------------------------------------------------

  start(): void {
    if (this.blocked || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.tickIntervalMs ?? 30_000);
    void this.tick();
  }

  /** Arrête le sondage, annule le run en cours et attend sa fin (≤ 10 s). */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.live) {
      await this.options.adapter.cancel(this.live.runId);
      await Promise.race([this.live.done, new Promise((r) => setTimeout(r, 10_000))]);
    }
  }

  /** Attend la fin du run en cours et du tick qui le suit (pilotage en ligne de commande). */
  async waitForRun(): Promise<void> {
    while (this.live || this.ticking) await (this.live?.done ?? this.ticking);
  }

  // -- lecture ----------------------------------------------------------------

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): InboxState {
    return this.state;
  }

  // -- commandes : écrivent dans GitHub puis forcent un tick -------------------

  async startFraming(issue: number): Promise<void> {
    await this.setPhase(issue, 'framing', ['intent']);
    await this.tick();
  }

  async startImplementation(issue: number): Promise<void> {
    const current = await this.issueOrThrow(issue);
    const contract = parseContract(current.body);
    if (!contract.ok)
      throw new Error(`#${String(issue)} : aucun contrat lisible (${contract.error.kind})`);
    const ready = canStartImplementation(contract.value);
    if (!ready.ok) {
      const why = ready.error
        .map((b) =>
          b.kind === 'item-not-settled' ? `${b.id} ${b.status}` : 'aucun critère validé',
        )
        .join(', ');
      throw new Error(`#${String(issue)} : contrat incomplet (${why})`);
    }
    await this.setPhase(issue, 'implementation', ['framing']);
    await this.tick();
  }

  async sendBackToFraming(issue: number, reason: string): Promise<void> {
    const changed = await this.setPhase(issue, 'framing', [
      'implementation',
      'evidence',
      'verdict',
    ]);
    if (changed) await this.options.github.createComment(issue, `Renvoyé en cadrage : ${reason}`);
    await this.tick();
  }

  async answerCard(cardId: string, answer: CardAnswer): Promise<void> {
    this.assertReady();
    const found = this.tasks.flatMap((t) =>
      t.cards.filter((c) => c.card.id === cardId).map((c) => ({ task: t, card: c })),
    )[0];
    if (!found) throw new Error(`carte ${cardId} inconnue (rafraîchir ?)`);
    const valid = validateAnswer(found.card.card, { ...answer, cardId });
    if (!valid.ok) throw new Error(`réponse refusée : ${JSON.stringify(valid.error)}`);
    const comments = await this.options.github.listComments(found.card.location.number);
    const already = findMarked(
      comments,
      (name, attrs) => name === 'answer' && attrs.card === cardId,
    );
    if (!already)
      await this.options.github.createComment(
        found.card.location.number,
        serializeAnswer({ ...answer, cardId }),
      );
    await this.tick();
  }

  async validateItem(
    issue: number,
    itemId: string,
    status: ItemStatus,
    note?: string,
  ): Promise<void> {
    const current = await this.issueOrThrow(issue);
    const contract = parseContract(current.body);
    if (!contract.ok) throw new Error(`#${String(issue)} : aucun contrat lisible`);
    const item = contract.value.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`#${String(issue)} : item ${itemId} inconnu`);
    if (item.status === status && (note === undefined || item.note === note)) return;
    item.status = status;
    if (note !== undefined) item.note = note;
    const next = { ...contract.value, version: contract.value.version + 1 };
    await this.options.github.updateIssueBody(issue, writeContract(current.body, next));
    await this.tick();
  }

  markActionDone(cardId: string): Promise<void> {
    return this.answerCard(cardId, { cardId, choice: { kind: 'done' }, text: '' });
  }

  async markEvidenceReviewed(
    pr: number,
    criterion: string,
    verdict: 'proven' | 'blocked',
    note?: string,
  ): Promise<void> {
    this.assertReady();
    const { github } = this.options;
    const comments = await github.listComments(pr);
    const existing = findMarked(comments, (name) => name === 'evidence');
    const parsed = existing ? parseEvidence(existing.body) : undefined;
    if (!existing || parsed?.ok !== true)
      throw new Error(`PR #${String(pr)} : aucun commentaire de preuves lisible`);
    const line = parsed.value.lines.find((l) => l.criterion === criterion);
    if (!line) throw new Error(`PR #${String(pr)} : critère ${criterion} absent des preuves`);
    if (line.state === verdict && (note === undefined || line.note === note)) return;
    if (verdict === 'proven' && !hasUrl(line.proof)) {
      const pull = (await github.listPulls()).find((p) => p.number === pr);
      if (!pull) throw new Error(`PR #${String(pr)} introuvable`);
      const path = line.proof.replace(/^`|`$/g, '');
      line.proof = `[${path}](https://github.com/${github.ref.owner}/${github.ref.repo}/blob/${pull.headSha}/${path})`;
    }
    line.state = verdict;
    if (note !== undefined) line.note = note;
    else delete line.note;
    await github.updateComment(existing.id, serializeEvidence(parsed.value));
    await this.tick();
  }

  refresh(): Promise<void> {
    return this.tick();
  }

  /** Lecture seule : relit GitHub et publie l'état sans exécuter aucune action (`factory state`). */
  async observe(): Promise<InboxState> {
    if (this.blocked) return this.state;
    if (this.ticking) await this.ticking;
    const errors: string[] = [];
    try {
      await this.read(errors);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    this.publish(errors);
    return this.state;
  }

  // -- tick ---------------------------------------------------------------------

  /** Un tick à la fois ; un tick demandé pendant un tick en relance un juste après. */
  tick(): Promise<void> {
    if (this.blocked) return Promise.resolve();
    if (this.ticking) {
      this.pendingTick = true;
      return this.ticking;
    }
    this.ticking = this.runTick().finally(() => {
      this.ticking = undefined;
      if (this.pendingTick) {
        this.pendingTick = false;
        void this.tick();
      }
    });
    return this.ticking;
  }

  private async runTick(): Promise<void> {
    const { worktrees, log } = this.options;
    const errors: string[] = [];
    try {
      const { pulls, repo } = await this.read(errors);
      for (const task of this.tasks) {
        const local = {
          runs: new Set(this.live ? [this.live.issue] : []),
          worktrees: new Set(worktrees.list()),
          ciRetries: this.ciRetries,
        };
        for (const action of reconcile(task, local, repo)) {
          log.write(task.issue, { kind: 'action', action });
          await this.execute(task, action, pulls);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      log.write('repo', { kind: 'tick-error', error: String(error) });
    }
    this.publish(errors);
  }

  /** Moitié lecture du tick : étiquettes, identité, issues, PR, CI → `this.tasks`. */
  private async read(
    errors: string[],
  ): Promise<{ pulls: PullData[]; repo: { hasWorkflows: boolean } }> {
    const { github, worktrees } = this.options;
    if (!this.labelsEnsured) {
      await github.ensureLabels(LABEL_DEFINITIONS);
      this.labelsEnsured = true;
    }
    if (this.me === '') this.me = await github.whoami();
    const repo = { hasWorkflows: await github.hasWorkflows() };
    const pulls = await github.listPulls();
    const issues = await github.listManagedIssues();
    const known = new Set(issues.map((i) => i.number));
    for (const n of worktrees.list()) {
      if (known.has(n)) continue;
      const closed = await github.getIssue(n);
      if (closed) issues.push(closed);
    }
    const tasks: TaskState[] = [];
    for (const issue of issues) {
      const pull = findPull(pulls, issue.number);
      const built = buildTaskState({
        issue,
        comments: await github.listComments(issue.number),
        ...(pull
          ? {
              pull: {
                data: pull,
                comments: await github.listComments(pull.number),
                ci: await github.latestCiRun(pull.headSha),
              },
            }
          : {}),
      });
      if (built.ok) tasks.push(built.value);
      else errors.push(`#${String(built.error.issue)} ignorée : ${built.error.kind}`);
    }
    this.tasks = tasks;
    return { pulls, repo };
  }

  private publish(errors: string[] = this.state.errors): void {
    this.state = buildInboxState(this.tasks, {
      lastSync: this.clock(),
      errors,
      ...(this.live ? { run: this.runView(this.live) } : {}),
    });
    for (const l of this.listeners) l(this.state);
  }

  private runView(live: LiveRun): RunView {
    return {
      issue: live.issue,
      skill: live.skill,
      startedAt: live.startedAt,
      lastEvent: live.lastEvent,
    };
  }

  // -- exécution des actions ----------------------------------------------------

  private async execute(
    task: TaskState,
    action: Action,
    pulls: readonly PullData[],
  ): Promise<void> {
    const { github, worktrees } = this.options;
    switch (action.type) {
      case 'recover-failed-run': {
        await this.setLock(task, 'failed');
        await this.publishActionCard(
          task,
          CARD_TITLES.runInterrupted,
          'Le verrou `run:active` était posé sans run vivant : le processus a été interrompu. « fait » relance le run (reprise de session si possible).',
        );
        return;
      }
      case 'cleanup': {
        if (action.removeWorktree) await worktrees.remove(task.issue);
        if (action.removeRunLabel) await this.setLock(task, undefined);
        return;
      }
      case 'consume-answer': {
        await github.updateComment(
          action.commentId,
          serializeCard(withStatus(action.card, action.newStatus)),
        );
        if (action.blockingRule !== undefined) {
          const w = await this.worktreeFor(task, skillForPhase(task.phase));
          appendRule(w.path, 'Bloquant', action.blockingRule);
          await worktrees.commitAll(
            w.path,
            `chore(#${String(task.issue)}): règle Bloquant depuis la carte ${action.cardId}`,
          );
          await worktrees.push(w.path, w.branch);
        }
        if (action.run) await this.launch(task, action.run, pulls);
        return;
      }
      case 'normalize-contract': {
        await github.updateIssueBody(task.issue, action.body);
        return;
      }
      case 'fix-needs': {
        await this.patchLabels(task.issue, { needs: new Set(action.needs) });
        return;
      }
      case 'start-run': {
        await this.launch(task, action.run, pulls);
        return;
      }
      case 'mark-proven': {
        await github.updateComment(action.commentId, serializeEvidence(action.evidence));
        this.ciRetries.delete(task.issue);
        return;
      }
      case 'publish-action-card': {
        await this.publishActionCard(task, action.title, action.context);
        return;
      }
      case 'set-phase': {
        await this.patchLabels(task.issue, { phase: action.phase });
        if (action.markReady && task.pr) await github.markPullReady(task.pr.number);
        this.ciRetries.delete(task.issue);
        return;
      }
    }
  }

  /** Relit les étiquettes de l'issue et n'en change que ce qui est demandé (jamais depuis un état figé). */
  private async patchLabels(
    issue: number,
    over: {
      phase?: Phase;
      needs?: ReadonlySet<Need>;
      addNeed?: Need;
      run?: 'active' | 'failed' | null;
    },
  ): Promise<void> {
    const current = await this.options.github.getIssue(issue);
    if (!current) return;
    const labels = parseLabels(current.labels);
    if (!labels.ok) return;
    const needs = new Set(over.needs ?? labels.value.needs);
    if (over.addNeed !== undefined) needs.add(over.addNeed);
    const run = over.run === undefined ? labels.value.run : (over.run ?? undefined);
    const next = labelsFor({
      ...(over.phase !== undefined
        ? { phase: over.phase }
        : labels.value.phase !== undefined
          ? { phase: labels.value.phase }
          : {}),
      needs,
      ...(run !== undefined ? { run } : {}),
      others: labels.value.others,
    });
    if (next.join(',') !== current.labels.join(','))
      await this.options.github.setLabels(issue, next);
  }

  private async setLock(task: TaskState, run: 'active' | 'failed' | undefined): Promise<void> {
    await this.patchLabels(task.issue, { run: run ?? null });
    await this.options.github.setAssignees(task.issue, run === 'active' ? [this.me] : []);
    if (run === undefined) delete task.lock;
    else task.lock = { active: run === 'active', failed: run === 'failed', assignee: this.me };
  }

  private async publishActionCard(task: TaskState, title: string, context: string): Promise<void> {
    if (task.cards.some((c) => c.card.title === title && c.card.status === 'open')) return;
    const { github } = this.options;
    const origin =
      task.phase === 'intent' || task.phase === 'framing' ? 'framing' : 'implementation';
    const target = origin === 'framing' || !task.pr ? task.issue : task.pr.number;
    const card: Card = {
      id: nextCardId(task.cards),
      kind: 'action',
      origin,
      status: 'open',
      skill: ORCHESTRATOR_SKILL,
      title,
      context,
      options: [],
      reversibility: 'reversible',
    };
    const comment = await github.createComment(target, serializeCard(card));
    task.cards.push({
      card,
      location: {
        place: target === task.issue ? 'issue' : 'pr',
        number: target,
        commentId: comment.id,
        url: comment.url,
      },
    });
    await this.patchLabels(task.issue, { addNeed: 'action' });
  }

  // -- runs ----------------------------------------------------------------------

  private async worktreeFor(
    task: TaskState,
    skill: SkillName,
  ): Promise<{ path: string; branch: string }> {
    const { worktrees, github } = this.options;
    const base = await github.defaultBranch();
    const existing = await worktrees.open(task.issue);
    if (skill === 'framing') {
      if (existing?.branch.startsWith('framing/') === true) return existing;
      if (existing) return existing; // worktree d'implémentation gardé (carte « Retour en cadrage »)
      return worktrees.create(task.issue, framingBranch(task.issue), base);
    }
    if (existing?.branch.startsWith('factory/') === true) return existing;
    if (existing) await worktrees.remove(task.issue); // branche de cadrage supprimée au passage en implémentation
    const branch =
      task.pr?.headRef ??
      `factory/${String(task.issue)}-${slugify(task.title).slice(0, 40).replace(/-$/, '')}`;
    return worktrees.create(task.issue, branch, base);
  }

  private async launch(
    task: TaskState,
    request: RunRequest,
    pulls: readonly PullData[],
  ): Promise<void> {
    const { github, adapter, worktrees, log } = this.options;
    const skill: Skill = loadSkill(request.skill, this.options.skillsDir);
    const skillTag = `${skill.name}@${skill.version}`;
    // Un run qui (re)démarre rend caduque toute carte « Run interrompu » encore ouverte.
    for (const c of task.cards) {
      if (c.card.title !== CARD_TITLES.runInterrupted || c.card.status !== 'open') continue;
      c.card = withStatus(c.card, 'cancelled');
      await github.updateComment(c.location.commentId, serializeCard(c.card));
    }
    await this.setLock(task, 'active');
    if (request.ciRetry) this.ciRetries.set(task.issue, (this.ciRetries.get(task.issue) ?? 0) + 1);

    const worktree = await this.worktreeFor(task, request.skill);
    const pull = findPull(pulls, task.issue);
    const handlers: Handlers = createHandlers({
      github,
      worktrees,
      issue: task.issue,
      title: task.title,
      skill: skillTag,
      origin: request.skill,
      worktree: { issue: task.issue, ...worktree },
      defaultBranch: await github.defaultBranch(),
      clock: this.clock,
      ...(pull?.state === 'open' ? { pull: { number: pull.number } } : {}),
    });
    const spec: RunSpec = {
      runId: this.newRunId(),
      cwd: worktree.path,
      instructions: inject({
        skill,
        rules: readRules(worktree.path),
        ...(task.contract ? { contract: task.contract } : {}),
      }),
      prompt: request.prompt,
      requiredTools: skill.requiresTools,
      tools: handlers,
      policy: this.options.policy ?? DEFAULT_POLICY,
      ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
      ...(this.options.model !== undefined ? { model: this.options.model } : {}),
      ...(this.options.maxTurns !== undefined ? { maxTurns: this.options.maxTurns } : {}),
      ...(this.options.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: this.options.maxBudgetUsd }
        : {}),
    };
    const events = request.answer ? adapter.resume(spec, request.answer) : adapter.start(spec);
    const live: LiveRun = {
      issue: task.issue,
      runId: spec.runId,
      skill: request.skill,
      startedAt: this.clock().toISOString(),
      lastEvent: {
        type: 'run.started',
        runId: spec.runId,
        sessionId: request.sessionId ?? '',
        model: '',
        tools: [],
      },
      done: Promise.resolve(),
    };
    this.live = live;
    log.write(task.issue, {
      kind: 'run',
      runId: spec.runId,
      skill: skillTag,
      prompt: request.prompt,
      sessionId: request.sessionId,
    });
    live.done = this.consume(task, live, events, handlers, skillTag, worktree).finally(() => {
      this.live = undefined;
      // Relire GitHub tout de suite : l'inbox voit les cartes du run sans attendre le prochain tick.
      void this.tick();
    });
    await Promise.resolve();
  }

  private async consume(
    task: TaskState,
    live: LiveRun,
    events: AsyncIterable<FactoryEvent>,
    handlers: Handlers,
    skillTag: string,
    worktree: { path: string; branch: string },
  ): Promise<void> {
    const { github, worktrees, log } = this.options;
    let terminal: FactoryEvent | undefined;
    try {
      for await (const event of events) {
        log.write(task.issue, { kind: 'event', event });
        live.lastEvent = event;
        this.publish();
        if (
          event.type === 'run.waiting' ||
          event.type === 'run.finished' ||
          event.type === 'run.failed'
        )
          terminal = event;
      }
    } catch (error) {
      log.write(task.issue, { kind: 'run-error', error: String(error) });
    }
    try {
      if (
        live.skill === 'framing' &&
        (await worktrees.hasChangesUnder(worktree.path, PROTOTYPE_DIR))
      ) {
        await worktrees.commitAll(
          worktree.path,
          `chore(#${String(task.issue)}): prototype de cadrage`,
        );
        await worktrees.push(worktree.path, worktree.branch);
      }
      const block = this.runBlock(terminal, skillTag);
      if (block) {
        const target =
          live.skill === 'framing' ? task.issue : (handlers.pull()?.number ?? task.issue);
        await upsertMarked(
          github,
          target,
          (name, attrs) => name === 'run' && attrs.skill?.startsWith(`${live.skill}@`) === true,
          serializeRunBlock(block),
        );
      }
      const failed = terminal === undefined || terminal.type === 'run.failed';
      await this.setLock(task, failed ? 'failed' : undefined);
      if (failed) {
        const detail =
          terminal?.type === 'run.failed'
            ? `${terminal.reason} : ${terminal.detail}`
            : 'flux terminé sans événement terminal';
        await this.publishActionCard(
          task,
          CARD_TITLES.runInterrupted,
          `Le run s'est arrêté sans carte ni changement de phase (${detail}). « fait » relance (reprise de session si possible).`,
        );
      }
    } catch (error) {
      log.write(task.issue, { kind: 'finalize-error', error: String(error) });
    }
  }

  private runBlock(terminal: FactoryEvent | undefined, skill: string): RunBlock | undefined {
    if (!terminal) return undefined;
    const updated = this.clock().toISOString();
    if (terminal.type === 'run.waiting') {
      return {
        session: terminal.sessionId,
        skill,
        turns: 0,
        costUsd: 0,
        updated,
        status: 'waiting',
        card: terminal.cardId,
      };
    }
    if (terminal.type === 'run.finished') {
      return {
        session: terminal.sessionId,
        skill,
        turns: terminal.turns,
        costUsd: terminal.costUsd,
        updated,
        status: 'finished',
      };
    }
    if (
      terminal.type === 'run.failed' &&
      terminal.sessionId !== undefined &&
      terminal.sessionId !== ''
    ) {
      return {
        session: terminal.sessionId,
        skill,
        turns: 0,
        costUsd: 0,
        updated,
        status: 'failed',
      };
    }
    return undefined;
  }

  // -- aides ----------------------------------------------------------------------

  private assertReady(): void {
    if (this.blocked) throw new Error(`orchestrateur bloqué : ${this.blocked.message}`);
  }

  private async issueOrThrow(issue: number): Promise<IssueData> {
    this.assertReady();
    const current = await this.options.github.getIssue(issue);
    if (!current) throw new Error(`issue #${String(issue)} introuvable`);
    return current;
  }

  /** Change la phase si la transition est permise ; retourne faux si déjà dans la phase cible. */
  private async setPhase(issue: number, to: Phase, from: readonly Phase[]): Promise<boolean> {
    const current = await this.issueOrThrow(issue);
    const labels = parseLabels(current.labels);
    if (!labels.ok) throw new Error(`#${String(issue)} : étiquettes incohérentes`);
    if (labels.value.phase === to) return false;
    if (labels.value.phase === undefined || !from.includes(labels.value.phase)) {
      throw new Error(
        `#${String(issue)} : passage ${labels.value.phase ?? 'aucune phase'} → ${to} interdit`,
      );
    }
    await this.options.github.setLabels(issue, labelsFor({ ...labels.value, phase: to }));
    return true;
  }
}

export { openCards };
