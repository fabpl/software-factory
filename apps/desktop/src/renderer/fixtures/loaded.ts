import type { CardView, InboxState } from '@factory/orchestrator';

/**
 * Une carte de chaque type, un item `pending`, une preuve à examiner, une tâche par phase et un
 * run en cours : la
 * fixture des tests de composants et des captures (H5), jamais le vrai dépôt.
 */

const ISSUE = { issue: 42, issueTitle: 'Lire les étiquettes sans Project' };

export const ARBITRATION: CardView = {
  ...ISSUE,
  id: 'card-5',
  kind: 'arbitration',
  title: 'Nouvelle dépendance de production',
  context:
    'Le rendu du contexte exige un **analyseur Markdown**.\n\n- coût : 40 ko\n- `react-markdown`',
  options: [
    { letter: 'A', text: 'Ajouter react-markdown', consequence: 'Une dépendance de plus.' },
    { letter: 'B', text: 'Afficher le texte brut', consequence: 'Lisibilité moindre.' },
  ],
  recommendation: { letter: 'A', text: 'Le contexte est écrit en Markdown.' },
  changeCost: 'Moyen : remplacer le composant de rendu.',
  reversibility: 'irreversible',
  origin: 'implementation',
  skill: 'implementation@0.1.0',
  url: 'https://github.test/acme/widget/pull/43#issuecomment-5',
  createdAt: '2026-10-14T09:48:00Z',
};

export const QUESTION: CardView = {
  issue: 44,
  issueTitle: 'Badge de la barre de menus',
  id: 'card-1',
  kind: 'question',
  title: 'Où afficher le compteur ?',
  context: 'Confiance : 40 %. Il manque l’emplacement voulu.',
  options: [
    { letter: 'A', text: 'Dans la barre de menus', consequence: 'Toujours visible.' },
    { letter: 'B', text: 'Dans le Dock', consequence: 'Masqué en plein écran.' },
    { letter: 'C', text: 'Les deux' },
  ],
  reversibility: 'reversible',
  origin: 'framing',
  skill: 'framing@0.1.0',
  url: 'https://github.test/acme/widget/issues/44#issuecomment-1',
  createdAt: '2026-10-14T08:00:00Z',
};

export const DECISION: CardView = {
  ...ISSUE,
  id: 'card-4',
  kind: 'decision',
  title: 'Nommage du module de colonnes',
  context: 'Deux noms possibles, sans effet hors du renderer.',
  options: [
    { letter: 'A', text: 'Column', consequence: 'Aligné sur la spec.' },
    { letter: 'B', text: 'Queue', consequence: 'Aligné sur le code de l’orchestrateur.' },
  ],
  recommendation: { letter: 'A', text: 'La spec nomme déjà Column.' },
  changeCost: 'Faible : un renommage.',
  reversibility: 'reversible',
  origin: 'implementation',
  skill: 'implementation@0.1.0',
  url: 'https://github.test/acme/widget/pull/43#issuecomment-4',
  createdAt: '2026-10-14T09:30:00Z',
};

export const ITEM: CardView = {
  issue: 44,
  issueTitle: 'Badge de la barre de menus',
  id: '44:H2',
  kind: 'item',
  title: 'H2 — Le badge compte toutes les colonnes.',
  context: '',
  options: [],
  url: 'https://github.test/acme/widget/issues/44',
  item: {
    id: 'H2',
    kind: 'hypothesis',
    text: 'Le badge compte toutes les colonnes.',
    status: 'pending',
  },
};

export const EVIDENCE: CardView = {
  ...ISSUE,
  id: '43:C1',
  kind: 'evidence',
  title: 'C1 — Les trois colonnes s’affichent.',
  context: '[capture](https://github.test/acme/widget/blob/factory/42-x/docs/c1.png)',
  options: [],
  url: 'https://github.test/acme/widget/pull/43#issuecomment-8',
  createdAt: '2026-10-14T09:55:00Z',
  evidence: {
    pr: 43,
    criterion: 'C1',
    artifactUrl: 'https://github.test/acme/widget/blob/factory/42-x/docs/c1.png',
  },
};

