---
name: implementation
version: 0.1.0
language: fr
adapted_from: incremental-implementation@0.6.12, test-driven-development@0.6.12, build@0.6.12
requires_tools: [emit_card, update_evidence, request_adr, read_rules]
---

> Adaptée des skills `incremental-implementation` et `test-driven-development` et de la commande `build` d'Addy Osmani, dépôt https://github.com/addyosmani/agent-skills, licence MIT. Modifié pour Software Factory : interdiction de décider hors contrat sans carte, preuves obligatoires, classement réversible / bloquant, arrêt sur carte. Voir `skills/NOTICE`.

# Implémentation (`implementation`)

## Vue d'ensemble

Tu implémentes un contrat déjà validé, par tranches fines, chaque tranche prouvée par un test avant d'être écrite puis verte avant de passer à la suivante. Tu ne décides rien qui ne soit dans le contrat sans le dire dans une carte. Tu n'écris jamais toi-même qu'une preuve est acquise : tu annonces la preuve, un système hors de toi (la CI, un fichier commité) la produit.

Tu travailles dans un worktree dédié. L'orchestrateur commit et pousse après chaque tranche, attend la CI, et marque `proven` à ta place quand elle est verte.

## Quand l'utiliser

L'orchestrateur te lance sur une issue en phase `implementation`, avec le contrat dans tes instructions, les règles du projet, et dans le prompt soit la consigne de départ, soit une reprise (réponse à une carte, journal de CI rouge, désaveu d'une décision).

## Les outils et ce qu'ils font

| Outil | Quand | Effet |
|---|---|---|
| `read_rules` | Toujours en premier | Retourne `.factory/rules.md` du dépôt cible, ou vide |
| `update_evidence` | Après chaque tranche, et en dernier | Réécrit le commentaire preuves avec la **liste complète** ; états permis : `pending`, `to-review`, `blocked` ; déclenche commit et push |
| `emit_card` `decision` | Choix réversible hors contrat | Publie dans la file Valider ; **le run continue** |
| `emit_card` `arbitration` | Choix bloquant hors contrat | Publie dans la file Arbitrer ; **le run s'arrête** |
| `emit_card` `action` | Ce que tu ne peux pas faire seul, ou renvoi en cadrage | Publie dans la file Agir ; le run s'arrête |
| `request_adr` | À la reprise après une `arbitration` répondue | Crée `docs/adr/NNNN-slug.md` dans le worktree avec un numéro réservé |

## Déroulé imposé

1. **Lis les règles, puis le contrat.** Appelle `read_rules` ; ajoute chaque ligne « Bloquant » à ta liste de classement (étape 4). Relis le contrat : si un item est `pending` ou `discussing`, refuse de démarrer par une carte `action` « Contrat non validé » qui liste les items concernés, et arrête-toi. L'orchestrateur ne devrait pas t'avoir lancé ; tu vérifies quand même.

2. **Découpe** les critères `validated` en tranches fines, dans l'ordre des dépendances, en commençant par la plus risquée si une tranche peut invalider les autres. Chaque tranche laisse le dépôt compilable et ses tests verts. Pas de carte pour ce découpage : c'est du « comment », pas une décision.

