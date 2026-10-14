// @vitest-environment jsdom
import type { InboxState, TaskView } from '@factory/orchestrator';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { Sidebar } from '../src/renderer/components/Sidebar';
import { BLOCKED } from '../src/renderer/fixtures/blocked';
import { EMPTY } from '../src/renderer/fixtures/empty';
import { LOADED } from '../src/renderer/fixtures/loaded';
import { fakeApi, inboxState } from './fakes';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function task(issue: number): TaskView {
  const found = LOADED.tasks.find((t) => t.issue === issue);
  if (!found) throw new Error(`tâche #${String(issue)} absente de la fixture`);
  return found;
}

function sidebar(state: InboxState = LOADED) {
  const api = fakeApi(state);
  render(<Sidebar state={state} api={api} />);
  return {
    api,
    user: userEvent.setup(),
    bar: screen.getByRole('complementary', { name: 'Tâches' }),
  };
}

/** Déplie une tâche et renvoie sa zone de détail. */
async function expand(user: ReturnType<typeof userEvent.setup>, issue: number) {
  const toggle = screen.getByRole('button', { name: new RegExp(`^#${String(issue)} `) });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  return within(screen.getByRole('group', { name: `#${String(issue)}` }));
}

describe('fixtures de la barre (C1)', () => {
  it('la fixture chargée a une tâche par phase, un cadrage incomplet et un run sur agent.tool', () => {
    expect(LOADED.tasks.map((t) => t.phase).sort()).toEqual(
      ['evidence', 'framing', 'implementation', 'intent', 'verdict'].sort(),
    );
    expect(LOADED.tasks.find((t) => t.phase === 'framing')?.startBlockers.length).toBeGreaterThan(
      0,
    );
    expect(LOADED.run?.lastEvent.type).toBe('agent.tool');
    expect(LOADED.run?.lastAgentEvent?.type).toBe('agent.tool');
  });

  it.each([
    ['vide', EMPTY],
    ['chargée', LOADED],
    ['bloquée', BLOCKED],
  ] as const)('la fixture %s rend App avec la barre', async (_name, state) => {
    render(<App api={fakeApi(state)} />);
    expect(await screen.findByRole('complementary', { name: 'Tâches' })).toBeTruthy();
  });
});

