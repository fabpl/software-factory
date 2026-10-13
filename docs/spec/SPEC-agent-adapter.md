# Spec : `agent-adapter`

> Module 3 sur 5 du jalon 1. Aucune dépendance de module. Fournit l'interface `AgentAdapter` consommée par `orchestrator`.
> Statut : **approuvée** le 13 octobre 2026.

## Objectif

Piloter Claude Code en mode non interactif depuis l'app, et traduire tout ce qu'il émet vers le vocabulaire d'événements de l'app. Le cœur de l'app ne connaît ni le SDK, ni `SDKMessage`, ni la CLI : seulement `FactoryEvent`. Un second adaptateur (Codex) pourra être ajouté sans toucher au cœur.

Succès : un run de cadrage sur une issue émet une carte, s'arrête, est repris avec la réponse et continue dans la même session. Le cœur n'a vu que des `FactoryEvent`.

## Faits SDK sur lesquels la spec s'appuie

Vérifiés le 13 octobre 2026 sur `code.claude.com/docs/en/agent-sdk/typescript` et `/docs/en/hooks`.

| Fait | Usage ici |
|---|---|
| `query({ prompt, options })` retourne un `AsyncGenerator<SDKMessage>` ; `options.cwd`, `options.resume`, `options.systemPrompt: { type: 'preset', preset: 'claude_code', append }`, `options.settingSources`, `options.permissionMode`, `options.allowedTools`, `options.disallowedTools`, `options.hooks`, `options.mcpServers`, `options.abortController`, `options.maxTurns` | Lancement et reprise |
| `createSdkMcpServer({ name, tools })` + `tool(name, description, zodShape, handler)` : serveur MCP en process, outils nommés `mcp__<server>__<tool>` | Les cinq outils de `skills` |
| Hook `PreToolUse` → `hookSpecificOutput.permissionDecision: "deny"` avec raison | Interdits (`git push`, `gh`, réseau, écriture hors worktree) |
| `SDKResultMessage` : `session_id`, `subtype` (`success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`…), `is_error`, `num_turns`, `total_cost_usd`, `stop_reason` | `run.finished` / `run.failed` |
| `SDKSystemMessage` `init` : `session_id`, `tools`, `mcp_servers[].status`, `model` | `run.started`, vérification des outils requis |
| `Query.close()` termine de force ; `interrupt()` n'existe qu'en mode flux d'entrée | Repli et annulation |

## Interface fournie

```ts
export interface AgentAdapter {
  readonly id: 'claude-code' | 'codex';
  start(spec: RunSpec): AsyncIterable<FactoryEvent>;
  resume(spec: RunSpec, answer: CardAnswer): AsyncIterable<FactoryEvent>;
  cancel(runId: string): Promise<void>;
}

export interface RunSpec {
  runId: string;
  cwd: string;                      // worktree
  instructions: string;             // skill + contrat + règles, assemblé par packages/skills
  prompt: string;                   // intention ou consigne de reprise
  sessionId?: string;               // bloc de run, si reprise
  requiredTools: FactoryToolName[]; // depuis le front matter de la skill
  tools: FactoryToolHandlers;       // fournis par orchestrator
  policy: Policy;                   // outils autorisés, chemins, commandes
  model?: string;
  maxTurns?: number;
}
```

`FactoryToolHandlers` : les cinq fonctions (`emit_card`, `update_contract`, `update_evidence`, `request_adr`, `read_rules`). L'adaptateur ne sait pas ce qu'elles font ; il les expose à l'agent et observe leurs appels.

## Vocabulaire d'événements

```ts
export type FactoryEvent =
  | { type: 'run.started';      runId; sessionId; model; tools: string[] }
  | { type: 'agent.message';    runId; text }                       // texte assistant
  | { type: 'agent.tool';       runId; tool; summary; ok: boolean } // tout outil, résumé court
  | { type: 'card.emitted';     runId; card: CardInput; blocking: boolean }
  | { type: 'contract.updated'; runId; contract: ContractInput }
  | { type: 'evidence.updated'; runId; evidence: EvidenceInput }
  | { type: 'adr.requested';    runId; adr: AdrInput }
  | { type: 'run.waiting';      runId; sessionId; cardId }          // run arrêté sur carte bloquante
  | { type: 'run.finished';     runId; sessionId; turns; costUsd }
  | { type: 'run.failed';       runId; sessionId?; reason: 'max_turns' | 'budget' | 'execution' | 'tools_missing' | 'cancelled'; detail };
```

Règles :

- Un run émet exactement un événement terminal : `run.waiting`, `run.finished` ou `run.failed`.
- `card.emitted` avec `blocking: true` est toujours suivi de `run.waiting`.
- Les types `CardInput`, `ContractInput`, `EvidenceInput`, `AdrInput` viennent de `@factory/conventions`.
- Ce vocabulaire est **le** contrat entre adaptateurs et cœur. Toute extension passe par « demander d'abord ».

## Adaptateur Claude Code

### Lancement

