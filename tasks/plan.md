# Plan d'implémentation — Jalon 1 (Software Factory)

> Écrit le 13 octobre 2026 à partir des cinq specs approuvées (`docs/spec/`). Statut : **approuvé** le 13 octobre 2026.
> Liste de tâches : `tasks/todo.md` jusqu'à ce que la boucle tourne ; ensuite le projet est dogfoodé, et les tâches suivantes deviennent des issues GitHub du dépôt lui-même.

## Vue d'ensemble

Construire, dans l'ordre de la carte des capacités, les cinq modules qui font traverser à une issue les cinq phases via une boîte à trois files. Chaque phase du plan se termine par un point de contrôle vérifiable sans interface : le premier jalon visible est « un contrat écrit à la main dans une vraie issue est relu sans erreur », le second « un run de cadrage réel émet une carte et reprend », le troisième « la boucle tourne depuis la ligne de commande », le dernier « la boucle tourne depuis l'app ».

## Décisions d'architecture (rappel)

- Monorepo pnpm : `packages/conventions`, `packages/skills`, `packages/agent-adapter`, `packages/orchestrator`, `apps/desktop`. Tests Vitest partout, CI GitHub Actions sur ce dépôt.
- Aucun paquet hors `apps/desktop` n'importe Electron ; aucun paquet hors `agent-adapter/src/claude` n'importe le SDK.
- Fonctions pures testées sur fixtures (`parse*`, `translate`, `reconcile`) ; effets isolés dans des modules fins.
- `proven` n'est jamais écrit par l'agent.

## Actions qui te reviennent (file Agir du plan)

| # | Action | Quand |
|---|---|---|
| A1 | Créer le dépôt GitHub public et pousser : `gh repo create fabpl/software-factory --public --source=. --push` | Avant la tâche 1 (la CI et le dogfooding en dépendent). Je ne le fais pas sans ton oui. |
| A2 | Vérifier `gh auth status` et `gh auth setup-git` | Avant la phase 3 |
| A3 | Claude Code connecté sur la machine | Avant la tâche 13 (test live) |
| A4 | Écrire à la main une issue de test avec intention + contrat + carte | Point de contrôle 1 |
| A5 | Dogfooding : une issue réelle de l'intention au verdict depuis l'app, sorties comptées | Point de contrôle 4 |

## Graphe de dépendances

```
T0 racine monorepo ── A1 dépôt GitHub + CI
   │
   ├── conventions (T2–T6) ──┬── skills (T7–T9) ──────────┐
   │                         │                            ├── orchestrator (T14–T20) ── inbox (T21–T26)
   │                         └── agent-adapter (T10–T13) ─┘
```

skills et agent-adapter sont parallélisables après le point de contrôle 1.

## Liste des tâches

### Phase 0 — Fondations
- [x] T0 Racine du monorepo (pnpm, tsconfig, eslint + prettier, vitest, CI, NOTICE, README minimal)
- [ ] A1 Dépôt GitHub créé, CI verte sur un commit vide de tests

### Phase 1 — `conventions`
- [ ] T2 Étiquettes et transitions de phase
- [ ] T3 Contrat : parse, serialize, aller-retour, tolérance, refus
- [ ] T4 Cartes et réponses
- [ ] T5 Preuves et bloc de run (autorité sur `proven`)
- [ ] T6 ADR : gabarit et numérotation
- [ ] T6b Script `pnpm conventions:check <issue>` qui lit une issue réelle via `gh api` et affiche le contrat parsé

### Point de contrôle 1
- [ ] CI verte ; A4 faite ; `conventions:check` relit l'issue manuscrite sans erreur ; couverture 100 % branches `parse*`/`serialize*`

### Phase 2 — `skills` ∥ `agent-adapter`
- [ ] T7 Chargeur de skills : front matter, changelog, attribution, `inject`
- [ ] T8 `skills/framing/SKILL.md` adaptée
- [ ] T9 `skills/implementation/SKILL.md` adaptée
- [ ] T10 `FactoryEvent`, `RunSpec`, adaptateur `fake` + scénario
- [ ] T11 Adaptateur Claude : `buildOptions`, serveur MCP `factory`, `policy`
- [ ] T12 Hooks `defer`/`allow`/`deny` et `translate` sur fixtures
- [ ] T13 Test live : carte → `run.waiting` → reprise → `run.finished` ; fixtures `SDKMessage` enregistrées

### Point de contrôle 2
- [ ] T13 passé une fois à la main avec la skill `framing` réelle sur une issue de ce dépôt ; CI verte ; `grep claude-agent-sdk` ne sort que `src/claude/`

### Phase 3 — `orchestrator`
- [ ] T14 `auth.ts` (gh) et lecture GitHub avec ETag (msw)
- [ ] T15 Écritures GitHub idempotentes : étiquettes, commentaires, contrat, preuves, bloc de run
- [ ] T16 `state.ts` + `reconcile.ts` lignes cadrage et verrou
- [ ] T17 `reconcile.ts` lignes implémentation, CI, verdict
- [ ] T18 `worktree.ts` (simple-git)
- [ ] T19 Les cinq handlers
- [ ] T20 Boucle de tick, API `Orchestrator`, journal JSONL, scénario complet avec redémarrage simulé
- [ ] T20b Entrée CLI `pnpm factory tick|start-framing <issue>|answer <card> <choice>` pour piloter sans interface

### Point de contrôle 3 — « la boucle tourne sans interface »
- [ ] Une issue réelle de ce dépôt passe `intent → framing → implementation → evidence → verdict` via la CLI ; redémarrage en plein run = une seule carte « Run interrompu » ; tick sans changement = zéro appel comptabilisé

### Phase 4 — `inbox`
- [ ] T21 Squelette Electron : main, preload, renderer, pont IPC, écran `blocked`
- [ ] T22 Colonnes et cartes avec zones de réponse, tests composants sur fixtures
- [ ] T23 Barre latérale : dépôt, nouvelle intention, tâches par phase, run en cours
- [ ] T24 Barre de menus, badge, notifications, fermeture et sortie propre
- [ ] T25 E2E Playwright en mode `fake`
- [ ] T26 Construction `.dmg`

### Point de contrôle 4 — Jalon 1
- [ ] A5 faite ; sorties de l'app comptées dans l'issue ; les cinq critères de succès de `SPEC-inbox` cochés ; README avec manifeste et compteur

## Risques

| Risque | Impact | Parade |
|---|---|---|
| `defer` ignoré si l'agent fait plusieurs appels d'outil dans le tour | Moyen | Skill impose un seul appel ; repli `close()` spécifié ; T13 le vérifie |
| Forme de `SDKMessage` changeante entre versions du SDK | Moyen | Version épinglée ; fixtures enregistrées ; `translate` pur |
| Reprise de session impossible (session expirée, worktree supprimé) | Faible | Run neuf avec contrat + carte répondue en contexte, spécifié |
| Quota GitHub en sondage | Faible | ETag partout ; critère de succès « zéro appel comptabilisé » |
| Skill de cadrage qui converge mal (plus de 12 cartes) | Moyen | Carte `action` « cadrage non convergent » ; mesurer sur trois issues |
| Pas de CI sur le dépôt cible | Moyen | Carte `action` « Aucune CI configurée » ; ce dépôt en a une dès T0 |
| Electron + SDK en process : incompatibilités de version Node | Moyen | T21 vérifie tôt que `query()` tourne dans le process principal ; sinon process utilitaire Node séparé (décision à carte) |

## Questions tranchées à l'approbation

1. Lint : eslint + prettier.
2. Dépôt public dès A1, README « en construction ».
