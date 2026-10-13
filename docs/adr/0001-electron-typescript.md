# ADR 0001 — Electron + TypeScript

**Statut :** accepté — 13 octobre 2026
**Origine :** cadrage (entretien d'intention, question 6)
**Réversibilité :** faible après le jalon 1

## Question

Avec quoi construire l'app desktop macOS ?

## Contexte

L'app doit lire et écrire GitHub, lancer des processus Claude Code en mode non interactif (JSON), créer des worktrees Git, envoyer des notifications. macOS seul en V1, portage Windows/Linux à garder faisable. Pas de terminal interactif, pas de service en arrière-plan en V1.

## Options

| Option | Pour | Contre |
|---|---|---|
| **A. Electron + TypeScript** | SDK Claude Code en TypeScript ; pilotage de processus simple en Node ; portage Linux facile | Poids de l'app ; moins démonstratif |
| B. Tauri + Rust | Léger ; démonstratif | Pilotage de processus et adaptateurs d'agents plus coûteux ; apprentissage Rust ralentit le jalon 1 |
| C. Serveur Node local + navigateur | Encore plus simple | Notifications et menu bar moins naturels ; « pas une app » pour la vitrine |

## Décision

**A.** Le jalon 1 est « la boucle tourne ». Tout ce qui la ralentit est un coût. Le choix n'a pas été fait pour la vitrine mais pour livrer.

## Conséquences

- Règle maintenue : tout ce qui lance des processus ou manipule des fichiers passe par TypeScript, jamais par des scripts shell.
- Coût d'un changement d'avis : réécriture de la couche interface et du lanceur de processus. Les modules orchestrateur et adaptateur d'agent doivent rester sans dépendance à Electron pour limiter ce coût.
