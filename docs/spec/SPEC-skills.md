# Spec : `skills`

> Module 2 sur 5 du jalon 1. Dépend de [`conventions`](SPEC-conventions.md).
> Statut : **approuvée** le 13 octobre 2026.

## Objectif

Deux skills embarquées, `framing` et `implementation`, qui font respecter le cycle de vie du cahier des charges : décider avant, prouver après. Elles sont adaptées des agent-skills d'Addy Osmani (MIT) et versionnées dans ce dépôt. L'orchestrateur les injecte dans les instructions du run ; elles ne passent jamais par la configuration utilisateur de l'agent ni par le dépôt cible.

Succès : un run `framing` sur une issue de ce dépôt produit un contrat complet sans qu'aucune décision structurante ne reste implicite ; un run `implementation` sur ce contrat ne décide rien hors contrat sans carte, et chaque critère validé finit avec une preuve hors agent.

## Provenance et attribution

| Skill | Adaptée de | Ce qu'on garde | Ce qu'on change |
|---|---|---|---|
| `framing` | `interview-me`, `spec-driven-development` | Hypothèse + confiance, une question à la fois avec pari, règle d'arrêt à 95 %, hypothèses explicites, critères reformulés en conditions testables | Sortie = cartes et contrat via outils, pas de conversation ; pas de plan ni de tâches (le run `implementation` les fait) |
| `implementation` | `incremental-implementation`, `test-driven-development`, `build` | Tranches fines, rouge-vert-refactor, vérification à chaque tranche | Interdit de décider hors contrat ; preuves obligatoires ; classement réversible / bloquant ; arrêt sur carte |

- Chaque `SKILL.md` commence par un bloc d'attribution : nom de la skill d'origine, dépôt, licence MIT, « modifié ».
- Fichier `NOTICE` à la racine du dépôt avec le texte MIT d'Addy Osmani.

## Forme d'une skill

```
skills/
  framing/
    SKILL.md
    CHANGELOG.md
  implementation/
    SKILL.md
    CHANGELOG.md
  NOTICE
```

Front matter obligatoire :

```yaml
---
name: framing
version: 0.1.0
language: fr
adapted_from: interview-me@0.6.12, spec-driven-development@0.6.12
requires_tools: [emit_card, update_contract]
---
```

- `version` suit semver. Tout changement du corps impose une entrée dans `CHANGELOG.md` et un bump. Un test échoue sinon.
- `requires_tools` liste les outils que l'orchestrateur doit exposer. Le run refuse de démarrer s'il en manque un.
- Langue : français. Les jetons machine (`kind`, statuts, étiquettes) restent en anglais, conformément à `conventions`.

## Outils requis de l'orchestrateur

Les skills ne touchent jamais GitHub, ne font jamais `git push`, n'ouvrent jamais de PR. Elles appellent ces outils ; l'orchestrateur écrit dans GitHub via `conventions`. La spec `orchestrator` implémente ce contrat.

| Outil | Entrée | Effet | Termine le run ? |
|---|---|---|---|
| `emit_card` | `kind`, `title`, `context`, `options[]` (lettre, texte, conséquence), `recommendation`, `change_cost`, `reversibility` | Publie une carte (`conventions` §4) | Oui si `kind` ∈ {`question`, `arbitration`, `action`}. Non si `decision`. |
| `update_contract` | Liste complète d'items `H`/`D`/`C` avec statut et preuve prévue | Réécrit le bloc contrat (`conventions` §3) | Non |
| `update_evidence` | Liste `critère → url, état` | Réécrit le commentaire preuves (`conventions` §5) | Non |
| `request_adr` | `card_id`, `slug`, contenu | Crée `docs/adr/NNNN-slug.md` dans le worktree avec numéro réservé | Non |
| `read_rules` | — | Retourne `.factory/rules.md` du dépôt cible, ou vide | Non |

Quand un outil termine le run, l'orchestrateur conserve l'identifiant de session pour reprendre avec la réponse (`conventions` §4, Réponse).

## Skill `framing`

Déroulé imposé, dans cet ordre :

1. **Lire les règles** (`read_rules`). Toute question déjà tranchée dans `rules.md` n'est pas reposée : elle devient une hypothèse `validated` avec référence.
2. **Explorer le dépôt** sans écrire de code de production. Lecture, recherche, exécution des tests existants autorisées. Prototype jetable autorisé dans le worktree, sous `prototype/`, jamais fusionné.
3. **Publier l'hypothèse** : premier `update_contract` avec les hypothèses `pending` et une confiance en pour cent dans la première carte.
4. **Boucle de cartes** : une `question` à la fois, deux à quatre options, un pari explicite, une réversibilité. Après chaque réponse : mettre à jour le contrat, puis carte suivante ou arrêt.
5. **Règle d'arrêt** : la skill s'arrête quand elle peut prédire les réponses aux trois questions suivantes, ou après douze cartes. Dans le second cas elle émet une carte `action` : « Cadrage non convergent, reprendre l'intention ».
6. **Sortie** : contrat avec au moins un critère, chaque critère avec une preuve prévue vérifiable par un système hors agent (CI, fichier, capture commitée). Items restant `pending` pour validation humaine dans la file Valider. La skill n'émet jamais de `decision` : en cadrage, tout est à valider.

Interdits : écrire du code de production, planifier les tâches, proposer une question sans options, poser une question dont la réponse est dans `rules.md`.

Sondes obligatoires reprises d'interview-me : si une réponse ressemble à une justification (« scalable », « propre », « standard »), la carte suivante demande ce que l'humain voudrait s'il n'avait rien à justifier.

## Skill `implementation`

Déroulé imposé :

