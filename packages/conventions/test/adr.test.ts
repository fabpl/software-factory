import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adrFilename, formatAdrNumber, nextAdrNumber, renderAdr, slugify } from '../src/adr.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('renderAdr', () => {
  it("reproduit l'ADR 0001 du dépôt", () => {
    const rendered = renderAdr({
      number: 1,
      title: 'Electron + TypeScript',
      status: 'accepté',
      date: '13 octobre 2026',
      origin: "cadrage (entretien d'intention, question 6)",
      reversibility: 'faible après le jalon 1',
      question: "Avec quoi construire l'app desktop macOS ?",
      context:
        "L'app doit lire et écrire GitHub, lancer des processus Claude Code en mode non interactif (JSON), créer des worktrees Git, envoyer des notifications. macOS seul en V1, portage Windows/Linux à garder faisable. Pas de terminal interactif, pas de service en arrière-plan en V1.",
      options: [
        {
          letter: 'A',
          label: 'Electron + TypeScript',
          pros: 'SDK Claude Code en TypeScript ; pilotage de processus simple en Node ; portage Linux facile',
          cons: "Poids de l'app ; moins démonstratif",
        },
        {
          letter: 'B',
          label: 'Tauri + Rust',
          pros: 'Léger ; démonstratif',
          cons: "Pilotage de processus et adaptateurs d'agents plus coûteux ; apprentissage Rust ralentit le jalon 1",
        },
        {
          letter: 'C',
          label: 'Serveur Node local + navigateur',
          pros: 'Encore plus simple',
          cons: 'Notifications et menu bar moins naturels ; « pas une app » pour la vitrine',
        },
      ],
      chosen: 'A',
      decision:
        "Le jalon 1 est « la boucle tourne ». Tout ce qui la ralentit est un coût. Le choix n'a pas été fait pour la vitrine mais pour livrer.",
      consequences: [
        'Règle maintenue : tout ce qui lance des processus ou manipule des fichiers passe par TypeScript, jamais par des scripts shell.',
        "Coût d'un changement d'avis : réécriture de la couche interface et du lanceur de processus. Les modules orchestrateur et adaptateur d'agent doivent rester sans dépendance à Electron pour limiter ce coût.",
      ],
    });
    expect(rendered).toBe(fixture('adr-0001.md'));
  });

  it('échappe les barres verticales dans les cellules', () => {
    const out = renderAdr({
      number: 2,
      title: 'x',
      status: 's',
      date: 'd',
      origin: 'o',
      reversibility: 'r',
      question: 'q',
      context: 'c',
      options: [{ letter: 'A', label: 'a | b', pros: 'p', cons: 'c' }],
      chosen: 'Z',
      decision: 'dec',
      consequences: [],
    });
    expect(out).toContain('| A. a \\| b | p | c |');
    expect(out).not.toContain('**A.');
  });
});

describe('numérotation', () => {
  it('formate sur quatre chiffres', () => {
    expect(formatAdrNumber(7)).toBe('0007');
    expect(formatAdrNumber(12345)).toBe('12345');
  });

  it('prend le maximum existant + 1, ignore les fichiers étrangers', () => {
    expect(nextAdrNumber([])).toBe(1);
    expect(nextAdrNumber(['0001-a.md', 'README.md', '0007-b.md', 'x-0009.md'])).toBe(8);
  });

  it('construit un slug ASCII', () => {
    expect(slugify('Stockage des sessions : où ?')).toBe('stockage-des-sessions-ou');
    expect(adrFilename(2, 'Électron & co')).toBe('0002-electron-co.md');
  });
});
