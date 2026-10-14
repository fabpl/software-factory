import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import { packageRoot } from './paths';

/**
 * Sonde C5 : `query()` depuis le process principal Electron, prompt trivial, `maxTurns: 1`.
 * Écrit `apps/desktop/docs/sdk-probe.md`. Hors CI (H6) : `pnpm --filter desktop probe:sdk`.
 *
 * Tentatives, dans l'ordre : sans correctif ; puis, en cas d'échec, `ELECTRON_RUN_AS_NODE=1` dans
 * l'environnement du sous-process (H5). Le fichier dit explicitement laquelle a fonctionné.
 */

interface Attempt {
  label: string;
  env?: Record<string, string | undefined>;
}

interface Outcome {
  label: string;
  ok: boolean;
  durationMs: number;
  finalText?: string;
  costUsd?: number;
  error?: string;
  stderr: string[];
  messageTypes: string[];
}

const ROOT = packageRoot(import.meta.url);

const ATTEMPTS: Attempt[] = [
  { label: 'sans correctif' },
  { label: 'ELECTRON_RUN_AS_NODE=1', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
];

function sdkVersions(): { sdk: string; claudeCode: string; path: string } {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
  const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
    version: string;
    claudeCodeVersion?: string;
  };
  return { sdk: pkg.version, claudeCode: pkg.claudeCodeVersion ?? 'inconnue', path: entry };
}

async function attempt(spec: Attempt): Promise<Outcome> {
  const started = Date.now();
  const stderr: string[] = [];
  const messages: SDKMessage[] = [];
  try {
    const q = query({
      prompt: 'Réponds exactement : OK',
      options: {
        maxTurns: 1,
        cwd: ROOT,
        stderr: (data: string) => {
          for (const line of data.split('\n')) if (line.trim() !== '') stderr.push(line);
        },
        ...(spec.env ? { env: spec.env } : {}),
      },
    });
    for await (const message of q) messages.push(message);
    const result = messages.find((m) => m.type === 'result');
    const base = {
      label: spec.label,
      durationMs: Date.now() - started,
      stderr,
      messageTypes: messages.map((m) => m.type),
    };
    if (result?.type !== 'result') {
      return { ...base, ok: false, error: 'flux terminé sans message `result`' };
    }
    if (result.subtype === 'success') {
      return { ...base, ok: true, finalText: result.result, costUsd: result.total_cost_usd };
    }
    return {
      ...base,
      ok: false,
      costUsd: result.total_cost_usd,
      error: `result.subtype = ${result.subtype}${'errors' in result ? ` : ${JSON.stringify(result.errors)}` : ''}`,
    };
  } catch (error) {
    return {
      label: spec.label,
      ok: false,
      durationMs: Date.now() - started,
      stderr,
      messageTypes: messages.map((m) => m.type),
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
}

function verdict(outcomes: Outcome[]): string {
  const first = outcomes[0];
  if (first?.ok === true) return '`query()` fonctionne **sans correctif**.';
  const fixed = outcomes.find((o) => o.ok);
  if (fixed) return `\`query()\` fonctionne **avec correctif : ${fixed.label}**.`;
  return '`query()` **ne fonctionne pas**, ni sans correctif ni avec `ELECTRON_RUN_AS_NODE=1`.';
}

function money(value: number | undefined): string {
  return value === undefined ? 'inconnu' : `${value.toFixed(4)} $`;
}

function report(outcomes: Outcome[], date: Date): string {
  const v = sdkVersions();
  const lines = [
    '# Sonde SDK — `query()` dans le process principal Electron (C5)',
    '',
    `Date : ${date.toISOString()}`,
    '',
    '| Composant | Version |',
    '|---|---|',
    `| Electron | ${process.versions.electron} |`,
    `| Node (embarqué) | ${process.versions.node} |`,
    `| Chromium | ${process.versions.chrome} |`,
    `| @anthropic-ai/claude-agent-sdk | ${v.sdk} |`,
    `| Claude Code (binaire natif du SDK) | ${v.claudeCode} |`,
    '',
    `\`process.execPath\` : \`${process.execPath}\``,
    `\`ELECTRON_RUN_AS_NODE\` au lancement : ${process.env.ELECTRON_RUN_AS_NODE ?? 'non défini'}`,
    `SDK résolu depuis : \`${v.path}\``,
    '',
    '## Verdict',
    '',
    verdict(outcomes),
    '',
    'Prompt : « Réponds exactement : OK », `maxTurns: 1`, options SDK par défaut sinon.',
  ];
  for (const [i, o] of outcomes.entries()) {
    lines.push(
      '',
      `## Tentative ${String(i + 1)} — ${o.label}`,
      '',
      `- Résultat : ${o.ok ? '**succès**' : '**échec**'}`,
      `- Durée : ${(o.durationMs / 1000).toFixed(1)} s`,
      `- Coût : ${money(o.costUsd)}`,
      `- Messages reçus : ${o.messageTypes.length > 0 ? o.messageTypes.join(', ') : 'aucun'}`,
    );
    if (o.finalText !== undefined) lines.push('', 'Message final :', '', '```', o.finalText, '```');
    if (o.error !== undefined) lines.push('', 'Erreur complète :', '', '```', o.error, '```');
    if (o.stderr.length > 0) lines.push('', 'stderr :', '', '```', ...o.stderr, '```');
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const outcomes: Outcome[] = [];
  for (const spec of ATTEMPTS) {
    const outcome = await attempt(spec);
    outcomes.push(outcome);
    console.log(`[sonde] ${spec.label} : ${outcome.ok ? 'succès' : 'échec'}`);
    if (outcome.ok) break;
  }
  const file = join(ROOT, 'docs', 'sdk-probe.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, report(outcomes, new Date()));
  console.log(`[sonde] rapport écrit : ${file}`);
  app.exit(outcomes.some((o) => o.ok) ? 0 : 1);
}

void app.whenReady().then(main);