1. **Lire les règles** puis **le contrat**. Refuser de démarrer si le contrat a un item `pending` ou `discussing` (c'est à l'orchestrateur de ne pas lancer, la skill le vérifie quand même).
2. **Découper** les critères en tranches fines, dans l'ordre des dépendances. Pas de carte pour ça : c'est du « comment ».
3. **Par tranche** : test rouge, code, test vert, puis `update_evidence` pour le critère couvert, avec l'URL que l'orchestrateur fournit pour le dernier run CI, ou `to-review` avec le chemin du fichier commité.
4. **Face à un choix hors contrat**, classer :
   - **Bloquant** (`arbitration`, `irreversible`) : schéma de base de données, API publique, nouvelle dépendance de production, sécurité ou authentification, suppression ou migration de données, tout point que `rules.md` marque « bloquant ». La skill émet la carte et le run s'arrête.
   - **Réversible** (`decision`) : tout le reste. La skill applique sa recommandation, émet la carte, continue.
   - **Hors du contrat de façon structurante** (un critère devient faux ou impossible) : carte `action` « Renvoyer en cadrage » avec explication. Le run s'arrête.
5. **Ce qu'elle ne peut pas faire seule** (token, service externe, accès) : carte `action`, le run s'arrête.
6. **Fin** : tous les critères `validated` ont une ligne de preuve `proven` ou `to-review`. Dernière action : `update_evidence` complet, puis le run se termine sans carte. L'orchestrateur passe la phase à `evidence`.

Interdits : modifier un critère du contrat, supprimer ou affaiblir un test existant sans carte, écrire `proven` sans URL hors agent, pousser quoi que ce soit (l'orchestrateur commit et pousse après chaque tranche).

## Boucle d'apprentissage

Fichier `.factory/rules.md` **dans le dépôt cible**, commité, lisible par l'humain :

```markdown
# Règles du projet (générées, éditables)

## Tranché
- 2026-10-13 · #12 · Stockage des sessions : commentaire caché de la PR, jamais la base locale. (ADR 0002)

## Bloquant
- Tout changement de `packages/conventions/src/*.ts` exporté. (désaveu sur #15)
```

- L'orchestrateur ajoute une ligne « Tranché » à chaque réponse d'`arbitration` irréversible, une ligne « Bloquant » à chaque réponse `reverse` accompagnée de « aurait dû bloquer ».
- Les deux skills lisent ce fichier en premier. `framing` transforme chaque ligne pertinente en hypothèse validée. `implementation` ajoute les lignes « Bloquant » à sa liste de classement.

## Commandes

```
Valider les skills : pnpm --filter @factory/skills test
Scénario manuel    : pnpm --filter @factory/skills scenario framing fixtures/issue-simple.md
```

## Structure

```
skills/                       → les SKILL.md (hors packages, lisibles par un humain)
packages/skills/
  src/index.ts                → charge, valide le front matter, expose { name, version, body, requiresTools }
  src/inject.ts               → assemble le texte d'instructions : skill + contrat + règles
  test/frontmatter.test.ts
  test/changelog.test.ts      → version bumpée si le corps a changé depuis le dernier tag
  test/scenarios/             → issues fixtures et séquences de cartes attendues (vérifiées à la main, cf. Tests)
```

## Style

Les SKILL.md suivent la structure des skills d'origine : Overview, When to use, Process numéroté, Red flags, Verification. Un extrait :

```markdown
## Déroulé

3. Publie l'hypothèse. Appelle `update_contract` avec chaque hypothèse en `pending`.
   Puis émets la première carte `question` ; son contexte contient ta confiance en pour cent et ce qui manque.

## Signaux d'alerte
- Deux questions dans une même carte : découpe.
- Une option sans conséquence : complète ou supprime.
- Une preuve prévue qui dit « l'agent vérifie que » : remplace par un artefact.
```

## Tests

- **Statiques, en CI** : front matter valide, `requires_tools` ⊆ outils connus, attribution présente, version bumpée avec entrée de changelog.
- **Scénarios, à la main** : pour chaque skill, une issue fixture et la séquence attendue (nombre de cartes, présence d'options, contrat final valide selon `conventions`). Exécutés par l'humain via l'orchestrateur, résultat noté dans le changelog. Non automatisés au jalon 1 : le coût d'un run n'est pas déterministe.
- **Contrôle croisé** : chaque appel d'outil dans un scénario est validé par `@factory/conventions` (le contrat produit se parse, les cartes ont ≥ 2 options).

## Limites

- **Toujours** : bump de version et changelog à chaque modification ; relire les deux skills ensemble quand un outil change.
- **Demander d'abord** : ajouter un outil requis ; changer la liste des catégories bloquantes ; ajouter une troisième skill.
- **Jamais** : laisser une skill écrire dans GitHub ou pousser ; copier une skill dans le dépôt cible ; retirer l'attribution.

## Critères de succès

1. `framing` exécutée sur une issue de ce dépôt produit un contrat qui se parse avec `conventions`, où chaque critère a une preuve prévue, en douze cartes ou moins.
2. `implementation` exécutée sur ce contrat termine avec zéro critère `missing` et aucune ligne `proven` sans URL.
3. Un choix volontairement absent du contrat (fixture) produit une `arbitration` si bloquant, une `decision` sinon, conformément à la liste.
4. Les tests statiques passent en CI.
5. `NOTICE` et les blocs d'attribution sont présents.

## Questions tranchées à l'approbation

1. Plafond de douze cartes en cadrage, à mesurer sur les trois premières issues.
2. Le prototype jetable de `framing` est poussé sur `framing/<issue>` et supprimé au passage en `implementation`.
