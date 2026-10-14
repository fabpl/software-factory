# Spec : `inbox`

> Module 5 sur 5 du jalon 1. Dépend de [`orchestrator`](SPEC-orchestrator.md). Dernier module de la carte des capacités.
> Statut : **approuvée** le 13 octobre 2026.

## Objectif

L'app desktop macOS et son unique écran : une boîte à trois files où l'humain arbitre, valide et agit sans ouvrir le code. Elle affiche `InboxState`, envoie des commandes à l'orchestrateur, et rien d'autre.

Succès : l'humain traite une issue de ce dépôt de l'intention au verdict en n'utilisant que cet écran. Chaque fois qu'il doit sortir de l'app (GitHub, terminal, éditeur), c'est compté.

## Stack

- Electron (version épinglée), `electron-vite`, React 19, TypeScript 5, Tailwind 4, shadcn/ui (Radix), lucide-react, sonner, react-markdown (contexte des cartes, sans `rehype-raw` : aucun HTML brut rendu, encapsulé dans `Markdown.tsx`).
- Paquet `apps/desktop` : `src/main` (process principal, branche `Orchestrator` sur IPC), `src/preload` (`contextBridge`), `src/renderer` (React).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` côté renderer. Le renderer ne voit que l'API typée exposée par le preload.
- Pas de gestionnaire d'état : `InboxState` arrive entier via IPC, l'interface est une fonction pure de cet état plus un état local d'ouverture de cartes.

## Écran

```
┌──────────────┬───────────────────────────────────────────────────────────────┐
│ Dépôt        │  ARBITRER (2)        VALIDER (5)          AGIR (1)            │
│ owner/repo   │  ┌─────────────┐    ┌─────────────┐     ┌─────────────┐      │
│              │  │ ⏸ Arbitrage │    │ ✎ Décision  │     │ ☐ Action     │      │
│ + Intention  │  │ #42 · bloq. │    │ #42 · rév.  │     │ #42          │      │
│              │  └─────────────┘    └─────────────┘     └─────────────┘      │
│ Tâches       │  ┌─────────────┐    ┌─────────────┐                          │
│  intent (1)  │  │ ? Question  │    │ H2 contrat  │                          │
│  framing (1) │  │ #43 · cadr. │    │ #43         │                          │
│  implem. (1) │  └─────────────┘    └─────────────┘                          │
│  evidence    │                     ┌─────────────┐                          │
│  verdict     │                     │ C1 preuve   │                          │
│              │                     │ #42 à exam. │                          │
│ ● Run #42    │                     └─────────────┘                          │
│   implem.    │                                                               │
│   12 min     │                                                               │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

### Trois colonnes, dans cet ordre

| Colonne | Contenu | Tri |
|---|---|---|
| **Arbitrer** | `question` et `arbitration` ouvertes | `irreversible` d'abord, puis plus ancienne d'abord |
| **Valider** | `decision` ouvertes, items de contrat `pending`, preuves `to-review` | décisions, puis items, puis preuves ; ancienneté |
| **Agir** | `action` ouvertes, prérequis manquants (`status: blocked`) | prérequis d'abord |

Le compteur de chaque colonne est dans l'en-tête. Colonne vide = message « Rien à faire ici ».

### Carte repliée

Icône du `kind`, titre, numéro d'issue, badge réversibilité, âge. Un clic déplie.

### Carte dépliée

- **Contexte** (Markdown rendu).
- **Options** : lettre, texte, conséquence. L'option recommandée porte un surlignage et la mention « Recommandé ».
- **Coût d'un changement d'avis**, **réversibilité**, **origine** (cadrage / implémentation), **skill** et version.
- Lien « Ouvrir dans GitHub » vers le commentaire.
- Zone de réponse selon le `kind` :

| `kind` | Réponse |
|---|---|
| `question`, `arbitration` | Un bouton par option + « Autre » (champ texte obligatoire) |
| `decision` | « Garder » / « Renverser » ; sur Renverser, case « Ça aurait dû me bloquer » + note facultative |
| `action` | « C'est fait » + note facultative ; le texte de la carte dit quoi faire |
| item de contrat | « Valider » / « Rejeter » / « À discuter » + note (obligatoire pour les deux derniers) |
| preuve `to-review` | Lien vers l'artefact, « Prouvé » / « Bloqué » + note (obligatoire pour Bloqué) |

Répondre envoie la commande, affiche un toast « Envoyé, l'agent reprend », et la carte quitte la colonne au prochain `InboxState`. Pas de confirmation modale : tout est réversible côté GitHub et visible dans l'issue.

### Barre latérale

- **Dépôt** : chemin local et `owner/repo` déduit de l'origin. Un seul dépôt au jalon 1 ; changer = choisir un autre dossier.
- **Nouvelle intention** : titre + texte libre. Crée l'issue avec `phase:intent`. Bouton « Lancer le cadrage » disponible aussitôt.
- **Tâches par phase** : liste repliable, chaque tâche avec ses actions contextuelles :
  - `intent` → « Lancer le cadrage »
  - `framing` → « Lancer l'implémentation » (grisé avec raison tant que le contrat a un `pending` ou `discussing` ou zéro critère)
  - `implementation`, `evidence`, `verdict` → « Renvoyer en cadrage » (motif obligatoire)
  - toutes → « Ouvrir dans GitHub »
