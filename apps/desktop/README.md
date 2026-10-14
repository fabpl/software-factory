# Inbox de la Software Factory

Application Electron (macOS) qui affiche les trois files de l'orchestrateur, Arbitrer, Valider et Agir, et vit dans la barre de menus. Spécification : [`docs/spec/SPEC-inbox.md`](../../docs/spec/SPEC-inbox.md).

## Lancer

Depuis la racine du dépôt, `gh` connecté (`gh auth status`) :

```sh
pnpm install
pnpm --filter desktop dev
```

- `FACTORY_REPO=owner/repo` choisit le dépôt piloté ; sans lui, `gh repo view` détecte celui du dossier courant.
- `FACTORY_HOME` remplace le dossier maison `~/.software-factory` (clones, worktrees, journaux), partagé avec `pnpm factory`.
- `pnpm --filter desktop build` produit `out/` ; `pnpm --filter desktop screenshot:blocked` capture l'écran `blocked`.

Une fois lancée :

- l'icône de la barre de menus porte le nombre de cartes en attente (vide quand il n'y en a pas ou quand l'inbox est bloquée), doublé du badge du Dock ;
- son menu propose « Ouvrir », « Rafraîchir » et « Quitter » ; ⌘R rafraîchit, ⌘Q quitte ;
- fermer la fenêtre la masque, sans arrêter l'orchestrateur ni le run en cours ;
- une notification signale chaque nouvelle carte Arbitrer ou Agir, chaque fin de run (terminé ou échoué) et chaque passage en `verdict` ; un clic ouvre la fenêtre sur la carte concernée ;
- « Quitter » est la seule sortie : il annule le run en cours (au plus 10 s), puis ferme l'app.

## Scénario manuel : fermer n'interrompt pas, quitter interrompt proprement

Critère de succès 3 de SPEC-inbox. À rejouer sur un dépôt de test, avec une issue prête à lancer (contrat validé).

1. Lancer l'app (`pnpm --filter desktop dev`) et attendre que les colonnes s'affichent.
2. Depuis la barre latérale, lancer un run d'implémentation sur l'issue de test ; l'indicateur de run affiche son activité.
3. Fermer la fenêtre (bouton rouge ou ⌘W). Vérifier que l'icône reste dans la barre de menus et que l'app reste dans le Dock.
4. Attendre au moins un tick (environ 30 s), puis rouvrir la fenêtre par « Ouvrir » dans le menu de l'icône. Vérifier que le run est toujours en cours et que son dernier événement a avancé.
5. Quitter par « Quitter » (menu de l'icône) ou ⌘Q. Vérifier que l'app se ferme en 10 s au plus.
6. Sur GitHub, vérifier que l'issue porte le verrou `run:failed` et que la tâche n'a pas de run actif.
7. Relancer l'app et attendre le premier tick.
8. Vérifier que la colonne Agir contient exactement une carte « Run interrompu, relancer ? » pour cette issue, et qu'aucune notification n'est apparue pour les cartes antérieures au lancement.

Vérifié le : …
