Je veux que l'app lise les étiquettes sans configurer un Project.

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

Note ajoutée après coup par l'humain.
