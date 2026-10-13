# Scénario manuel `framing` — issue simple

> Exécuté par l'humain via l'orchestrateur (SPEC-skills, Tests). Résultat à noter dans `skills/framing/CHANGELOG.md`.

## Intention

« Ajouter un compteur dans le README : nombre de fois où il a fallu ouvrir le code pendant le dogfooding, et pourquoi. »

## Séquence attendue

1. `read_rules` en premier.
2. `update_contract` avec au moins une hypothèse `pending` avant la première carte.
3. Entre une et quatre cartes `question`, chacune avec deux à quatre options et une recommandation.
4. Contrat final : au moins un critère, chaque critère avec une preuve prévue (fichier commité ou test CI), une hypothèse « Hors périmètre ».
5. Aucune carte `decision`, aucune `arbitration`, aucun fichier écrit hors `prototype/`.
6. Le contrat produit se parse avec `@factory/conventions` (`pnpm conventions:check <issue>`).
