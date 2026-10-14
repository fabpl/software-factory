import { LABEL_DEFINITIONS } from '@factory/conventions';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOctokitGitHub, throttleOptions } from '../src/octokit.js';

const API = 'https://api.github.com';
const R = `${API}/repos/acme/widget`;

type Json = Record<string, unknown>;

interface Hit {
  method: string;
  path: string;
  counted: boolean;
  ifNoneMatch: string | null;
  auth: string | null;
  body?: Json;
}

const hits: Hit[] = [];
const counted = (): number => hits.filter((h) => h.counted).length;

/** Réponse conditionnelle : 304 si l'ETag envoyé correspond, sinon 200 avec ETag. */
function conditional(etag: string, data: Json | Json[]) {
  return ({ request }: { request: Request }) => {
    const ifNoneMatch = request.headers.get('if-none-match');
    const hit: Hit = {
      method: request.method,
      path: new URL(request.url).pathname,
      counted: ifNoneMatch !== etag,
      ifNoneMatch,
      auth: request.headers.get('authorization'),
    };
    hits.push(hit);
    if (ifNoneMatch === etag) return new HttpResponse(null, { status: 304, headers: { etag } });
    return HttpResponse.json(data, { headers: { etag } });
  };
}

async function record(request: Request): Promise<Hit> {
  const hit: Hit = {
    method: request.method,
    path: new URL(request.url).pathname,
    counted: true,
    ifNoneMatch: null,
    auth: request.headers.get('authorization'),
    body: (await request.json()) as Json,
  };
  hits.push(hit);
  return hit;
}

const issue = (number: number, labels: string[], extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${String(number)}`,
  body: null,
  labels: labels.map((name) => ({ name })),
  state: 'open',
  assignees: [{ login: 'fabpl' }],
  html_url: `https://github.com/acme/widget/issues/${String(number)}`,
  ...extra,
});

