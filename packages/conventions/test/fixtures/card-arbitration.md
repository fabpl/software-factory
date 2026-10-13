<!-- factory:card id=card-7 kind=arbitration origin=implementation reversibility=irreversible status=open skill=implementation@0.1.0 -->
### ⏸ Arbitrage 7 — Stockage des sessions

**Contexte** — Le contrat ne dit pas où persister l'identifiant de session Claude Code. Le run est arrêté, le travail est poussé (commit `a1b2c3d`).

**Options**
- **A.** Dans un fichier `.factory/runs/<issue>.json` du worktree.
  Conséquence : Simple, mais perdu si le worktree est supprimé.
- **B.** Dans un commentaire caché de la PR.
  Conséquence : Reconstructible depuis GitHub (principe 7).
- **C.** Dans la base locale de l'app.
  Conséquence : Rapide, contredit le principe 1.

**Recommandation** — B. C'est le seul choix cohérent avec « chaque run est reconstructible depuis le tracker ».

**Coût d'un changement d'avis** — Faible maintenant, moyen après le module `orchestrator`.
