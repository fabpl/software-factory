# Spec : `conventions`

> Module 1 sur 5 du jalon 1. Voir [CAPABILITY-MAP.md](../CAPABILITY-MAP.md).
> Statut : **approuvée** le 13 octobre 2026.

## Objectif

Définir les formats que l'app, les skills et l'humain partagent dans GitHub, pour que tout l'état d'une tâche soit lisible dans l'issue et la PR sans l'app. Livrer le paquet TypeScript `@factory/conventions` qui lit et écrit ces formats, consommé par `orchestrator` et `inbox`.

Succès : un humain qui ouvre l'issue et la PR dans GitHub comprend où en est la tâche, ce qui attend, et peut répondre à la main. L'app relit cette réponse sans ambiguïté.

## Vocabulaire

| Terme | Sens |
|---|---|
| Tâche | Une issue GitHub portant une étiquette `phase:*` |
| Carte | Un commentaire structuré qui attend un geste de l'humain |
| Contrat | Bloc structuré dans le corps de l'issue, items validables |
| Preuve | Lien vers un artefact produit hors de l'agent (CI, fichier dans la PR) |
| Verdict | Fusion de la PR, ou retour en cadrage |

## 1. Étiquettes

Toutes en anglais, créées par l'app au premier lancement sur un dépôt.

| Groupe | Valeurs | Règle |
|---|---|---|
| `phase:` | `intent`, `framing`, `implementation`, `evidence`, `verdict` | Exactement une par tâche. Changer de phase déclenche un run. |
| `needs:` | `validation`, `arbitration`, `action` | Zéro ou plusieurs. Posée par l'agent, retirée par l'app quand plus aucune carte de ce type n'est ouverte. Alimente les trois files de l'inbox. |
| `run:` | `active`, `failed` | `active` = verrou. `failed` = le run s'est arrêté sans carte ni changement de phase. |

Transitions de phase :

```
intent ──(humain : « Lancer le cadrage »)──▶ framing
framing ──(contrat 100 % validé, humain : « Lancer l'implémentation »)──▶ implementation
implementation ──(agent : PR prête, preuves publiées)──▶ evidence
evidence ──(humain : toutes les preuves examinées)──▶ verdict
verdict ──(humain fusionne la PR)──▶ issue fermée
implementation | evidence | verdict ──(humain : « Renvoyer en cadrage »)──▶ framing
```

## 2. Verrou

- Un run en cours = étiquette `run:active` **et** issue assignée au compte qui exécute l'agent.
- L'orchestrateur ne lance jamais un run sur une tâche `run:active`.
- Si l'app redémarre et trouve `run:active` sans processus vivant : elle retire l'étiquette, pose `run:failed`, et crée une carte `action` « Run interrompu, relancer ? ».

## 3. Contrat (corps de l'issue)

L'intention reste le texte libre de l'humain, en tête du corps. Le contrat est un bloc délimité, réécrit intégralement par l'app à chaque changement. Tout ce qui est hors du bloc appartient à l'humain.

```markdown
<!-- factory:contract version=3 skill=framing@0.1.0 -->
## Contrat

### Hypothèses
- [x] **H1** — L'app n'a pas besoin de GitHub Projects. `validated`
- [ ] **H2** — Un seul dépôt par projet. `pending`

### Décisions
- [x] **D1** — Les étiquettes sont en anglais. `validated` (carte #3)
- [ ] **D2** — Le contrat est réécrit intégralement, pas patché. `discussing`

### Critères d'acceptation
- [ ] **C1** — Le parseur relit un contrat écrit à la main sans perte. `pending`
  Preuve prévue : test `contract.roundtrip` vert en CI.
- [ ] **C2** — Une étiquette inconnue ne casse pas la lecture. `rejected`
  Preuve prévue : test `labels.unknown` vert en CI.
<!-- /factory:contract -->
```

Règles :

