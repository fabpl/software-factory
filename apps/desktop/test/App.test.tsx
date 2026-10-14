// @vitest-environment jsdom
import type { InboxState } from '@factory/orchestrator';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { BLOCKED } from '../src/renderer/fixtures/blocked';
import { EMPTY } from '../src/renderer/fixtures/empty';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { fakeApi, inboxState } from './fakes';

afterEach(cleanup);

function columns(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
}

describe('App (H1)', () => {
  it('affiche l’écran bloqué quand status === "blocked"', async () => {
    render(<App api={fakeApi(BLOCKED)} />);
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.getByRole('code').textContent).toBe('gh auth login');
  });

  it('bloqué sans raison détaillée : l’écran bloqué reste affiché avec son titre', async () => {
    render(<App api={fakeApi(inboxState({ status: 'blocked' }))} />);
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(screen.getAllByText('Prérequis manquant')).toHaveLength(2);
  });

  it('sinon les trois colonnes, dans l’ordre Arbitrer, Valider, Agir', async () => {
    render(<App api={fakeApi(EMPTY)} />);
    await screen.findAllByRole('region');
    expect(columns()).toEqual(['Arbitrer0', 'Valider0', 'Agir0']);
    expect(screen.getAllByText('Rien à faire ici')).toHaveLength(3);
  });

  it('avant le premier état, un message de connexion', () => {
    const api = fakeApi(EMPTY);
    api.getState = () => new Promise<InboxState>(() => undefined);
    render(<App api={api} />);
    expect(screen.getByText('Connexion à l’orchestrateur…')).toBeTruthy();
  });

  it('suit les états publiés par subscribe : la carte quitte sa colonne au prochain état', async () => {
    const api = fakeApi(LOADED);
    render(<App api={api} />);
    expect(await screen.findByText(LOADED.act[0]?.title ?? '')).toBeTruthy();
    act(() => {
      api.publish({ ...LOADED, act: [] });
    });
    expect(screen.queryByText(LOADED.act[0]?.title ?? '')).toBeNull();
    expect(columns()).toEqual(['Arbitrer2', 'Valider3', 'Agir0']);
    act(() => {
      api.publish(BLOCKED);
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('se désabonne au démontage', async () => {
    const api = fakeApi(EMPTY);
    const { unmount } = render(<App api={api} />);
    await screen.findAllByRole('region');
    expect(api.listeners.size).toBe(1);
    expect(api.focusListeners.size).toBe(1);
    unmount();
    expect(api.listeners.size).toBe(0);
    expect(api.focusListeners.size).toBe(0);
  });
});

describe('ouvrir sur la carte (H7, C5)', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  function article(title: string): HTMLElement {
    return screen.getByRole('article', { name: title });
  }

  it('factory:focus déplie la carte visée et la fait défiler dans la vue', async () => {
    const api = fakeApi(LOADED);
    render(<App api={api} />);
    const target = LOADED.act[0];
    const other = LOADED.arbitrate[0];
    if (!target || !other) throw new Error('fixture incomplète');
    await screen.findByText(target.title);
    expect(article(target.title).getAttribute('aria-expanded')).toBe('false');

    act(() => {
      api.focus(target.id);
    });
    expect(article(target.title).getAttribute('aria-expanded')).toBe('true');
    expect(article(other.title).getAttribute('aria-expanded')).toBe('false');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(article(target.title));
  });

  it('un second focus sur la même carte, repliée entre-temps, la redéplie', async () => {
    const api = fakeApi(LOADED);
    render(<App api={api} />);
    const target = LOADED.arbitrate[1];
    if (!target) throw new Error('fixture incomplète');
    await screen.findByText(target.title);
    act(() => {
      api.focus(target.id);
    });
    act(() => {
      within(article(target.title)).getAllByRole('button')[0]?.click();
    });
    expect(article(target.title).getAttribute('aria-expanded')).toBe('false');
    act(() => {
      api.focus(target.id);
    });
    expect(article(target.title).getAttribute('aria-expanded')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('un identifiant inconnu ne déplie rien', async () => {
    const api = fakeApi(LOADED);
    render(<App api={api} />);
    await screen.findAllByRole('article');
    act(() => {
      api.focus('card-404');
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    for (const a of screen.getAllByRole('article')) {
      expect(a.getAttribute('aria-expanded')).toBe('false');
    }
  });
});

describe('fixtures InboxState (C1)', () => {
  it.each([
    ['vide', EMPTY],
    ['chargée', LOADED],
    ['bloquée', BLOCKED],
  ] as const)('la fixture %s rend sans erreur', async (_name, state) => {
    render(<App api={fakeApi(state)} />);
    expect(await screen.findByRole('main')).toBeTruthy();
  });

  it('la fixture chargée contient chaque type de carte, un item pending et un run en cours', () => {
    const cards = [...LOADED.arbitrate, ...LOADED.validate, ...LOADED.act];
    expect(new Set(cards.map((c) => c.kind))).toEqual(
      new Set(['question', 'arbitration', 'decision', 'action', 'item', 'evidence']),
    );
    expect(cards.find((c) => c.kind === 'item')?.item?.status).toBe('pending');
    expect(LOADED.run).toBeDefined();
  });

  it('la fixture chargée répartit ses cartes dans les colonnes, dans l’ordre reçu', async () => {
    render(<App api={fakeApi(LOADED)} />);
    await screen.findAllByRole('article');
    expect(columns()).toEqual(['Arbitrer2', 'Valider3', 'Agir1']);
    const valider = screen.getByRole('region', { name: /^Valider/ });
    expect(
      within(valider)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(LOADED.validate.map((c) => c.title));
  });
});
