import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canStartImplementation,
  nextItemId,
  parseContract,
  serializeContract,
  writeContract,
  type Contract,
} from '../src/contract.js';
import { findDelimitedBlock } from '../src/block.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function parsed(name: string): Contract {
  const r = parseContract(fixture(name));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe('parseContract', () => {
  it('lit la fixture complète', () => {
    const c = parsed('contract-full.md');
    expect(c.version).toBe(3);
    expect(c.skill).toBe('framing@0.1.0');
    expect(c.items.map((i) => [i.id, i.kind, i.status])).toEqual([
      ['H1', 'hypothesis', 'validated'],
      ['H2', 'hypothesis', 'pending'],
      ['D1', 'decision', 'validated'],
      ['D2', 'decision', 'discussing'],
      ['C1', 'criterion', 'pending'],
      ['C2', 'criterion', 'rejected'],
    ]);
    expect(c.items[2]?.note).toBe('carte #3');
    expect(c.items[4]?.plannedProof).toBe('test `contract.roundtrip` vert en CI.');
  });

  it('lit un contrat vide', () => {
    expect(parsed('contract-empty.md').items).toEqual([]);
  });

  it('tolère les espaces, lignes vides et sections collées ; la case cochée l’emporte', () => {
    const c = parsed('contract-handedited.md');
    expect(c.version).toBe(2);
    expect(c.items.map((i) => [i.id, i.status])).toEqual([
      ['H1', 'validated'],
      ['H2', 'pending'],
      ['C1', 'validated'],
    ]);
  });

  it('signale l’absence de bloc', () => {
    expect(parseContract('Juste une intention.')).toEqual({
      ok: false,
      error: { kind: 'missing' },
    });
    expect(
      parseContract('<!-- factory:contract version=1 skill=f@0.1.0 -->\nsans fermeture'),
    ).toEqual({
      ok: false,
      error: { kind: 'missing' },
    });
  });

  const wrap = (inner: string, attrs = 'version=1 skill=framing@0.1.0') =>
    `<!-- factory:contract ${attrs} -->\n## Contrat\n${inner}\n<!-- /factory:contract -->`;

  it('refuse les attributs invalides', () => {
    expect(parseContract(wrap('', 'version=0 skill=framing@0.1.0'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-attrs', detail: 'version=0' },
    });
    expect(parseContract(wrap('', 'skill=framing@0.1.0'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-attrs', detail: 'version=' },
    });
    expect(parseContract(wrap('', 'version=1'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-attrs', detail: 'skill=' },
    });
    expect(parseContract(wrap('', 'version=1 skill=framing'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-attrs', detail: 'skill=framing' },
    });
  });

  it('refuse une section inconnue et un item hors section', () => {
    expect(parseContract(wrap('### Autre'))).toMatchObject({
      ok: false,
      error: { kind: 'unknown-section', line: '### Autre' },
    });
    expect(parseContract(wrap('- [ ] **H1** — x `pending`'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-line' },
    });
  });

  it('refuse une ligne mal formée', () => {
    expect(parseContract(wrap('### Hypothèses\n- H1 sans format'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-line', line: '- H1 sans format' },
    });
  });

  it('refuse un statut inconnu, un doublon, un identifiant dans la mauvaise section', () => {
    expect(parseContract(wrap('### Hypothèses\n- [ ] **H1** — x `maybe`'))).toEqual({
      ok: false,
      error: { kind: 'unknown-status', id: 'H1', status: 'maybe' },
    });
    expect(
      parseContract(wrap('### Hypothèses\n- [ ] **H1** — x `pending`\n- [ ] **H1** — y `pending`')),
    ).toEqual({ ok: false, error: { kind: 'duplicate-id', id: 'H1' } });
    expect(parseContract(wrap('### Décisions\n- [ ] **H1** — x `pending`'))).toEqual({
      ok: false,
      error: { kind: 'id-kind-mismatch', id: 'H1', section: 'decision' },
    });
  });

  it('refuse un critère sans preuve prévue', () => {
    expect(parseContract(wrap("### Critères d'acceptation\n- [ ] **C1** — x `pending`"))).toEqual({
      ok: false,
      error: { kind: 'criterion-without-proof', id: 'C1' },
    });
    // Une ligne « Preuve prévue » hors critère est une ligne mal formée.
    expect(parseContract(wrap('### Hypothèses\n  Preuve prévue : x'))).toMatchObject({
      ok: false,
      error: { kind: 'bad-line' },
    });
  });
});

describe('serializeContract', () => {
  it('fait l’aller-retour exact sur la fixture complète', () => {
    const body = fixture('contract-full.md');
    const block = findDelimitedBlock(body, 'contract');
    expect(block).toBeDefined();
    const original = body.slice(block?.start, block?.end);
    expect(serializeContract(parsed('contract-full.md'))).toBe(original);
  });

  it('normalise un contrat édité à la main', () => {
    const out = serializeContract(parsed('contract-handedited.md'));
    expect(out).toContain('- [x] **H1** — Cochée à la main, jeton encore pending. `validated`');
    expect(out).toContain('- [ ] **H2** — Décochée à la main, jeton encore validated. `pending`');
    const again = parseContract(out);
    expect(again.ok).toBe(true);
  });
});

describe('serializeContract sur un objet construit', () => {
  it('rend une preuve prévue vide pour un critère incomplet (sera refusé à la relecture)', () => {
    const out = serializeContract({
      version: 1,
      skill: 'framing@0.1.0',
      items: [{ id: 'C1', kind: 'criterion', text: 'x', status: 'pending' }],
    });
    expect(out).toContain('  Preuve prévue : \n');
    expect(parseContract(out)).toMatchObject({ ok: false, error: { kind: 'bad-line' } });
  });
});

describe('writeContract', () => {
  it('remplace le bloc sans toucher au reste du corps', () => {
    const body = fixture('contract-full.md');
    const c = parsed('contract-full.md');
    c.version = 4;
    const out = writeContract(body, c);
    expect(out.startsWith("Je veux que l'app lise")).toBe(true);
    expect(out.endsWith("Note ajoutée après coup par l'humain.\n")).toBe(true);
    expect(out).toContain('version=4');
    expect(out).not.toContain('version=3');
  });

  it('ajoute le bloc à la fin d’un corps qui n’en a pas, ou dans un corps vide', () => {
    const c: Contract = { version: 1, skill: 'framing@0.1.0', items: [] };
    const out = writeContract('Intention.\n\n', c);
    expect(out).toBe(`Intention.\n\n${serializeContract(c)}\n`);
    expect(writeContract('', c)).toBe(`${serializeContract(c)}\n`);
  });
});

describe('canStartImplementation', () => {
  it('liste les bloqueurs', () => {
    const r = canStartImplementation(parsed('contract-full.md'));
    expect(r).toEqual({
      ok: false,
      error: [
        { kind: 'item-not-settled', id: 'H2', status: 'pending' },
        { kind: 'item-not-settled', id: 'D2', status: 'discussing' },
        { kind: 'item-not-settled', id: 'C1', status: 'pending' },
        { kind: 'no-validated-criterion' },
      ],
    });
  });

  it('accepte un contrat réglé avec un critère validé', () => {
    const c = parsed('contract-handedited.md');
    const h2 = c.items.find((i) => i.id === 'H2');
    if (h2) h2.status = 'rejected';
    expect(canStartImplementation(c)).toEqual({ ok: true, value: true });
  });
});

describe('nextItemId', () => {
  it('ne réutilise jamais un identifiant', () => {
    const c = parsed('contract-full.md');
    expect(nextItemId(c, 'hypothesis')).toBe('H3');
    expect(nextItemId(c, 'decision')).toBe('D3');
    expect(nextItemId(c, 'criterion')).toBe('C3');
    expect(nextItemId({ version: 1, skill: 'f@0.0.1', items: [] }, 'criterion')).toBe('C1');
  });
});
