import type { LabelDefinition } from '@factory/conventions';
import type {
  CiRun,
  CommentData,
  GitHubPort,
  IssueData,
  PullData,
  RepoRef,
} from '../../src/github.js';

/**
 * GitHub en mémoire : issues, commentaires, étiquettes, PR, runs Actions.
 * Chaque écriture est journalisée dans `writes` pour les assertions d'idempotence.
 */
export class FakeGitHub implements GitHubPort {
  readonly ref: RepoRef = { owner: 'acme', repo: 'widget' };
  readonly issues = new Map<number, IssueData>();
  readonly comments = new Map<number, CommentData[]>();
  readonly pulls: PullData[] = [];
  readonly ciRuns = new Map<string, CiRun>();
  readonly labelsCreated: string[] = [];
  readonly writes: string[] = [];
  workflows = true;
  me = 'factory-bot';
  private nextNumber = 1;
  private nextCommentId = 1000;
  private nextSha = 1;

  addIssue(input: Partial<IssueData> & { title: string }): IssueData {
    const number = input.number ?? this.nextNumber;
    this.nextNumber = Math.max(this.nextNumber, number + 1);
    const issue: IssueData = {
      number,
      title: input.title,
      body: input.body ?? '',
      labels: input.labels ?? [],
      state: input.state ?? 'open',
      assignees: input.assignees ?? [],
      url: `https://github.test/acme/widget/issues/${String(number)}`,
    };
    this.issues.set(number, issue);
    return issue;
  }

  addComment(number: number, body: string): CommentData {
    const id = this.nextCommentId++;
    const comment = {
      id,
      body,
      url: `https://github.test/acme/widget/issues/${String(number)}#issuecomment-${String(id)}`,
    };
    this.comments.set(number, [...(this.comments.get(number) ?? []), comment]);
    return comment;
  }

  /** Simule un push : nouveau SHA de tête sur la PR de cette branche. */
  advanceHead(headRef: string): string {
    const sha = `sha${String(this.nextSha++)}`;
    const pull = this.pulls.find((p) => p.headRef === headRef && p.state === 'open');
    if (pull) pull.headSha = sha;
    return sha;
  }

  merge(prNumber: number): void {
    const pull = this.pulls.find((p) => p.number === prNumber);
    if (!pull) throw new Error(`PR ${String(prNumber)} inconnue`);
    pull.merged = true;
    pull.state = 'closed';
  }

  bodyOf(number: number): string {
    return this.issues.get(number)?.body ?? '';
  }

  commentsOf(number: number): CommentData[] {
    return this.comments.get(number) ?? [];
  }

  // -- lecture --------------------------------------------------------------

  listManagedIssues(): Promise<IssueData[]> {
    return Promise.resolve(
      [...this.issues.values()].filter(
        (i) => i.state === 'open' && i.labels.some((l) => l.startsWith('phase:')),
      ),
    );
  }

  getIssue(number: number): Promise<IssueData | undefined> {
    return Promise.resolve(this.issues.get(number));
  }

  listComments(number: number): Promise<CommentData[]> {
    return Promise.resolve([...this.commentsOf(number)]);
  }

  listPulls(): Promise<PullData[]> {
    return Promise.resolve([...this.pulls].reverse());
  }

  latestCiRun(sha: string): Promise<CiRun | undefined> {
    return Promise.resolve(this.ciRuns.get(sha));
  }

  hasWorkflows(): Promise<boolean> {
    return Promise.resolve(this.workflows);
  }

  defaultBranch(): Promise<string> {
    return Promise.resolve('main');
  }

  cloneUrl(): string {
    return 'https://github.test/acme/widget.git';
  }

  whoami(): Promise<string> {
    return Promise.resolve(this.me);
  }

  // -- écriture -------------------------------------------------------------

  setLabels(number: number, labels: readonly string[]): Promise<void> {
    this.writes.push(`labels ${String(number)} ${labels.join(',')}`);
    this.issue(number).labels = [...labels];
    return Promise.resolve();
  }

  setAssignees(number: number, logins: readonly string[]): Promise<void> {
    this.writes.push(`assignees ${String(number)} ${logins.join(',')}`);
    this.issue(number).assignees = [...logins];
    return Promise.resolve();
  }

  createComment(number: number, body: string): Promise<CommentData> {
    this.writes.push(`comment ${String(number)}`);
    return Promise.resolve(this.addComment(number, body));
  }

  updateComment(commentId: number, body: string): Promise<void> {
    this.writes.push(`edit ${String(commentId)}`);
    for (const list of this.comments.values()) {
      const c = list.find((x) => x.id === commentId);
      if (c) {
        c.body = body;
        return Promise.resolve();
      }
    }
    return Promise.reject(new Error(`commentaire ${String(commentId)} inconnu`));
  }

  updateIssueBody(number: number, body: string): Promise<void> {
    this.writes.push(`body ${String(number)}`);
    this.issue(number).body = body;
    return Promise.resolve();
  }

  createDraftPull(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullData> {
    this.writes.push(`pull ${input.head}`);
    const number = this.nextNumber++;
    const pull: PullData = {
      number,
      title: input.title,
      body: input.body,
      draft: true,
      headRef: input.head,
      headSha: `sha${String(this.nextSha++)}`,
      merged: false,
      state: 'open',
      url: `https://github.test/acme/widget/pull/${String(number)}`,
    };
    this.pulls.push(pull);
    return Promise.resolve(pull);
  }

  markPullReady(number: number): Promise<void> {
    this.writes.push(`ready ${String(number)}`);
    const pull = this.pulls.find((p) => p.number === number);
    if (!pull) return Promise.reject(new Error(`PR ${String(number)} inconnue`));
    pull.draft = false;
    return Promise.resolve();
  }

  ensureLabels(definitions: readonly LabelDefinition[]): Promise<void> {
    for (const d of definitions)
      if (!this.labelsCreated.includes(d.name)) this.labelsCreated.push(d.name);
    return Promise.resolve();
  }

  private issue(number: number): IssueData {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`issue ${String(number)} inconnue`);
    return issue;
  }
}
