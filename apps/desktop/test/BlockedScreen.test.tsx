// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedScreen } from '../src/renderer/components/BlockedScreen';
import { BLOCKED } from '../src/renderer/fixtures/blocked';
import { fakeApi } from './fakes';

afterEach(cleanup);

function reason(): { message: string; command?: string } {
  if (!BLOCKED.blockedReason) throw new Error('fixture blocked sans blockedReason');
  return BLOCKED.blockedReason;
}

describe('BlockedScreen (C1)', () => {
  it('affiche le message et la commande dans un bloc copiable', () => {
    render(<BlockedScreen reason={reason()} api={fakeApi()} />);
    expect(screen.getByText(reason().message)).toBeTruthy();
    const code = screen.getByRole('code');
    expect(code.textContent).toBe('gh auth login');
  });

  it('« Copier » écrit la commande dans le presse-papiers', async () => {
    const user = userEvent.setup();
    render(<BlockedScreen reason={reason()} api={fakeApi()} />);
    await user.click(screen.getByRole('button', { name: 'Copier' }));
    expect(await navigator.clipboard.readText()).toBe('gh auth login');
    expect(screen.getByRole('button', { name: 'Copié' })).toBeTruthy();
  });

  it('« Réessayer » appelle api.commands.retry()', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<BlockedScreen reason={reason()} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(api.commands.retry).toHaveBeenCalledTimes(1);
  });

  it('sans commande, pas de bloc copiable ni de bouton Copier', () => {
    render(<BlockedScreen reason={{ message: 'aucun dépôt GitHub détecté' }} api={fakeApi()} />);
    expect(screen.queryByRole('code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copier' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('un échec de retry() est affiché, pas avalé', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.commands.retry).mockRejectedValueOnce(new Error('gh introuvable'));
    render(<BlockedScreen reason={reason()} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'gh introuvable');
  });

  it('un rejet qui n’est pas une Error est affiché tel quel', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.commands.retry).mockRejectedValueOnce('boum');
    render(<BlockedScreen reason={reason()} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'boum');
  });
});
