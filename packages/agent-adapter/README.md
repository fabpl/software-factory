# `@factory/agent-adapter`

Pilote Claude Code en mode non interactif et traduit tout ce qu'il émet en `FactoryEvent` (voir [`docs/spec/SPEC-agent-adapter.md`](../../docs/spec/SPEC-agent-adapter.md)). Le cœur ne voit ni le SDK, ni `SDKMessage`.

```
pnpm --filter @factory/agent-adapter test        # unitaires + fake, en CI
pnpm --filter @factory/agent-adapter test:live   # un vrai run court, hors CI (Claude Code connecté)
```

## Isolation du SDK

`grep -r "claude-agent-sdk" packages/*/src` ne doit sortir que `packages/agent-adapter/src/claude/`. Les fonctions pures (`translate`, `hooks`, `policy`, `handlers`) lisent des objets simples et sont couvertes à 100 % ; le câblage SDK (`options.ts`, `server.ts`, `adapter.ts`) n'est exercé que par le test live.

## Test live

Dernier passage : **13 octobre 2026, vert** (SDK `0.3.296`, deux tests, 25 s). Le premier appel du run repris est un outil `factory` : c'est le chemin qui échouait en vrai (point 4).

- `run.started → agent.tool (read_rules) → agent.tool (emit_card) → card.emitted (blocking) → agent.message → run.waiting`, puis à la reprise `run.started → agent.tool (read_rules) → agent.message → agent.tool (Bash) → agent.tool (Bash, refusé) → agent.message → run.finished`, même `session_id`, la carte répondue n'est pas republiée.
- `git push origin main` refusé par le hook (`PreToolUse:Bash hook error`), le run continue.
- Un outil requis manquant échoue en moins de dix secondes avec `tools_missing`.
- Flux brut enregistré dans `test/fixtures/sdk/live-roundtrip.json` ; le test `translate` le rejoue en CI.

Observations qui ont fait évoluer l'implémentation par rapport à la spec :

1. **Plus de `defer`.** Avec le hook `defer`, le SDK vérifiait l'outil différé _avant_ de connecter le serveur MCP `factory` (fourni en process), le déclarait indisponible (`tool_deferred_unavailable`), annulait la commande de reprise (`command_lifecycle cancelled`) puis poursuivait la session ; les appels `factory` des 45 premières secondes revenaient alors « interrupted » (voir 4). L'adaptateur ne diffère plus rien : le handler publie la carte bloquante et répond « le run s'arrête », le tour se termine normalement, `run.finished` devient `run.waiting`, et la reprise est ordinaire avec la réponse en tête du prompt.
2. **Outils MCP chargés à la demande.** Le modèle appelle `ToolSearch` avant le premier outil `factory` ; `init.tools` les liste bien. Événement `agent.tool` ordinaire.
3. **Messages ignorés rencontrés** : `rate_limit_event`, `command_lifecycle`, `system/thinking_tokens`.
4. **`tool_result` « interrupted » sur un outil `factory` à la reprise — résolu en deux temps.** Premier diagnostic (13 octobre 2026, matin) : les connecteurs claude.ai de l'utilisateur chargés à la reprise (`cwd` sous le dossier personnel) ; `strictMcpConfig: true` les écarte, mais la sonde qui l'a validé reprenait sur un appel `Bash`, pas sur un outil `factory`. Le soir, issue #4 : même symptôme avec le seul serveur `factory` chargé, trois appels `update_contract` interrompus en 45 s, deux reprises sur trois échouées depuis le début. Cause commune : le rejeu de l'outil différé (point 1). Correctif : suppression de `defer` ; la sonde live reprend maintenant sur `read_rules` et passe. `strictMcpConfig` reste (configuration utilisateur jamais lue). L'adaptateur journalise la sortie d'erreur du processus (`onStderr`).
