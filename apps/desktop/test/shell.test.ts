import { describe, expect, it, vi } from 'vitest';
import {
  extractPath,
  loginShellPath,
  PATH_END,
  PATH_START,
  PATH_TIMEOUT_MS,
  PRINT_PATH,
  runShell,
} from '../src/main/shell';

const INHERITED = '/usr/bin:/bin';
const LOGIN = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

function packaged(run: (shell: string, args: string[], timeoutMs: number) => Promise<string>) {
  return { isPackaged: true, env: { PATH: INHERITED, SHELL: '/bin/zsh' }, run };
}

describe('extractPath (H9)', () => {
  it('extrait le PATH entre les marqueurs', () => {
    expect(extractPath(`${PATH_START}${LOGIN}\n${PATH_END}`)).toBe(LOGIN);
  });

  it('ignore la bannière de .zshrc autour des marqueurs', () => {
    expect(extractPath(`Bonjour !\n${PATH_START}${LOGIN}\n${PATH_END}\nau revoir`)).toBe(LOGIN);
  });

  it('sortie vide, sans marqueurs ou PATH vide : rien', () => {
    expect(extractPath('')).toBeUndefined();
    expect(extractPath(`${PATH_START}${LOGIN}`)).toBeUndefined();
    expect(extractPath(`${LOGIN}${PATH_END}`)).toBeUndefined();
    expect(extractPath(`${PATH_START}\n${PATH_END}`)).toBeUndefined();
  });
});

describe('loginShellPath (D1, D3, C6)', () => {
  it('app empaquetée : PATH du shell de connexion ($SHELL -ilc, 5 s)', async () => {
    const run = vi.fn(() => Promise.resolve(`motd\n${PATH_START}${LOGIN}\n${PATH_END}`));
    await expect(loginShellPath(packaged(run))).resolves.toBe(LOGIN);
    expect(run).toHaveBeenCalledWith('/bin/zsh', ['-ilc', expect.any(String)], PATH_TIMEOUT_MS);
    expect(PATH_TIMEOUT_MS).toBe(5_000);
  });

  it('sans $SHELL : /bin/zsh', async () => {
    const run = vi.fn(() => Promise.resolve(`${PATH_START}${LOGIN}${PATH_END}`));
    await loginShellPath({ isPackaged: true, env: { PATH: INHERITED }, run });
    expect(run).toHaveBeenCalledWith('/bin/zsh', expect.any(Array), PATH_TIMEOUT_MS);
  });

  it('sortie illisible : PATH hérité', async () => {
    const run = vi.fn(() => Promise.resolve(''));
    await expect(loginShellPath(packaged(run))).resolves.toBe(INHERITED);
  });

  it('échec du shell : PATH hérité', async () => {
    const run = vi.fn(() => Promise.reject(new Error('exit 1')));
    await expect(loginShellPath(packaged(run))).resolves.toBe(INHERITED);
  });

  it('délai dépassé : PATH hérité sans attendre le shell', async () => {
    const run = vi.fn(() => new Promise<string>(() => undefined));
    const options = { ...packaged(run), timeoutMs: 10 };
    await expect(loginShellPath(options)).resolves.toBe(INHERITED);
  });

  it('app non empaquetée : aucun shell lancé', async () => {
    const run = vi.fn(() => Promise.resolve(''));
    await expect(loginShellPath({ ...packaged(run), isPackaged: false })).resolves.toBe(INHERITED);
    expect(run).not.toHaveBeenCalled();
  });

  it('FACTORY_INHERIT_PATH=1 : aucun shell lancé', async () => {
    const run = vi.fn(() => Promise.resolve(''));
    const env = { PATH: INHERITED, FACTORY_INHERIT_PATH: '1' };
    await expect(loginShellPath({ isPackaged: true, env, run })).resolves.toBe(INHERITED);
    expect(run).not.toHaveBeenCalled();
  });

  it('sans PATH hérité ni PATH lisible : rien', async () => {
    const run = vi.fn(() => Promise.resolve(''));
    await expect(loginShellPath({ isPackaged: true, env: {}, run })).resolves.toBeUndefined();
  });
});

describe('runShell', () => {
  it('renvoie la sortie standard du shell', async () => {
    await expect(runShell('/bin/sh', ['-c', 'printf ok'], 1_000)).resolves.toBe('ok');
  });

  it('rejette quand le shell échoue', async () => {
    await expect(runShell('/bin/sh', ['-c', 'exit 3'], 1_000)).rejects.toThrow();
  });

  it('la commande imprime le PATH entre les marqueurs', async () => {
    const stdout = await runShell('/bin/sh', ['-c', PRINT_PATH], 1_000);
    expect(extractPath(stdout)).toBe(process.env.PATH);
  });
});
