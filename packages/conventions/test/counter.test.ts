import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { incrementCounter, parseCounter, serializeCounter } from '../src/counter.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const block = (inner: string) =>
  `avant\n<!-- factory:counter -->\n${inner}\n<!-- /factory:counter -->\naprès\n`;

describe('parseCounter', () => {
  it('lit le README converti : 0, aucune raison', () => {
    expect(parseCounter(fixture('readme-counter.md'))).toEqual({
      ok: true,
      value: { value: 0, reasons: [] },
    });
  });

  it('lit le README.md réel du dépôt', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    const r = parseCounter(readme);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.reasons).toHaveLength(r.value.value);
  });

  it('lit la valeur et les raisons dans l’ordre', () => {
    expect(parseCounter(block('**2**\n\n1. première\n2. seconde'))).toEqual({
      ok: true,
      value: { value: 2, reasons: ['première', 'seconde'] },
    });
  });

  it('erreur typée sans bloc compteur', () => {
    expect(parseCounter('# Titre\n\nrien\n')).toEqual({
      ok: false,
      error: { kind: 'missing-block' },
    });
  });

  it('erreur typée sur valeur, ligne ou décompte invalides', () => {
    expect(parseCounter(block('zéro'))).toEqual({
      ok: false,
      error: { kind: 'bad-value', line: 'zéro' },
    });
    expect(parseCounter(block('**1**\n\n- puce'))).toEqual({
      ok: false,
      error: { kind: 'bad-reason', line: '- puce' },
    });
    expect(parseCounter(block('**3**\n\n1. seule'))).toEqual({
      ok: false,
      error: { kind: 'count-mismatch', value: 3, reasons: 1 },
    });
  });
});

describe('serializeCounter', () => {
  it('est l’inverse de parseCounter', () => {
    const counter = { value: 2, reasons: ['a', 'b'] };
    expect(parseCounter(`x\n${serializeCounter(counter)}\n`)).toEqual({
      ok: true,
      value: counter,
    });
    expect(serializeCounter({ value: 0, reasons: [] })).toBe(
      '<!-- factory:counter -->\n**0**\n<!-- /factory:counter -->',
    );
  });
});

describe('incrementCounter', () => {
  it('N+1, raison en dernière ligne, hors bloc identique octet pour octet', () => {
    const readme = fixture('readme-counter.md');
    const first = incrementCounter(readme, 'ouvert pour corriger le verrou');
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const second = incrementCounter(first.value, '  relu la CI  ');
    if (!second.ok) throw new Error(JSON.stringify(second.error));
    expect(parseCounter(second.value)).toEqual({
      ok: true,
      value: { value: 2, reasons: ['ouvert pour corriger le verrou', 'relu la CI'] },
    });
    const outside = (text: string) => {
      const start = text.indexOf('<!-- factory:counter');
      const end = text.indexOf('<!-- /factory:counter -->') + '<!-- /factory:counter -->'.length;
      return [text.slice(0, start), text.slice(end)];
    };
    expect(outside(second.value)).toEqual(outside(readme));
  });

  it('refuse une raison vide ou multiligne', () => {
    const readme = fixture('readme-counter.md');
    expect(incrementCounter(readme, '   ')).toEqual({
      ok: false,
      error: { kind: 'empty-reason' },
    });
    expect(incrementCounter(readme, 'a\nb')).toEqual({
      ok: false,
      error: { kind: 'multiline-reason' },
    });
    expect(incrementCounter(readme, 'a\r\nb')).toEqual({
      ok: false,
      error: { kind: 'multiline-reason' },
    });
  });

  it('propage l’erreur de lecture', () => {
    expect(incrementCounter('rien', 'raison')).toEqual({
      ok: false,
      error: { kind: 'missing-block' },
    });
  });
});
