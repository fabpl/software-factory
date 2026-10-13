# Carte des capacités — Jalon 1

> Validée le 13 octobre 2026. Les identifiants de modules sont stables : ils nomment les specs (`docs/spec/SPEC-<module>.md`) et les tâches.

| Module | Responsabilité | Dépend de |
|---|---|---|
| `conventions` | Formats GitHub : étiquettes, contrat dans le corps de l'issue, cartes et arbitrages en commentaires, dossier de preuves, ADR | — |
| `skills` | SKILL.md cadrage et implémentation, adaptées des agent-skills d'Addy Osmani (MIT, attribution conservée) | conventions |
| `agent-adapter` | Pilotage de Claude Code en JSON non interactif, reprise de session, traduction vers le vocabulaire d'événements de l'app | — |
| `orchestrator` | Lit GitHub, pose le verrou, crée le worktree, lance le run avec la skill injectée, écrit les réponses | conventions, skills, agent-adapter |
| `inbox` | Electron : trois files Valider / Arbitrer / Agir, cartes, actions | orchestrator |

**Ordre de construction :** conventions → skills ∥ agent-adapter → orchestrator → inbox.

**Règle :** une spec par module, approuvée avant la suivante. Les interfaces entre modules sont décrites dans la spec du module fournisseur.