let tokenCalls = 0;
const server = setupServer(
  http.get(
    `${R}/issues`,
    conditional('W/"issues-1"', [
      issue(1, ['phase:framing']),
      issue(2, ['bug']),
      issue(3, ['phase:intent'], { pull_request: {} }),
    ]),
  ),
  http.get(`${R}/issues/1`, conditional('W/"issue-1"', issue(1, ['phase:framing', 'x']))),
  http.get(`${R}/issues/404`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404 })),
  http.get(`${R}/issues/500`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
  http.get(
    `${R}/issues/1/comments`,
    conditional('W/"c-1"', [
      { id: 11, body: 'a', html_url: 'u' },
      { id: 12, html_url: 'v' },
    ]),
  ),
  http.get(
    `${R}/pulls`,
    conditional('W/"p-1"', [
      {
        number: 9,
        title: 't',
        body: 'b',
        draft: true,
        head: { ref: 'factory/1-x', sha: 'abc' },
        merged_at: null,
        state: 'open',
        html_url: 'p9',
        node_id: 'N9',
      },
      {
        number: 8,
        title: 't',
        body: null,
        head: { ref: 'factory/0-y', sha: 'def' },
        merged_at: '2026-01-01',
        state: 'closed',
        html_url: 'p8',
        node_id: 'N8',
      },
    ]),
  ),
  http.get(
    `${R}/pulls/9`,
    conditional('W/"p9"', {
      number: 9,
      title: 't',
      body: 'b',
      draft: true,
      head: { ref: 'factory/1-x', sha: 'abc' },
      merged_at: null,
      state: 'open',
      html_url: 'p9',
      node_id: 'N9',
    }),
  ),
  http.get(`${R}/actions/runs`, ({ request }) => {
    const sha = new URL(request.url).searchParams.get('head_sha');
    const runs =
      sha === 'abc'
        ? [{ html_url: 'run1', status: 'completed', conclusion: 'success' }]
        : sha === 'q'
          ? [{ html_url: 'run2', status: 'queued', conclusion: null }]
          : sha === 'p'
            ? [{ html_url: 'run3', status: 'in_progress', conclusion: null }]
            : [];
    return conditional(`W/"runs-${sha ?? ''}"`, { workflow_runs: runs })({ request });
  }),
  http.get(`${R}/actions/workflows`, conditional('W/"wf"', { total_count: 1 })),
  http.get(R, conditional('W/"repo"', { default_branch: 'main' })),
  http.get(`${API}/user`, ({ request }) => {
    hits.push({
      method: 'GET',
      path: '/user',
      counted: true,
      ifNoneMatch: null,
      auth: request.headers.get('authorization'),
    });
    if (request.headers.get('authorization') === 'token stale')
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
    return HttpResponse.json({ login: 'fabpl' });
  }),
  http.get(`${R}/labels`, conditional('W/"labels"', [{ name: 'phase:intent' }, { name: 'bug' }])),
  http.put(`${R}/issues/1/labels`, async ({ request }) =>
    HttpResponse.json((await record(request)).body ?? {}),
  ),
  http.patch(`${R}/issues/1`, async ({ request }) =>
    HttpResponse.json({ ...issue(1, []), ...((await record(request)).body as object) }),
  ),
  http.post(`${R}/issues/1/comments`, async ({ request }) =>
    HttpResponse.json(
      { id: 77, body: ((await record(request)).body as { body: string }).body, html_url: 'c77' },
      { status: 201 },
    ),
  ),
  http.patch(`${R}/issues/comments/77`, async ({ request }) =>
    HttpResponse.json({ id: 77, ...((await record(request)).body as object) }),
  ),
  http.post(`${R}/pulls`, async ({ request }) => {
    const body = (await record(request)).body as {
      head: string;
      base: string;
      title: string;
      body: string;
      draft: boolean;
    };
    return HttpResponse.json(
      {
        number: 10,
        title: body.title,
        body: body.body,
        draft: body.draft,
        head: { ref: body.head, sha: 'new' },
        merged_at: null,
        state: 'open',
        html_url: 'p10',
        node_id: 'N10',
      },
      { status: 201 },
    );
  }),
  http.post(`${R}/issues`, async ({ request }) => {
    const body = (await record(request)).body as { title: string; body: string; labels: string[] };
    return HttpResponse.json(
      { ...issue(12, body.labels), title: body.title, body: body.body, assignees: [] },
      { status: 201 },
    );
  }),
  http.post(`${R}/labels`, async ({ request }) =>
    HttpResponse.json((await record(request)).body ?? {}, { status: 201 }),
  ),
  http.post(`${API}/graphql`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({
      data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
    });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  hits.length = 0;
});
afterAll(() => {
  server.close();
});

const github = createOctokitGitHub({
  ref: { owner: 'acme', repo: 'widget' },
  token: () => {
    tokenCalls += 1;
    return Promise.resolve(tokenCalls === 1 ? 'stale' : 'fresh');
  },
});

