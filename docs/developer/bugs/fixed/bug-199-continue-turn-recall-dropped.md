# Bug 199 — A turn with no new user message posts recall but never shows it to the model

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, source audit for the [memory system refactor](../../features/memory-system-refactor.md) (§2, filed first) |
| **Fixed** | 2026-10-12, v4.10-dev |
| **Severity** | **High** — the character answers without the memories the Salon shows it being given, and the rows are stamped and recorded as whispered, so the anti-repetition ring keeps them out of the next turns as well |
| **Who it bites** | every continue, nudge, chained or autonomous turn — the turns that carry no new user message — whenever recall finds anything |
| **Provenance** | Original to v4. The trailing-only branch was written for the chained-turn scene note and later widened for progressions and informs; recall was never added |
| **Defect site** | `lib/chat/context-manager.ts`, `buildContext`: the `else if (...)` branch that builds `trailingOnly` |
| **Fix site** | `lib/chat/context-manager.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `llmRecallText` is now in the trailing-only branch's guard and in
`trailingOnly`, after the scene note and before the mail (bug 227) and the progressions report — the
same relative order it has in `trailingContextSections`. Test: `__tests__/unit/context-management.test.ts`,
*recall on a turn with no new user message (bug 199)*.

## Symptom

On a turn without a new user message, the Commonplace Book whisper appears in the Salon with the
character's recalled memories, but the character's reply shows no sign of them. The same memories are
then less likely to surface on later turns, because they were recorded as already shown.

## Root cause

`buildContext` computes recall on every turn: it builds the persona whisper and `llmRecallText`, posts
the whisper, stamps the rows' `lastAccessedAt`, and appends them to the recall-history ring.

`llmRecallText` reaches the model only through `trailingContextSections`, which is used only when there
is a `newUserMessage`. The `else if (...)` branch that pushes a standalone trailing user message for
turns without one neither tested for `llmRecallText` nor included it in `trailingOnly`.

## Why it survived

The whisper is posted either way, so the Salon looks right. The recall tests in
`context-management.test.ts` all passed a `newUserMessage`.

## Fix

Add `llmRecallText` to the guard and to `trailingOnly`. The comment above the branch now names recall
and mail and why neither may be dropped.

## Verify

In a chat where the character has relevant memories, press Continue (or let an autonomous room take
the turn) without writing a message. The model's request (LLM log) ends with a user message carrying
the "You remember…" / "You also recall…" recall text.
