import { describe, expect, it } from 'vitest';
import {
  findDelimitedBlock,
  parseMarker,
  renderMarker,
  replaceDelimitedBlock,
} from '../src/block.js';

describe('parseMarker', () => {
  it('lit nom et attributs', () => {
    expect(parseMarker('<!-- factory:card id=card-7 kind=action -->')).toEqual({
      name: 'card',
      attrs: { id: 'card-7', kind: 'action' },
    });
    expect(parseMarker('<!--factory:evidence-->')).toEqual({ name: 'evidence', attrs: {} });
    expect(parseMarker('pas de marqueur')).toBeUndefined();
  });

  it('renderMarker est l’inverse', () => {
    const text = renderMarker('run', { session: 's1', status: 'waiting' });
    expect(text).toBe('<!-- factory:run session=s1 status=waiting -->');
    expect(parseMarker(text)).toEqual({ name: 'run', attrs: { session: 's1', status: 'waiting' } });
    expect(renderMarker('evidence', {})).toBe('<!-- factory:evidence -->');
  });
});

describe('findDelimitedBlock', () => {
  it('retourne undefined sans ouverture ou sans fermeture', () => {
    expect(findDelimitedBlock('rien', 'contract')).toBeUndefined();
    expect(findDelimitedBlock('<!-- factory:contract -->\nx', 'contract')).toBeUndefined();
  });

  it('isole le contenu intérieur', () => {
    const b = findDelimitedBlock(
      'a\n<!-- factory:contract v=1 -->\nin\n<!-- /factory:contract -->\nz',
      'contract',
    );
    expect(b?.inner).toBe('in');
    expect(b?.attrs).toEqual({ v: '1' });
  });
});

describe('replaceDelimitedBlock', () => {
  it('remplace, ajoute, ou crée', () => {
    const block = '<!-- factory:x -->\nnew\n<!-- /factory:x -->';
    expect(
      replaceDelimitedBlock('a\n<!-- factory:x -->\nold\n<!-- /factory:x -->\nb', 'x', block),
    ).toBe(`a\n${block}\nb`);
    expect(replaceDelimitedBlock('a\n', 'x', block)).toBe(`a\n\n${block}\n`);
    expect(replaceDelimitedBlock('', 'x', block)).toBe(`${block}\n`);
  });
});
