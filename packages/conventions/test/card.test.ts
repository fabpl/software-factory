import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachAnswers,
  cardNumber,
  isBlocking,
  parseAnswer,
  parseCard,
  queueFor,
  serializeAnswer,
  serializeCard,
  shouldHaveBlocked,
  statusAfter,
  validateAnswer,
  validateCardInput,
  withStatus,
  type Card,
  type CardAnswer,
} from '../src/card.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replace(/\n$/, '');

function card(name: string): Card {
  const r = parseCard(fixture(name));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const marker = (attrs: string) => `<!-- factory:card ${attrs} -->`;
const base =
  'id=card-1 kind=question origin=framing reversibility=reversible status=open skill=framing@0.1.0';
const minimal = (
  attrs = base,
  body = '### ❓ Question 1 — T\n\n**Contexte** — c\n\n**Options**\n- **A.** a\n- **B.** b',
) => `${marker(attrs)}\n${body}`;

describe('parseCard', () => {
  it('lit la carte d’arbitrage de la spec', () => {
    const c = card('card-arbitration.md');
    expect(c).toMatchObject({
      id: 'card-7',
      kind: 'arbitration',
      origin: 'implementation',
      reversibility: 'irreversible',
      status: 'open',
      skill: 'implementation@0.1.0',
      title: 'Stockage des sessions',
      recommendation: { letter: 'B', text: expect.stringContaining('seul choix') as string },
      changeCost: 'Faible maintenant, moyen après le module `orchestrator`.',
    });
    expect(c.context).toContain('commit `a1b2c3d`');
    expect(c.options.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
    expect(c.options[1]?.consequence).toBe('Reconstructible depuis GitHub (principe 7).');
  });

  it('lit une carte action sans options, contexte sur plusieurs lignes', () => {
    const c = card('card-action.md');
    expect(c.kind).toBe('action');
    expect(c.options).toEqual([]);
    expect(c.context).toBe(
      'Le critère C4 appelle une API externe.\nIl faut un jeton dans `.env.test`.',
    );
    expect(c.recommendation).toBeUndefined();
    expect(c.changeCost).toBeUndefined();
  });

  it('refuse un commentaire sans marqueur de carte', () => {
    expect(parseCard('bonjour')).toEqual({ ok: false, error: { kind: 'missing-marker' } });
    expect(parseCard('<!-- factory:answer card=card-1 choice=A -->')).toEqual({
      ok: false,
      error: { kind: 'missing-marker' },
    });
  });

  it('refuse chaque attribut invalide', () => {
    const cases: [string, string, string][] = [
      ['kind=question origin=framing reversibility=reversible status=open skill=f@0.1.0', 'id', ''],
      [
        'id=x kind=question origin=framing reversibility=reversible status=open skill=f@0.1.0',
        'id',
        'x',
      ],
      [
        'id=card-1 kind=foo origin=framing reversibility=reversible status=open skill=f@0.1.0',
        'kind',
        'foo',
      ],
      [
        'id=card-1 kind=question origin=x reversibility=reversible status=open skill=f@0.1.0',
        'origin',
        'x',
      ],
      [
        'id=card-1 kind=question origin=framing reversibility=x status=open skill=f@0.1.0',
        'reversibility',
        'x',
      ],
      [
        'id=card-1 kind=question origin=framing reversibility=reversible status=x skill=f@0.1.0',
        'status',
        'x',
      ],
      ['id=card-1 kind=question origin=framing reversibility=reversible status=open', 'skill', ''],
      [
        'id=card-1 kind=question origin=framing reversibility=reversible status=open skill=f',
        'skill',
        'f',
      ],
    ];
    for (const [attrs, attr, value] of cases) {
      expect(parseCard(minimal(attrs))).toEqual({
        ok: false,
        error: { kind: 'bad-attr', attr, value },
      });
    }
  });

  it('refuse l’absence de titre, trop peu d’options, une décision irréversible, une option mal formée', () => {
    expect(parseCard(minimal(base, '**Contexte** — c'))).toEqual({
      ok: false,
      error: { kind: 'missing-title' },
    });
    expect(parseCard(minimal(base, '### ❓ Question 1 — T\n**Options**\n- **A.** a'))).toEqual({
      ok: false,
      error: { kind: 'too-few-options', count: 1 },
    });
    expect(
      parseCard(
        minimal(
          base
            .replace('kind=question', 'kind=decision')
            .replace('reversibility=reversible', 'reversibility=irreversible'),
        ),
      ),
    ).toEqual({ ok: false, error: { kind: 'decision-not-reversible' } });
    expect(parseCard(minimal(base, '### ❓ Question 1 — T\n**Options**\n- A sans gras'))).toEqual({
      ok: false,
      error: { kind: 'bad-option-line', line: '- A sans gras' },
    });
    expect(
      parseCard(minimal(base, '### ❓ Question 1 — T\n**Options**\n  Conséquence : orpheline')),
    ).toEqual({
      ok: false,
      error: { kind: 'bad-option-line', line: '  Conséquence : orpheline' },
    });
  });

  it('signale un attribut absent avec une valeur vide', () => {
    const without = (attr: string) =>
      base
        .split(' ')
        .filter((p) => !p.startsWith(`${attr}=`))
        .join(' ');
    for (const attr of ['kind', 'origin', 'reversibility', 'status']) {
      expect(parseCard(minimal(without(attr)))).toEqual({
        ok: false,
        error: { kind: 'bad-attr', attr, value: '' },
      });
    }
  });

  it('accepte des sections sans texte sur la ligne et une option sans conséquence', () => {
    const c = parseCard(
      minimal(
        base,
        "### ❓ Question 1 — T\n**Contexte**\nligne 1\n**Options**\n- **A.** a\n- **B.** b\n**Recommandation**\n**Coût d'un changement d'avis**",
      ),
    );
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.context).toBe('ligne 1');
    expect(c.value.recommendation).toBeUndefined();
    expect(c.value.changeCost).toBeUndefined();
    expect(c.value.options[0]?.consequence).toBeUndefined();
    expect(serializeCard(c.value)).toContain('- **A.** a\n- **B.** b');
  });

  it('tolère une recommandation sans lettre et une ligne de titre répétée', () => {
    const c = parseCard(
      minimal(
        base,
        '### ❓ Question 1 — T\n### ❓ Question 1 — pas un second titre\n**Options**\n- **A.** a\n- **B.** b\n**Recommandation** — sans lettre',
      ),
    );
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.recommendation).toEqual({ letter: '', text: 'sans lettre' });
    expect(c.value.context).toBe('');
  });
});

