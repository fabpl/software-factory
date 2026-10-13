import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeAdapter, isTerminal, type FactoryEvent, type Scenario } from '../src/index.js';
import { collect, fakeTools, spec } from './helpers.js';

const scenario = JSON.parse(
  readFileSync(new URL('./fixtures/scenarios/two-cards.json', import.meta.url), 'utf8'),
) as Scenario;

const types = (events: FactoryEvent[]): string[] => events.map((e) => e.type);
const terminals = (events: FactoryEvent[]): FactoryEvent[] => events.filter(isTerminal);

describe('FakeAdapter', () => {
  it('rejoue un scénario à deux cartes bloquantes avec exactement un terminal par run', async () => {
    const adapter = new FakeAdapter(scenario);
    const tools = fakeTools();
    const s = spec({ tools });

    const first = await collect(adapter.start(s));
    expect(types(first)).toEqual([
      'run.started',
      'agent.tool',
      'agent.tool',
      'contract.updated',
      'agent.message',
      'agent.tool',
      'card.emitted',
      'run.waiting',
    ]);
    expect(first.at(-1)).toMatchObject({
      type: 'run.waiting',
      cardId: 'card-1',
      sessionId: 'fake-session',
    });
    expect(terminals(first)).toHaveLength(1);
    expect(tools.calls).toEqual(['read_rules', 'update_contract', 'emit_card:question']);

    const second = await collect(
      adapter.resume(
        { ...s, sessionId: 'sess-42' },
        { cardId: 'card-1', choice: { kind: 'option', letter: 'B' }, text: '' },
      ),
    );
    expect(types(second)).toEqual([
      'run.started',
      'agent.tool',
      'contract.updated',
      'agent.tool',
      'card.emitted',
      'agent.tool',
      'card.emitted',
      'run.waiting',
    ]);
    const blocking = second.flatMap((e) => (e.type === 'card.emitted' ? [e.blocking] : []));
    expect(blocking).toEqual([false, true]);
    expect(second.at(-1)).toMatchObject({
      type: 'run.waiting',
      cardId: 'card-3',
      sessionId: 'sess-42',
    });
    expect(terminals(second)).toHaveLength(1);

    const third = await collect(
      adapter.resume(s, { cardId: 'card-3', choice: { kind: 'option', letter: 'B' }, text: 'ok' }),
    );
    expect(types(third)).toEqual([
      'run.started',
      'agent.tool',
      'adr.requested',
      'agent.tool',
      'evidence.updated',
      'run.finished',
    ]);
    expect(third.at(-1)).toMatchObject({ type: 'run.finished', turns: 2, costUsd: 0 });

    const fourth = await collect(
      adapter.resume(s, { cardId: 'card-9', choice: { kind: 'done' }, text: '' }),
    );
    expect(types(fourth)).toEqual(['run.started', 'run.finished']);
    expect(adapter.answers.map((x) => x.cardId)).toEqual(['card-1', 'card-3', 'card-9']);
  });

  it('un événement terminal du scénario arrête le run', async () => {
    const adapter = new FakeAdapter({
      start: [
        { event: { type: 'run.failed', reason: 'budget', detail: 'plafond' } },
        { event: { type: 'agent.message', text: 'jamais' } },
      ],
    });
    const events = await collect(adapter.start(spec()));
    expect(types(events)).toEqual(['run.started', 'run.failed']);
  });

  it('cancel produit run.failed cancelled au pas suivant', async () => {
    const adapter = new FakeAdapter(scenario);
    const s = spec();
    await adapter.cancel(s.runId);
    const events = await collect(adapter.start(s));
    expect(types(events)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({ reason: 'cancelled' });
  });
});
