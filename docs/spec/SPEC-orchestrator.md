# Spec : `orchestrator`

> Module 4 sur 5 du jalon 1. Dépend de [`conventions`](SPEC-conventions.md), [`skills`](SPEC-skills.md), [`agent-adapter`](SPEC-agent-adapter.md). Fournit l'API consommée par `inbox`.
> Statut : **approuvée** le 13 octobre 2026.

## Objectif

Faire avancer les tâches en lisant GitHub et en lançant des runs, sans jamais détenir d'état indispensable. L'orchestrateur est un module sans interface, tournant dans le process principal Electron, extractible en service séparé sans réécriture.

Succès : une issue de ce dépôt traverse les cinq phases en ne touchant que des cartes dans l'inbox, et l'orchestrateur relancé au milieu d'un run retrouve l'état exact depuis GitHub.

## Prérequis d'exécution

- `gh` installé et connecté (`gh auth status` réussit). L'app lit `gh auth token` au démarrage et à chaque échec 401. Aucun jeton stocké par l'app.
- `git` installé, credential helper de `gh` actif (`gh auth setup-git`).
- Claude Code connecté (vérifié par l'adaptateur).
- Si un prérequis manque, l'orchestrateur ne démarre pas et expose un état `blocked` avec la commande à lancer. L'inbox l'affiche dans la file Agir.

## Principes

1. **Réconciliation, pas événements.** Toutes les 30 secondes et sur `refresh`, l'orchestrateur lit l'état GitHub, calcule l'action attendue, et agit. Aucune action n'est déclenchée par un clic : le clic écrit dans GitHub, le tick suivant agit. Un clic force un tick immédiat.
2. **Idempotence.** Chaque action est sûre à rejouer : relancer un tick après un crash ne lance pas deux runs et ne publie pas deux cartes.
3. **Un seul run à la fois**, toutes issues confondues.
4. **GitHub par Octokit, authentifié par `gh`.** Requêtes conditionnelles (ETag) sur toutes les lectures de sondage.

## État observé (par tâche)

Calculé à chaque tick, jamais stocké :

```ts
interface TaskState {
  issue: number; title: string;
  phase: Phase;                       // étiquette phase:*
  needs: Set<'validation'|'arbitration'|'action'>;
  lock?: { active: boolean; failed: boolean; assignee?: string };
  contract?: Contract;                // conventions §3
  cards: Card[];                      // issue + PR, avec réponses associées
  run?: RunBlock;                     // conventions §7
  pr?: { number; draft; headSha; merged; evidence?: Evidence; ciRun?: { url; status } };
}
```

## Table de réconciliation

| Condition observée | Action |
|---|---|
| `run:active` posé, aucun run local vivant | Retirer `run:active`, poser `run:failed`, publier carte `action` « Run interrompu » (idempotent : pas de doublon si la carte existe) |
| `phase:framing`, pas de `run:*`, pas de carte ouverte, pas de bloc de run `finished` pour cette phase | Démarrer un run `framing` |
| Carte `question`/`arbitration` ouverte avec réponse non consommée (`status: open` + commentaire `factory:answer`) | Marquer la carte `answered`, reprendre le run avec la réponse (`resume`), ou run neuf si bloc de run absent |
| Carte `decision` avec réponse `reverse` | Marquer `reversed`, reprendre avec consigne d'annulation ; si texte contient « aurait dû bloquer », ajouter une ligne Bloquant à `rules.md` |
| Carte `action` avec réponse `done` | Marquer `done`, reprendre le run si un run attendait cette carte |
| Item de contrat coché à la main | Statut `validated`, contrat réécrit |
| `phase:implementation`, contrat complet, pas de run, pas de PR | Créer worktree + branche, démarrer run `implementation` |
| `evidence.updated` reçu | Commit + push, réécrire le commentaire preuves, créer la PR brouillon si absente |
| Run Actions sur `pr.headSha` terminé **vert**, lignes `pending` présentes | Passer ces lignes à `proven` avec l'URL du run (seul endroit qui écrit `proven` pour une preuve CI) |
| Run Actions sur `pr.headSha` terminé **rouge**, run `implementation` terminé | Reprendre le run avec le journal d'échec en consigne ; au-delà de deux reprises pour le même critère, carte `action` « CI rouge, intervention nécessaire » |
| Pas de workflow Actions sur le dépôt alors que des lignes sont `pending` | Carte `action` « Aucune CI configurée » (une seule fois) |
| Run `implementation` terminé sans carte, zéro `missing`, zéro `pending`, CI verte sur `headSha` | `phase:evidence`, PR marquée prête pour relecture |
| `phase:evidence`, toutes lignes `proven` | `phase:verdict`, carte `action` « Fusionner la PR » |
| PR fusionnée ou issue fermée | Supprimer worktree et branche locale, retirer `run:*` |
| `phase:framing` posée à la main sur une tâche en implémentation | Carte `action` « Retour en cadrage : supprimer le worktree ? » (le worktree est gardé jusqu'à `done`) |
| Étiquette `needs:*` incohérente avec les cartes ouvertes | Corriger l'étiquette |

Toute action commence par poser `run:active` + assignation (verrou), et finit par le retirer. Un tick ne lance jamais une action si un run est vivant localement.

## Handlers des outils de l'agent

L'orchestrateur fournit à l'adaptateur les cinq handlers de `skills` :

| Handler | Effet |
|---|---|
| `emit_card` | Valide via `conventions`, publie le commentaire dans l'issue (framing) ou la PR (implementation), pose `needs:*`. Si bloquante : enregistre l'attente, le run s'arrête (adaptateur). |
| `update_contract` | Réécrit le bloc contrat, `version + 1`, items inconnus refusés, identifiants jamais réutilisés |
| `update_evidence` | Refuse toute ligne `proven` venant de l'agent, réécrit le commentaire avec les lignes `pending` / `to-review` / `blocked`, déclenche commit + push. Le passage à `proven` est fait par la réconciliation quand la CI est verte |
| `request_adr` | Réserve `NNNN` (max existant + 1 dans `docs/adr/` du worktree), écrit le fichier, ajoute une ligne Tranché à `.factory/rules.md`, commit |
| `read_rules` | Lit `.factory/rules.md` du worktree, vide si absent |

## Worktrees et branches

- Racine : `<userData>/worktrees/<owner>-<repo>/<issue>/`.
- Branche : `factory/<issue>-<slug>` depuis la branche par défaut à jour (`fetch` + `worktree add -b`).
- Cadrage : même mécanique, branche `framing/<issue>`, poussée seulement si le run a écrit sous `prototype/`. Supprimée au passage en `implementation`.
- Commits par l'orchestrateur : `git add -A` puis message `feat(#<issue>): <titre de carte ou critère>` ; auteur = identité git de la machine. Jamais de `--force`.
- Tout passe par `simple-git` (binaire `git`). Aucun script shell.

## API vers l'inbox

Exposée sur IPC Electron par un pont typé. Le module ne connaît pas Electron : il expose un objet `Orchestrator` et c'est `apps/desktop` qui le branche sur IPC.

```ts
interface Orchestrator {
  // commandes : écrivent dans GitHub puis forcent un tick
  startFraming(issue: number): Promise<void>;           // phase:intent → phase:framing
  startImplementation(issue: number): Promise<void>;    // refuse si contrat incomplet
  sendBackToFraming(issue: number, reason: string): Promise<void>;
  answerCard(cardId: string, answer: CardAnswer): Promise<void>;   // publie factory:answer
  validateItem(issue: number, itemId: string, status: 'validated'|'rejected'|'discussing', note?: string): Promise<void>;
  markActionDone(cardId: string): Promise<void>;
  markEvidenceReviewed(pr: number, criterion: string, verdict: 'proven'|'blocked', note?: string): Promise<void>;
  refresh(): Promise<void>;
  // lecture
  subscribe(listener: (state: InboxState) => void): () => void;
  getState(): InboxState;
}

interface InboxState {
  status: 'ready' | 'blocked';
  blockedReason?: { message: string; command?: string };
  validate: CardView[];      // decision ouvertes + items pending
  arbitrate: CardView[];     // question + arbitration ouvertes
  act: CardView[];           // action ouvertes + prérequis manquants
  tasks: TaskView[];         // par phase
  run?: { issue; skill; startedAt; lastEvent: FactoryEvent };
  lastSync: Date;
}
```

Toute commande qui écrit dans GitHub est rejouable sans effet double (vérification de l'état avant écriture).

## Journal

- Chaque `FactoryEvent` et chaque action de réconciliation sont écrits en JSONL dans `<userData>/logs/<owner>-<repo>/<issue>.jsonl`, purge à 30 jours. Hors source de vérité.

## Stack

- TypeScript 5, Node 22. `@octokit/rest` + `@octokit/plugin-throttling`, `simple-git`, `zod`.
- Paquet `packages/orchestrator`. Dépend de `@factory/conventions`, `@factory/skills`, `@factory/agent-adapter`. Zéro Electron : `userData` et le jeton sont injectés au constructeur.

## Commandes

```
Tester      : pnpm --filter @factory/orchestrator test
Scénario    : pnpm --filter @factory/orchestrator scenario fixtures/full-loop.json   (faux GitHub + adaptateur fake)
```

## Structure

```
packages/orchestrator/
  src/orchestrator.ts      → boucle de tick, API
  src/reconcile.ts         → TaskState → Action[] (fonction pure)
  src/github.ts            → Octokit, ETag, lecture/écriture via conventions
  src/auth.ts              → gh auth token / status
  src/worktree.ts          → simple-git
  src/handlers.ts          → les cinq handlers
  src/state.ts             → TaskState, InboxState
  src/log.ts               → JSONL
  test/reconcile.test.ts   → table de réconciliation, cas par cas
  test/fakes/github.ts     → GitHub en mémoire (issues, commentaires, étiquettes, PR)
  test/scenario.test.ts    → boucle complète avec adaptateur fake
```

## Style

```ts
export function reconcile(state: TaskState, local: LocalRuns): Action[] {
  if (state.lock?.active && !local.has(state.issue)) return [recoverFailedRun(state)];
  if (local.size > 0) return [];                       // un seul run à la fois
  const answered = state.cards.find(c => c.status === 'open' && c.answer);
  if (answered) return [consumeAnswer(state, answered)];
  …
}
```

- `reconcile` est pure : entrée l'état observé, sortie une liste d'actions. Les effets sont dans `github.ts`, `worktree.ts`, `handlers.ts`.
- Pas d'horloge ni de hasard dans `reconcile` ; injectés.

## Tests

- **`reconcile`** : une fixture par ligne de la table de réconciliation, plus les cas « rien à faire » et « run vivant ». Objectif : 100 % des lignes couvertes.
- **Scénario complet** avec faux GitHub et adaptateur `fake` : intention → framing (3 cartes) → contrat validé → implémentation (1 arbitrage bloquant, 1 décision réversible) → preuves → verdict. Vérifie l'état GitHub final et l'absence de doublons après un redémarrage simulé au milieu.
- **`github.ts`** : msw intercepte l'API ; vérifie ETag/304 et l'écriture idempotente des commentaires.
- **Live, hors CI** : un tick réel contre ce dépôt en lecture seule.

## Limites

- **Toujours** : poser le verrou avant toute action ; relire GitHub avant d'écrire ; journaliser chaque action.
- **Demander d'abord** : nouvelle ligne dans la table de réconciliation ; plus d'un run simultané ; webhooks ; GitHub App ; `--force`.
- **Jamais** : stocker un jeton ; importer Electron ou l'interface ; détenir un état sans équivalent dans GitHub ; pousser sur la branche par défaut.

## Critères de succès

1. Le scénario complet passe en CI avec faux GitHub et adaptateur `fake`, y compris le redémarrage simulé.
2. Sur ce dépôt, une issue réelle passe `intent → framing → implementation → evidence → verdict` via les commandes de l'API, sans édition manuelle hors cartes.
3. L'app tuée en plein run et relancée produit exactement une carte « Run interrompu » et aucune action en double.
4. Quota GitHub : un tick sans changement consomme zéro appel comptabilisé (tout en 304).
6. Une ligne `pending` passe à `proven` sans intervention humaine ni agent, dans le tick qui suit une CI verte, avec l'URL du run.
5. `grep -r "electron" packages/orchestrator/src` ne trouve rien.

## Amendements

- 2026-10-13 : quatre lignes de réconciliation CI et handler `update_evidence` (carte « Qui a le droit d'écrire proven », option A).
- 2026-10-13 (phase 3, interprétations consignées dans `packages/orchestrator/README.md`) :
  - **Run échoué** (`run.failed`, flux sans événement terminal, annulation) : `run:failed` posé et carte `action` « Run interrompu, relancer ? » publiée, comme pour le verrou orphelin. « fait » reprend la session du bloc de run si elle existe, sinon run neuf ; si le bloc attend une carte encore ouverte, c'est la réponse à cette carte qui relance. Un run qui (re)démarre passe toute carte « Run interrompu » encore ouverte à `cancelled`.
  - **Cartes de l'orchestrateur** (« Run interrompu », « Aucune CI configurée », « CI rouge sur <sha> », « Fusionner la PR », « Retour en cadrage ») portent `skill=orchestrator@0.1.0` et sont idempotentes par titre.
  - **PR brouillon** ouverte dès qu'un handler d'implémentation en a besoin (`emit_card` dans la PR, `update_evidence`), par un commit vide si rien n'est à committer.
  - **Reprises CI rouge** comptées en mémoire (deux au plus par issue, remises à zéro à `proven` ou au changement de phase) : un redémarrage de l'app peut en accorder deux de plus, jamais moins.
  - `update_evidence` ne rétrograde jamais une ligne `proven` existante ; `request_adr` commit **et** pousse.
  - `worktree remove --force` et `branch -D` ne touchent que le disque local ; aucun `push --force` nulle part.
  - Lecture seule : `observe()` (CLI `state`) relit GitHub sans créer les étiquettes ni exécuter d'action.
  - **Journal de CI rouge** non récupéré au jalon 1 : la consigne de reprise demande à l'agent de reproduire l'échec localement ; l'URL du run reste pour l'humain.
  - **Verrou** posé pour tout lancement de run ; les écritures sans run (phase, `proven`, cartes de l'orchestrateur, `needs`, contrat normalisé) sont une seule écriture idempotente après relecture, sans verrou.

## Questions tranchées à l'approbation

1. Sondage à 30 s ; chaque commande force un tick immédiat.
2. La PR brouillon est ouverte au premier commit.