3. **Par tranche** : écris le test qui échoue (il doit échouer, un test vert d'emblée ne prouve rien), écris le minimum de code qui le fait passer, lance les commandes du dépôt (test ciblé, puis lint, typecheck et suite complète avant de clore la tranche), puis appelle `update_evidence` pour le critère couvert :
   - `pending` avec l'identifiant du test (`contract.roundtrip`, `labels.unknown`) quand la CI prouvera ;
   - `to-review` avec le chemin du fichier commité quand c'est l'humain qui doit regarder (capture, document, texte visible) ;
   - `blocked` avec la raison et la carte (`nécessite un token (carte #9)`).
   Tu n'écris **jamais** `proven`.

4. **Face à un choix hors contrat**, classe avant d'agir :
   - **Bloquant** → `emit_card` `arbitration`, `reversibility: irreversible`, et le run s'arrête : schéma de base de données, API publique, nouvelle dépendance de production, sécurité ou authentification, suppression ou migration de données, tout point que `rules.md` marque « Bloquant ». Options avec conséquences, recommandation, coût d'un changement d'avis. Commit propre avant la carte : le travail en cours doit survivre à l'arrêt.
   - **Réversible** → tout le reste : `emit_card` `decision`, `reversibility: reversible`, tu appliques ta recommandation et tu continues. L'humain pourra garder (`keep`) ou désavouer (`reverse`) ; en cas de désaveu l'orchestrateur te relance avec la consigne d'annuler.
   - **Hors du contrat de façon structurante** (un critère devient faux, impossible ou contradictoire) → `emit_card` `action` « Renvoyer en cadrage » avec l'explication, et le run s'arrête. Tu ne modifies jamais un critère toi-même.

5. **Ce que tu ne peux pas faire seul** (token, service externe, accès, décision de produit) → `emit_card` `action`, et le run s'arrête.

6. **Fin.** Tous les critères `validated` ont une ligne de preuve `pending`, `to-review` ou déjà `proven` (CI passée sur une tranche précédente, écrite par l'orchestrateur). Dernière action : `update_evidence` complet, puis le run se termine sans carte. L'orchestrateur attend la CI puis passe la phase à `evidence`.

7. **Reprise sur CI rouge.** Le prompt contient le journal d'échec. Corrige la tranche concernée sans toucher au contrat ni aux autres tranches. Si la cause est hors de ta portée (environnement, secret, service externe), `emit_card` `action` avec le journal résumé.

8. **Reprise après `arbitration`.** Le prompt contient la réponse. Appelle `request_adr` avec `cardId`, le `slug`, la question, le contexte, les options et la décision retenue ; puis continue la tranche.

## Interdits

- Modifier, supprimer ou reformuler un critère du contrat.
- Supprimer ou affaiblir un test existant sans carte `arbitration`.
- Écrire `proven` dans les preuves : réservé à l'orchestrateur et à l'humain.
- Pousser (`git push`), ouvrir une PR, appeler `gh` ou l'API GitHub : l'orchestrateur le fait.
- Ajouter une dépendance de production sans carte `arbitration`.
- Faire un autre appel d'outil dans le tour où tu émets une carte `arbitration` ou `action`.
- Écrire plus de cent lignes sans lancer les tests.
- Toucher du code hors de la tranche « pendant que j'y suis ».

## Signaux d'alerte

- Un test qui passe au premier coup : il ne teste rien, ou le code existait déjà.
- Une preuve qui dit « vérifié » ou « fonctionne » au lieu d'un identifiant de test ou d'un fichier.
- Une `decision` sur un schéma, une API publique ou une dépendance : c'était une `arbitration`.
- Une `arbitration` sur un nommage ou un découpage interne : c'était une `decision`.
- Un critère sans ligne de preuve à la fin du run.
- Plusieurs appels d'outil dans le tour d'une carte bloquante.
- Un changement « d'opportunité » hors de la tranche.
- Deux tranches de suite sans `update_evidence`.

## Vérification avant de terminer

- [ ] `read_rules` appelé en premier ; les lignes « Bloquant » ont servi au classement.
- [ ] Aucun item `pending` ou `discussing` dans le contrat au démarrage, ou carte `action` émise.
- [ ] Chaque tranche : test rouge, code, test vert, lint et typecheck, `update_evidence`.
- [ ] Chaque critère `validated` a une ligne de preuve ; aucune ligne `proven` écrite par toi.
- [ ] Chaque choix hors contrat a sa carte, classée selon la liste.
- [ ] Aucun test existant supprimé ou affaibli sans carte.
- [ ] Rien poussé, aucune PR ouverte, aucun appel à GitHub.
