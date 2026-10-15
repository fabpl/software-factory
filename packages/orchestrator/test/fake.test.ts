import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapFake, createFake, FAKE_TICK_MS } from '../src/fake/bootstrap.js';
import { greenCiForOpenHeads } from '../src/fake/ci.js';
import { FakeGitHub } from '../src/fake/github.js';
import type { PullData } from '../src/github.js';
import { CARD_TITLES } from '../src/reconcile.js';

const underTmp = (path: string): boolean => !relative(tmpdir(), path).startsWith('..');

const pull = (over: Partial<PullData>): PullData => ({
  number: 2,
  title: '#1 Titre',
  body: '',
  draft: true,
  headRef: 'factory/1-titre',
  headSha: 'sha1',
  merged: false,
  state: 'open',
  url: 'https://github.test/acme/widget/pull/2',
  ...over,
});

describe('CI simulée (D3)', () => {
  it('verte dès lecture pour la tête d’une PR ouverte', () => {
    expect(greenCiForOpenHeads('sha1', [pull({})])).toEqual({
      url: 'https://github.test/acme/widget/actions/runs/sha1',
      status: 'completed',
      conclusion: 'success',
    });
  });

  it('absente pour un SHA sans PR ouverte', () => {
    expect(greenCiForOpenHeads('sha9', [pull({})])).toBeUndefined();
    expect(greenCiForOpenHeads('sha1', [pull({ state: 'closed' })])).toBeUndefined();
    expect(greenCiForOpenHeads('sha1', [])).toBeUndefined();
  });

  it('branchée sur un FakeGitHub, elle remplace `ciRuns` ; sans elle, `ciRuns` fait foi', async () => {
    const plain = new FakeGitHub();
    const { headSha } = await plain.createDraftPull({
      head: 'b',
      base: 'main',
      title: 't',
      body: '',
    });
    expect(await plain.latestCiRun(headSha)).toBeUndefined();

    const fake = new FakeGitHub({ ciRule: greenCiForOpenHeads });
    const opened = await fake.createDraftPull({ head: 'b', base: 'main', title: 't', body: '' });
    expect(await fake.latestCiRun(opened.headSha)).toMatchObject({ conclusion: 'success' });
  });
});

describe('bootstrapFake (mode fake de l’app)', () => {
  it('hermétique : GitHub en mémoire, origin et userData sous os.tmpdir(), issue #1 en intent', async () => {
    const fake = await createFake();
    expect(fake.github).toBeInstanceOf(FakeGitHub);
    expect(underTmp(fake.repo.remote)).toBe(true);
    expect(underTmp(fake.repo.userData)).toBe(true);
    expect(fake.orchestrator.getState().repo.path.startsWith(fake.repo.userData)).toBe(true);
    expect(fake.github.issues.get(1)).toMatchObject({ labels: ['phase:intent'] });
    await fake.orchestrator.tick();
    expect(fake.orchestrator.getState().tasks).toMatchObject([{ issue: 1, phase: 'intent' }]);
  });

  it('ignore le dossier maison reçu et tique toutes les 500 ms', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const orchestrator = await bootstrapFake({ userData: join('/nulle-part', 'home') });
    expect(underTmp(orchestrator.getState().repo.path)).toBe(true);
    orchestrator.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), FAKE_TICK_MS);
    expect(FAKE_TICK_MS).toBe(500);
    await orchestrator.stop();
    spy.mockRestore();
  });

  // Même ordre que `apps/desktop/e2e/full-loop.spec.ts` (C1, H4 amendés par la carte card-5) : une
  // carte ouverte bloque le passage en `evidence`, « Nom du module » est donc gardée.
  it('la boucle du test E2E mène à « Fusionner la PR » une fois la décision « Nom du module » gardée', async () => {
    const { orchestrator: o, github } = await createFake();
    const answer = async (title: string, letter: string): Promise<void> => {
      const card = o.getState().arbitrate.find((c) => c.title === title);
      if (!card) throw new Error(`carte « ${title} » absente`);
      await o.answerCard(card.id, {
        cardId: card.id,
        choice: { kind: 'option', letter },
        text: '',
      });
      await o.waitForRun();
    };
    await o.tick();
    await o.startFraming(1);
    await o.waitForRun();
    await answer("Où stocker l'état ?", 'B');
    await answer("Faut-il une capture d'écran ?", 'A');
    for (const id of ['H2', 'D1', 'C1', 'C2']) await o.validateItem(1, id, 'validated');
    await o.startImplementation(1);
    await o.waitForRun();
    await answer('Nouvelle dépendance de production', 'B');
    const decision = o.getState().validate.find((c) => c.title === 'Nom du module');
    await o.answerCard(decision?.id ?? '', {
      cardId: decision?.id ?? '',
      choice: { kind: 'keep' },
      text: '',
    });
    await o.waitForRun();
    const pr = github.pulls[0]?.number ?? 0;
    await o.markEvidenceReviewed(pr, 'C2', 'proven', '');
    for (let i = 0; i < 4; i++) await o.tick();
    expect(o.getState().act.map((c) => c.title)).toEqual([CARD_TITLES.merge]);
    expect(github.pulls[0]?.merged).toBe(false);
  });
});