- `systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.instructions }`.
- `cwd: spec.cwd`, `settingSources: ['project']` : CLAUDE.md et `.claude/settings.json` du dépôt cible sont lus, la configuration utilisateur jamais.
- `model: spec.model` sinon défaut de la CLI. `maxTurns: spec.maxTurns ?? 200`.
- `mcpServers: { factory: createSdkMcpServer({ name: 'factory', tools }) }` où chaque outil enveloppe un handler de `spec.tools`.
- Au message `init` : si un outil de `spec.requiredTools` manque dans `tools` ou si le serveur `factory` n'est pas `connected`, l'adaptateur appelle `close()` et émet `run.failed` avec `reason: 'tools_missing'`.

### Carte bloquante

1. Le handler `emit_card` reçoit une carte de `kind` ∈ {`question`, `arbitration`, `action`} : il la valide avec `conventions`, la publie, pousse `card.emitted` (`blocking: true`), note la carte dans l'état du run et retourne au modèle « Carte publiée, le run s'arrête. Ne fais aucun autre appel. ».
2. Le tour se termine normalement (`result` `success`). L'adaptateur, voyant une carte bloquante notée, émet `run.waiting` avec `session_id` à la place de `run.finished`.
3. **Garde-fou** : si le modèle fait encore un appel d'outil après la carte (message `assistant` avec `tool_use`), l'adaptateur appelle `close()` et émet `run.waiting` tout de suite.
4. `resume(spec, answer)` : `options.resume = spec.sessionId`, reprise ordinaire de la session ; la réponse humaine est donnée en tête de `prompt`. Aucun outil n'est rejoué, aucun hook n'intervient.
5. Si la reprise échoue (session absente) : `run.failed` avec `reason: 'execution'`. L'orchestrateur relance un run neuf.

### Cartes non bloquantes et autres outils

`decision`, `update_contract`, `update_evidence`, `request_adr`, `read_rules` : exécutés en process par le handler, événement correspondant émis, le run continue.

### Permissions

- `permissionMode: 'dontAsk'`. Tout ce qui demanderait une confirmation est refusé, l'agent reçoit le refus et s'adapte.
- `allowedTools` construit depuis `spec.policy` : `Read`, `Glob`, `Grep`, `Edit`, `Write`, `mcp__factory__*`, et `Bash(<motifs>)` pour les commandes du projet (`pnpm *`, `git status`, `git diff`, `git log`, `git add`, `git commit`, lanceur de tests).
- Hooks `PreToolUse` `deny` : `Bash` contenant `git push`, `gh `, `curl`, `rm -rf` hors worktree ; `Write`/`Edit` sur un chemin hors `spec.cwd` ou dans `.git/`.
- `disallowedTools: ['WebSearch', 'WebFetch', 'Agent']` au jalon 1 : pas de sous-agents, pas de web. Levable par `policy`.
- Jamais `bypassPermissions`.

### Traduction `SDKMessage` → `FactoryEvent`

| `SDKMessage` | `FactoryEvent` |
|---|---|
| `system` / `init` | `run.started` |
| `assistant` avec blocs texte | `agent.message` |
| `assistant` avec `tool_use` + `user` `tool_result` correspondant | `agent.tool` (nom, résumé ≤ 120 caractères, `ok` = pas `is_error`) |
| `result` `success` après une carte bloquante publiée dans le run | `run.waiting` (adaptateur) |
| `result` `success` | `run.finished` |
| `result` `error_max_turns` / `error_max_budget_usd` / `error_during_execution` | `run.failed` |
| tout le reste (`stream_event`, hooks, tâches, rate limit…) | ignoré, journalisé en debug |

Le résumé d'`agent.tool` est produit par outil : chemin pour `Read`/`Edit`/`Write`, commande tronquée pour `Bash`, titre pour `emit_card`.

### Annulation

`cancel(runId)` : `abortController.abort()` puis `close()`. Événement terminal `run.failed` avec `reason: 'cancelled'`.

## Codex (hors jalon 1, contrainte d'architecture)

L'adaptateur Codex implémentera la même interface sur `codex app-server`. Les points qui divergent (approbations, questions, diffs) seront traduits dans l'adaptateur. Rien dans `FactoryEvent` ne doit nommer un concept Claude Code : pas de `session_id` SDK exposé tel quel, pas de nom d'outil interne. Test de la contrainte : un faux adaptateur (`fake`) qui rejoue un scénario JSON est fourni et utilisé par les tests d'`orchestrator`.

## Stack

