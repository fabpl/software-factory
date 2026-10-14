// @vitest-environment jsdom
import type { CardView } from '@factory/orchestrator';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast, Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../src/renderer/components/Card';
import {
  ACTION,
  ARBITRATION,
  DECISION,
  EVIDENCE,
  ITEM,
  QUESTION,
} from '../src/renderer/fixtures/loaded';
import { formatAge } from '../src/renderer/labels';
import { fakeApi, type FakeApi } from './fakes';

afterEach(() => {
  cleanup();
  // L'état de sonner est global et rejoué à chaque montage du Toaster.
  toast.dismiss();
});

/** Rend la carte avec le `Toaster` de l'app, la déplie ; le focus reste sur l'en-tête. */
async function expanded(card: CardView, api: FakeApi = fakeApi()) {
  const user = userEvent.setup();
  render(
    <>
      <Card card={card} api={api} />
      <Toaster />
    </>,
  );
  const article = screen.getByRole('article');
  await user.click(within(article).getByRole('heading', { level: 3 }));
  return { user, api, article };
}

function calls(api: FakeApi): number {
  return (
    api.commands.answerCard.mock.calls.length +
    api.commands.validateItem.mock.calls.length +
    api.commands.markEvidenceReviewed.mock.calls.length +
    api.commands.markActionDone.mock.calls.length
  );
}

describe('Card dépliée — raccourcis clavier (C4, D4)', () => {
  const CASES: [CardView, string, string, (api: FakeApi) => void][] = [
    [
      QUESTION,
      'b',
      'Dans le Dock',
      (api) => {
        expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-1', {
          cardId: 'card-1',
          choice: { kind: 'option', letter: 'B' },
          text: '',
        });
      },
    ],
    [
      ARBITRATION,
      'A',
      'Ajouter react-markdown',
      (api) => {
        expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-5', {
          cardId: 'card-5',
          choice: { kind: 'option', letter: 'A' },
          text: '',
        });
      },
    ],
    [
      DECISION,
      'b',
      'Renverser',
      (api) => {
        expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-4', {
          cardId: 'card-4',
          choice: { kind: 'reverse' },
          text: '',
        });
      },
    ],
    [
      ACTION,
      'a',
      'C’est fait',
      (api) => {
        expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-6', {
          cardId: 'card-6',
          choice: { kind: 'done' },
          text: '',
        });
      },
    ],
    [
      ITEM,
      'a',
      'Valider',
      (api) => {
        expect(api.commands.validateItem).toHaveBeenCalledExactlyOnceWith(
          44,
          'H2',
          'validated',
          undefined,
        );
      },
    ],
    [
      EVIDENCE,
      'a',
      'Prouvé',
      (api) => {
        expect(api.commands.markEvidenceReviewed).toHaveBeenCalledExactlyOnceWith(
          43,
          'C1',
          'proven',
          undefined,
        );
      },
    ],
  ];

  it.each(CASES)(
    '%#. la lettre sélectionne sans envoyer, Entrée envoie exactement une commande',
    async (card, key, label, expectCommand) => {
      const { user, api, article } = await expanded(card);
      await user.keyboard(key);
      expect(calls(api)).toBe(0);
      const selected = within(article).getByRole('button', { name: label });
      expect(document.activeElement).toBe(selected);
      expect(selected.getAttribute('data-selected')).toBe('true');
      await user.keyboard('{Enter}');
      expect(calls(api)).toBe(1);
      expectCommand(api);
      expect(await screen.findByText('Envoyé, l’agent reprend')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      await user.keyboard('{Enter}');
      expect(calls(api)).toBe(1);
    },
  );

  it('la même lettre tapée dans la note ne sélectionne rien et n’envoie rien', async () => {
    const { user, api, article } = await expanded(QUESTION);
    const note = within(article).getByRole('textbox');
    await user.click(note);
    await user.keyboard('b{Enter}');
    expect((note as HTMLTextAreaElement).value).toBe('b\n');
    expect(document.activeElement).toBe(note);
    expect(
      within(article)
        .queryAllByRole('button', { name: /./ })
        .some((b) => b.dataset.selected === 'true'),
    ).toBe(false);
    expect(calls(api)).toBe(0);
  });

  it('une lettre sans bouton de ce rang, une touche avec modificateur ou Entrée sans sélection : rien', async () => {
    const { user, api, article } = await expanded(DECISION);
    await user.keyboard('z');
    await user.keyboard('{Meta>}a{/Meta}');
    await user.keyboard('{Escape}');
    expect(
      within(article)
        .getAllByRole('button')
        .some((b) => b.dataset.selected === 'true'),
    ).toBe(false);
    await user.keyboard('{Enter}');
    expect(calls(api)).toBe(0);
  });

  it('focus sur la case à cocher : les lettres sélectionnent toujours', async () => {
    const { user, api, article } = await expanded(DECISION);
    await user.click(within(article).getByRole('checkbox'));
    await user.keyboard('b');
    expect(document.activeElement).toBe(within(article).getByRole('button', { name: 'Renverser' }));
    await user.keyboard('{Enter}');
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-4', {
      cardId: 'card-4',
      choice: { kind: 'reverse' },
      text: 'Ça aurait dû me bloquer.',
    });
  });

  it('lettre d’un bouton désactivé (« Autre » sans note) : sélectionné, Entrée n’envoie rien', async () => {
    const { user, api, article } = await expanded(QUESTION);
    await user.keyboard('d');
    const other = within(article).getByRole('button', { name: 'Autre' });
    expect(other.dataset.selected).toBe('true');
    await user.keyboard('{Enter}');
    expect(calls(api)).toBe(0);
  });

  it('carte repliée : les lettres ne font rien', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<Card card={DECISION} api={api} />);
    screen.getByRole('button').focus();
    await user.keyboard('a{Enter}');
    expect(calls(api)).toBe(0);
  });

  it('commande rejetée : toast d’erreur en français, pas de toast « Envoyé », réessai possible', async () => {
    const api = fakeApi();
    api.commands.answerCard.mockRejectedValueOnce(new Error('réseau coupé'));
    const { user, article } = await expanded(DECISION, api);
    await user.click(within(article).getByRole('button', { name: 'Garder' }));
    expect(await screen.findByText('Échec de l’envoi : réseau coupé')).toBeTruthy();
    expect(screen.queryByText('Envoyé, l’agent reprend')).toBeNull();
    await user.click(within(article).getByRole('button', { name: 'Garder' }));
    expect(api.commands.answerCard).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Envoyé, l’agent reprend')).toBeTruthy();
  });

  it('rejet qui n’est pas une Error : affiché tel quel', async () => {
    const api = fakeApi();
    api.commands.validateItem.mockRejectedValueOnce('boum');
    const { user, article } = await expanded(ITEM, api);
    await user.click(within(article).getByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('Échec de l’envoi : boum')).toBeTruthy();
  });
});

