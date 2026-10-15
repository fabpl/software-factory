import { describe, expect, it } from 'vitest';
import { ghReady, ghToken, type Exec, type GhEnv } from '../src/auth.js';

const exec =
  (answers: Record<string, string | Error>): Exec =>
  (file, args) => {
    const key = [file, ...args].join(' ');
    const answer = answers[key];
    if (answer === undefined) return Promise.reject(new Error(`inattendu : ${key}`));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ stdout: answer, stderr: '' });
  };

const enoent = (): Error => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });

const env = (path: string | undefined, present: string[] = []): GhEnv => ({
  path,
  home: '/Users/moi',
  exists: (file) => present.includes(file),
});

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
    expect(await ghToken(exec({ 'gh auth token': enoent() }), env('/usr/bin:/bin'))).toMatchObject({
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

  it('ENOENT : detail montre le PATH de l’app', async () => {
    const vu = env('/usr/bin:/bin');
    const ailleurs = env('/usr/bin:/bin', ['/opt/homebrew/bin/gh']);
    for (const result of [
      await ghToken(exec({ 'gh auth token': enoent() }), vu),
      await ghReady(exec({ 'gh auth status': enoent() }), vu),
      await ghToken(exec({ 'gh auth token': enoent() }), ailleurs),
      await ghReady(exec({ 'gh auth status': enoent() }), ailleurs),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.detail).toContain('/usr/bin:/bin');
    }
    const vide = await ghReady(exec({ 'gh auth status': enoent() }), env(undefined));
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(vide.error.detail).toContain('(vide)');
  });

  it('ENOENT sans gh dans les emplacements connus → brew install', async () => {
    const regardes: string[] = [];
    const absent: GhEnv = {
      path: '/usr/bin:/bin',
      home: '/Users/moi',
      exists: (file) => {
        regardes.push(file);
        return false;
      },
    };
    for (const result of [
      await ghToken(exec({ 'gh auth token': enoent() }), absent),
      await ghReady(exec({ 'gh auth status': enoent() }), absent),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'gh-not-ready', command: 'brew install gh && gh auth login' },
      });
    }
    expect(new Set(regardes)).toEqual(
      new Set(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/Users/moi/.local/bin/gh']),
    );
  });

  it('ENOENT avec gh hors du PATH → export PATH, pas brew install', async () => {
    const ailleurs = env('/usr/bin:/bin', ['/opt/homebrew/bin/gh']);
    for (const result of [
      await ghToken(exec({ 'gh auth token': enoent() }), ailleurs),
      await ghReady(exec({ 'gh auth status': enoent() }), ailleurs),
    ]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.command).toBe('export PATH="/opt/homebrew/bin:$PATH"');
      expect(result.error.command).not.toContain('brew install');
      expect(result.error.detail).toContain('/opt/homebrew/bin');
      expect(result.error.detail).toContain("absent du PATH de l'app");
    }
  });
});