describe('serializeCard', () => {
  it('fait l’aller-retour exact sur les fixtures', () => {
    for (const name of ['card-arbitration.md', 'card-action.md']) {
      expect(serializeCard(card(name))).toBe(fixture(name));
    }
  });

  it('withStatus ne change que le marqueur', () => {
    const c = withStatus(card('card-arbitration.md'), 'answered');
    const out = serializeCard(c);
    expect(out).toContain('status=answered');
    expect(out.split('\n').slice(1).join('\n')).toBe(
      fixture('card-arbitration.md').split('\n').slice(1).join('\n'),
    );
  });
});

describe('helpers', () => {
  it('cardNumber, isBlocking, queueFor, validateCardInput', () => {
    expect(cardNumber('card-12')).toBe(12);
    expect(cardNumber('nope')).toBe(0);
    expect(isBlocking('decision')).toBe(false);
    expect(isBlocking('action')).toBe(true);
    expect(queueFor('question')).toBe('arbitrate');
    expect(queueFor('decision')).toBe('validate');
    expect(queueFor('action')).toBe('act');
    expect(
      validateCardInput({
        kind: 'action',
        title: 'x',
        context: '',
        options: [],
        reversibility: 'reversible',
      }),
    ).toEqual({ ok: true, value: true });
    expect(
      validateCardInput({
        kind: 'action',
        title: '  ',
        context: '',
        options: [],
        reversibility: 'reversible',
      }),
    ).toEqual({ ok: false, error: { kind: 'missing-title' } });
  });
});

