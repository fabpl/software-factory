import { describe, expect, it } from 'vitest';
import { ghReady, ghToken, type Exec } from '../src/auth.js';

const exec =
  (answers: Record<string, string | Error>): Exec =>
  (file, args) => {
    const key = [file, ...args].join(' ');
    const answer = answers[key];
    if (answer === undefined) return Promise.reject(new Error(`inattendu : ${key}`));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ stdout: answer, stderr: '' });
  };

describe('auth', () => {
  it('ghToken lit le jeton', async () => {
    expect(await ghToken(exec({ 'gh auth token': 'gho_abc\n' }))).toEqual({
      ok: true,
      value: 'gho_abc',
    });
    expect(await ghToken(exec({ 'gh auth token': '\n' }))).toMatchObject({
      ok: false,
      error: { command: 'gh auth login' },
    });
  });

  it('gh absent → commande d’installation ; gh déconnecté → gh auth login', async () => {
    const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    expect(await ghToken(exec({ 'gh auth token': enoent }))).toMatchObject({
      ok: false,
      error: { kind: 'gh-not-ready', command: 'brew install gh && gh auth login' },
    });
    expect(await ghToken(exec({ 'gh auth token': new Error('not logged in') }))).toMatchObject({
      ok: false,
      error: { command: 'gh auth login', detail: 'not logged in' },
    });
    const notAnError: Exec = () => Promise.reject(new Error('plain'));
    expect(await ghToken(notAnError)).toMatchObject({ ok: false, error: { detail: 'plain' } });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- cas d'un rejet non-Error
    const thrownString: Exec = () => Promise.reject('texte brut');
    expect(await ghToken(thrownString)).toMatchObject({
      ok: false,
      error: { detail: 'texte brut' },
    });
  });

  it('ghReady exige gh connecté et le credential helper de gh', async () => {
    const helper =
      'credential.https://github.com.helper !/opt/homebrew/bin/gh auth git-credential\n';
    expect(
      await ghReady(
        exec({ 'gh auth status': 'ok', 'git config --get-regexp credential.*helper': helper }),
      ),
    ).toEqual({
      ok: true,
      value: true,
    });
    expect(
      await ghReady(exec({ 'gh auth status': new Error('You are not logged in') })),
    ).toMatchObject({
      ok: false,
      error: { command: 'gh auth login' },
    });
    expect(
      await ghReady(
        exec({
          'gh auth status': 'ok',
          'git config --get-regexp credential.*helper': 'credential.helper osxkeychain\n',
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { command: 'gh auth setup-git' },
    });
    expect(await ghReady(exec({ 'gh auth status': 'ok' }))).toMatchObject({
      ok: false,
      error: { command: 'gh auth setup-git' },
    });
  });
});
