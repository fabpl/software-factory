# Énoncé d'intention — Software factory orientée décision

> Confirmé le 13 octobre 2026, à l'issue d'un entretien de cadrage (6 questions).
> Ce document est l'entrée de la spec du jalon 1. Il ne remplace pas le cahier des charges V0.

## Résultat

Une app macOS (Electron + TypeScript) dont l'écran unique est une boîte à trois files :

| File | Sens | Geste de l'humain |
|---|---|---|
| **Valider** | L'agent a tranché seul et soumet : items du contrat, décisions réversibles prises en implémentation | Confirmer ou désavouer |
| **Arbitrer** | L'agent n'a pas tranché et attend : questions de cadrage, arbitrages bloquants | Choisir une option (ou « Autre ») |
| **Agir** | Ce que l'app ne peut pas faire à la place de l'humain : fusionner la PR, fournir un secret, débloquer la CI, répondre à une question hors contexte | Faire, puis marquer fait |

## Utilisateur

L'auteur seul, sur ses projets. Dogfooding dès la deuxième issue du dépôt.

## Pourquoi maintenant

Les outils actuels font décider pendant ou après l'implémentation. Ici on décide avant, dans des cartes structurées, pas dans une conversation.

## Succès (jalon 1)

Une issue de ce dépôt traverse intention → cadrage → implémentation → preuves → verdict via l'app, sans que l'humain ouvre le code. Chaque ouverture du code est comptée et expliquée.

## Contraintes

- **GitHub est la seule source de vérité.** L'app ne détient aucun état indispensable.
- **La carte est la seule primitive.** Le cadrage est une suite de cartes Arbitrer ; le contrat se remplit dans Valider. Un champ « Autre » absorbe ce qui ne tient pas en options ; l'agent reformule en options au tour suivant.
- **Seuil réversible / bloquant :** l'agent classe seul, avec la liste du cahier des charges (schéma de base, API publique, nouvelle dépendance, sécurité = bloquant). Un désaveu (« ça aurait dû me bloquer ») devient une règle du projet. Le contrat peut durcir le seuil pour une tâche donnée.
- **Skills :** copies adaptées des agent-skills d'Addy Osmani (interview-me, spec, plan, build…), versionnées dans l'app, injectées dans les instructions du run. Jamais référencées comme dépendance, jamais copiées dans le dépôt du projet cible.
- **Stack :** Electron + TypeScript (voir ADR 0001).

## Hors périmètre du jalon 1

Kanban, salle des machines, skills intention et revue globale, Codex, Linear, service en arrière-plan, personnalisation des skills par projet, Windows, Linux, terminal interactif.

## Décisions prises pendant l'entretien

| # | Question | Choix | Réversibilité |
|---|---|---|---|
| 1 | Contenu de la file Agir | Uniquement ce que l'app ne peut pas faire | Moyenne |
| 2 | Frontière Valider / Arbitrer | « L'agent a-t-il tranché ? » et non la phase | Faible |
| 3 | Boucle minimale | Une issue, cinq phases, un écran, deux skills | Élevée |
| 4 | Lieu du cadrage | Cartes Arbitrer, pas de conversation | Moyenne |
| 5 | Seuil réversible / bloquant | Agent classe seul, désaveu enrichit la règle, contrat peut durcir | Élevée |
| 6 | Stack | Electron + TypeScript | Faible après jalon 1 |