describe('réponses', () => {
  it('parse et sérialise', () => {
    const a = parseAnswer(
      '<!-- factory:answer card=card-7 choice=B -->\nB. Et note-le dans l’ADR.',
    );
    expect(a).toEqual({
      ok: true,
      value: {
        cardId: 'card-7',
        choice: { kind: 'option', letter: 'B' },
        text: 'B. Et note-le dans l’ADR.',
      },
    });
    if (!a.ok) return;
    expect(serializeAnswer(a.value)).toBe(
      '<!-- factory:answer card=card-7 choice=B -->\nB. Et note-le dans l’ADR.',
    );
    expect(serializeAnswer({ cardId: 'card-1', choice: { kind: 'done' }, text: '' })).toBe(
      '<!-- factory:answer card=card-1 choice=done -->',
    );
    const k = parseAnswer('<!-- factory:answer card=card-2 choice=keep -->');
    expect(k).toEqual({
      ok: true,
      value: { cardId: 'card-2', choice: { kind: 'keep' }, text: '' },
    });
  });

  it('refuse les marqueurs et attributs invalides', () => {
    expect(parseAnswer('texte')).toEqual({ ok: false, error: { kind: 'missing-marker' } });
    expect(parseAnswer('<!-- factory:answer choice=A -->')).toEqual({
      ok: false,
      error: { kind: 'bad-attr', attr: 'card', value: '' },
    });
    expect(parseAnswer('<!-- factory:answer card=card-1 choice=maybe -->')).toEqual({
      ok: false,
      error: { kind: 'bad-attr', attr: 'choice', value: 'maybe' },
    });
    expect(parseAnswer('<!-- factory:answer card=card-1 -->')).toEqual({
      ok: false,
      error: { kind: 'bad-attr', attr: 'choice', value: '' },
    });
  });

  it('validateAnswer applique les règles par type de carte', () => {
    const arb = card('card-arbitration.md');
    const act = card('card-action.md');
    const dec: Card = { ...arb, kind: 'decision', reversibility: 'reversible' };
    const ans = (choice: CardAnswer['choice'], text = ''): CardAnswer => ({
      cardId: 'card-7',
      choice,
      text,
    });
    expect(validateAnswer(arb, ans({ kind: 'option', letter: 'B' }))).toEqual({
      ok: true,
      value: true,
    });
    expect(validateAnswer(arb, ans({ kind: 'option', letter: 'Z' }))).toEqual({
      ok: false,
      error: { kind: 'unknown-option', letter: 'Z' },
    });
    expect(validateAnswer(arb, ans({ kind: 'other' }))).toEqual({
      ok: false,
      error: { kind: 'other-requires-text' },
    });
    expect(validateAnswer(arb, ans({ kind: 'other' }, 'un texte'))).toEqual({
      ok: true,
      value: true,
    });
    expect(validateAnswer(arb, ans({ kind: 'keep' }))).toEqual({
      ok: false,
      error: { kind: 'choice-not-allowed', cardKind: 'arbitration', choice: 'keep' },
    });
    expect(validateAnswer(dec, ans({ kind: 'reverse' }))).toEqual({ ok: true, value: true });
    expect(validateAnswer(dec, ans({ kind: 'option', letter: 'A' }))).toEqual({
      ok: false,
      error: { kind: 'choice-not-allowed', cardKind: 'decision', choice: 'A' },
    });
    expect(validateAnswer(act, ans({ kind: 'done' }))).toEqual({ ok: true, value: true });
  });

  it('statusAfter et shouldHaveBlocked', () => {
    const a = (choice: CardAnswer['choice'], text = ''): CardAnswer => ({
      cardId: 'card-1',
      choice,
      text,
    });
    expect(statusAfter(a({ kind: 'keep' }))).toBe('kept');
    expect(statusAfter(a({ kind: 'reverse' }))).toBe('reversed');
    expect(statusAfter(a({ kind: 'done' }))).toBe('done');
    expect(statusAfter(a({ kind: 'other' }))).toBe('answered');
    expect(statusAfter(a({ kind: 'option', letter: 'A' }))).toBe('answered');
    expect(shouldHaveBlocked(a({ kind: 'reverse' }, 'Ça aurait dû me bloquer.'))).toBe(true);
    expect(shouldHaveBlocked(a({ kind: 'reverse' }, 'aurait du bloquer'))).toBe(true);
    expect(shouldHaveBlocked(a({ kind: 'reverse' }, 'non'))).toBe(false);
    expect(shouldHaveBlocked(a({ kind: 'keep' }, 'aurait dû me bloquer'))).toBe(false);
  });

  it('attachAnswers garde la première réponse admissible par carte', () => {
    const arb = card('card-arbitration.md');
    const act = card('card-action.md');
    const answers: CardAnswer[] = [
      { cardId: 'card-7', choice: { kind: 'keep' }, text: '' }, // inadmissible
      { cardId: 'card-7', choice: { kind: 'option', letter: 'A' }, text: '' },
      { cardId: 'card-7', choice: { kind: 'option', letter: 'B' }, text: '' }, // doublon ignoré
      { cardId: 'card-99', choice: { kind: 'done' }, text: '' }, // carte inconnue
      { cardId: 'card-9', choice: { kind: 'done' }, text: 'fait' },
    ];
    const m = attachAnswers([arb, act], answers);
    expect(m.get('card-7')?.choice).toEqual({ kind: 'option', letter: 'A' });
    expect(m.get('card-9')?.text).toBe('fait');
    expect(m.size).toBe(2);
  });
});
