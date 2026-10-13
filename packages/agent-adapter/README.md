# `@factory/agent-adapter`

Pilote Claude Code en mode non interactif et traduit tout ce qu'il émet en `FactoryEvent` (voir [`docs/spec/SPEC-agent-adapter.md`](../../docs/spec/SPEC-agent-adapter.md)). Le cœur ne voit ni le SDK, ni `SDKMessage`.

```
pnpm --filter @factory/agent-adapter test        # unitaires + fake, en CI
pnpm --filter @factory/agent-adapter test:live   # un vrai run court, hors CI (Claude Code connecté)
```

## Isolation du SDK

`grep -r "claude-agent-sdk" packages/*/src` ne doit sortir que `packages/agent-adapter/src/claude/`. Les fonctions pures (`translate`, `hooks`, `policy`, `handlers`) lisent des objets simples et sont couvertes à 100 % ; le câblage SDK (`options.ts`, `server.ts`, `adapter.ts`) n'est exercé que par le test live.

## Test live

Dernier passage : **13 octobre 2026, vert** (SDK `0.3.296`, modèle `claude-opus-5-5`, deux tests, 17 s).

- `run.started → agent.tool (read_rules) → card.emitted (blocking) → run.waiting`, puis à la reprise `run.started → agent.message → agent.tool (Bash, refusé) → agent.message → run.finished`, même `session_id`, la carte répondue n'est pas republiée.
- `git push origin main` refusé par le hook (`PreToolUse:Bash hook error`), le run continue.
- Un outil requis manquant échoue en moins de dix secondes avec `tools_missing`.
- Flux brut enregistré dans `test/fixtures/sdk/live-roundtrip.json` ; le test `translate` le rejoue en CI.

Observations qui ont fait évoluer l'implémentation par rapport à la spec :

1. **`tool_deferred_unavailable` à la reprise.** Le SDK vérifie l'outil différé _avant_ de connecter le serveur MCP `factory` (fourni en process), le déclare indisponible, puis poursuit la même session avec le prompt. Le hook n'est donc jamais rejoué pour un outil en process. L'adaptateur passe la réponse humaine dans le prompt à chaque reprise, ignore ce premier `result` et attend le second ; si le flux se termine sans second `result`, `run.failed` (`execution`).
2. **Outils MCP chargés à la demande.** Le modèle appelle `ToolSearch` avant le premier outil `factory` ; `init.tools` les liste bien. Événement `agent.tool` ordinaire.
3. **Messages ignorés rencontrés** : `rate_limit_event`, `command_lifecycle`, `system/thinking_tokens`.
4. **`tool_result` « interrupted » sur un outil `factory` — résolu.** À la reprise d'une session dont le `cwd` est sous le dossier personnel, le CLI chargeait les connecteurs claude.ai de l'utilisateur (`init.mcp_servers` : `pending`, `needs-auth`) en plus de `factory` ; leur capture de manifeste interrompait le premier appel `factory` du run (« The tool call was interrupted before a result was received », `non_execution_kind: interrupted`, en 9 ms, handler jamais appelé). Reproduit 8 fois le 13 octobre 2026 (dossier vide sous `~/.software-factory`, reprise, n'importe quel contenu), jamais sous `/tmp`, jamais sur un run neuf. Correctif : `strictMcpConfig: true` (seul le serveur `factory`), sonde verte ensuite. L'adaptateur journalise aussi la sortie d'erreur du processus (`onStderr`).
