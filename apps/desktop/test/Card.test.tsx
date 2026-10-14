// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../src/renderer/components/Card';
import { ACTION, ARBITRATION, DECISION, ITEM, QUESTION } from '../src/renderer/fixtures/loaded';
import { formatAge } from '../src/renderer/labels';
import { fakeApi } from './fakes';

afterEach(cleanup);

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
