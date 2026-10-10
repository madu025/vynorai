# Architecture decisions (single source of truth)

Read this before answering or changing anything about the database, caching, context handling or plans.
If a decision changes, update this file in the same commit. Facts below were checked in code on 2026-10-10;
anything about production environment values is marked "not verified".

## Database

- Production uses PostgreSQL 16 (`DATABASE_URL`). `backend/src/services/pgDriver.ts` selects it when
  `DATABASE_URL` is set and `DB_DRIVER` is not `sqlite`.
- SQLite is for local development and the default test run only. Every query must stay portable:
  `?` placeholders and `ON CONFLICT` upserts, no `rowid`, no `INSERT OR REPLACE`.
- New tables need both the SQLite schema (`backend/src/db.ts`) and a PostgreSQL migration
  (`backend/src/services/postgresSchema.ts`). Check with the `vynor-postgres-check` skill.

## Caching: four different things, do not mix them up

| Cache                          | What it is                                                                                                          | State                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Provider prompt-prefix cache   | DeepSeek bills a byte-identical repeated prefix at ~2%. Protected by append-only history and frozen volatile state. | Always on; protect it (`vynor-prompt-cache` skill)                          |
| Read dedupe / tool-output trim | `backend/src/services/hybridContext.ts`: later identical reads become a pointer, noisy output is capped.            | Always on in "safe" mode                                                    |
| Semantic response cache        | `backend/src/services/semanticCache.ts`: embedding match, threshold 0.95, scope per user.                           | **Off unless `SEMANTIC_CACHE_ENABLED=true`**. Production value not verified |
| Redis                          | Optional shared store, active only when `REDIS_URL` is set.                                                         | Production value not verified                                               |

## Context and plans

- Context limit per plan (`backend/src/services/modelRegistry.ts`): free and starter 32K, pro 128K,
  enterprise 256K tokens. Compaction triggers at 85% of the budget and drops about half of it.
- Default optimization mode is "safe" (trim tool output, window, read dedupe, background summary).
  "aggressive" runs only when a client sends `optimization_mode: "aggressive"`; the extension does not.
- The backend owns the real window. The client model `contextLength` is the largest plan window (256000,
  `core/config/default.ts`, `extensions/vscode/src/util/vynorModelMigration.ts`); a smaller client value
  prunes history one message per round before the server can compact. Do not lower it per model.
- When turns are dropped, the user's own requests of the dropped turns are kept verbatim in
  `<earlier-user-requests>` (capped), and an `<earlier-conversation-omitted>` note is added while no summary
  exists (`hybridContext.ts` `applyCompaction`).
- Known quality risks (not fixed): the compaction summary sees only the last 12,000 characters of the dropped
  block and no assistant tool calls (`localSlmRouter.ts`, `transcriptOf`); summaries live in process memory,
  so a restart or rolling deploy changes the block once; a failed summary is retried every request.

## Product

- VynorAI: VS Code extension plus a hosted proxy over low-cost models (DeepSeek), no user API key,
  credits priced in LKR, target users in price-sensitive markets (Sri Lanka, South Asia).
- Goal: Claude Code level agent quality at a fraction of the cost. Never trade quality for tokens
  without a measured check.
