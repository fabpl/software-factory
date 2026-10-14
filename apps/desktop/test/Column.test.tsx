// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Column } from '../src/renderer/components/Column';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { fakeApi } from './fakes';

afterEach(cleanup);

function column(name: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${name}`) });
}

describe('Column (C2)', () => {
  it('en-tête : libellé et compteur, pour chaque file', () => {
    const api = fakeApi();
    render(
      <>
        <Column queue="arbitrate" cards={LOADED.arbitrate} api={api} />
        <Column queue="validate" cards={LOADED.validate} api={api} />
        <Column queue="act" cards={LOADED.act} api={api} />
      </>,
    );
    for (const [name, count] of [
      ['Arbitrer', 2],
      ['Valider', 3],
      ['Agir', 1],
    ] as const) {
      const heading = within(column(name)).getByRole('heading', { level: 2 });
      expect(heading.textContent).toBe(`${name}${String(count)}`);
      expect(within(heading).getByText(String(count))).toBeTruthy();
    }
  });

  it('liste vide : « Rien à faire ici » et compteur 0', () => {
    render(<Column queue="act" cards={[]} api={fakeApi()} />);
    const region = column('Agir');
    expect(within(region).getByText('Rien à faire ici')).toBeTruthy();
    expect(within(region).getByRole('heading', { level: 2 }).textContent).toBe('Agir0');
    expect(within(region).queryAllByRole('article')).toHaveLength(0);
  });

  it('les cartes suivent l’ordre exact du tableau reçu, sans tri', () => {
    const reversed = [...LOADED.validate].reverse();
    render(<Column queue="validate" cards={reversed} api={fakeApi()} />);
    const titles = within(column('Valider'))
      .getAllByRole('article')
      .map((a) => within(a).getByRole('heading', { level: 3 }).textContent);
    expect(titles).toEqual(reversed.map((c) => c.title));
    expect(within(column('Valider')).queryByText('Rien à faire ici')).toBeNull();
  });
});