export const ACTION: CardView = {
  ...ISSUE,
  id: 'card-6',
  kind: 'action',
  title: 'Fournir un jeton npm',
  context: 'Ajoute le secret `NPM_TOKEN` au dépôt, puis réponds ici.',
  options: [],
  reversibility: 'reversible',
  origin: 'implementation',
  skill: 'implementation@0.1.0',
  url: 'https://github.test/acme/widget/pull/43#issuecomment-6',
  createdAt: '2026-10-13T10:00:00Z',
};

export const LOADED: InboxState = {
  status: 'ready',
  repo: { slug: 'acme/widget', path: '/Users/moi/.software-factory/repos/acme-widget' },
  arbitrate: [ARBITRATION, QUESTION],
  validate: [DECISION, ITEM, EVIDENCE],
  act: [ACTION],
  tasks: [
    {
      issue: 42,
      title: ISSUE.issueTitle,
      url: 'https://github.test/acme/widget/issues/42',
      phase: 'implementation',
      needs: ['arbitration', 'validation', 'action'],
      lock: { active: true, failed: false, assignee: 'factory-bot' },
      startBlockers: [],
      openCards: 3,
      pr: {
        number: 43,
        url: 'https://github.test/acme/widget/pull/43',
        draft: true,
        merged: false,
        ci: { kind: 'pending', url: 'https://github.test/acme/widget/actions/runs/1' },
      },
    },
    {
      issue: 44,
      title: 'Badge de la barre de menus',
      url: 'https://github.test/acme/widget/issues/44',
      phase: 'framing',
      needs: ['arbitration', 'validation'],
      startBlockers: [
        { kind: 'item-not-settled', id: 'H2', status: 'pending' },
        { kind: 'item-not-settled', id: 'C3', status: 'discussing' },
      ],
      openCards: 1,
    },
    {
      issue: 46,
      title: 'Exporter les preuves en PDF',
      url: 'https://github.test/acme/widget/issues/46',
      phase: 'intent',
      needs: [],
      startBlockers: [{ kind: 'no-validated-criterion' }],
      openCards: 0,
    },
    {
      issue: 38,
      title: 'Journal des runs',
      url: 'https://github.test/acme/widget/issues/38',
      phase: 'evidence',
      needs: [],
      startBlockers: [],
      openCards: 0,
      pr: {
        number: 39,
        url: 'https://github.test/acme/widget/pull/39',
        draft: false,
        merged: false,
        ci: { kind: 'green', url: 'https://github.test/acme/widget/actions/runs/2' },
      },
    },
    {
      issue: 36,
      title: 'Compteur du README',
      url: 'https://github.test/acme/widget/issues/36',
      phase: 'verdict',
      needs: [],
      lock: { active: false, failed: true },
      startBlockers: [],
      openCards: 0,
      pr: {
        number: 37,
        url: 'https://github.test/acme/widget/pull/37',
        draft: false,
        merged: true,
        ci: { kind: 'red', url: 'https://github.test/acme/widget/actions/runs/3' },
      },
    },
  ],
  run: {
    issue: 42,
    skill: 'implementation@0.1.0',
    startedAt: '2026-10-14T09:40:00Z',
    lastEvent: {
      type: 'agent.tool',
      runId: 'run-1',
      tool: 'Edit',
      summary: 'Colonne.tsx : tranche 2, colonnes',
      ok: true,
    },
    lastAgentEvent: {
      type: 'agent.tool',
      runId: 'run-1',
      tool: 'Edit',
      summary: 'Colonne.tsx : tranche 2, colonnes',
      ok: true,
    },
  },
  lastSync: new Date('2026-10-14T10:00:00Z'),
  errors: [],
};
