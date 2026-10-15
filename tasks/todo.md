# Tâches — Jalon 1

Format : description, acceptation, vérification, dépendances, fichiers, taille. Commandes de test : voir chaque spec.

## Phase 0 — Fondations

### T0 : Racine du monorepo
**Description :** pnpm workspaces, tsconfig de base strict, eslint + prettier, vitest, workflow CI `.github/workflows/ci.yml` (install, lint, typecheck, test sur tous les paquets), `NOTICE` MIT Addy Osmani, README minimal « en construction » avec lien vers `docs/`.
- Acceptation : `pnpm install && pnpm -r lint && pnpm -r typecheck && pnpm -r test` passent sur un paquet vide `packages/conventions`.
- Vérification : CI verte après A1.
- Dépendances : aucune. Taille : M.
- Fichiers : `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.github/workflows/ci.yml`, `NOTICE`, `README.md`.

### A1 : Dépôt GitHub (action humaine)
`gh repo create fabpl/software-factory --public --source=. --push` puis vérifier que la CI tourne.

## Phase 1 — `conventions` (`packages/conventions`)

### T2 : Étiquettes et transitions
- Acceptation : `PHASES`, `NEEDS`, `RUN` exportés ; `canTransition(from, to, actor)` conforme au diagramme de `SPEC-conventions` §1 ; `labelsFor(state)` et `parseLabels(labels)` tolèrent les étiquettes inconnues.
- Vérification : `pnpm --filter @factory/conventions test labels`.
- Dépendances : T0. Taille : S. Fichiers : `src/labels.ts`, `test/labels.test.ts`.

### T3 : Contrat
- Acceptation : `parseContract` / `serializeContract` ; aller-retour sur 4 fixtures (vide, complet, édité à la main avec case cochée, texte hors bloc) ; refus d'un critère sans preuve prévue et d'un statut inconnu ; `canStartImplementation(contract)`.
- Vérification : `test contract`, couverture 100 % branches.
- Dépendances : T2. Taille : M. Fichiers : `src/contract.ts`, `src/block.ts` (délimiteurs `<!-- factory:… -->`), `test/contract.test.ts`, `test/fixtures/contract-*.md`.

### T4 : Cartes et réponses
- Acceptation : `parseCard` / `serializeCard` / `parseAnswer` / `serializeAnswer` ; une carte à options exige ≥ 2 options ; `choice` ∈ lettres | `keep` | `reverse` | `done` | `other` ; `attachAnswers(cards, comments)` associe réponses et cartes ; mapping carte → file (`validate` / `arbitrate` / `act`).
- Vérification : `test card`.
- Dépendances : T3 (block.ts). Taille : M. Fichiers : `src/card.ts`, `test/card.test.ts`, fixtures.

### T5 : Preuves et bloc de run
- Acceptation : `parseEvidence` / `serializeEvidence` avec états `pending|proven|to-review|blocked|missing` ; `validateAgentEvidence` rejette `proven` ; `missingFor(contract, evidence)` ; `canReachVerdict` ; `parseRunBlock` / `serializeRunBlock`.
- Vérification : `test evidence run`.
- Dépendances : T3. Taille : M. Fichiers : `src/evidence.ts`, `src/run.ts`, tests, fixtures.

### T6 : ADR
- Acceptation : `renderAdr(input)` conforme à `docs/adr/0001` ; `nextAdrNumber(existingFilenames)` ; `slugify`.
- Vérification : `test adr` ; `renderAdr` sur l'ADR 0001 reproduit le fichier à l'espace près.
- Dépendances : T0. Taille : S. Fichiers : `src/adr.ts`, `test/adr.test.ts`.

### T6b : `conventions:check`
- Acceptation : `pnpm conventions:check <issue>` lit l'issue et ses commentaires via `gh api`, affiche contrat, cartes, réponses parsés ou l'erreur précise.
- Vérification : manuelle sur l'issue A4.
- Dépendances : T2–T5, A4. Taille : S. Fichiers : `scripts/check.ts`, `package.json`.

### Point de contrôle 1
- [x] CI verte, couverture atteinte, `conventions:check` relit l'issue manuscrite (#1) sans erreur. Revue humaine : « phase 2 » le 13 octobre 2026.

