# Bug 265 — the compression window counts rows the summary never saw, and drops a message from both

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-26, while refactoring the context manager (code reading, not a user report) |
| **Fixed** | 2026-10-26 |
| **Severity** | Low. Each tool-only or empty assistant row inside the window costs one real message: it is neither summarised nor sent verbatim |
| **Who it bites** | chats with compression in force whose recent history includes assistant turns that were only tool calls (or are empty) |
| **Provenance** | The window was located by walking `existingMessages` back and counting every USER/ASSISTANT row, while the summary and the window size are computed over `extractVisibleConversation`, which drops rows with no content and assistant rows that are only tool markup |
| **Fix site** | `lib/chat/context/turn-compression.ts` (`verbatimWindowStart`), `lib/memory/cheap-llm-tasks/chat-tasks.ts` (`toVisibleConversationMessage`, new) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-26).** `extractVisibleConversation` is now a loop over
`toVisibleConversationMessage`, the one rule for whether a row is part of the visible conversation,
and `verbatimWindowStart` counts with the same rule. The window holds exactly the visible messages
the summary left out; a row the rule drops is carried along when it falls inside the window but
never counted toward it.

Test: `__tests__/unit/lib/chat/context/turn-compression.test.ts`, "does not count a row the visible
conversation drops". Not yet verified live.

## Symptom

With compression on and a window of N, fewer than N real messages follow the compressed summary
when the window contains a tool-only assistant turn. The message just before the window's start
is in neither the summary nor the history.

## Root cause

The summary covers `visible.slice(0, visible.length − N)` and the window is `visible.slice(−N)`,
where `visible = extractVisibleConversation(existingMessages)`. To map the window back onto
`existingMessages`, the old code walked back counting rows whose role was USER or ASSISTANT —
including the rows `extractVisibleConversation` had dropped. Each such row used up one count, so
the walk stopped one visible message short.

## How to verify

Covered by the unit test; live, compare the LLM log's history after system block 3 with the
chat's last N visible messages on a turn whose window includes a tool-only reply.
