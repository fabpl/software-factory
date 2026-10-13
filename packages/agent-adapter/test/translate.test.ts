import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RunState } from '../src/claude/state.js';
import {
  deferredCard,
  missingTools,
  summarize,
  translate,
  truncate,
  type SdkInitMessage,
  type SdkMessageLike,
  type SdkResultMessage,
} from '../src/claude/translate.js';
import type { FactoryEvent } from '../src/index.js';

function load(name: string): SdkMessageLike[] {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/sdk/${name}.json`, import.meta.url), 'utf8'),
  ) as SdkMessageLike[];
}

const CTX = { requiredTools: ['emit_card', 'update_contract', 'read_rules'] };

function run(messages: SdkMessageLike[], ctx = CTX): { events: FactoryEvent[]; state: RunState } {
  const state = new RunState('run-1');
  const events = messages.flatMap((m) => translate(m, state, ctx));
  return { events, state };
}

const init = (over: Partial<SdkInitMessage> = {}): SdkInitMessage => ({
  ...(load('synthetic-framing')[0] as SdkInitMessage),
  ...over,
});

const result = (over: Partial<SdkResultMessage>): SdkResultMessage => ({
  type: 'result',
  subtype: 'success',
  session_id: 'sess-1',
  is_error: false,
  num_turns: 3,
  total_cost_usd: 0.05,
  ...over,
});

describe('translate — fixture synthétique de cadrage', () => {
  it('produit la séquence attendue jusqu’à la carte différée', () => {
    const { events, state } = run(load('synthetic-framing'));
    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'agent.message',
      'agent.tool',
      'agent.tool',
      'agent.tool',
      'run.finished',
    ]);
    expect(events[0]).toMatchObject({ sessionId: 'sess-1', model: 'claude-opus-5-5' });
    expect(events[2]).toMatchObject({ tool: 'mcp__factory__read_rules', summary: '', ok: true });
    expect(events[3]).toMatchObject({ tool: 'Read', summary: '/wt/README.md', ok: true });
    expect(events[4]).toMatchObject({ tool: 'Bash', summary: 'git push origin main', ok: false });
    expect(state.toolUses.has('toolu_4')).toBe(true);
    expect(state.sessionId).toBe('sess-1');
  });

  it('la carte différée est extraite et validée à part', () => {
    const last = load('synthetic-framing').at(-1) as SdkResultMessage;
    const card = deferredCard(last);
    expect(card?.ok).toBe(true);
    if (card?.ok) expect(card.value.title).toBe('Où stocker ?');
  });
});

describe('deferredCard', () => {
  it('rien à différer', () => {
    expect(deferredCard(result({}))).toBeUndefined();
  });
  it('outil différé inattendu', () => {
    expect(
      deferredCard(result({ deferred_tool_use: { id: 'x', name: 'Bash', input: {} } })),
    ).toEqual({ ok: false, error: 'outil différé inattendu : Bash' });
  });
  it('carte invalide', () => {
    const r = deferredCard(
      result({
        deferred_tool_use: {
          id: 'x',
          name: 'mcp__factory__emit_card',
          input: {
            kind: 'question',
            title: 'T',
            context: '',
            options: [],
            reversibility: 'reversible',
          },
        },
      }),
    );
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error).toMatch(/too-few-options/);
  });
});

describe('translate — init et outils manquants', () => {
  it('outil requis absent → run.failed tools_missing', () => {
    const msg = init({ tools: ['Read', 'mcp__factory__emit_card'] });
    const { events } = run([msg]);
    expect(events).toEqual([
      {
        type: 'run.failed',
        runId: 'run-1',
        sessionId: 'sess-1',
        reason: 'tools_missing',
        detail: 'outils requis absents : mcp__factory__update_contract, mcp__factory__read_rules',
      },
    ]);
  });
  it('serveur factory absent ou non connecté', () => {
    expect(missingTools(init({ mcp_servers: [] }), [])).toEqual(['serveur factory non connecté']);
    expect(
      missingTools(init({ mcp_servers: [{ name: 'factory', status: 'failed' }] }), []),
    ).toEqual(['serveur factory non connecté']);
    expect(missingTools(init(), CTX.requiredTools)).toEqual([]);
  });
  it('un system non init est ignoré', () => {
    expect(run([{ type: 'system', subtype: 'status' }]).events).toEqual([]);
  });
});

describe('translate — assistant et user', () => {
  it('contenu sous forme de chaîne : rien', () => {
    const { events } = run([
      { type: 'assistant', session_id: 's', message: { content: 'texte brut' } },
      { type: 'user', session_id: 's', message: { content: 'texte brut' } },
    ]);
    expect(events).toEqual([]);
  });
  it('bloc inconnu ignoré', () => {
    const { events } = run([
      { type: 'assistant', session_id: 's', message: { content: [{ type: 'thinking' }] } },
    ]);
    expect(events).toEqual([]);
  });
});

describe('translate — result', () => {
  it.each([
    ['error_max_turns', 'max_turns'],
    ['error_max_budget_usd', 'budget'],
    ['error_during_execution', 'execution'],
    ['error_max_structured_output_retries', 'execution'],
  ] as const)('%s → %s', (subtype, reason) => {
    const { events } = run([result({ subtype, is_error: true, errors: ['a', 'b'] })]);
    expect(events).toEqual([
      { type: 'run.failed', runId: 'run-1', sessionId: 'sess-1', reason, detail: 'a ; b' },
    ]);
  });
  it('sans liste d’erreurs, le sous-type sert de détail', () => {
    const { events } = run([result({ subtype: 'error_during_execution', is_error: true })]);
    expect(events[0]).toMatchObject({ detail: 'error_during_execution' });
  });
  it('outil différé indisponible à la reprise : rien émis, état marqué, pas de carte', () => {
    const deferred = { id: 'x', name: 'mcp__factory__emit_card', input: {} };
    const msg = result({
      terminal_reason: 'tool_deferred_unavailable',
      is_error: true,
      deferred_tool_use: deferred,
    });
    const { events, state } = run([msg]);
    expect(events).toEqual([]);
    expect(state.deferredUnavailable).toBe(true);
    expect(deferredCard(msg)).toBeUndefined();
    expect(
      deferredCard(
        result({ stop_reason: 'tool_deferred_unavailable', deferred_tool_use: deferred }),
      ),
    ).toBeUndefined();
  });
  it('succès → run.finished', () => {
    const { events } = run([result({ num_turns: 7, total_cost_usd: 0.42 })]);
    expect(events).toEqual([
      { type: 'run.finished', runId: 'run-1', sessionId: 'sess-1', turns: 7, costUsd: 0.42 },
    ]);
  });
  it('tout le reste est ignoré', () => {
    expect(run([{ type: 'rate_limit_event' }]).events).toEqual([]);
  });
});

describe('summarize et truncate', () => {
  it('choisit le champ par outil', () => {
    expect(summarize('Edit', { file_path: 'a.ts', old_string: 'x' })).toBe('a.ts');
    expect(summarize('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb');
    expect(summarize('Bash', { command: 'pnpm   test\n--run' })).toBe('pnpm test --run');
    expect(summarize('mcp__factory__emit_card', { title: 'Titre', kind: 'question' })).toBe(
      'Titre',
    );
    expect(summarize('Grep', { pattern: 'foo' })).toBe('foo');
    expect(summarize('Glob', { path: 'src' })).toBe('src');
    expect(summarize('X', { a: 1 })).toBe('{"a":1}');
    expect(summarize('X', {})).toBe('');
    expect(summarize('X', null)).toBe('');
    expect(summarize('X', 'texte')).toBe('');
  });
  it('tronque à 120 caractères', () => {
    const long = 'x'.repeat(200);
    expect(truncate(long)).toHaveLength(120);
    expect(truncate(long).endsWith('…')).toBe(true);
    expect(truncate('court')).toBe('court');
  });
});

describe('translate — fixture enregistrée en live (si présente)', () => {
  const path = new URL('./fixtures/sdk/live-roundtrip.json', import.meta.url);
  it.skipIf(!existsSync(path))('le run réel se traduit en une séquence cohérente', () => {
    const recorded = JSON.parse(readFileSync(path, 'utf8')) as {
      start: SdkMessageLike[];
      resume: SdkMessageLike[];
    };
    const first = run(recorded.start, { requiredTools: ['emit_card', 'read_rules'] });
    expect(first.events[0]?.type).toBe('run.started');
    const lastStart = recorded.start.at(-1) as SdkResultMessage;
    expect(deferredCard(lastStart)?.ok).toBe(true);
    const second = run(recorded.resume, { requiredTools: ['emit_card', 'read_rules'] });
    expect(second.events.at(-1)?.type).toBe('run.finished');
    expect(first.state.sessionId).toBe(second.state.sessionId);
  });
});