## Phase 2 — `skills` ∥ `agent-adapter`

### T7 : Chargeur de skills (`packages/skills`)
- Acceptation : `loadSkill(name)` valide le front matter (zod), expose `requiresTools` ; `inject({ skill, contract, rules })` assemble le texte ; tests : attribution présente, `version` bumpée si corps changé depuis le dernier tag (lecture `git`), changelog contient la version.
- Vérification : `pnpm --filter @factory/skills test`.
- Dépendances : T3. Taille : M. Fichiers : `src/index.ts`, `src/inject.ts`, `test/*.test.ts`.

### T8 : Skill `framing`
- Acceptation : `skills/framing/SKILL.md` suit `SPEC-skills` (6 étapes, interdits, sondes), front matter valide, attribution interview-me + spec-driven-development, `CHANGELOG.md` 0.1.0.
- Vérification : T7 vert ; relecture humaine.
- Dépendances : T7. Taille : S. Fichiers : `skills/framing/SKILL.md`, `skills/framing/CHANGELOG.md`.

### T9 : Skill `implementation`
- Acceptation : idem pour `skills/implementation/SKILL.md` (7 étapes, classement bloquant, jamais `proven`).
- Vérification : T7 vert ; relecture humaine.
- Dépendances : T7. Taille : S.

### T10 : Vocabulaire d'événements et adaptateur `fake` (`packages/agent-adapter`)
- Acceptation : `FactoryEvent`, `RunSpec`, `AgentAdapter` exportés ; `FakeAdapter` rejoue un scénario JSON (`start`, `resume`, `cancel`) et appelle les handlers de `spec.tools` ; test : un scénario à 2 cartes produit exactement la séquence attendue avec un seul événement terminal par run.
- Vérification : `pnpm --filter @factory/agent-adapter test fake`.
- Dépendances : T4, T5. Taille : M. Fichiers : `src/events.ts`, `src/fake/adapter.ts`, `test/fake.test.ts`, `test/fixtures/scenario-*.json`.

### T11 : Adaptateur Claude, options et outils
- Acceptation : `buildOptions(spec, pending)` produit `systemPrompt` preset + append, `cwd`, `settingSources: ['project']`, `permissionMode: 'dontAsk'`, `allowedTools` depuis `policy`, `disallowedTools`, `mcpServers.factory` ; `createFactoryServer(tools)` expose les 5 outils avec schémas zod ; test : `allowedTools` attendus pour une `policy` donnée ; `tools_missing` si `init` ne liste pas un outil requis.
- Vérification : `test policy options`.
- Dépendances : T10. Taille : M. Fichiers : `src/claude/adapter.ts`, `src/claude/tools.ts`, `src/claude/policy.ts`, tests.

### T12 : Hooks et traduction
- Acceptation : `preToolUse` répond `defer` pour `emit_card` bloquante sans réponse, `allow` + `updatedInput` avec réponse, `deny` sur `git push`/`gh`/`curl`/chemin hors worktree ; `translate(msg, pending)` couvre la table de `SPEC-agent-adapter` ; fixtures `SDKMessage` initialement synthétiques, remplacées par T13.
- Vérification : `test hooks translate`, 100 % branches.
- Dépendances : T11. Taille : M. Fichiers : `src/claude/hooks.ts`, `src/claude/translate.ts`, tests, `test/fixtures/sdk/*.json`.

### T13 : Test live et fixtures réelles
- Acceptation : `test:live` lance un run avec une skill minimale qui émet une `question`, observe `run.waiting`, reprend avec « A », observe `run.finished`, même `session_id` ; enregistre les `SDKMessage` en fixtures ; vérifie le repli `close()` quand l'agent fait deux appels.
- Vérification : manuelle, résultat noté dans `packages/agent-adapter/README.md`.
- Dépendances : T12, A3. Taille : S. Fichiers : `test/live/roundtrip.test.ts`, fixtures.

### Point de contrôle 2
- [x] Test live minimal vert (13 octobre 2026), fixtures réelles enregistrées, isolation SDK vérifiée par grep.
- [ ] T13 avec la vraie skill `framing` sur une issue de ce dépôt : nécessite l'orchestrateur (T20c), reporté au point de contrôle 3. Revue humaine des deux `SKILL.md`.

