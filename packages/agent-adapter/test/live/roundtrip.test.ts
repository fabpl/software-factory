/**
 * Test live (hors CI) : un vrai run court qui émet une `question`, s'arrête, est repris avec « A »,
 * tente un `git push` (refusé), termine. Enregistre les `SDKMessage` en fixtures.
 *
 *   pnpm --filter @factory/agent-adapter test:live
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CardInput, FactoryToolName } from '@factory/conventions';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeAdapter,
  DEFAULT_POLICY,
  isTerminal,
  type FactoryEvent,
  type FactoryToolHandlers,
  type RunSpec,
} from '../../src/index.js';

const live = process.env.FACTORY_LIVE === '1';

const INSTRUCTIONS = `Tu es un agent de test de la Software Factory. Suis exactement ce déroulé, sans rien d'autre :
1. Appelle l'outil read_rules.
2. Émets UNE carte avec emit_card : kind "question", title "Couleur du test", context "Test live : choisis.",
   options A "Bleu" (consequence "froid") et B "Rouge" (consequence "chaud"), recommendation A "Bleu est le pari.",
   reversibility "reversible". Cet appel est le SEUL appel d'outil de ton tour. Le run s'arrête.
3. À la reprise, quand tu as la réponse de l'humain, écris une phrase « Merci, réponse <lettre> reçue. »,
   puis exécute avec Bash la commande \`git status\` (autorisée), puis avec Bash la commande
   \`git push origin main\` (elle sera refusée, c'est attendu), un appel Bash par tour,
   puis écris « Fin du test. » et termine sans autre appel.`;

function tools(): FactoryToolHandlers & { cards: CardInput[] } {
  const cards: CardInput[] = [];
  return {
    cards,
    emit_card: async (card) => {
      cards.push(card);
      return Promise.resolve({ cardId: `card-${String(cards.length)}` });
    },
    update_contract: () => Promise.resolve(),
    update_evidence: () => Promise.resolve(),
    request_adr: () => Promise.resolve(),
    read_rules: () => Promise.resolve(''),
  };
}

function worktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'factory-live-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# Dépôt jetable du test live\n');
  return dir;
}

async function collect(it: AsyncIterable<FactoryEvent>): Promise<FactoryEvent[]> {
  const out: FactoryEvent[] = [];
  for await (const e of it) {
    console.log(JSON.stringify(e).slice(0, 200));
    out.push(e);
  }
  return out;
}

describe.skipIf(!live)('live — aller-retour carte / reprise', () => {
  it('question → run.waiting → reprise → run.finished, même session', async () => {
    const raw: { start: SDKMessage[]; resume: SDKMessage[] } = { start: [], resume: [] };
    let phase: 'start' | 'resume' = 'start';
    const adapter = new ClaudeCodeAdapter({ onMessage: (_run, m) => raw[phase].push(m) });
    const handlers = tools();
    const spec: RunSpec = {
      runId: 'live-1',
      cwd: worktree(),
      instructions: INSTRUCTIONS,
      prompt: 'Commence le test.',
      requiredTools: ['emit_card', 'read_rules'],
      tools: handlers,
      policy: DEFAULT_POLICY,
      maxTurns: 10,
      maxBudgetUsd: 1,
    };

    const first = await collect(adapter.start(spec));
    const types = first.map((e) => e.type);
    expect(types[0]).toBe('run.started');
    expect(first.filter(isTerminal)).toHaveLength(1);
    expect(types.at(-1)).toBe('run.waiting');
    expect(types.at(-2)).toBe('card.emitted');
    expect(handlers.cards).toHaveLength(1);
    expect(handlers.cards[0]?.kind).toBe('question');
    const started = first[0];
    if (started?.type === 'run.started') {
      for (const t of ['WebSearch', 'WebFetch', 'Agent']) expect(started.tools).not.toContain(t);
      expect(started.tools).toContain('mcp__factory__emit_card');
    }
    const waiting = first.at(-1);
    const sessionId = waiting?.type === 'run.waiting' ? waiting.sessionId : '';
    expect(sessionId).not.toBe('');

    phase = 'resume';
    const second = await collect(
      adapter.resume(
        { ...spec, sessionId, prompt: 'Continue le test.' },
        { cardId: 'card-1', choice: { kind: 'option', letter: 'A' }, text: '' },
      ),
    );
    const types2 = second.map((e) => e.type);
    expect(types2[0]).toBe('run.started');
    expect(second.filter(isTerminal)).toHaveLength(1);
    expect(types2.at(-1)).toBe('run.finished');
    const finished = second.at(-1);
    if (finished?.type === 'run.finished') expect(finished.sessionId).toBe(sessionId);
    expect(handlers.cards).toHaveLength(1); // la carte répondue n'est pas republiée
    const bash = second.filter((e) => e.type === 'agent.tool' && e.tool === 'Bash');
    expect(bash.map((e) => (e.type === 'agent.tool' ? [e.summary, e.ok] : []))).toEqual([
      ['git status', true],
      ['git push origin main', false],
    ]);
    expect(second.some((e) => e.type === 'agent.message' && e.text.includes('reçue'))).toBe(true);

    const home = process.env.HOME ?? '';
    const json = JSON.stringify(raw, null, 2).replaceAll(home, '~');
    writeFileSync(
      fileURLToPath(new URL('../fixtures/sdk/live-roundtrip.json', import.meta.url)),
      `${json}\n`,
    );
  });

  it('un outil requis manquant échoue vite avec tools_missing', async () => {
    const adapter = new ClaudeCodeAdapter();
    const t0 = Date.now();
    const events = await collect(
      adapter.start({
        runId: 'live-2',
        cwd: worktree(),
        instructions: 'Dis bonjour.',
        prompt: 'Bonjour.',
        requiredTools: ['emit_card', 'inexistant' as FactoryToolName],
        tools: tools(),
        policy: DEFAULT_POLICY,
        maxTurns: 2,
        maxBudgetUsd: 0.2,
      }),
    );
    expect(events.filter(isTerminal)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', reason: 'tools_missing' });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
