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
import type { RunView } from '@factory/orchestrator';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App';
import { LOADED } from '../src/renderer/fixtures/loaded';
import {
  CI_LABELS,
  EVENT_LABELS,
  ITEM_STATUS_LABELS,
  NEED_LABELS,
  PHASE_LABELS,
  formatDuration,
  formatSkill,
  formatStartBlocker,
} from '../src/renderer/labels';
import { fakeApi } from './fakes';

afterEach(cleanup);

const EVENT_TYPES: RunView['lastEvent']['type'][] = [
  'run.started',
  'agent.message',
  'agent.tool',
  'card.emitted',
  'contract.updated',
  'evidence.updated',
  'adr.requested',
  'run.waiting',
  'run.finished',
  'run.failed',
];

const TOKENS = [
  ...EVENT_TYPES,
  'none',
  'pending',
  'green',
  'red',
  'draft',
  'merged',
  'active',
  'failed',
  'run:active',
  'run:failed',
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

  it('chaque type d’événement, phase, besoin, état de CI et statut d’item a un libellé français', () => {
    const types = Object.keys(EVENT_LABELS).sort();
    expect(types).toEqual(EVENT_TYPES.slice().sort());
    const labels = [
      ...Object.values(EVENT_LABELS),
      ...PHASES.map((p) => PHASE_LABELS[p]),
      ...NEEDS.map((n) => NEED_LABELS[n]),
      ...ITEM_STATUSES.map((s) => ITEM_STATUS_LABELS[s]),
      ...Object.values(CI_LABELS),
    ];
    for (const label of labels) {
      expect(label).not.toBe('');
      expect(TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(label))).toEqual([]);
    }
    expect(PHASE_LABELS.implementation).toBe('Implémentation');
    expect(EVENT_LABELS['agent.tool']).toBe('Outil utilisé');
  });

  it('raisons de grisage du lancement en français', () => {
    expect(formatStartBlocker({ kind: 'item-not-settled', id: 'H2', status: 'pending' })).toBe(
      'H2 à valider',
    );
    expect(formatStartBlocker({ kind: 'item-not-settled', id: 'C3', status: 'discussing' })).toBe(
      'C3 à discuter',
    );
    expect(formatStartBlocker({ kind: 'no-validated-criterion' })).toBe('Aucun critère validé');
  });

  it('formatDuration : minutes puis heures et minutes', () => {
    const start = '2026-10-14T09:40:00Z';
    const at = (iso: string) => Date.parse(iso);
    expect(formatDuration(start, at('2026-10-14T09:40:30Z'))).toBe('moins d’une minute');
    expect(formatDuration(start, at('2026-10-14T10:00:00Z'))).toBe('20 min');
    expect(formatDuration(start, at('2026-10-14T11:45:00Z'))).toBe('2 h 05 min');
  });

  it('formatSkill traduit le nom de la skill et garde la version ; nom inconnu tel quel', () => {
    expect(formatSkill('implementation@0.1.0')).toBe('Implémentation 0.1.0');
    expect(formatSkill('framing@0.2.0')).toBe('Cadrage 0.2.0');
    expect(formatSkill('orchestrator@0.1.0')).toBe('Orchestrateur 0.1.0');
    expect(formatSkill('autre@1.0.0')).toBe('autre 1.0.0');
    expect(formatSkill('framing')).toBe('Cadrage');
  });
});