## Phase 3 — `orchestrator` (`packages/orchestrator`)

### T14 : Authentification et lecture GitHub
- Acceptation : `auth.ts` lit `gh auth token` / `gh auth status`, erreur typée `GhNotReady { command }` ; `github.ts` lit issues `phase:*`, commentaires, PR, dernier run Actions par SHA, avec cache ETag ; test msw : second appel identique = 304 et zéro appel comptabilisé.
- Vérification : `pnpm --filter @factory/orchestrator test github auth`.
- Dépendances : T2. Taille : M. Fichiers : `src/auth.ts`, `src/github.ts`, `test/github.test.ts`.

### T15 : Écritures GitHub idempotentes
- Acceptation : poser/retirer étiquettes, assigner, créer/éditer commentaire par marqueur (`factory:card id=…`, `factory:evidence`, `factory:run`), réécrire le bloc contrat sans toucher au reste du corps, créer PR brouillon, marquer prête ; test : rejouer chaque écriture ne crée pas de doublon.
- Vérification : `test github-write`.
- Dépendances : T14, T3–T5. Taille : M. Fichiers : `src/github.ts`, tests.

### T16 : État et réconciliation, cadrage et verrou
- Acceptation : `buildTaskState` ; `reconcile` couvre les lignes : verrou orphelin, démarrage `framing`, réponse non consommée, `reverse` + « aurait dû bloquer », `action` done, item coché à la main, étiquette `needs` incohérente, un seul run.
- Vérification : `test reconcile`, une fixture par ligne.
- Dépendances : T4, T5, T14. Taille : M. Fichiers : `src/state.ts`, `src/reconcile.ts`, `test/reconcile.test.ts`, fixtures.

### T17 : Réconciliation, implémentation et CI
- Acceptation : lignes : démarrage `implementation`, `evidence.updated`, CI verte → `proven`, CI rouge → reprise (max 2), aucune CI, passage `evidence`, passage `verdict` + carte « Fusionner », fusion → nettoyage, retour en cadrage manuel.
- Vérification : `test reconcile`.
- Dépendances : T16. Taille : M. Fichiers : `src/reconcile.ts`, fixtures.

### T18 : Worktrees
- Acceptation : `createWorktree(repo, issue, slug)`, `commitAll(message)`, `push()`, `removeWorktree()`, branches `factory/…` et `framing/…` ; jamais `--force` ; test sur un dépôt git temporaire.
- Vérification : `test worktree`.
- Dépendances : T0. Taille : S. Fichiers : `src/worktree.ts`, `test/worktree.test.ts`.

### T19 : Handlers
- Acceptation : les cinq handlers de `SPEC-orchestrator` ; `update_evidence` rejette `proven` ; `request_adr` réserve le numéro et ajoute la ligne Tranché ; tests avec faux GitHub en mémoire et worktree temporaire.
- Vérification : `test handlers`.
- Dépendances : T15, T18, T6. Taille : M. Fichiers : `src/handlers.ts`, `test/handlers.test.ts`, `test/fakes/github.ts`.

### T20 : Boucle, API, journal, scénario complet
- Acceptation : `Orchestrator` (7 commandes, `subscribe`, `getState`, `status: blocked` si prérequis manquant) ; tick toutes les 30 s + forcé ; JSONL ; scénario `full-loop.json` avec faux GitHub + `FakeAdapter` : 5 phases, 1 arbitrage bloquant, 1 décision réversible, redémarrage simulé au milieu sans doublon.
- Vérification : `test scenario`.
- Dépendances : T16–T19, T10. Taille : L → découpée : T20a boucle + API, T20b scénario. Fichiers : `src/orchestrator.ts`, `src/log.ts`, `test/scenario.test.ts`.

### T20c : CLI de pilotage
- Acceptation : `pnpm factory tick | start-framing <issue> | start-implementation <issue> | answer <card> <choice> [texte] | state` contre le vrai GitHub et le vrai adaptateur.
- Vérification : point de contrôle 3.
- Dépendances : T20. Taille : S. Fichiers : `src/cli.ts`.

