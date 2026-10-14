// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App';
import { NewIntentDialog } from '../src/renderer/components/NewIntentDialog';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { fakeApi } from './fakes';

afterEach(cleanup);

function panel() {
  const api = fakeApi();
  render(<NewIntentDialog api={api} />);
  return { api, user: userEvent.setup() };
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Créer l’issue' });
}

describe('NewIntentDialog (H3, C2)', () => {
  it('panneau en place, sans role=dialog ; « Fermer » le replie sans rien envoyer', async () => {
    const { api, user } = panel();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nouvelle intention' }));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Nouvelle intention' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.commands.createIntent).not.toHaveBeenCalled();
  });

  it('envoi impossible tant que le titre est vide ou blanc', async () => {
    const { api, user } = panel();
    await user.click(screen.getByRole('button', { name: 'Nouvelle intention' }));
    expect(submitButton().disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Texte' }), 'Du texte sans titre');
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), '   ');
    expect(submitButton().disabled).toBe(true);
    await user.click(submitButton());
    expect(api.commands.createIntent).not.toHaveBeenCalled();
  });

  it('createIntent(titre, texte) avec le texte tel quel, puis le panneau se referme vidé', async () => {
    const { api, user } = panel();
    await user.click(screen.getByRole('button', { name: 'Nouvelle intention' }));
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), '  Exporter en PDF ');
    await user.type(
      screen.getByRole('textbox', { name: 'Texte' }),
      'Pouvoir **exporter**.{Enter}{Enter}Deuxième paragraphe.',
    );
    await user.click(submitButton());
    expect(api.commands.createIntent).toHaveBeenCalledExactlyOnceWith(
      'Exporter en PDF',
      'Pouvoir **exporter**.\n\nDeuxième paragraphe.',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nouvelle intention' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Titre' }).value).toBe('');
  });

  it('refus de l’orchestrateur : toast d’erreur, le panneau reste ouvert', async () => {
    const api = fakeApi(LOADED);
    api.commands.createIntent.mockRejectedValueOnce(new Error('dépôt introuvable'));
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.click(await screen.findByRole('button', { name: 'Nouvelle intention' }));
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), 'Idée');
    await user.click(submitButton());
    expect(await screen.findByText('Échec de l’envoi : dépôt introuvable')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Titre' }).value).toBe('Idée');
  });
});
