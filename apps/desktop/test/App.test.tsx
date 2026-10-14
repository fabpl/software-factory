// @vitest-environment jsdom
import type { InboxState } from '@factory/orchestrator';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App';
import { BLOCKED } from '../src/renderer/fixtures/blocked';
import { EMPTY } from '../src/renderer/fixtures/empty';
import { fakeApi, inboxState } from './fakes';

afterEach(cleanup);

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

  it('sinon un écran d’attente neutre, sans colonnes', async () => {
    render(<App api={fakeApi(EMPTY)} />);
    expect(await screen.findByText('Orchestrateur prêt')).toBeTruthy();
    expect(screen.queryByText('Arbitrer')).toBeNull();
    expect(screen.queryByText('Valider')).toBeNull();
    expect(screen.queryByText('Agir')).toBeNull();
  });

  it('avant le premier état, un message de connexion', () => {
    const api = fakeApi(EMPTY);
    api.getState = () => new Promise<InboxState>(() => undefined);
    render(<App api={api} />);
    expect(screen.getByText('Connexion à l’orchestrateur…')).toBeTruthy();
  });

  it('suit les états publiés par subscribe', async () => {
    const api = fakeApi(EMPTY);
    render(<App api={api} />);
    await screen.findByText('Orchestrateur prêt');
    act(() => {
      api.publish(BLOCKED);
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('se désabonne au démontage', async () => {
    const api = fakeApi(EMPTY);
    const { unmount } = render(<App api={api} />);
    await screen.findByText('Orchestrateur prêt');
    expect(api.listeners.size).toBe(1);
    unmount();
    expect(api.listeners.size).toBe(0);
  });
});