### Point de contrôle 3 — la boucle tourne sans interface
- [x] Issue réelle de ce dépôt traversée via la CLI : #2 « Compteur du README mis à jour automatiquement », 3 cartes de cadrage, 14 items validés, run d'implémentation de 71 tours (1,71 $), 1 décision gardée, 4 preuves `proven` par la CI, 1 preuve examinée, PR #3 fusionnée le 13 octobre 2026. Deux défauts corrigés en route (connecteurs MCP de l'utilisateur chargés à la reprise ; relance d'un cadrage inachevé). À partir d'ici, les tâches suivantes deviennent des issues dogfoodées.
- [x] Redémarrage en plein run = une carte « Run interrompu » (scénario `test/scenario.test.ts`, 13 octobre 2026).
- [x] Tick sans changement = zéro appel comptabilisé (`pnpm --filter @factory/orchestrator live`, 13 octobre 2026).

## Phase 4 — `inbox` (`apps/desktop`)

### T21 : Squelette Electron — fait (issue #4, PR #5, 14 octobre 2026)
- Acceptation : electron-vite, main/preload/renderer, `contextIsolation`, pont IPC typé (`api.commands.*`, `api.subscribe`), écran `blocked` avec commande à copier ; vérification que `query()` du SDK fonctionne dans le process principal (sinon carte de décision).
- Vérification : `pnpm --filter desktop dev` affiche l'écran `blocked` quand `gh` n'est pas connecté.
- Dépendances : T20. Taille : M. Fichiers : `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `electron.vite.config.ts`.

### T22 : Colonnes et cartes — fait (issue #6, PR #7, 14 octobre 2026)
- Acceptation : `Column`, `Card`, `CardAnswer` pour les 6 types de réponse ; raccourcis A/B/C ; `labels.ts` ; tests composants sur fixtures `InboxState` (vide, chargé, bloqué) ; aucun jeton anglais visible.
- Vérification : `pnpm --filter desktop test`.
- Dépendances : T21. Taille : M. Fichiers : `src/renderer/components/{Column,Card,CardAnswer}.tsx`, `labels.ts`, `fixtures/`, tests.

### T23 : Barre latérale — fait (issue #8, PR #9, 14 octobre 2026)
- Acceptation : dépôt, « Nouvelle intention », tâches par phase avec actions contextuelles et bouton grisé avec raison, `RunIndicator`, « Rafraîchir », « Annuler » avec confirmation.
- Vérification : tests composants.
- Dépendances : T22. Taille : M. Fichiers : `Sidebar.tsx`, `RunIndicator.tsx`, `NewIntentDialog.tsx`, tests.

### T24 : Barre de menus et cycle de vie — fait (issue #10, PR #11, 14 octobre 2026)
- Acceptation : fermeture = masquer ; icône barre de menus avec badge ; notifications sur carte bloquante, fin de run, `verdict` ; Quitter = `cancel` + attente ≤ 10 s.
- Vérification : manuelle, scénario noté dans `apps/desktop/README.md`.
- Dépendances : T21. Taille : S. Fichiers : `src/main/tray.ts`, `src/main/notifications.ts`, `src/main/index.ts`.

### T25 : E2E — fait (issue #13, PR #14, 15 octobre 2026)
- Acceptation : Playwright Electron lance l'app avec l'orchestrateur en mode `fake` (`full-loop.json`), répond à une question, valide un item, tranche un arbitrage, marque une preuve, voit « Fusionner la PR ».
- Vérification : `pnpm --filter desktop test:e2e` en CI.
- Dépendances : T22, T23, T20b. Taille : M. Fichiers : `e2e/full-loop.spec.ts`, `playwright.config.ts`.

### T26 : Construction — fait (issue #17, PR #18, 15 octobre 2026)
- Acceptation : `pnpm --filter desktop build` produit un `.dmg` non signé qui démarre.
- Vérification : manuelle.
- Dépendances : T24. Taille : S. Fichiers : `electron-builder.yml`.

### Point de contrôle 4 — Jalon 1
- [ ] A5 : une issue réelle de l'intention au verdict depuis l'app, sorties comptées dans l'issue.
- [ ] Les 5 critères de `SPEC-inbox` cochés ; README avec manifeste et compteur « fois où il a fallu ouvrir le code ».
