// @vitest-environment jsdom
import type { CardView } from '@factory/orchestrator';
import {
  cleanup,
  render,
  screen,
  within,
  type BoundFunctions,
  type queries,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Card } from '../src/renderer/components/Card';
import { answerButtons } from '../src/renderer/components/CardAnswer';
import {
  ACTION,
  ARBITRATION,
  DECISION,
  EVIDENCE,
  ITEM,
  QUESTION,
} from '../src/renderer/fixtures/loaded';
import { fakeApi, type FakeApi } from './fakes';

afterEach(cleanup);

async function open(card: CardView, api: FakeApi = fakeApi()) {
  const user = userEvent.setup();
  render(<Card card={card} api={api} />);
  const article = screen.getByRole('article');
  expect(within(article).queryByRole('group', { name: 'Réponse' })).toBeNull();
  await user.click(within(article).getByRole('heading', { level: 3 }));
  const zone = within(article).getByRole('group', { name: 'Réponse' });
  return { user, api, article, zone: within(zone) };
}

function button(zone: BoundFunctions<typeof queries>, name: string): HTMLButtonElement {
  return zone.getByRole<HTMLButtonElement>('button', { name });
}

describe('CardAnswer — zone de réponse et commandes (C3, H3)', () => {
  it('question : un bouton par option puis « Autre » ; option → answerCard option', async () => {
    const { user, api, zone } = await open(QUESTION);
    expect(zone.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'ADans la barre de menus',
      'BDans le Dock',
      'CLes deux',
      'DAutre',
    ]);
    await user.type(zone.getByRole('textbox'), 'plutôt ça');
    await user.click(button(zone, 'Dans le Dock'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-1', {
      cardId: 'card-1',
      choice: { kind: 'option', letter: 'B' },
      text: 'plutôt ça',
    });
  });

  it('arbitration : « Autre » désactivé sans note, puis answerCard other avec la note', async () => {
    const { user, api, zone } = await open(ARBITRATION);
    expect(button(zone, 'Autre').disabled).toBe(true);
    await user.type(zone.getByRole('textbox'), '  ');
    expect(button(zone, 'Autre').disabled).toBe(true);
    await user.type(zone.getByRole('textbox'), 'ni l’un ni l’autre');
    await user.click(button(zone, 'Autre'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-5', {
      cardId: 'card-5',
      choice: { kind: 'other' },
      text: 'ni l’un ni l’autre',
    });
  });

  it('arbitration : option sans note → texte vide', async () => {
    const { user, api, zone } = await open(ARBITRATION);
    await user.click(button(zone, 'Ajouter react-markdown'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-5', {
      cardId: 'card-5',
      choice: { kind: 'option', letter: 'A' },
      text: '',
    });
  });

  it('decision : Garder → keep', async () => {
    const { user, api, zone } = await open(DECISION);
    expect(zone.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'AGarder',
      'BRenverser',
    ]);
    await user.click(button(zone, 'Garder'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-4', {
      cardId: 'card-4',
      choice: { kind: 'keep' },
      text: '',
    });
  });

  it('decision : Renverser + « Ça aurait dû me bloquer » ajoute la phrase littérale au texte', async () => {
    const { user, api, zone } = await open(DECISION);
    await user.click(zone.getByRole('checkbox', { name: 'Ça aurait dû me bloquer' }));
    await user.type(zone.getByRole('textbox'), 'le nom est public');
    await user.click(button(zone, 'Renverser'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-4', {
      cardId: 'card-4',
      choice: { kind: 'reverse' },
      text: 'Ça aurait dû me bloquer. le nom est public',
    });
  });

  it('decision : Renverser sans case ni note → texte vide ; Garder ignore la case', async () => {
    const { user, api, zone } = await open(DECISION);
    await user.click(button(zone, 'Renverser'));
    expect(api.commands.answerCard).toHaveBeenLastCalledWith('card-4', {
      cardId: 'card-4',
      choice: { kind: 'reverse' },
      text: '',
    });
    cleanup();
    const second = await open(DECISION);
    await second.user.click(second.zone.getByRole('checkbox'));
    await second.user.click(button(second.zone, 'Garder'));
    expect(second.api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-4', {
      cardId: 'card-4',
      choice: { kind: 'keep' },
      text: '',
    });
  });

  it('action : « C’est fait » → answerCard done avec la note (pas markActionDone)', async () => {
    const { user, api, zone } = await open(ACTION);
    await user.type(zone.getByRole('textbox'), 'secret ajouté');
    await user.click(button(zone, 'C’est fait'));
    expect(api.commands.answerCard).toHaveBeenCalledExactlyOnceWith('card-6', {
      cardId: 'card-6',
      choice: { kind: 'done' },
      text: 'secret ajouté',
    });
    expect(api.commands.markActionDone).not.toHaveBeenCalled();
  });

  it('item : Valider sans note → validateItem validated', async () => {
    const { user, api, zone } = await open(ITEM);
    expect(zone.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'AValider',
      'BRejeter',
      'CÀ discuter',
    ]);
    await user.click(button(zone, 'Valider'));
    expect(api.commands.validateItem).toHaveBeenCalledExactlyOnceWith(
      44,
      'H2',
      'validated',
      undefined,
    );
  });

  it('item : Rejeter et À discuter désactivés sans note, puis envoyés avec la note', async () => {
    const { user, api, zone } = await open(ITEM);
    expect(button(zone, 'Rejeter').disabled).toBe(true);
    expect(button(zone, 'À discuter').disabled).toBe(true);
    await user.type(zone.getByRole('textbox'), 'trop large');
    await user.click(button(zone, 'Rejeter'));
    expect(api.commands.validateItem).toHaveBeenCalledExactlyOnceWith(
      44,
      'H2',
      'rejected',
      'trop large',
    );
    cleanup();
    const second = await open(ITEM);
    await second.user.type(second.zone.getByRole('textbox'), 'à préciser');
    await second.user.click(button(second.zone, 'À discuter'));
    expect(second.api.commands.validateItem).toHaveBeenCalledExactlyOnceWith(
      44,
      'H2',
      'discussing',
      'à préciser',
    );
  });

  it('preuve : lien vers l’artefact ; Prouvé → markEvidenceReviewed proven', async () => {
    const { user, api, article, zone } = await open(EVIDENCE);
    expect(
      within(article).getByRole('link', { name: 'Voir l’artefact' }).getAttribute('href'),
    ).toBe(EVIDENCE.evidence?.artifactUrl);
    await user.click(button(zone, 'Prouvé'));
    expect(api.commands.markEvidenceReviewed).toHaveBeenCalledExactlyOnceWith(
      43,
      'C1',
      'proven',
      undefined,
    );
  });

  it('preuve : Bloqué désactivé sans note, puis envoyé avec la note', async () => {
    const { user, api, zone } = await open(EVIDENCE);
    expect(button(zone, 'Bloqué').disabled).toBe(true);
    expect(button(zone, 'Prouvé').disabled).toBe(false);
    await user.type(zone.getByRole('textbox'), 'capture floue');
    await user.click(button(zone, 'Bloqué'));
    expect(api.commands.markEvidenceReviewed).toHaveBeenCalledExactlyOnceWith(
      43,
      'C1',
      'blocked',
      'capture floue',
    );
  });

  it('item ou preuve sans données associées : aucun bouton', () => {
    const bareItem: CardView = { ...ITEM };
    delete bareItem.item;
    const bareEvidence: CardView = { ...EVIDENCE };
    delete bareEvidence.evidence;
    expect(answerButtons(bareItem)).toEqual([]);
    expect(answerButtons(bareEvidence)).toEqual([]);
  });
});

