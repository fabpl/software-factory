import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCard,
  parseContract,
  parseEvidence,
  type Contract,
  type ContractItem,
} from '@factory/conventions';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkContractItems,
  createHandlers,
  frenchDate,
  HandlerError,
  mergeEvidence,
  type HandlerContext,
} from '../src/handlers.js';
import { createWorktrees, type Worktree, type WorktreePort } from '../src/worktree.js';
import { FakeGitHub } from './fakes/github.js';
import { IDENTITY, tempRepo, type TempRepo } from './fakes/repo.js';
import { ARBITRATION, CONTRACT_FULL, DECISION, QUESTION } from './helpers.js';

const CLOCK = (): Date => new Date('2026-10-13T10:00:00Z');

describe('handlers', () => {
  let repo: TempRepo;
  let worktrees: WorktreePort;
  let github: FakeGitHub;
  let worktree: Worktree;

  const context = (over: Partial<HandlerContext> = {}): HandlerContext => ({
    github,
    worktrees,
    issue: 7,
    title: 'Un titre',
    skill: 'framing@0.1.0',
    origin: 'framing',
    worktree,
    defaultBranch: 'main',
    clock: CLOCK,
    ...over,
  });

  beforeAll(async () => {
    repo = await tempRepo();
    worktrees = createWorktrees({
      root: repo.userData,
      ref: { owner: 'acme', repo: 'widget' },
      cloneUrl: repo.remote,
      identity: IDENTITY,
    });
    github = new FakeGitHub();
    github.addIssue({
      number: 7,
      title: 'Un titre',
      body: 'Intention.\n',
      labels: ['phase:framing'],
    });
    worktree = await worktrees.create(7, 'factory/7-un-titre', 'main');
  });

  it('emit_card en cadrage : carte dans l’issue, identifiant suivant, étiquette needs', async () => {
    github.addComment(7, 'Un commentaire humain, sans marqueur.');
    github.addComment(
      7,
      '<!-- factory:card id=card-4 kind=question origin=framing reversibility=reversible status=answered skill=framing@0.1.0 -->\n### ❓ Question 4 — Vieille carte\n\n**Contexte** — x\n\n**Options**\n- **A.** a\n- **B.** b\n',
    );
    const h = createHandlers(context());
    expect(await h.emit_card(QUESTION)).toEqual({ cardId: 'card-5' });
    const last = github.commentsOf(7).at(-1);
    const card = parseCard(last?.body ?? '');
    expect(card.ok && card.value).toMatchObject({
      id: 'card-5',
      kind: 'question',
      origin: 'framing',
      status: 'open',
      skill: 'framing@0.1.0',
    });
    expect(github.issues.get(7)?.labels).toEqual(['phase:framing', 'needs:arbitration']);
    expect(await h.emit_card({ ...QUESTION, title: 'Autre' })).toEqual({ cardId: 'card-6' });
    expect(github.writes.filter((w) => w.startsWith('labels'))).toHaveLength(1);
    await expect(h.emit_card({ ...QUESTION, options: [] })).rejects.toBeInstanceOf(HandlerError);
    expect(h.pull()).toBeUndefined();
  });

  it('emit_card en implémentation : ouvre la PR brouillon (commit vide + push) puis publie dans la PR', async () => {
    const h = createHandlers(context({ origin: 'implementation', skill: 'implementation@0.1.0' }));
    expect(await h.emit_card(DECISION)).toEqual({ cardId: 'card-7' });
    const pr = h.pull();
    if (!pr) throw new Error('PR attendue');
    expect(pr).toMatchObject({
      number: 8,
      headRef: 'factory/7-un-titre',
      draft: true,
      title: '#7 Un titre',
      body: 'Closes #7',
    });
    expect(await repo.log('factory/7-un-titre')).toEqual(['feat(#7): Nommage', 'chore: seed']);
    expect(github.commentsOf(8)).toHaveLength(1);
    expect(github.issues.get(7)?.labels).toContain('needs:validation');
    // Une PR déjà ouverte est retrouvée, pas recréée.
    const again = createHandlers(
      context({ origin: 'implementation', skill: 'implementation@0.1.0' }),
    );
    expect(await again.emit_card(ARBITRATION)).toEqual({ cardId: 'card-8' });
    expect(github.pulls).toHaveLength(1);
    expect(github.commentsOf(8)).toHaveLength(2);
    // Une PR connue au lancement est utilisée telle quelle.
    const known = createHandlers(context({ origin: 'implementation', pull: pr }));
    expect(known.pull()).toBe(pr);
  });

  it('update_contract : version 1 sur un corps sans bloc, puis incrément, intention intacte', async () => {
    const h = createHandlers(context());
    await h.update_contract({
      items: [{ id: 'H1', kind: 'hypothesis', text: 'Une hypothèse.', status: 'pending' }],
    });
    let body = github.bodyOf(7);
    expect(body.startsWith('Intention.\n')).toBe(true);
    expect(parseContract(body)).toMatchObject({
      ok: true,
      value: { version: 1, skill: 'framing@0.1.0' },
    });
    await h.update_contract({ items: CONTRACT_FULL.items });
    body = github.bodyOf(7);
    expect(parseContract(body)).toMatchObject({ ok: true, value: { version: 2 } });
    expect(body.startsWith('Intention.\n')).toBe(true);
    await expect(h.update_contract({ items: [] })).rejects.toThrow(/item disparu : H1/);
  });

  it('checkContractItems : les refus', () => {
    const ok: ContractItem[] = CONTRACT_FULL.items;
    expect(checkContractItems(undefined, ok)).toBeUndefined();
    expect(
      checkContractItems(undefined, [
        { id: 'X1', kind: 'hypothesis', text: 't', status: 'pending' },
      ]),
    ).toMatch(/invalide/);
    expect(
      checkContractItems(undefined, [{ id: 'H1', kind: 'decision', text: 't', status: 'pending' }]),
    ).toMatch(/incohérent/);
    const h1: ContractItem = { id: 'H1', kind: 'hypothesis', text: 't', status: 'pending' };
    expect(checkContractItems(undefined, [h1, h1])).toMatch(/double/);
    expect(
      checkContractItems(undefined, [
        { id: 'C1', kind: 'criterion', text: 't', status: 'pending' },
      ]),
    ).toMatch(/sans preuve/);
    const rejected: Contract = {
      ...CONTRACT_FULL,
      items: [{ id: 'H1', kind: 'hypothesis', text: 'ancien', status: 'rejected' }],
    };
    expect(
      checkContractItems(rejected, [
        { id: 'H1', kind: 'hypothesis', text: 'nouveau', status: 'rejected' },
      ]),
    ).toMatch(/rejeté/);
    expect(
      checkContractItems(rejected, [
        { id: 'H1', kind: 'hypothesis', text: 'ancien', status: 'validated' },
      ]),
    ).toMatch(/rejeté/);
    expect(
      checkContractItems(rejected, [
        { id: 'H1', kind: 'hypothesis', text: 'ancien', status: 'rejected' },
      ]),
    ).toBeUndefined();
  });

  it('update_evidence : refuse proven, exige un contrat, commit + push, PR brouillon, commentaire réécrit sans doublon', async () => {
    const h = createHandlers(context({ origin: 'implementation', skill: 'implementation@0.1.0' }));
    await expect(
      h.update_evidence({ lines: [{ criterion: 'C1', proof: '[r](https://x)', state: 'proven' }] }),
    ).rejects.toThrow(/preuves refusées/);
    const noContract = new FakeGitHub();
    noContract.addIssue({
      number: 7,
      title: 'Un titre',
      body: 'Rien.',
      labels: ['phase:implementation'],
    });
    const bare = createHandlers(context({ github: noContract, origin: 'implementation' }));
    await expect(bare.update_evidence({ lines: [] })).rejects.toThrow(/aucun contrat/);

    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(worktree.path, 'src.ts'), 'export const a = 1;\n');
    await h.update_evidence({ lines: [{ criterion: 'C1', proof: '`a`', state: 'pending' }] });
    expect(await repo.log('factory/7-un-titre')).toContain('feat(#7): C1');
    const pr = h.pull();
    expect(pr?.number).toBe(8);
    const first = github.commentsOf(8).filter((c) => c.body.includes('factory:evidence'));
    expect(first).toHaveLength(1);
    expect(parseEvidence(first[0]?.body ?? '')).toMatchObject({
      ok: true,
      value: { contract: 2, lines: [{ criterion: 'C1', state: 'pending' }] },
    });

    // L'orchestrateur a marqué C1 proven entre-temps : l'agent ne le rétrograde pas.
    await github.updateComment(
      first[0]?.id ?? 0,
      (first[0]?.body ?? '').replace(
        '| `a` | `pending` |',
        '| [run](https://ci/1) — `a` | `proven` |',
      ),
    );
    await h.update_evidence({
      lines: [
        { criterion: 'C1', proof: '`a`', state: 'pending' },
        { criterion: 'C2', proof: '[c](https://x)', state: 'to-review' },
      ],
    });
    const second = github.commentsOf(8).filter((c) => c.body.includes('factory:evidence'));
    expect(second).toHaveLength(1);
    expect(parseEvidence(second[0]?.body ?? '')).toMatchObject({
      ok: true,
      value: {
        lines: [
          { criterion: 'C1', state: 'proven', proof: '[run](https://ci/1) — `a`' },
          { criterion: 'C2', state: 'to-review' },
        ],
      },
    });
    expect(mergeEvidence(undefined, { lines: [] }, 3, 's@1.0.0')).toEqual({
      contract: 3,
      skill: 's@1.0.0',
      lines: [],
    });
  });

  it('request_adr : numéro réservé, fichier rendu, ligne Tranché, commit poussé', async () => {
    const h = createHandlers(context({ origin: 'implementation', skill: 'implementation@0.1.0' }));
    const input = {
      cardId: 'card-8',
      slug: 'pas-de-dependance',
      title: 'Pas de dépendance',
      origin: 'implémentation (carte card-8)',
      reversibility: 'irréversible',
      question: 'Ajouter une dépendance ?',
      context: 'Bloquant.',
      options: [{ letter: 'B', label: 'Non', pros: 'simple', cons: 'code à écrire' }],
      chosen: 'B',
      decision: 'Code maison.',
      consequences: ['Écrire le parseur.'],
    };
    await h.request_adr(input);
    const file = join(worktree.path, 'docs', 'adr', '0001-pas-de-dependance.md');
    expect(existsSync(file)).toBe(true);
    const adr = readFileSync(file, 'utf8');
    expect(adr).toContain('# ADR 0001 — Pas de dépendance');
    expect(adr).toContain('**Statut :** accepté — 13 octobre 2026');
    expect(await h.read_rules()).toContain(
      '- 2026-10-13 · #7 · Pas de dépendance : Code maison. (ADR 0001, carte card-8)',
    );
    expect(await repo.log('factory/7-un-titre')).toContain('docs(#7): ADR 0001 pas-de-dependance');
    await h.request_adr({ ...input, slug: 'autre', title: 'Autre' });
    expect(existsSync(join(worktree.path, 'docs', 'adr', '0002-autre.md'))).toBe(true);
  });

  it('read_rules vide si le fichier manque', async () => {
    const other = await worktrees.create(9, 'factory/9-x', 'main');
    const h = createHandlers(context({ issue: 9, worktree: other }));
    expect(await h.read_rules()).toBe('');
  });

  it('issue introuvable → erreur typée', async () => {
    const h = createHandlers(context({ issue: 99 }));
    await expect(h.update_contract({ items: [] })).rejects.toBeInstanceOf(HandlerError);
    await expect(h.emit_card(QUESTION)).rejects.toBeInstanceOf(HandlerError);
    const broken = new FakeGitHub();
    broken.addIssue({ number: 7, title: 't', labels: ['phase:framing', 'phase:intent'] });
    await expect(createHandlers(context({ github: broken })).emit_card(QUESTION)).rejects.toThrow(
      /incohérentes/,
    );
    expect(frenchDate(new Date('2026-01-05T00:00:00Z'))).toBe('5 janvier 2026');
  });
});
