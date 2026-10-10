---
name: vynor-prompt-cache
description: Keep the model prompt prefix byte-stable so the provider's prompt cache keeps hitting. Use when adding or changing anything that goes into the system message, tool definitions, rules, environment block or message history, and when someone asks why a prompt got expensive.
---

# Prompt cache safety

DeepSeek bills a repeated prompt prefix at about 2% of the normal rate, but only while the prefix is
byte-identical. One changed character early in the request re-bills everything after it at the full rate
(about 50x). Cost per task is decided by how often the prefix changes, not by how many tokens it holds.

## Rules

1. Nothing volatile in the system message or tool definitions: no timestamps, progress percentages,
   changed-file lists, active file, token counts, random ids. If the model needs it, put it at the END of the
   request (latest user message or a tool result), never in the prefix.
2. State that changes during a conversation is captured once per conversation and reused
   (`gui/src/redux/util/groundingFreeze.ts`). Only things that matter when they change stay live: open folders,
   trust, index ready.
3. Never edit an older message to "clean up" context. History is append-only; shrink it only at a
   compaction boundary, in one block (`backend/src/services/hybridContext.ts`, COMPACT_TRIGGER).
4. A newer read of a changed file gets a note that it supersedes the older one. Do not rewrite the older one.
5. Tool lists must be built in a stable order. Adding or removing a tool mid-conversation breaks the prefix.
6. Identical re-reads become a pointer to the earlier copy (`applyReadDedupe`), never the other way round.

## Before merging a prompt change

- Build the request for two consecutive rounds of the same conversation (one tool call apart) and diff the
  system message and tool list: they must be equal. `gui/src/redux/util/groundingFreeze.test.ts` is the pattern.
- Measure with a real run: cache-hit tokens vs. total (`prompt_cache_hit_tokens` in the usage), and credits,
  not raw `total_tokens`. Raw totals include cached tokens and overstate the cost.

## Known history

- The git status list added to the environment block changed after every agent edit and re-billed the whole
  history each round. Fixed by freezing it per conversation.
