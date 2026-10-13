import { describe, expect, it } from 'vitest';
import { answerText, CARD_PUBLISHED_STOP, wrapHandlers } from '../src/claude/handlers.js';
import { RunState } from '../src/claude/state.js';
import { DECISION, fakeTools, QUESTION } from './helpers.js';

function setup() {
  const tools = fakeTools();
  const state = new RunState('run-1');
  return { tools, state, handlers: wrapHandlers(tools, state) };
}

describe('handlers factory', () => {
  it('emit_card bloquante : publie, événement, demande d’arrêt', async () => {
    const { tools, state, handlers } = setup();
    expect(await handlers.emit_card(QUESTION)).toBe(CARD_PUBLISHED_STOP);
    expect(tools.calls).toEqual(['emit_card:question']);
    expect(state.drain()).toEqual([
      { type: 'card.emitted', runId: 'run-1', card: QUESTION, blocking: true },
    ]);
    expect(state.stopOnCard).toBe('card-1');
    expect(state.drain()).toEqual([]);
  });

  it('emit_card decision : publie et continue', async () => {
    const { state, handlers } = setup();
    expect(await handlers.emit_card(DECISION)).toMatch(/card-1 publiée.*Continue/);
    expect(state.stopOnCard).toBeUndefined();
    expect(state.drain()[0]).toMatchObject({ type: 'card.emitted', blocking: false });
  });

  it('emit_card avec réponse (reprise) : ne republie pas, rend la réponse au modèle', async () => {
    const { tools, state, handlers } = setup();
    const answer = {
      cardId: 'card-1',
      choice: { kind: 'option' as const, letter: 'B' },
      text: 'et note-le',
    };
    expect(await handlers.emit_card({ ...QUESTION, answer })).toBe(
      "Réponse de l'humain à la carte card-1 : B. et note-le",
    );
    expect(tools.calls).toEqual([]);
    expect(state.drain()).toEqual([]);
  });

  it('emit_card invalide : refusée sans appel au handler', async () => {
    const { tools, handlers } = setup();
    const text = await handlers.emit_card({ ...QUESTION, options: [] });
    expect(text).toMatch(/Carte refusée/);
    expect(tools.calls).toEqual([]);
  });

  it('update_contract et request_adr relaient et émettent', async () => {
    const { state, handlers } = setup();
    const contract = { items: [] };
    expect(await handlers.update_contract(contract)).toBe('Contrat réécrit : 0 items.');
    const adr = {
      cardId: 'card-2',
      slug: 'x',
      title: 'X',
      origin: 'implementation',
      reversibility: 'irreversible',
      question: 'q',
      context: 'c',
      options: [],
      chosen: 'A',
      decision: 'd',
      consequences: [],
    };
    expect(await handlers.request_adr(adr)).toBe('ADR demandé pour la carte card-2 (x).');
    expect(state.drain().map((e) => e.type)).toEqual(['contract.updated', 'adr.requested']);
  });

  it('update_evidence refuse proven et missing, accepte le reste', async () => {
    const { tools, state, handlers } = setup();
    const refused = await handlers.update_evidence({
      lines: [
        { criterion: 'C1', proof: 'x', state: 'proven' },
        { criterion: 'C2', proof: '—', state: 'missing' },
        { criterion: 'C3', proof: 't', state: 'pending' },
      ],
    });
    expect(refused).toMatch(/Refusé.*C1 \(proven\), C2 \(missing\)/);
    expect(tools.calls).toEqual([]);
    const ok = await handlers.update_evidence({
      lines: [{ criterion: 'C3', proof: 't', state: 'to-review' }],
    });
    expect(ok).toBe('Preuves réécrites : 1 lignes.');
    expect(state.drain()[0]).toMatchObject({ type: 'evidence.updated' });
  });

  it('read_rules rend le texte ou un message d’absence', async () => {
    const { tools, handlers } = setup();
    expect(await handlers.read_rules()).toMatch(/Tranché/);
    tools.read_rules = async () => Promise.resolve('  ');
    expect(await wrapHandlers(tools, new RunState('r')).read_rules()).toMatch(/Aucune règle/);
  });

  it('answerText couvre lettre et mot-clé', () => {
    expect(answerText({ cardId: 'c', choice: { kind: 'keep' }, text: '' })).toBe('keep');
    expect(answerText({ cardId: 'c', choice: { kind: 'option', letter: 'A' }, text: 'oui' })).toBe(
      'A. oui',
    );
  });
});