- Identifiants `H`, `D`, `C` + entier, stables pour la vie de l'issue. Jamais réutilisés après rejet.
- Statuts d'item (jetons machine, rendus en français par l'inbox) : `pending`, `validated`, `rejected`, `discussing`.
- Un critère sans « Preuve prévue » est invalide : l'app refuse de le passer `validated`.
- La case à cocher reflète `validated`. Cocher à la main dans GitHub vaut validation : l'app relit la case et met le statut à jour.
- `version` s'incrémente à chaque réécriture. `skill` note la skill et sa version (traçabilité, cahier 6.3).
- Le passage en `implementation` exige : zéro `pending`, zéro `discussing`, au moins un critère `validated`.

## 4. Cartes (commentaires)

Un commentaire = une carte. Les cartes de cadrage vont dans l'issue, les cartes d'implémentation dans la PR. Métadonnées dans un commentaire HTML invisible, rendu Markdown en dessous.

```markdown
<!-- factory:card id=card-7 kind=arbitration origin=implementation reversibility=irreversible status=open skill=implementation@0.1.0 -->
### ⏸ Arbitrage 7 — Stockage des sessions

**Contexte** — Le contrat ne dit pas où persister l'identifiant de session Claude Code. Le run est arrêté, le travail est poussé (commit `a1b2c3d`).

**Options**
- **A.** Dans un fichier `.factory/runs/<issue>.json` du worktree. Simple, mais perdu si le worktree est supprimé.
- **B.** Dans un commentaire caché de la PR. Reconstructible depuis GitHub (principe 7).
- **C.** Dans la base locale de l'app. Rapide, contredit le principe 1.

**Recommandation** — B. C'est le seul choix cohérent avec « chaque run est reconstructible depuis le tracker ».

**Coût d'un changement d'avis** — Faible maintenant, moyen après le module `orchestrator`.
```

| Champ | Valeurs | Sens |
|---|---|---|
| `kind` | `question`, `arbitration`, `decision`, `action` | `question` : cadrage. `arbitration` : l'agent attend. `decision` : l'agent a tranché et continue. `action` : seul l'humain peut faire. |
| `origin` | `framing`, `implementation` | Phase d'émission |
| `reversibility` | `reversible`, `irreversible` | Classée par l'agent (cahier 5.2). Un `decision` est toujours `reversible`. |
| `status` | `open`, `answered`, `kept`, `reversed`, `done`, `cancelled` | `kept`/`reversed` pour `decision`, `done` pour `action`, `answered` pour les autres |

Correspondance avec les files de l'inbox :

| File | Cartes |
|---|---|
| Valider | `decision` ouvertes, items de contrat `pending` |
| Arbitrer | `question` et `arbitration` ouvertes |
| Agir | `action` ouvertes |

Toute carte à options propose au moins deux options et une recommandation. L'option « Autre » est implicite : une réponse en texte libre est toujours acceptée.

### Réponse

Un commentaire de réponse, écrit par l'app ou par l'humain à la main. L'app met ensuite `status` à jour dans la carte d'origine (édition du commentaire).

```markdown
<!-- factory:answer card=card-7 choice=B -->
B. Et note-le dans l'ADR.
```

- `choice` : lettre d'option, `keep`, `reverse`, `done`, ou `other`.
- Le texte libre après la ligne cachée est transmis intégralement à l'agent.
- Une réponse à une carte `arbitration` ou `question` déclenche un run (reprise de session si disponible).
- Une réponse `reverse` à une `decision` déclenche un run avec consigne d'annuler.

## 5. Preuves (commentaire de la PR)

Un seul commentaire, réécrit par l'agent à chaque mise à jour, identifié par `<!-- factory:evidence -->`.

```markdown
<!-- factory:evidence contract=3 -->
## Preuves

| Critère | Preuve | État |
|---|---|---|
| C1 | [CI run 4412](https://github.com/…/actions/runs/4412) — `contract.roundtrip` | `proven` |
| C3 | [capture `docs/evidence/42-inbox.png`](…) | `to-review` |
| C4 | — | `blocked` : nécessite un token (carte #9) |
```