describe('Sidebar — phases et tâches (H6)', () => {
  it('cinq phases toujours affichées dans l’ordre, avec leur compte', () => {
    sidebar(EMPTY);
    const phases = screen.getAllByRole('button', { expanded: true }).map((b) => b.textContent);
    expect(phases).toEqual(['Intention0', 'Cadrage0', 'Implémentation0', 'Preuves0', 'Verdict0']);
  });

  it('une phase se replie et se déplie', async () => {
    const { user } = sidebar();
    const framing = screen.getByRole('button', { name: /^Cadrage/ });
    expect(screen.getByRole('list', { name: 'Cadrage' })).toBeTruthy();
    await user.click(framing);
    expect(framing.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Cadrage' })).toBeNull();
    await user.click(framing);
    expect(screen.getByRole('list', { name: 'Cadrage' })).toBeTruthy();
  });

  it('les tâches d’une phase gardent l’ordre reçu', () => {
    const a = { ...task(42), issue: 50, title: 'Zèbre' };
    const b = { ...task(42), issue: 51, title: 'Abeille' };
    sidebar(inboxState({ tasks: [a, b] }));
    const list = screen.getByRole('list', { name: 'Implémentation' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Zèbre'), expect.stringContaining('Abeille')]);
  });

  it('dépôt, verrou et PR en français', () => {
    const { bar } = sidebar();
    expect(bar.textContent).toContain('acme/widget');
    expect(within(bar).getByTitle(LOADED.repo.path)).toBeTruthy();
    const impl = within(screen.getByRole('list', { name: 'Implémentation' }));
    expect(impl.getByText('Run en cours')).toBeTruthy();
    expect(impl.getByText('PR #43 · brouillon')).toBeTruthy();
    expect(impl.getByText('CI en cours')).toBeTruthy();
    expect(impl.getByText('À arbitrer')).toBeTruthy();
    const evidence = within(screen.getByRole('list', { name: 'Preuves' }));
    expect(evidence.getByText('PR #39 · prête')).toBeTruthy();
    expect(evidence.getByText('CI verte')).toBeTruthy();
    const verdict = within(screen.getByRole('list', { name: 'Verdict' }));
    expect(verdict.getByText('Run interrompu')).toBeTruthy();
    expect(verdict.getByText('PR #37 · fusionnée')).toBeTruthy();
    expect(verdict.getByText('CI rouge')).toBeTruthy();
  });
});

describe('Sidebar — actions contextuelles (C2, C3, C4)', () => {
  it('intention : « Lancer le cadrage » → startFraming(n) ; lien GitHub vers TaskView.url', async () => {
    const { api, user } = sidebar();
    const detail = await expand(user, 46);
    expect(detail.getByRole('link', { name: 'Ouvrir dans GitHub' }).getAttribute('href')).toBe(
      task(46).url,
    );
    await user.click(detail.getByRole('button', { name: 'Lancer le cadrage' }));
    expect(api.commands.startFraming).toHaveBeenCalledExactlyOnceWith(46);
  });

  it('cadrage complet : « Lancer l’implémentation » → startImplementation(n)', async () => {
    const ready = { ...task(44), startBlockers: [] };
    const { api, user } = sidebar(inboxState({ tasks: [ready] }));
    const detail = await expand(user, 44);
    await user.click(detail.getByRole('button', { name: 'Lancer l’implémentation' }));
    expect(api.commands.startImplementation).toHaveBeenCalledExactlyOnceWith(44);
  });

  it('cadrage incomplet : bouton grisé, raisons en français, aucun jeton de statut (C3)', async () => {
    const { api, user, bar } = sidebar();
    const detail = await expand(user, 44);
    const start = detail.getByRole<HTMLButtonElement>('button', {
      name: 'Lancer l’implémentation',
    });
    expect(start.disabled).toBe(true);
    expect(detail.getByText('H2 à valider')).toBeTruthy();
    expect(detail.getByText('C3 à discuter')).toBeTruthy();
    expect(bar.textContent).not.toMatch(/\b(pending|discussing)\b/);
    await user.click(start);
    expect(api.commands.startImplementation).not.toHaveBeenCalled();
  });

  it('« Renvoyer en cadrage » grisé tant que le motif est vide ou blanc (C4)', async () => {
    const { api, user } = sidebar();
    const detail = await expand(user, 42);
    const send = detail.getByRole<HTMLButtonElement>('button', { name: 'Renvoyer en cadrage' });
    expect(send.disabled).toBe(true);
    const motif = detail.getByRole('textbox', { name: 'Motif' });
    await user.type(motif, '   ');
    expect(send.disabled).toBe(true);
    await user.type(motif, 'le critère C2 est faux ');
    expect(send.disabled).toBe(false);
    await user.click(send);
    expect(api.commands.sendBackToFraming).toHaveBeenCalledExactlyOnceWith(
      42,
      'le critère C2 est faux',
    );
  });

  it('preuves et verdict proposent aussi le renvoi en cadrage ; une tâche se replie', async () => {
    const { user } = sidebar();
    for (const issue of [38, 36]) {
      const detail = await expand(user, issue);
      expect(detail.getByRole('button', { name: 'Renvoyer en cadrage' })).toBeTruthy();
    }
    await user.click(screen.getByRole('button', { name: /^#36 / }));
    expect(screen.queryByRole('group', { name: '#36' })).toBeNull();
  });

  it('« Rafraîchir » → refresh()', async () => {
    const { api, user } = sidebar();
    await user.click(screen.getByRole('button', { name: 'Rafraîchir' }));
    expect(api.commands.refresh).toHaveBeenCalledExactlyOnceWith();
  });

  it('une commande refusée affiche l’erreur dans un toast', async () => {
    const api = fakeApi(LOADED);
    api.commands.startFraming.mockRejectedValueOnce(new Error('passage interdit'));
    api.commands.refresh.mockRejectedValueOnce('hors ligne');
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.click(await screen.findByRole('button', { name: /^#46 / }));
    await user.click(screen.getByRole('button', { name: 'Lancer le cadrage' }));
    expect(await screen.findByText('Échec de l’envoi : passage interdit')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rafraîchir' }));
    expect(await screen.findByText('Échec de l’envoi : hors ligne')).toBeTruthy();
  });
});

describe('Sidebar — dernière synchro (C6)', () => {
  it('« il y a … » calculé sur l’horloge fixée', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:05:00Z'));
    sidebar(inboxState({ lastSync: new Date('2026-10-14T10:00:00Z') }));
    expect(screen.getByText('Dernière synchronisation il y a 5 min')).toBeTruthy();
  });
});