describe('Card dépliée — corps', () => {
  it('contexte rendu, options avec conséquence et « Recommandé », méta-données, lien GitHub', async () => {
    const { article } = await open(ARBITRATION);
    const body = within(article);
    expect(body.getByText('analyseur Markdown').tagName).toBe('STRONG');
    expect(body.getByText('Une dépendance de plus.')).toBeTruthy();
    expect(body.getByText('Recommandé')).toBeTruthy();
    expect(body.getByText('Le contexte est écrit en Markdown.')).toBeTruthy();
    expect(body.getByText('Moyen : remplacer le composant de rendu.')).toBeTruthy();
    expect(body.getByText('Implémentation')).toBeTruthy();
    expect(body.getByText('implementation@0.1.0')).toBeTruthy();
    expect(body.getByRole('link', { name: 'Ouvrir dans GitHub' }).getAttribute('href')).toBe(
      ARBITRATION.url,
    );
  });

  it('carte sans url, ni coût, ni origine : rien de tout cela n’est affiché', async () => {
    const bare: CardView = { ...ITEM };
    delete bare.url;
    const { article } = await open(bare);
    expect(within(article).queryByRole('link', { name: 'Ouvrir dans GitHub' })).toBeNull();
    expect(within(article).queryByText('Coût d’un changement d’avis')).toBeNull();
    expect(within(article).queryByText('Origine')).toBeNull();
  });
});
