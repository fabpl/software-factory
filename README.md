# Software Factory

> **En construction.** Software factory orientée décision : l'humain spécifie une intention, valide les décisions importantes, valide des preuves. Il n'écrit ni ne lit de code.

## Thèse

Les outils agentiques actuels font décider pendant ou après l'implémentation. Ici on décide **avant**, dans des cartes structurées, pas dans une conversation. L'écran principal est une boîte à trois files : **Arbitrer** (l'agent attend ton choix), **Valider** (l'agent a tranché, tu confirmes ou désavoues), **Agir** (ce que l'app ne peut pas faire à ta place).

GitHub est la seule source de vérité. Le projet se construit avec lui-même dès que la boucle minimale tourne.

## Documents

- [Énoncé d'intention](docs/intent/software-factory.md)
- [Carte des capacités](docs/CAPABILITY-MAP.md) et [specs](docs/spec/)
- [Décisions (ADR)](docs/adr/)
- [Plan](tasks/plan.md) et [tâches](tasks/todo.md)

## Compteur

Nombre de fois où il a fallu ouvrir le code pendant le dogfooding, et pourquoi : **0** (pas encore commencé).

## Développement

```bash
corepack pnpm install
corepack pnpm check
```

Skills adaptées des [agent-skills](https://github.com/addyosmani/agent-skills) d'Addy Osmani (MIT), voir `NOTICE`.
