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
- `FACTORY_INHERIT_PATH=1` garde le `PATH` hérité dans l'app empaquetée (voir « Construire »).
- `pnpm --filter desktop build` produit le `.dmg` (voir « Construire ») ; `pnpm --filter desktop screenshot:blocked` capture l'écran `blocked`.

Une fois lancée :

- l'icône de la barre de menus porte le nombre de cartes en attente (vide quand il n'y en a pas ou quand l'inbox est bloquée), doublé du badge du Dock ;
- son menu propose « Ouvrir », « Rafraîchir » et « Quitter » ; ⌘R rafraîchit, ⌘Q quitte ;
- fermer la fenêtre la masque, sans arrêter l'orchestrateur ni le run en cours ;
- une notification signale chaque nouvelle carte Arbitrer ou Agir, chaque fin de run (terminé ou échoué) et chaque passage en `verdict` ; un clic ouvre la fenêtre sur la carte concernée ;
- « Quitter » est la seule sortie : il annule le run en cours (au plus 10 s), puis ferme l'app.

## Construire

```sh
pnpm --filter desktop build          # electron-vite build, puis electron-builder --mac dmg
pnpm --filter desktop build:dir      # même paquet, sans .dmg : dist/mac-arm64/Software Factory.app
pnpm --filter desktop test:packaged  # Playwright sur l'app de dist/mac-arm64 (à lancer après build:dir)
```

`build` produit `dist/Software Factory-<version>-arm64.dmg` : arm64 seulement, non signé, non notarisé, icône Electron par défaut. Configuration : `electron-builder.yml`.

L'app installée exécute le même `out/main/index.js`, le même preload et le même renderer que `pnpm --filter desktop dev`, et partage `FACTORY_HOME`, `FACTORY_REPO` et `~/.software-factory` avec `pnpm factory`.

Contenu embarqué :

- `out/` et `package.json` dans `app.asar` ; `@factory/*` y est déjà bundlé par electron-vite, donc exclu de `node_modules` ;
- les dépendances de production de `package.json` dans `node_modules` ;
- `@anthropic-ai/claude-agent-sdk*` hors de l'asar (`app.asar.unpacked/`) : le SDK lance son binaire `claude` en sous-processus, qui doit rester un fichier exécutable ;
- `skills/` (racine du dépôt) dans `Contents/Resources/skills`, où `defaultSkillsDir()` le trouve en remontant depuis `app.asar/out/main/`.

`electron-builder` construit sans script d'installation : `onlyBuiltDependencies` de `pnpm-workspace.yaml` ne liste toujours qu'`electron`.

**Ouvrir l'app non signée.** Au premier lancement, macOS refuse une app téléchargée sans signature Developer ID. Clic droit sur l'app dans Applications, « Ouvrir », puis confirmer ; ou `xattr -dr com.apple.quarantine "/Applications/Software Factory.app"`.

**`PATH` depuis le Finder.** Lancée depuis le Finder, une app n'hérite que du `PATH` minimal de launchd (`/usr/bin:/bin:/usr/sbin:/sbin`) et ne trouverait ni `gh` ni les outils de l'agent (`node`, `pnpm`). Au démarrage, l'app empaquetée lit donc une fois le `PATH` de `$SHELL -ilc` (5 s au plus, sortie lue entre deux marqueurs pour ignorer les bannières de `.zshrc`) et l'applique avant `bootstrap()`. En cas d'échec, de délai dépassé ou de sortie illisible, elle garde le `PATH` hérité. `FACTORY_INHERIT_PATH=1` désactive cette résolution : aucun shell n'est lancé. Le test empaqueté la pose, avec `PATH=/usr/bin:/bin`, pour obtenir l'écran `blocked` sans dépendre de la machine. `pnpm --filter desktop dev` ne lance jamais ce shell.

**Dépôt piloté depuis le Finder.** Le dossier courant d'une app lancée depuis le Finder est `/` : sans `FACTORY_REPO`, `gh repo view` ne trouve aucun dépôt et l'app affiche l'écran `blocked`. Avant de lancer l'app :

```sh
launchctl setenv FACTORY_REPO owner/repo   # vaut jusqu'à la fin de session ou launchctl unsetenv
```

En CI, le job `packaged` (`macos-latest`) lance `build:dir` puis `test:packaged` ; il ne construit ni ne publie de `.dmg`. `e2e/packaged.spec.ts` démarre l'exécutable de l'app avec `PATH=/usr/bin:/bin`, `FACTORY_INHERIT_PATH=1` et un `FACTORY_HOME` temporaire ; il vérifie l'écran `blocked`, l'absence d'erreur de chargement, l'emplacement de `skills/` et le bit d'exécution du binaire `claude`. `test:e2e` ne l'exécute pas.