describe('octokit — lecture conditionnelle', () => {
  it('401 → jeton relu une fois, puis la requête est rejouée', async () => {
    expect(await github.whoami()).toBe('fabpl');
    expect(hits.map((h) => h.auth)).toEqual(['token stale', 'token fresh']);
    expect(await github.whoami()).toBe('fabpl');
    expect(hits).toHaveLength(2);
    expect(tokenCalls).toBe(2);
  });

  it('second appel identique = 304, zéro appel comptabilisé', async () => {
    const first = await github.listManagedIssues();
    expect(first.map((i) => i.number)).toEqual([1]);
    expect(first[0]).toMatchObject({
      labels: ['phase:framing'],
      body: '',
      assignees: ['fabpl'],
      state: 'open',
    });
    expect(counted()).toBe(1);
    const second = await github.listManagedIssues();
    expect(second).toEqual(first);
    expect(counted()).toBe(1);
    expect(hits[1]).toMatchObject({ ifNoneMatch: 'W/"issues-1"', counted: false });
    expect(github.stats).toEqual({ requests: 2, notModified: 1 });
    github.invalidate();
    await github.listManagedIssues();
    expect(counted()).toBe(2);
  });

  it('issue, commentaires, PR, runs CI, workflows, branche par défaut', async () => {
    expect(await github.getIssue(1)).toMatchObject({ number: 1, labels: ['phase:framing', 'x'] });
    expect(await github.getIssue(404)).toBeUndefined();
    await expect(github.getIssue(500)).rejects.toMatchObject({ status: 500 });
    expect(await github.listComments(1)).toEqual([
      { id: 11, body: 'a', url: 'u' },
      { id: 12, body: '', url: 'v' },
    ]);
    const pulls = await github.listPulls();
    expect(pulls).toEqual([
      {
        number: 9,
        title: 't',
        body: 'b',
        draft: true,
        headRef: 'factory/1-x',
        headSha: 'abc',
        merged: false,
        state: 'open',
        url: 'p9',
      },
      {
        number: 8,
        title: 't',
        body: '',
        draft: false,
        headRef: 'factory/0-y',
        headSha: 'def',
        merged: true,
        state: 'closed',
        url: 'p8',
      },
    ]);
    expect(await github.latestCiRun('abc')).toEqual({
      url: 'run1',
      status: 'completed',
      conclusion: 'success',
    });
    expect(await github.latestCiRun('q')).toMatchObject({ status: 'queued' });
    expect(await github.latestCiRun('p')).toMatchObject({ status: 'in_progress' });
    expect(await github.latestCiRun('none')).toBeUndefined();
    expect(await github.hasWorkflows()).toBe(true);
    expect(await github.defaultBranch()).toBe('main');
    expect(github.cloneUrl()).toBe('https://github.com/acme/widget.git');
    const before = counted();
    await github.getIssue(1);
    await github.listComments(1);
    await github.listPulls();
    await github.latestCiRun('abc');
    await github.hasWorkflows();
    await github.defaultBranch();
    expect(counted()).toBe(before);
  });
});

