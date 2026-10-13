import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { RequestError } from '@octokit/request-error';
import type { LabelDefinition } from '@factory/conventions';
import type { CiRun, CommentData, GitHubPort, IssueData, PullData, RepoRef } from './github.js';

/**
 * Implémentation Octokit du port GitHub. Toutes les lectures de sondage sont conditionnelles
 * (ETag → 304, non comptabilisé) ; les écritures passent par `conventions` côté appelant.
 */

export interface OctokitStats {
  /** Requêtes ayant reçu une réponse comptabilisée (hors 304). */
  requests: number;
  notModified: number;
}

export interface OctokitGitHub extends GitHubPort {
  readonly stats: OctokitStats;
  /** Oublie les ETag (après une écriture dont on veut relire l'effet sans attendre). */
  invalidate(): void;
}

export interface OctokitOptions {
  ref: RepoRef;
  /** Relu à chaque 401 (`gh auth token`). */
  token: () => Promise<string>;
  baseUrl?: string;
}

interface Cached {
  etag: string;
  data: unknown;
}

interface GhLabel {
  name: string;
}
interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: (GhLabel | string)[];
  state: string;
  assignees: { login: string }[] | null;
  html_url: string;
  pull_request?: unknown;
}
interface GhComment {
  id: number;
  body?: string;
  html_url: string;
}
interface GhPull {
  number: number;
  title: string;
  body: string | null;
  draft?: boolean;
  head: { ref: string; sha: string };
  merged_at: string | null;
  state: string;
  html_url: string;
  node_id: string;
}
interface GhRun {
  html_url: string;
  status: string | null;
  conclusion: string | null;
}

const ThrottledOctokit = Octokit.plugin(throttling);
const noop = (): void => undefined;

function toIssue(i: GhIssue): IssueData {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    state: i.state === 'closed' ? 'closed' : 'open',
    assignees: (i.assignees ?? []).map((a) => a.login),
    url: i.html_url,
  };
}

function toComment(c: GhComment): CommentData {
  return { id: c.id, body: c.body ?? '', url: c.html_url };
}

function toPull(p: GhPull): PullData {
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? '',
    draft: p.draft === true,
    headRef: p.head.ref,
    headSha: p.head.sha,
    merged: p.merged_at !== null,
    state: p.state === 'closed' ? 'closed' : 'open',
    url: p.html_url,
  };
}

function toCiRun(r: GhRun): CiRun {
  const status =
    r.status === 'completed' ? 'completed' : r.status === 'queued' ? 'queued' : 'in_progress';
  return { url: r.html_url, status, conclusion: r.conclusion };
}

/** Un seul réessai sur quota primaire ; jamais sur quota secondaire (abus) : on laisse l'erreur remonter. */
export function throttleOptions(): {
  onRateLimit: (
    retryAfter: number,
    options: object,
    octokit: unknown,
    retryCount: number,
  ) => boolean;
  onSecondaryRateLimit: () => boolean;
} {
  return {
    onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 1,
    onSecondaryRateLimit: () => false,
  };
}

