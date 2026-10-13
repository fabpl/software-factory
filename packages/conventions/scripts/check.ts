/**
 * `pnpm conventions:check <issue> [owner/repo]`
 * Lit une issue réelle via `gh api` et affiche ce que le paquet en comprend.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseAnswer,
  parseCard,
  parseContract,
  parseEvidence,
  parseLabels,
  parseMarker,
  parseRunBlock,
} from '../src/index.js';

const run = promisify(execFile);

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
}
interface GhComment {
  id: number;
  body: string;
}

async function gh<T>(path: string): Promise<T> {
  const { stdout } = await run('gh', ['api', path, '--paginate']);
  return JSON.parse(stdout) as T;
}

async function repoSlug(): Promise<string> {
  const { stdout } = await run('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  return stdout.trim();
}

function show(label: string, result: { ok: boolean; value?: unknown; error?: unknown }): void {
  if (result.ok) console.log(`✔ ${label}`, JSON.stringify(result.value, null, 2));
  else console.log(`✘ ${label}`, JSON.stringify(result.error));
}

async function main(): Promise<void> {
  const [issueArg, repoArg] = process.argv.slice(2);
  if (issueArg === undefined) {
    console.error('usage: conventions:check <issue> [owner/repo]');
    process.exit(2);
  }
  const repo = repoArg ?? (await repoSlug());
  const issue = await gh<GhIssue>(`repos/${repo}/issues/${issueArg}`);
  console.log(`# ${repo}#${String(issue.number)} — ${issue.title}\n`);

  show('étiquettes', parseLabels(issue.labels.map((l) => l.name)));
  show('contrat', parseContract(issue.body ?? ''));

  const comments = await gh<GhComment[]>(`repos/${repo}/issues/${issueArg}/comments`);
  console.log(`\n${String(comments.length)} commentaire(s)`);
  let failures = 0;
  for (const c of comments) {
    const marker = parseMarker(c.body);
    const label = `commentaire ${String(c.id)} (${marker?.name ?? 'sans marqueur'})`;
    let result: { ok: boolean; value?: unknown; error?: unknown } | undefined;
    switch (marker?.name) {
      case 'card':
        result = parseCard(c.body);
        break;
      case 'answer':
        result = parseAnswer(c.body);
        break;
      case 'evidence':
        result = parseEvidence(c.body);
        break;
      case 'run':
        result = parseRunBlock(c.body);
        break;
      default:
        console.log(`– ${label} : ignoré`);
    }
    if (result) {
      show(label, result);
      if (!result.ok) failures += 1;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
