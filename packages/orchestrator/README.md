# `@factory/orchestrator`

Lit GitHub, calcule l'action attendue, agit : réconciliation toutes les 30 s, un seul run à la fois, aucun état indispensable hors GitHub (voir [`docs/spec/SPEC-orchestrator.md`](../../docs/spec/SPEC-orchestrator.md)). Zéro Electron : `userData` et le jeton sont injectés.

```
pnpm --filter @factory/orchestrator test       # 98 tests, couverture 100 % sur les neuf modules
pnpm --filter @factory/orchestrator scenario   # scénario complet seul (faux GitHub, adaptateur fake, git temporaire)
pnpm --filter @factory/orchestrator live       # lecture seule contre le vrai dépôt : seconde lecture = zéro appel comptabilisé
pnpm factory <commande>                        # pilotage sans interface, voir ci-dessous
```

## CLI (`pnpm factory`)

| Commande | Effet |
|---|---|
| `state` | État observé, lecture seule (ne crée pas les étiquettes, n'exécute rien) |
| `tick` | Un tick ; attend la fin du run éventuel en affichant ses événements |
| `start-framing <issue>` | `phase:intent → phase:framing`, puis tick (le run de cadrage démarre) |
| `start-implementation <issue>` | Refuse si le contrat est incomplet ; `phase:framing → phase:implementation` |
| `send-back <issue> <raison>` | Retour en cadrage depuis `implementation`, `evidence` ou `verdict` |
| `answer <card> <A\|B\|…\|keep\|reverse\|done\|other> [texte]` | Publie `factory:answer`, puis tick (reprise du run) |
| `validate <issue> <item> <statut> [note]` | Change le statut d'un item du contrat (`version + 1`) |
| `evidence <pr> <critère> <proven\|blocked> [note]` | L'humain examine une preuve `to-review` ; un chemin devient un lien `blob` au SHA de tête |

Options : `--repo owner/repo` (sinon `gh repo view`), `--home <dossier>` (sinon `$FACTORY_HOME`, sinon `~/.software-factory`). Prérequis : `gh auth status` vert et `gh auth setup-git` fait ; sinon l'état est `blocked` avec la commande à lancer.

## Structure

```
src/state.ts         TaskState (observé, jamais stocké), InboxState, vues
src/reconcile.ts     table de réconciliation : TaskState → Action[] (pure, sans horloge)
src/orchestrator.ts  boucle de tick, exécution des actions, runs, API vers l'inbox
src/handlers.ts      les cinq outils de l'agent (emit_card, update_contract, update_evidence, request_adr, read_rules)
src/github.ts        port GitHub + aides (findPull, upsertMarked…)
src/octokit.ts       implémentation Octokit : ETag → 304 non comptabilisé, 401 → jeton relu
src/worktree.ts      clones et worktrees via simple-git
src/rules.ts         .factory/rules.md (Tranché, Bloquant)
src/log.ts           JSONL par issue, purge à 30 jours
src/auth.ts          gh auth token / status / setup-git
src/bootstrap.ts     assemblage réel (gh, Octokit, Claude Code, worktrees, journaux)
src/cli.ts           pnpm factory
test/fakes/          GitHub en mémoire, adaptateur fake routé par skill, dépôt git temporaire
test/fixtures/full-loop.json   scénario : 3 cartes de cadrage, décision + arbitrage, ADR, CI, verdict
```

## Interprétations (là où la spec laissait un choix)

1. **Run échoué.** `run.failed`, flux sans terminal ou annulation : `run:failed` et carte « Run interrompu, relancer ? », comme pour le verrou orphelin. « fait » reprend la session du bloc de run si elle existe, sinon run neuf. Si le bloc attend une carte encore ouverte, « fait » ne relance rien : c'est la réponse à cette carte qui relance. Un run qui (re)démarre passe toute carte « Run interrompu » ouverte à `cancelled`.
2. **Cartes de l'orchestrateur** portent `skill=orchestrator@0.1.0` et sont idempotentes par titre (« CI rouge sur <sha> » inclut le SHA : une nouvelle CI rouge produit une nouvelle carte).
3. **PR brouillon** ouverte dès qu'un handler d'implémentation en a besoin (carte dans la PR, preuves) : commit vide si rien à committer, `Closes #<issue>` dans le corps.
4. **Reprises CI rouge** comptées en mémoire, deux au plus, remises à zéro à `proven` ou au changement de phase. Un redémarrage peut en accorder deux de plus : perte sans gravité, jamais d'état indispensable localement.
5. **`update_evidence`** ne rétrograde jamais une ligne `proven` écrite par l'orchestrateur ou l'humain. **`request_adr`** commit et pousse (l'ADR est dans la PR même si le run s'arrête ensuite).
6. **`update_contract`** refuse : identifiant mal formé, type incohérent, doublon, item disparu (identifiants jamais réutilisés : marquer `rejected`), item rejeté reformulé, critère sans preuve prévue.
7. **Worktrees.** `worktree remove --force` et `branch -D` ne touchent que le disque local ; aucun `push --force`. Le worktree d'implémentation est gardé lors d'un retour en cadrage jusqu'à la carte « Retour en cadrage : supprimer le worktree ? ».
8. **Phase `evidence` sans CI** : atteinte si toutes les preuves sont `to-review` et que le dépôt n'a aucun workflow. Avec des lignes `pending` sans workflow : carte « Aucune CI configurée », une seule fois.
9. **Tâches fermées** : relues seulement si un worktree local existe (nettoyage), jamais affichées.
10. **Pagination** : 100 issues ouvertes, 100 PR, 100 commentaires par conversation (jalon 1).

## Vérifications

- Scénario complet (`test/scenario.test.ts`) : intention → cadrage (question, crash simulé → une seule carte « Run interrompu », question) → contrat validé → implémentation (décision réversible, arbitrage bloquant, ADR, désaveu avec règle Bloquant, second crash) → CI verte → `proven` → `evidence` → preuve examinée → `verdict` → fusion → nettoyage. Deux redémarrages d'orchestrateur, zéro doublon.
- Octokit sous msw : second appel identique = 304, zéro requête comptabilisée ; 401 → jeton relu une fois.
- Live (13 octobre 2026, ce dépôt, lecture seule) : première lecture 4 requêtes, seconde lecture 0 requête et 3 × 304.