Construction du 15 octobre 2026 (`pnpm --filter desktop build`, fin de sortie, sans erreur) :

```text
  • skipped macOS code signing  reason=identity explicitly is set to null
  • building        target=DMG arch=arm64 file=dist/Software Factory-0.0.0-arm64.dmg
  • building block map  blockMapFile=dist/Software Factory-0.0.0-arm64.dmg.blockmap
```

`codesign -dv "dist/mac-arm64/Software Factory.app"` (à recopier : la commande n'a pas pu être lancée par l'agent) :

```text
À compléter.
```

### Scénario manuel : l'app installée depuis le `.dmg`

1. `pnpm --filter desktop build`, puis ouvrir `apps/desktop/dist/Software Factory-<version>-arm64.dmg`.
2. Glisser « Software Factory » dans Applications, puis éjecter le `.dmg`.
3. `launchctl setenv FACTORY_REPO owner/repo` sur un dépôt de test, `gh` connecté dans le terminal.
4. Lancer l'app depuis le Finder (Applications, double-clic ; « Ouvrir » si macOS le demande).
5. Vérifier que les colonnes Arbitrer, Valider et Agir s'affichent, pas l'écran `blocked`, et que l'icône apparaît dans la barre de menus.
6. Quitter par « Quitter », puis `launchctl unsetenv FACTORY_REPO`.

Vérifié le :

## E2E

```sh
pnpm --filter desktop test:e2e
```

La commande construit l'app (`electron-vite build`) puis lance `playwright test` sur `e2e/`. Playwright démarre l'app construite sur l'entrée `out/main/e2e.js` : c'est la même app (renderer, preload, IPC), mais l'orchestrateur vient de `bootstrapFake` (`@factory/orchestrator/fake`) au lieu de `bootstrap()`. `pnpm test` ne lance pas Playwright. En CI, le job `e2e` tourne sur `macos-latest`, sans `GH_TOKEN`.

Le test `e2e/full-loop.spec.ts` va de l'intention jusqu'à la carte « Fusionner la PR » dans Agir. Il ne passe que par rôles et libellés français, sans pause fixe ni clic sur « Rafraîchir ». À l'échec, la trace et la capture restent dans `test-results/`, que git ignore.

Ce que fait le mode `fake` :

- GitHub en mémoire, amorcé avec une issue #1 en `phase:intent` ;
- agent simulé qui rejoue le scénario `full-loop.json` (cadrage puis implémentation) ;
- CI verte dès qu'on la lit pour la tête de toute PR ouverte ;
- dépôt `origin` nu, worktrees et journaux dans des dossiers temporaires sous `os.tmpdir()`, jamais dans `~/.software-factory` ;
- tick toutes les 500 ms.

Ce qu'il ne fait pas :

- pas de vrai SDK Claude, de vrai dépôt, de `gh` ni de réseau ;
- `FACTORY_REPO` n'est pas lu ;
- pas d'état « CI en cours » ;
- pas de fusion : le test s'arrête à la carte « Fusionner la PR » ;
- pas d'E2E sous Linux.

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

Vérifié le : 14 octobre 2026, sur l'issue jetable #12 (run de cadrage lancé depuis la barre latérale, carte répondue depuis l'app pour relancer le run avant de quitter).

- Étapes 3 et 4 : fenêtre fermée pendant le run, process vivant, run poursuivi jusqu'à sa carte ; fenêtre rouverte par « Ouvrir » dans le menu de l'icône. Si un gestionnaire d'icônes de barre de menus est installé, l'icône peut être rangée derrière son bouton « << ».
- Étapes 5 et 6 : « Quitter » pendant le run : `run.failed` (`cancelled`) 4 s après le clic, process terminé environ 11 s après le clic (le reste est l'écriture GitHub du bloc de run, du verrou `run:failed` et de la carte Agir, faite avant de quitter). Sans run, « Quitter » prend encore environ 9 s : écart non expliqué, à suivre.
- Étapes 7 et 8 : après relance, colonne Agir = exactement une carte « Run interrompu, relancer ? », badge de l'icône et du Dock = cartes en attente. Les notifications n'ont pas été observées pendant ce passage : à vérifier à la prochaine session de dogfooding (une seule attendue, celle de la carte de cadrage).
