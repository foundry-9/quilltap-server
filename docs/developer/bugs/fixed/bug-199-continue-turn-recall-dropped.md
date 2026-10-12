# Bug 199 — A continue turn computes recall and never sends it to the model

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, code audit for the [memory system refactor](../../features/memory-system-refactor.md) (appendix C) |
| **Fixed** | 2026-10-12, v4.10-dev (Phase 0 of the refactor) |
| **Severity** | High. On every turn with no new user message, the model answered without its recalled memories, while the Commonplace Book recorded them as shown: it posted the whisper, stamped the rows accessed and wrote them to the anti-repetition ring |
| **Who it bites** | continue, chained multi-character, nudged and autonomous-room turns, i.e. any turn built without a new user message |
| **Provenance** | Original to v4. Recall moved into the trailing user message (the persona-whisper overhaul); the trailing-only branch for turns with no new user message was written for the scene note, progressions and inform, and recall was never added to it |
| **Defect site** | `lib/chat/context-manager.ts`, the `else if` branch after the new-user-message branch (`trailingOnly`, was line 2810) |
| **Fix site** | `lib/chat/context-manager.ts:2802-2822` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The trailing-only message now carries `llmRecallText`, after the scene
note and before progressions and inform. That is the order recall takes on an ordinary turn. The
branch's guard now also fires on recall alone. Tests: `__tests__/unit/context-management.test.ts`
(`recall on a turn with no new user message (bug 199)`): recall is delivered alone, delivered before
inform, and not duplicated on an ordinary turn. Two of these fail against the old code.

## Symptom

On a continue turn the Salon shows a fresh Commonplace Book whisper, but the reply shows no
knowledge of what it recalls. The recalled rows still get `lastAccessedAt` stamped and land in
`commonplaceRecallHistory`, so the next ordinary turn suppresses them as already whispered.

## Root cause

`buildContext` assembles `llmRecallText` (`buildCommonplaceLLMContext`), posts the persona whisper and
records it, all before it decides how to deliver it. With a new user message, recall rides that message
as a trailing section (`trailingContextSections`). Without one, the branch builds
`trailingOnly = [userNarrationAnchor, progressionsLLMContext, informBlock, turnSkipInstruction]`.
Recall is not in that list, so it is not delivered. The branch's guard does not mention recall either,
so a turn whose only trailing content was recall pushed nothing at all.

## Why it survived

Every inform and scene-note test exercised the trailing-only branch, but none of them ran with
memories on. The whisper in the transcript made recall look delivered.

## Fix

Add `llmRecallText` to the guard and to `trailingOnly`, in the ordinary turn's order. Core whisper
(`coreWhisperLLMContext`) is skipped by design on continue turns and is unchanged.

## Verify

In a chat with memories, press Continue. The request log's last user message contains the
"you remember" recall text that the whisper shows.
