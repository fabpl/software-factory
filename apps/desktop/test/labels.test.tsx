// @vitest-environment jsdom
import {
  CARD_KINDS,
  CARD_ORIGINS,
  CARD_STATUSES,
  ITEM_STATUSES,
  NEEDS,
  PHASES,
  REVERSIBILITIES,
} from '@factory/conventions';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { formatSkill } from '../src/renderer/labels';
import { fakeApi } from './fakes';

afterEach(cleanup);

const TOKENS = [
  ...CARD_KINDS,
  ...CARD_STATUSES,
  ...ITEM_STATUSES,
  ...PHASES,
  ...NEEDS,
  ...REVERSIBILITIES,
  ...CARD_ORIGINS,
  'item',
  'evidence',
];

describe('libellés (C5)', () => {
  it('aucun jeton machine anglais dans le texte rendu de la fixture chargée, cartes dépliées', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi(LOADED)} />);
    const articles = await screen.findAllByRole('article');
    expect(articles).toHaveLength(6);
    for (const article of articles) {
      await user.click(within(article).getByRole('heading', { level: 3 }));
      expect(article.getAttribute('aria-expanded')).toBe('true');
    }
    const text = document.body.textContent;
    const found = TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(text));
    expect(found).toEqual([]);
  });

  it('formatSkill traduit le nom de la skill et garde la version ; nom inconnu tel quel', () => {
    expect(formatSkill('implementation@0.1.0')).toBe('Implémentation 0.1.0');
    expect(formatSkill('framing@0.2.0')).toBe('Cadrage 0.2.0');
    expect(formatSkill('orchestrator@0.1.0')).toBe('Orchestrateur 0.1.0');
    expect(formatSkill('autre@1.0.0')).toBe('autre 1.0.0');
    expect(formatSkill('framing')).toBe('Cadrage');
  });
});