- États : `proven` (preuve produite hors agent, verte), `to-review` (preuve présente, l'humain doit regarder), `blocked`, `missing`.
- Une ligne par critère `validated` du contrat, à la version `contract` indiquée. Un critère sans ligne est `missing`.
- Une preuve `proven` pointe obligatoirement vers une URL hors du commentaire (run CI, fichier commité, artefact de PR). Une phrase de l'agent n'est pas une preuve.
- Passage en `verdict` : zéro `missing`, zéro `blocked`, tout `to-review` a été marqué examiné par l'humain (l'app édite l'état en `proven` ou renvoie en cadrage).

## 6. ADR

- Chaque `arbitration` `irreversible` répondue produit `docs/adr/NNNN-<slug>.md` dans la PR, au format de [0001](../adr/0001-electron-typescript.md) : question, contexte, options, décision, conséquences, origine, réversibilité.
- Numérotation séquentielle sur quatre chiffres. Le numéro est réservé au moment de la réponse.
- Les `decision` `reversible` gardées ne produisent pas d'ADR. Elles restent dans la PR.

## 7. Traçabilité des skills

Chaque bloc contrat, carte et preuves porte `skill=<nom>@<semver>`. L'inbox l'affiche, l'orchestrateur le vérifie contre la skill embarquée et signale un écart.

## Stack

- TypeScript 5, Node 22, pnpm workspaces.
- Paquet `packages/conventions`, zéro dépendance Electron ni GitHub. Il ne connaît que des chaînes Markdown et des objets typés.
- Validation : `zod`. Tests : `vitest`.

## Commandes

```
Installer : pnpm install
Tester    : pnpm --filter @factory/conventions test
Lint      : pnpm --filter @factory/conventions lint
Typer     : pnpm --filter @factory/conventions typecheck
```

## Structure

```
packages/conventions/
  src/labels.ts        → constantes et transitions de phase
  src/contract.ts      → types, parse, serialize
  src/card.ts          → types, parse, serialize, answer
  src/evidence.ts      → types, parse, serialize
  src/adr.ts           → template et numérotation
  src/index.ts
  test/fixtures/       → fichiers Markdown écrits à la main, un par cas
  test/*.test.ts
```

## Style

```ts
export const PHASES = ['intent', 'framing', 'implementation', 'evidence', 'verdict'] as const;
export type Phase = (typeof PHASES)[number];

export function parseContract(body: string): Result<Contract, ContractError> {
  const block = findBlock(body, 'factory:contract');
  if (!block) return err({ kind: 'missing' });
  …
}
```

- Fonctions pures, `Result` plutôt qu'exceptions pour les erreurs de format.
- Noms de jetons machine en anglais, libellés humains en français côté inbox seulement.
- Pas de `any`, pas de `class` sauf nécessité d'une bibliothèque.

## Tests

- Aller-retour : chaque fixture parsée puis sérialisée redonne un Markdown équivalent (pas forcément octet pour octet : espaces normalisés).
- Tolérance : un contrat édité à la main avec une case cochée, une ligne ajoutée hors bloc, ou une étiquette inconnue, se lit sans erreur.
- Refus : critère sans preuve prévue, item au statut inconnu, carte sans options alors que `kind` l'exige.
- Couverture visée : 100 % des branches de `parse*` et `serialize*`. Pas de test d'intégration GitHub ici (module `orchestrator`).

## Limites

- **Toujours** : fixture avant code pour chaque format ; tests verts avant commit.
- **Demander d'abord** : ajouter une étiquette, un `kind`, un statut ; ajouter une dépendance.
- **Jamais** : appeler l'API GitHub depuis ce paquet ; importer Electron ; stocker un état hors du Markdown.

## Critères de succès

1. Les sept sections de format ci-dessus ont chacune au moins une fixture et un test vert.
2. Un contrat, une carte et un bloc de preuves écrits à la main dans une vraie issue de ce dépôt sont lus par le paquet sans erreur.
3. `pnpm --filter @factory/conventions test` passe en CI GitHub Actions sur ce dépôt.
4. Le paquet n'a aucune dépendance de production hors `zod`.

## Questions tranchées à l'approbation

1. Les cartes d'implémentation vivent dans la PR seulement. L'inbox agrège issue et PR.
2. Pas d'étiquette `factory` : une issue est gérée par l'app si et seulement si elle porte une étiquette `phase:*`.