describe('octokit — écritures', () => {
  it('étiquettes, assignés, commentaires, corps, PR brouillon, PR prête', async () => {
    await github.setLabels(1, ['phase:framing', 'run:active']);
    expect(hits.at(-1)).toMatchObject({
      method: 'PUT',
      body: { labels: ['phase:framing', 'run:active'] },
    });
    await github.setAssignees(1, ['fabpl']);
    expect(hits.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/repos/acme/widget/issues/1',
      body: { assignees: ['fabpl'] },
    });
    expect(await github.createComment(1, 'hello')).toEqual({ id: 77, body: 'hello', url: 'c77' });
    await github.updateComment(77, 'edited');
    expect(hits.at(-1)).toMatchObject({
      path: '/repos/acme/widget/issues/comments/77',
      body: { body: 'edited' },
    });
    await github.updateIssueBody(1, 'corps');
    expect(hits.at(-1)).toMatchObject({ body: { body: 'corps' } });
    const pr = await github.createDraftPull({
      head: 'factory/1-x',
      base: 'main',
      title: '#1 t',
      body: 'Closes #1',
    });
    expect(pr).toMatchObject({ number: 10, draft: true, headRef: 'factory/1-x', headSha: 'new' });
    expect(hits.at(-1)).toMatchObject({ body: { draft: true, head: 'factory/1-x' } });
    await github.markPullReady(9);
    expect(hits.at(-1)).toMatchObject({ path: '/graphql', body: { variables: { id: 'N9' } } });
    expect(await github.createIssue('Titre', 'Texte libre', ['phase:intent'])).toMatchObject({
      number: 12,
      title: 'Titre',
      body: 'Texte libre',
      labels: ['phase:intent'],
      state: 'open',
      assignees: [],
    });
    expect(hits.at(-1)).toMatchObject({
      method: 'POST',
      path: '/repos/acme/widget/issues',
      body: { title: 'Titre', body: 'Texte libre', labels: ['phase:intent'] },
    });
  });

  it('fichier : lecture avec sha (jamais en cache), absent, erreur', async () => {
    const encoded = Buffer.from('# Titre\n\nété\n', 'utf8').toString('base64');
    server.use(
      http.get(`${R}/contents/README.md`, ({ request }) => {
        const ref = new URL(request.url).searchParams.get('ref');
        hits.push({
          method: 'GET',
          path: `README.md@${ref ?? ''}`,
          counted: true,
          ifNoneMatch: request.headers.get('if-none-match'),
          auth: null,
        });
        if (ref === 'gone') return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
        if (ref === 'boom') return HttpResponse.json({ message: 'boom' }, { status: 500 });
        // GitHub coupe le base64 par lignes de 60 caractères.
        const content = encoded.replace(/(.{60})/g, '$1\n');
        return HttpResponse.json(
          { content, encoding: 'base64', sha: 'r1' },
          { headers: { etag: 'W/"f"' } },
        );
      }),
    );
    expect(await github.readFile('README.md', 'main')).toEqual({
      content: '# Titre\n\nété\n',
      sha: 'r1',
    });
    await github.readFile('README.md', 'main');
    expect(hits.map((h) => h.ifNoneMatch)).toEqual([null, null]);
    expect(await github.readFile('README.md', 'gone')).toBeUndefined();
    await expect(github.readFile('README.md', 'boom')).rejects.toMatchObject({ status: 500 });
  });

  it('fichier : commit avec sha attendu, sha périmé, erreur', async () => {
    server.use(
      http.put(`${R}/contents/README.md`, async ({ request }) => {
        const body = (await record(request)).body as { sha: string };
        if (body.sha === 'old')
          return HttpResponse.json({ message: 'does not match' }, { status: 409 });
        if (body.sha === 'boom') return HttpResponse.json({ message: 'boom' }, { status: 500 });
        return HttpResponse.json({ content: { sha: 'f2' }, commit: { sha: 'c2' } });
      }),
    );
    const input = { path: 'README.md', branch: 'main', content: 'été\n', message: 'm' };
    expect(await github.commitFile({ ...input, sha: 'r1' })).toEqual({
      kind: 'committed',
      sha: 'c2',
    });
    expect(hits.at(-1)).toMatchObject({
      method: 'PUT',
      body: {
        message: 'm',
        branch: 'main',
        sha: 'r1',
        content: Buffer.from('été\n', 'utf8').toString('base64'),
      },
    });
    expect(await github.commitFile({ ...input, sha: 'old' })).toEqual({ kind: 'stale' });
    await expect(github.commitFile({ ...input, sha: 'boom' })).rejects.toMatchObject({
      status: 500,
    });
  });

  it('ensureLabels ne crée que les étiquettes manquantes', async () => {
    await github.ensureLabels(LABEL_DEFINITIONS);
    const created = hits
      .filter((h) => h.method === 'POST')
      .map((h) => (h.body as { name: string }).name);
    expect(created).toEqual(
      LABEL_DEFINITIONS.map((d) => d.name).filter((n) => n !== 'phase:intent'),
    );
  });
});

describe('octokit — options', () => {
  it('throttle : un réessai sur quota primaire, aucun sur quota secondaire', () => {
    const t = throttleOptions();
    expect(t.onRateLimit(1, {}, undefined, 0)).toBe(true);
    expect(t.onRateLimit(1, {}, undefined, 1)).toBe(false);
    expect(t.onSecondaryRateLimit()).toBe(false);
  });

  it('baseUrl : GitHub Enterprise', async () => {
    server.use(http.get('https://ghe.test/api/v3/user', () => HttpResponse.json({ login: 'ent' })));
    const ghe = createOctokitGitHub({
      ref: { owner: 'acme', repo: 'widget' },
      token: () => Promise.resolve('t'),
      baseUrl: 'https://ghe.test/api/v3',
    });
    expect(await ghe.whoami()).toBe('ent');
  });

  it('issue : étiquettes en chaînes, corps et assignés absents', async () => {
    server.use(
      http.get(`${R}/issues/2`, () =>
        HttpResponse.json({
          number: 2,
          title: 't',
          body: null,
          labels: ['phase:intent'],
          state: 'closed',
          assignees: null,
          html_url: 'u',
        }),
      ),
    );
    expect(await github.getIssue(2)).toEqual({
      number: 2,
      title: 't',
      body: '',
      labels: ['phase:intent'],
      state: 'closed',
      assignees: [],
      url: 'u',
    });
  });
});
