# Bug 230 — The memory dry run extracts without the chat's project context

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase D of the [memory system refactor](../../features/complete/memory-system-refactor.md), which still owns the rest of smell A.6 #27) |
| **Found** | 2026-10-12, while fixing bug 222 (the same omission on the Carina path) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — a preview only; nothing is written, but the preview can differ from what live extraction would produce in a project chat |
| **Who it bites** | anyone using the Memories dry run on a chat that belongs to a project |
| **Provenance** | Original to v4. Recorded earlier only as smell A.6 #27 in the refactor spec's Appendix A |
| **Defect site** | `app/api/v1/chats/[id]/actions/memories.ts:313-326` (the `processTurnForMemory` call) |
| **Fix site** | `app/api/v1/chats/[id]/actions/memories.ts` (`handleExtractMemoriesDryRun`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The dry run passes `projectId: chat.projectId`, the project
description from `loadExtractionProjectDescription` and `chatContextSummary: chat.contextSummary` to
`processTurnForMemory`, as the per-turn and Carina handlers do, so its prompt carries the same
project and summary as a live extraction. The rest of smell #27 (profile, timestamps, fold passes,
autonomous chats) stays with Phase D. Test: `__tests__/unit/api/memories-dry-run-project.test.ts`.

## Symptom

The dry run's candidate list for a project chat is built without the project's description or the
chat's context summary, so the extraction prompt is not the one the live per-turn job sends. A
candidate the live pass would phrase in the project's terms, or skip as already known from the
summary, can appear differently in the preview.

## Root cause

The dry run calls `processTurnForMemory` with `chatId`, `userId`, the profiles, the Concierge flag,
the limits and `timelineMode`, but not `projectId`, `projectDescription` or `chatContextSummary`.
The live per-turn handler and, since bug 222, the Carina handler pass all three (the project
description through `loadExtractionProjectDescription`, `lib/memory/extraction-route.ts`). The dry
run also passes no `sourceMessageTimestamp`, uses the cheap profile as `connectionProfile`, rejects
autonomous chats and never runs the fold pass (Appendix A, smell #27).

## Why it survived

The dry run writes nothing, so the difference is only visible by comparing a preview with a live
run on the same turn, which nobody does routinely. Bug 222's fix covered the Carina handler and left
this third caller out of scope.

## Fix

Pass `projectId: chat.projectId`, `projectDescription` from `loadExtractionProjectDescription` and
`chatContextSummary: chat.contextSummary`, as the live handler does. Phase D replaces the dry run's
hand-built call with `buildExtractionContext`, which closes this and the rest of smell #27 together.

## Verify

In a project chat, run the dry run and a live extraction over the same turn with a mocked model;
the prompt each sends carries the same project description and summary.
