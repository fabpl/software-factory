# `@factory/agent-adapter`

Pilote Claude Code en mode non interactif et traduit tout ce qu'il émet en `FactoryEvent` (voir [`docs/spec/SPEC-agent-adapter.md`](../../docs/spec/SPEC-agent-adapter.md)). Le cœur ne voit ni le SDK, ni `SDKMessage`.

```
pnpm --filter @factory/agent-adapter test        # unitaires + fake, en CI
pnpm --filter @factory/agent-adapter test:live   # un vrai run court, hors CI (Claude Code connecté)
```

## Isolation du SDK

`grep -r "claude-agent-sdk" packages/*/src` ne doit sortir que `packages/agent-adapter/src/claude/`. Les fonctions pures (`translate`, `hooks`, `policy`, `handlers`) lisent des objets simples et sont couvertes à 100 % ; le câblage SDK (`options.ts`, `server.ts`, `adapter.ts`) n'est exercé que par le test live.

## Test live

Résultat du dernier passage : _pas encore exécuté_.
