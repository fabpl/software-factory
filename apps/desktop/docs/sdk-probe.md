# Sonde SDK — `query()` dans le process principal Electron (C5)

Date : 2026-10-14T07:11:05.102Z

| Composant | Version |
|---|---|
| Electron | 44.7.2 |
| Node (embarqué) | 24.21.0 |
| Chromium | 152.0.7977.149 |
| @anthropic-ai/claude-agent-sdk | 0.3.296 |
| Claude Code (binaire natif du SDK) | 2.1.296 |

`process.execPath` : `/Users/fplanchette/.software-factory/worktrees/fabpl-software-factory/4/node_modules/.pnpm/electron@44.7.2/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
`ELECTRON_RUN_AS_NODE` au lancement : non défini
SDK résolu depuis : `/Users/fplanchette/.software-factory/worktrees/fabpl-software-factory/4/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.296_@anthropic-ai+sdk@0.133.0_zod@4.6.7__@modelconte_1ad609cde15964d4044a6583e4534e8a/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`

## Verdict

`query()` fonctionne **sans correctif**.

Prompt : « Réponds exactement : OK », `maxTurns: 1`, options SDK par défaut sinon.

## Tentative 1 — sans correctif

- Résultat : **succès**
- Durée : 7.9 s
- Coût : 0.1425 $
- Messages reçus : system, system, system, system, system, rate_limit_event, assistant, result

Message final :

```
OK
```