describe('Card repliée — âge relatif (C7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('affiche « il y a 12 min » pour une carte créée 12 minutes plus tôt', () => {
    render(<Card card={ARBITRATION} api={fakeApi()} />);
    expect(screen.getByText('il y a 12 min')).toBeTruthy();
  });

  it('heures et jours au-delà', () => {
    render(<Card card={QUESTION} api={fakeApi()} />);
    expect(screen.getByText('il y a 2 h')).toBeTruthy();
    cleanup();
    render(<Card card={ACTION} api={fakeApi()} />);
    expect(screen.getByText('il y a 1 j')).toBeTruthy();
  });

  it('sans createdAt (item de contrat), pas d’âge', () => {
    render(<Card card={ITEM} api={fakeApi()} />);
    expect(screen.queryByText(/il y a|à l’instant/)).toBeNull();
  });

  it('formatAge : moins d’une minute → « à l’instant »', () => {
    expect(formatAge('2026-10-14T09:59:30Z', Date.now())).toBe('à l’instant');
  });
});

describe('Card repliée — en-tête', () => {
  it('type, titre, numéro d’issue et badge de réversibilité ; repliée par défaut', () => {
    render(<Card card={ARBITRATION} api={fakeApi()} />);
    const article = screen.getByRole('article');
    expect(article.getAttribute('aria-expanded')).toBe('false');
    expect(within(article).getByText('Arbitrage')).toBeTruthy();
    expect(within(article).getByRole('heading', { level: 3 }).textContent).toBe(ARBITRATION.title);
    expect(within(article).getByText('#42')).toBeTruthy();
    expect(within(article).getByText('Irréversible')).toBeTruthy();
    cleanup();
    render(<Card card={DECISION} api={fakeApi()} />);
    expect(screen.getByText('Réversible')).toBeTruthy();
  });

  it('un clic sur l’en-tête déplie, un second replie', async () => {
    const user = userEvent.setup();
    render(<Card card={DECISION} api={fakeApi()} />);
    const article = screen.getByRole('article');
    await user.click(within(article).getByRole('heading', { level: 3 }));
    expect(article.getAttribute('aria-expanded')).toBe('true');
    await user.click(within(article).getByRole('heading', { level: 3 }));
    expect(article.getAttribute('aria-expanded')).toBe('false');
  });
});