export function createOctokitGitHub(options: OctokitOptions): OctokitGitHub {
  const { ref } = options;
  const cache = new Map<string, Cached>();
  const stats: OctokitStats = { requests: 0, notModified: 0 };
  let client: Octokit | undefined;
  let login: string | undefined;

  async function octokit(fresh = false): Promise<Octokit> {
    if (client && !fresh) return client;
    client = new ThrottledOctokit({
      auth: await options.token(),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      throttle: throttleOptions(),
      // Octokit journalise chaque requête (304 compris, en `error` via RequestError) et les avis de
      // dépréciation : silence total, les erreurs réelles remontent par exception.
      log: { debug: noop, info: noop, warn: noop, error: noop },
    });
    return client;
  }

  /** Une requête, rejouée une fois avec un jeton neuf sur 401. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T type la réponse attendue par l'appelant
  async function request<T>(
    route: string,
    params: Record<string, unknown>,
  ): Promise<{ data: T; etag?: string }> {
    const attempt = async (fresh: boolean): Promise<{ data: T; etag?: string }> => {
      const res = (await (await octokit(fresh)).request(route, params)) as {
        data: T;
        headers: { etag?: string };
      };
      stats.requests += 1;
      return res.headers.etag !== undefined
        ? { data: res.data, etag: res.headers.etag }
        : { data: res.data };
    };
    try {
      return await attempt(false);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) return attempt(true);
      throw error;
    }
  }

  async function get<T>(route: string, params: Record<string, unknown>): Promise<T> {
    const key = `${route} ${JSON.stringify(params)}`;
    const cached = cache.get(key);
    try {
      const res = await request<T>(route, {
        ...params,
        headers: cached ? { 'if-none-match': cached.etag } : {},
      });
      if (res.etag !== undefined) cache.set(key, { etag: res.etag, data: res.data });
      return res.data;
    } catch (error) {
      if (error instanceof RequestError && error.status === 304 && cached) {
        stats.notModified += 1;
        return cached.data as T;
      }
      throw error;
    }
  }

  const repo = { owner: ref.owner, repo: ref.repo };

  return {
    ref,
    stats,
    invalidate: () => {
      cache.clear();
    },

    async listManagedIssues() {
      const issues = await get<GhIssue[]>('GET /repos/{owner}/{repo}/issues', {
        ...repo,
        state: 'open',
        per_page: 100,
      });
      return issues
        .filter((i) => i.pull_request === undefined)
        .map(toIssue)
        .filter((i) => i.labels.some((l) => l.startsWith('phase:')));
    },

    async getIssue(number) {
      try {
        return toIssue(
          await get<GhIssue>('GET /repos/{owner}/{repo}/issues/{issue_number}', {
            ...repo,
            issue_number: number,
          }),
        );
      } catch (error) {
        if (error instanceof RequestError && error.status === 404) return undefined;
        throw error;
      }
    },

    async listComments(number) {
      const comments = await get<GhComment[]>(
        'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
        {
          ...repo,
          issue_number: number,
          per_page: 100,
        },
      );
      return comments.map(toComment);
    },

    async listPulls() {
      const pulls = await get<GhPull[]>('GET /repos/{owner}/{repo}/pulls', {
        ...repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });
      return pulls.map(toPull);
    },

    async latestCiRun(sha) {
      const res = await get<{ workflow_runs: GhRun[] }>('GET /repos/{owner}/{repo}/actions/runs', {
        ...repo,
        head_sha: sha,
        per_page: 1,
      });
      const run = res.workflow_runs[0];
      return run ? toCiRun(run) : undefined;
    },

    async hasWorkflows() {
      const res = await get<{ total_count: number }>(
        'GET /repos/{owner}/{repo}/actions/workflows',
        { ...repo, per_page: 1 },
      );
      return res.total_count > 0;
    },

    async defaultBranch() {
      const res = await get<{ default_branch: string }>('GET /repos/{owner}/{repo}', repo);
      return res.default_branch;
    },

    cloneUrl: () => `https://github.com/${ref.owner}/${ref.repo}.git`,

    async whoami() {
      login ??= (await get<{ login: string }>('GET /user', {})).login;
      return login;
    },

    async setLabels(number, labels) {
      await request('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        ...repo,
        issue_number: number,
        labels: [...labels],
      });
    },

    async setAssignees(number, logins) {
      await request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
        ...repo,
        issue_number: number,
        assignees: [...logins],
      });
    },

    async createComment(number, body) {
      const res = await request<GhComment>(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        {
          ...repo,
          issue_number: number,
          body,
        },
      );
      return toComment(res.data);
    },

    async updateComment(commentId, body) {
      await request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        ...repo,
        comment_id: commentId,
        body,
      });
    },

    async updateIssueBody(number, body) {
      await request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
        ...repo,
        issue_number: number,
        body,
      });
    },

    async createDraftPull(input) {
      const res = await request<GhPull>('POST /repos/{owner}/{repo}/pulls', {
        ...repo,
        ...input,
        draft: true,
      });
      return toPull(res.data);
    },

    async markPullReady(number) {
      const pull = await get<GhPull>('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        ...repo,
        pull_number: number,
      });
      await (
        await octokit()
      ).graphql(
        'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }',
        { id: pull.node_id },
      );
    },

    async ensureLabels(definitions) {
      const existing = await get<GhLabel[]>('GET /repos/{owner}/{repo}/labels', {
        ...repo,
        per_page: 100,
      });
      const names = new Set(existing.map((l) => l.name));
      for (const d of definitions) {
        if (names.has(d.name)) continue;
        await request('POST /repos/{owner}/{repo}/labels', {
          ...repo,
          name: d.name,
          color: d.color,
          description: d.description,
        });
      }
      cache.delete(
        `GET /repos/{owner}/{repo}/labels ${JSON.stringify({ ...repo, per_page: 100 })}`,
      );
    },
  };
}

export type { LabelDefinition };
