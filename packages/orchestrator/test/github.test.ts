import { describe, expect, it } from 'vitest';
import { ciStatusOf, findMarked, findPull, upsertMarked, type PullData } from '../src/github.js';
import { FakeGitHub } from '../src/fake/github.js';

const pull = (number: number, headRef: string, state: 'open' | 'closed'): PullData => ({
  number,
  title: 't',
  body: '',
  draft: false,
  headRef,
  headSha: 'sha',
  merged: false,
  state,
  url: 'u',
});

describe('github — aides sur le port', () => {
  it('ciStatusOf', () => {
    expect(ciStatusOf(undefined)).toEqual({ kind: 'none' });
    expect(ciStatusOf({ url: 'u', status: 'queued', conclusion: null })).toEqual({
      kind: 'pending',
      url: 'u',
    });
    expect(ciStatusOf({ url: 'u', status: 'completed', conclusion: 'success' })).toEqual({
      kind: 'green',
      url: 'u',
    });
    expect(ciStatusOf({ url: 'u', status: 'completed', conclusion: 'failure' })).toEqual({
      kind: 'red',
      url: 'u',
    });
  });

  it('findPull préfère la PR ouverte, sinon la plus récente fermée', () => {
    const pulls = [
      pull(3, 'factory/7-b', 'closed'),
      pull(2, 'factory/7-a', 'open'),
      pull(1, 'factory/8-x', 'open'),
    ];
    expect(findPull(pulls, 7)?.number).toBe(2);
    expect(findPull([pull(3, 'factory/7-b', 'closed')], 7)?.number).toBe(3);
    expect(findPull(pulls, 9)).toBeUndefined();
  });

  it('upsertMarked édite en place, ne réécrit pas un contenu identique, crée sinon', async () => {
    const github = new FakeGitHub();
    github.addIssue({ number: 1, title: 't' });
    github.addComment(1, 'sans marqueur');
    const isRun = (name: string): boolean => name === 'run';
    const first = await upsertMarked(github, 1, isRun, '<!-- factory:run session=a -->');
    expect(github.commentsOf(1)).toHaveLength(2);
    const same = await upsertMarked(github, 1, isRun, '<!-- factory:run session=a -->');
    expect(same.id).toBe(first.id);
    const edited = await upsertMarked(github, 1, isRun, '<!-- factory:run session=b -->');
    expect(edited).toEqual({ ...first, body: '<!-- factory:run session=b -->' });
    expect(github.writes).toEqual(['comment 1', `edit ${String(first.id)}`]);
    expect(
      findMarked(github.commentsOf(1), (name, attrs) => name === 'run' && attrs.session === 'b')
        ?.id,
    ).toBe(first.id);
  });
});
