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
- [x] A1 Dépôt GitHub créé, CI verte sur un commit vide de tests

### Phase 1 — `conventions`
- [x] T2 Étiquettes et transitions de phase
- [x] T3 Contrat : parse, serialize, aller-retour, tolérance, refus
- [x] T4 Cartes et réponses
- [x] T5 Preuves et bloc de run (autorité sur `proven`)
- [x] T6 ADR : gabarit et numérotation
- [x] T6b Script `pnpm conventions:check <issue>` qui lit une issue réelle via `gh api` et affiche le contrat parsé

### Point de contrôle 1
- [x] CI verte ; A4 faite (issue #1) ; `conventions:check` relit l'issue manuscrite sans erreur ; couverture 100 % branches `parse*`/`serialize*`

### Phase 2 — `skills` ∥ `agent-adapter`
- [x] T7 Chargeur de skills : front matter, changelog, attribution, `inject`
- [x] T8 `skills/framing/SKILL.md` adaptée
- [x] T9 `skills/implementation/SKILL.md` adaptée
- [x] T10 `FactoryEvent`, `RunSpec`, adaptateur `fake` + scénario
- [x] T11 Adaptateur Claude : `buildOptions`, serveur MCP `factory`, `policy`
- [x] T12 Hooks `defer`/`allow`/`deny` et `translate` sur fixtures
- [x] T13 Test live : carte → `run.waiting` → reprise → `run.finished` ; fixtures `SDKMessage` enregistrées

### Point de contrôle 2
- [x] T13 passé avec la skill `framing` réelle sur l'issue #2 (13 octobre 2026, point de contrôle 3) ; [x] test live minimal vert le 13 octobre 2026 ; [x] `grep claude-agent-sdk packages/*/src` ne sort que `src/claude/` ; CI verte à vérifier après push

### Phase 3 — `orchestrator`
- [x] T14 `auth.ts` (gh) et lecture GitHub avec ETag (msw)
- [x] T15 Écritures GitHub idempotentes : étiquettes, commentaires, contrat, preuves, bloc de run
- [x] T16 `state.ts` + `reconcile.ts` lignes cadrage et verrou
- [x] T17 `reconcile.ts` lignes implémentation, CI, verdict
- [x] T18 `worktree.ts` (simple-git)
- [x] T19 Les cinq handlers
- [x] T20 Boucle de tick, API `Orchestrator`, journal JSONL, scénario complet avec redémarrage simulé
- [x] T20b Entrée CLI `pnpm factory tick|start-framing <issue>|answer <card> <choice>` pour piloter sans interface

### Point de contrôle 3 — « la boucle tourne sans interface »
- [x] Une issue réelle de ce dépôt (#2, PR #3 fusionnée le 13 octobre 2026) passe `intent → framing → implementation → evidence → verdict` via la CLI, sans édition manuelle hors cartes ; [x] redémarrage en plein run = une seule carte « Run interrompu » (scénario `full-loop`, deux redémarrages simulés) ; [x] tick sans changement = zéro appel comptabilisé (`pnpm --filter @factory/orchestrator live` le 13 octobre 2026 : seconde lecture 0 requête, 3 × 304)

### Phase 4 — `inbox`
- [x] T21 Squelette Electron : main, preload, renderer, pont IPC, écran `blocked` — issue #4, PR #5 fusionnée le 14 octobre 2026 (dogfoodée via la CLI : 2 cartes de cadrage, 19 items, 8 preuves, 2 décisions gardées ; `query()` tourne dans le process principal Electron sans correctif)
- [x] T22 Colonnes et cartes avec zones de réponse, tests composants sur fixtures — issue #6, PR #7 fusionnée le 14 octobre 2026 (dogfoodée via la CLI : 3 cartes de cadrage, 18 items, 8 preuves `proven` par la CI, 1 décision gardée, 193 tours, 12,1 $ ; l’orchestrateur publie désormais les preuves `to-review` et `createdAt` dans `CardView` ; react-markdown ajouté à la spec). Défaut relevé : un second `pnpm factory` lancé pendant un run marque le run `failed` et publie une fausse carte « Run interrompu » (pas de garde contre deux orchestrateurs sur le même dépôt, issue de suivi à créer)
- [x] T23 Barre latérale : dépôt, nouvelle intention, tâches par phase, run en cours — issue #8, PR #9 fusionnée le 14 octobre 2026
- [x] T24 Barre de menus, badge, notifications, fermeture et sortie propre — issue #10, PR #11 fusionnée le 14 octobre 2026, scénario manuel vérifié
- [x] T25 E2E Playwright en mode `fake` — issue #13, PR #14 fusionnée le 15 octobre 2026 (dogfoodée via la CLI : 4 cartes de cadrage, 18 items, 10 preuves, job CI `e2e` sur macOS « 1 passed » ; une carte « Renvoyer en cadrage » résolue en amendant H4/C1 ; correctif du parseur de contrat poussé sur main en cours de boucle)
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
