/**
 * Libellés de l'écran (SPEC-inbox, « Langue et libellés »). T21 : seulement l'écran `blocked` et
 * l'écran d'attente ; le dictionnaire complet (kinds, statuts, phases) arrive avec T22.
 */
export const LABELS = {
  connecting: 'Connexion à l’orchestrateur…',
  blockedTitle: 'Prérequis manquant',
  blockedHint: 'Lance cette commande dans un terminal, puis réessaie.',
  copy: 'Copier',
  copied: 'Copié',
  retry: 'Réessayer',
  retrying: 'Réessai…',
  readyTitle: 'Orchestrateur prêt',
  readyHint: 'Les files Arbitrer, Valider et Agir arrivent avec la tâche suivante.',
  lastSync: 'Dernière synchronisation',
} as const;
