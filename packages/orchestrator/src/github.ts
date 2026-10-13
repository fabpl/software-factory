import { parseMarker, type LabelDefinition } from '@factory/conventions';

/**
 * Port GitHub : tout ce que l'orchestrateur lit et écrit. Deux implémentations : `octokit.ts`
 * (API réelle, ETag) et `test/fakes/github.ts` (mémoire). Rien ici ne connaît Octokit.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  assignees: string[];
  url: string;
}

export interface CommentData {
  id: number;
  body: string;
  url: string;
}

export interface PullData {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  headRef: string;
  headSha: string;
  merged: boolean;
  state: 'open' | 'closed';
  url: string;
}

export interface CiRun {
  url: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
}

export type CiStatus =
  | { kind: 'none' }
  | { kind: 'pending'; url: string }
  | { kind: 'green'; url: string }
  | { kind: 'red'; url: string };

export interface GitHubPort {
  readonly ref: RepoRef;
  /** Issues ouvertes portant une étiquette `phase:*` (les PR exclues). */
  listManagedIssues(): Promise<IssueData[]>;
  getIssue(number: number): Promise<IssueData | undefined>;
  /** Commentaires d'une issue ou d'une PR (même espace de numéros). */
  listComments(number: number): Promise<CommentData[]>;
  /** PR ouvertes et fermées, les plus récentes d'abord. */
  listPulls(): Promise<PullData[]>;
  /** Dernier run Actions sur ce SHA. */
  latestCiRun(sha: string): Promise<CiRun | undefined>;
  hasWorkflows(): Promise<boolean>;
  defaultBranch(): Promise<string>;
  cloneUrl(): string;
  /** Compte qui exécute l'agent : porte l'assignation du verrou. */
  whoami(): Promise<string>;

  setLabels(number: number, labels: readonly string[]): Promise<void>;
  setAssignees(number: number, logins: readonly string[]): Promise<void>;
  createComment(number: number, body: string): Promise<CommentData>;
  updateComment(commentId: number, body: string): Promise<void>;
  updateIssueBody(number: number, body: string): Promise<void>;
  createDraftPull(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullData>;
  markPullReady(number: number): Promise<void>;
  ensureLabels(definitions: readonly LabelDefinition[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Aides construites sur le port, partagées par les deux implémentations.

export function ciStatusOf(run: CiRun | undefined): CiStatus {
  if (!run) return { kind: 'none' };
  if (run.status !== 'completed') return { kind: 'pending', url: run.url };
  return run.conclusion === 'success'
    ? { kind: 'green', url: run.url }
    : { kind: 'red', url: run.url };
}

export function factoryBranchPrefix(issue: number): string {
  return `factory/${String(issue)}-`;
}

export function framingBranch(issue: number): string {
  return `framing/${String(issue)}`;
}

/** La PR d'une tâche : tête `factory/<issue>-…`, la plus récente d'abord. */
export function findPull(pulls: readonly PullData[], issue: number): PullData | undefined {
  const prefix = factoryBranchPrefix(issue);
  return (
    pulls.find((p) => p.headRef.startsWith(prefix) && p.state === 'open') ??
    pulls.find((p) => p.headRef.startsWith(prefix))
  );
}

/** Premier commentaire dont le marqueur caché satisfait `predicate`. */
export function findMarked(
  comments: readonly CommentData[],
  predicate: (name: string, attrs: Readonly<Record<string, string>>) => boolean,
): CommentData | undefined {
  return comments.find((c) => {
    const marker = parseMarker(c.body);
    return marker !== undefined && predicate(marker.name, marker.attrs);
  });
}

/** Édite le commentaire marqué s'il existe, sinon le crée : rejouable sans doublon. */
export async function upsertMarked(
  github: GitHubPort,
  number: number,
  predicate: (name: string, attrs: Readonly<Record<string, string>>) => boolean,
  body: string,
): Promise<CommentData> {
  const existing = findMarked(await github.listComments(number), predicate);
  if (existing) {
    if (existing.body !== body) await github.updateComment(existing.id, body);
    return { ...existing, body };
  }
  return github.createComment(number, body);
}