- **Run en cours** : issue, skill, durée, dernier `agent.tool` ou `agent.message` résumé. Bouton « Annuler » (confirmation, c'est la seule modale).
- **Dernière synchro** et bouton « Rafraîchir ».

### État `blocked`

Si `InboxState.status === 'blocked'`, les trois colonnes sont remplacées par une carte Agir unique : message et commande à copier (`gh auth login`, etc.), bouton « Réessayer ».

## Barre de menus et fenêtre

- Fermer la fenêtre cache la fenêtre ; l'app reste dans la barre de menus avec un badge = nombre de cartes en attente (toutes colonnes).
- Menu : « Ouvrir », « Rafraîchir », « Quitter ». Quitter appelle `cancel` sur le run en cours, attend l'événement terminal (délai max 10 s), puis quitte. L'état est dans GitHub.
- Notification macOS : nouvelle carte bloquante (titre + issue), fin de run (`finished` ou `failed`), passage en `verdict`. Cliquer ouvre la fenêtre sur la carte.

## Langue et libellés

Tout en français. Un dictionnaire unique `labels.ts` traduit les jetons machine (`kind`, statuts, phases, étiquettes) ; aucun jeton anglais n'apparaît à l'écran. Les textes de cartes sont affichés tels que l'agent les a écrits.

## Commandes

```
Dev        : pnpm --filter desktop dev
Tester     : pnpm --filter desktop test           (Vitest + Testing Library)
E2E        : pnpm --filter desktop test:e2e       (Playwright Electron, orchestrateur en mode fake)
Construire : pnpm --filter desktop build          (electron-builder, .dmg non signé au jalon 1)
```

## Structure

```
apps/desktop/
  src/main/index.ts          → fenêtre, barre de menus, notifications, branchement IPC
  src/main/ipc.ts            → Orchestrator → handlers IPC (une fonction par commande)
  src/preload/index.ts       → contextBridge : api.commands.*, api.subscribe
  src/renderer/App.tsx
  src/renderer/components/   → Column, Card, CardAnswer, Sidebar, RunIndicator, BlockedScreen
  src/renderer/labels.ts
  src/renderer/fixtures/     → InboxState de test (vide, chargé, bloqué, run en cours)
  test/                      → tests composants
  e2e/                       → Playwright
```

## Style

```tsx
export function Card({ card, onAnswer }: { card: CardView; onAnswer: (a: CardAnswer) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article aria-expanded={open} className="rounded-lg border p-3">
      <CardHeader card={card} onToggle={() => setOpen(o => !o)} />
      {open && <CardBody card={card} />}
      {open && <CardAnswer kind={card.kind} options={card.options} onSubmit={onAnswer} />}
    </article>
  );
}
```

- Composants fonctionnels, props typées depuis `@factory/orchestrator` (`CardView`, `InboxState`).
- Aucune logique métier dans le renderer : pas de calcul de phase, de tri complexe ou de validation. Tout vient de l'orchestrateur.
- Accessibilité : chaque carte est un `article`, les options sont des boutons avec raccourcis clavier `A`/`B`/`C`.

## Tests

- **Composants** : chaque fixture `InboxState` rend sans erreur ; une carte de chaque `kind` affiche la bonne zone de réponse ; la réponse appelle la bonne commande avec le bon payload ; le bouton « Lancer l'implémentation » est grisé avec la raison quand le contrat est incomplet.
- **E2E** : l'app démarre avec l'orchestrateur en mode `fake` (scénario `full-loop.json`), répond à une `question`, valide un item, tranche un `arbitration`, marque une preuve prouvée, et voit la carte « Fusionner la PR » apparaître.
- **Manuel, avant de déclarer le jalon** : dogfooding sur une issue réelle de ce dépôt, compteur des sorties de l'app tenu dans l'issue.

## Limites

- **Toujours** : `contextIsolation` ; l'interface ne lit que `InboxState` ; libellés via `labels.ts`.
- **Demander d'abord** : nouvel écran ou vue ; gestionnaire d'état ; dépendance d'interface hors de la liste ; signature et notarisation.
- **Jamais** : logique métier dans le renderer ; appel GitHub ou SDK depuis `apps/desktop` ; `nodeIntegration` ; terminal intégré.

## Critères de succès

1. Le test E2E passe en CI (Playwright Electron, mode `fake`).
2. Une issue réelle de ce dépôt est traitée de l'intention au verdict depuis l'app, et le nombre de sorties de l'app est consigné dans l'issue.
3. Fermer la fenêtre pendant un run ne l'interrompt pas ; quitter l'app l'interrompt proprement et le tick suivant après relance produit une seule carte « Run interrompu ».
4. Aucun jeton machine anglais visible à l'écran (test sur les fixtures).
5. `pnpm --filter desktop build` produit un `.dmg` qui démarre sur ta machine.

## Questions tranchées à l'approbation

1. Nom provisoire : **Software Factory** (`productName: "Software Factory"`, identifiant `software-factory`). Renommable avant la première issue publique.
2. Pas de raccourci global au jalon 1.
