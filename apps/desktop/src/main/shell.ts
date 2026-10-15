import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * `PATH` du shell de connexion (D1) : lancée depuis le Finder, l'app hérite du `PATH` minimal de
 * launchd et ne trouve ni `gh` ni les outils de l'agent. Une fois, avant `bootstrap()`, l'app
 * empaquetée lit le `PATH` de `$SHELL -ilc` ; tout échec garde le `PATH` hérité.
 * `FACTORY_INHERIT_PATH=1` désactive la résolution (D3).
 */

/** H9 : le démarrage n'attend jamais le shell plus longtemps. */
export const PATH_TIMEOUT_MS = 5_000;
export const PATH_START = '__FACTORY_PATH_START__';
export const PATH_END = '__FACTORY_PATH_END__';
/** Marqueurs autour du `PATH` : les bannières de `.zshrc` restent hors du résultat (H9). */
export const PRINT_PATH = `printf '%s' ${PATH_START}; /usr/bin/printenv PATH; printf '%s' ${PATH_END}`;

export type RunShell = (shell: string, args: string[], timeoutMs: number) => Promise<string>;

export interface ShellPathOptions {
  isPackaged: boolean;
  env: Record<string, string | undefined>;
  run: RunShell;
  timeoutMs?: number;
}

export function extractPath(stdout: string): string | undefined {
  const start = stdout.indexOf(PATH_START);
  if (start === -1) return undefined;
  const end = stdout.indexOf(PATH_END, start);
  if (end === -1) return undefined;
  const path = stdout.slice(start + PATH_START.length, end).trim();
  return path === '' ? undefined : path;
}

const exec = promisify(execFile);

export const runShell: RunShell = async (shell, args, timeoutMs) => {
  const pending = exec(shell, args, { timeout: timeoutMs });
  // Le shell interactif ne doit pas attendre une entrée.
  pending.child.stdin?.end();
  return (await pending).stdout;
};

/** `PATH` à appliquer à `process.env.PATH` ; le `PATH` hérité si la résolution ne s'applique pas. */
export async function loginShellPath(options: ShellPathOptions): Promise<string | undefined> {
  const inherited = options.env.PATH;
  if (!options.isPackaged || options.env.FACTORY_INHERIT_PATH === '1') return inherited;
  const timeoutMs = options.timeoutMs ?? PATH_TIMEOUT_MS;
  const shell = options.env.SHELL ?? '/bin/zsh';
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve('');
    }, timeoutMs);
  });
  try {
    const stdout = await Promise.race([
      options.run(shell, ['-ilc', PRINT_PATH], timeoutMs),
      expired,
    ]);
    return extractPath(stdout) ?? inherited;
  } catch {
    return inherited;
  } finally {
    clearTimeout(timer);
  }
}