- TypeScript 5, Node 22, `@anthropic-ai/claude-agent-sdk` (version épinglée, bump = « demander d'abord »), `zod`.
- Paquet `packages/agent-adapter`. Dépend de `@factory/conventions` pour les types d'entrée des cartes. Zéro Electron, zéro GitHub.

## Commandes

```
Tester     : pnpm --filter @factory/agent-adapter test
Intégration: pnpm --filter @factory/agent-adapter test:live   (lance un vrai run court, hors CI, nécessite une session Claude Code connectée)
```

## Structure

```
packages/agent-adapter/
  src/events.ts            → FactoryEvent, RunSpec, AgentAdapter
  src/claude/adapter.ts    → start, resume, cancel
  src/claude/tools.ts      → serveur MCP factory
  src/claude/hooks.ts      → defer, deny, allow
  src/claude/translate.ts  → SDKMessage → FactoryEvent
  src/claude/policy.ts     → allowedTools et motifs Bash
  src/fake/adapter.ts      → rejoue un scénario JSON
  test/translate.test.ts
  test/hooks.test.ts
  test/fake.test.ts
  test/live/*.test.ts      → exclus de CI
```

## Style

```ts
export async function* start(spec: RunSpec): AsyncIterable<FactoryEvent> {
  const pending = new PendingCards();
  const q = query({ prompt: spec.prompt, options: buildOptions(spec, pending) });
  for await (const msg of q) {
    const ev = translate(msg, pending);
    if (ev) yield ev;
    if (ev?.type === 'run.failed' && ev.reason === 'tools_missing') q.close();
  }
}
```

- Générateurs asynchrones, pas d'émetteurs d'événements.
- `translate` est une fonction pure testable sans SDK.
- Les options SDK sont construites dans une seule fonction `buildOptions`, seul endroit qui connaît le SDK.

## Tests

- **Unitaires, en CI** : `translate` sur des fixtures `SDKMessage` JSON enregistrées depuis un vrai run ; hooks `defer`/`allow`/`deny` sur des entrées synthétiques ; `policy` → `allowedTools` attendus ; adaptateur `fake` rejoue un scénario et émet exactement la séquence attendue.
- **Live, hors CI** : un run réel de dix tours maximum avec une skill minimale qui émet une `question`, est repris avec une réponse, et termine. Vérifie `run.started → card.emitted → run.waiting → (resume) → agent.message → run.finished` et que `session_id` est stable.
- Couverture : 100 % des branches de `translate` et `hooks`.

## Limites

- **Toujours** : épingler la version du SDK ; enregistrer une fixture à chaque changement de forme de `SDKMessage` observé ; un seul événement terminal par run.
- **Demander d'abord** : étendre `FactoryEvent` ; changer `permissionMode` ; ajouter un outil au serveur `factory` ; monter la version du SDK ; autoriser web ou sous-agents.
- **Jamais** : `bypassPermissions` ; exposer `SDKMessage` hors du paquet ; laisser l'agent pousser ; stocker la session ailleurs que dans le bloc de run GitHub (via orchestrator).

## Critères de succès

1. Le test live passe une fois à la main : carte émise, run arrêté, repris avec la réponse, terminé, même `session_id`.
2. Les tests unitaires et le `fake` passent en CI.
3. `grep -r "claude-agent-sdk" packages/` ne trouve que `packages/agent-adapter/src/claude/`.
4. Un run avec un outil requis manquant échoue en moins de dix secondes avec `tools_missing`.
5. Un `Bash` contenant `git push` est refusé et le run continue.

## Amendements

- 2026-10-13 (T13, test live) : à la reprise d'un outil `factory` différé, le SDK émet `tool_deferred_unavailable` avant de connecter le serveur en process, puis poursuit la même session avec le prompt. L'adaptateur ne rejoue donc jamais l'outil : la réponse est toujours passée dans `prompt`. **Remplacé le même jour** par l'amendement « issue #4 » ci-dessous.
- 2026-10-13 (issue #4, carte 2, option A) : **plus de `defer`**. Le rejeu de l'outil différé à la reprise annulait la commande de reprise (`command_lifecycle cancelled`) et les appels `factory` des 45 premières secondes revenaient « interrupted », même avec `strictMcpConfig` (deux reprises sur trois échouées sur #2 et #4 ; reproduit par la sonde live quand son premier appel après reprise est un outil `factory`). Une carte bloquante est maintenant publiée par le handler, le tour se termine normalement et l'adaptateur convertit `run.finished` en `run.waiting` ; la reprise est une reprise ordinaire. `close()` ne sert plus que de garde-fou si le modèle rappelle un outil après la carte. Sonde live verte sur ce chemin.
- 2026-10-13 : `RunSpec.maxBudgetUsd` ajouté (question tranchée 1) ; `FactoryToolName`, `ContractInput`, `EvidenceInput`, `AdrRequest` vivent dans `conventions` (`src/tools.ts`), partagés avec `skills`.
- 2026-10-13 (point de contrôle 3) : `strictMcpConfig: true` dans `buildOptions`. Sans ce drapeau, la reprise d'une session dont le `cwd` est sous le dossier personnel charge les connecteurs claude.ai de l'utilisateur (`pending` / `needs-auth`) et leur capture de manifeste interrompt le premier appel d'outil `factory` (« The tool call was interrupted before a result was received », reproduit 8 fois, jamais avec le drapeau). Cohérent avec « la configuration utilisateur n'est jamais lue ». Option `onStderr` ajoutée pour journaliser la sortie d'erreur du processus.

## Questions tranchées à l'approbation

1. `maxTurns` 200 par défaut, plus `maxBudgetUsd` réglable. À mesurer sur les trois premières issues.
2. Le flux `SDKMessage` brut est journalisé en JSONL dans le dossier de données de l'app, purgé à 30 jours. Hors source de vérité : utile à la salle des machines, jamais nécessaire à la reprise.
