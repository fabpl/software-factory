// @vitest-environment jsdom
import type { RunView } from '@factory/orchestrator';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunIndicator } from '../src/renderer/components/RunIndicator';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { fakeApi } from './fakes';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function loadedRun(): RunView {
  if (!LOADED.run) throw new Error('la fixture chargée n’a pas de run');
  return LOADED.run;
}

const RUN = loadedRun();

function indicator(run: RunView | undefined) {
  const api = fakeApi();
  const { container } = render(<RunIndicator run={run} api={api} />);
  return { api, container, user: userEvent.setup() };
}

describe('RunIndicator (H8, C5, C6)', () => {
  it('rien n’est rendu sans run', () => {
    const { container } = indicator(undefined);
    expect(container.innerHTML).toBe('');
  });

  it('issue, skill, résumé du dernier outil et type du dernier événement en français', () => {
    indicator(RUN);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('#42');
    expect(status.textContent).toContain('Implémentation 0.1.0');
    expect(screen.getByText('Colonne.tsx : tranche 2, colonnes')).toBeTruthy();
    expect(screen.getByText('Outil utilisé')).toBeTruthy();
  });

  it('message de l’agent : première ligne seulement ; sans événement d’agent, pas de résumé', () => {
    const message: RunView = {
      ...RUN,
      lastEvent: { type: 'run.started', runId: 'r', sessionId: 's', model: 'm', tools: [] },
      lastAgentEvent: { type: 'agent.message', runId: 'r', text: 'Je lis le contrat.\nPuis…' },
    };
    indicator(message);
    expect(screen.getByText('Je lis le contrat.')).toBeTruthy();
    expect(screen.getByText('Run démarré')).toBeTruthy();
    cleanup();
    indicator({
      issue: message.issue,
      skill: message.skill,
      startedAt: message.startedAt,
      lastEvent: message.lastEvent,
    });
    expect(screen.queryByText('Je lis le contrat.')).toBeNull();
    expect(screen.getByText('Run démarré')).toBeTruthy();
  });

  it('durée du run sur l’horloge fixée (C6)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    indicator(RUN);
    expect(screen.getByText('depuis 20 min')).toBeTruthy();
  });

  it('« Annuler » demande confirmation avant cancelRun (C5)', async () => {
    const { api, user } = indicator(RUN);
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Annuler le run' }));
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
    expect(api.commands.cancelRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Laisser tourner' }));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(api.commands.cancelRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Annuler le run' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    expect(api.commands.cancelRun).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });
});
