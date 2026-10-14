# Bug 199 — A continue turn computes recall and never sends it to the model

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, code audit for the [memory system refactor](../../features/complete/memory-system-refactor.md) (appendix C) |
| **Fixed** | 2026-10-12, v4.10-dev (Phase 0 of the refactor) |
| **Severity** | High. On every turn with no new user message, the model answered without its recalled memories, while the Commonplace Book recorded them as shown: it posted the whisper, stamped the rows accessed and wrote them to the anti-repetition ring |
| **Who it bites** | continue, chained multi-character, nudged and autonomous-room turns, i.e. any turn built without a new user message |
| **Provenance** | Original to v4. Recall moved into the trailing user message (the persona-whisper overhaul); the trailing-only branch for turns with no new user message was written for the scene note, progressions and inform, and recall was never added to it |
| **Defect site** | `lib/chat/context-manager.ts`, the `else if` branch after the new-user-message branch (`trailingOnly`, was line 2810) |
| **Fix site** | `lib/chat/context-manager.ts` (the trailing-only branch) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The trailing-only message now carries everything the turn posted:
the Core whisper, `llmRecallText` and new Suparṇā mail, after the scene note and before progressions
and inform. That is the order they take on an ordinary turn. The branch's guard now also fires on any
of them alone. Mail and the Core whisper had the same defect, raised in review of PR 87: a letter was
marked alerted and never offered again, and a Core whisper that fired on a chained turn was posted and
never sent. Tests: `__tests__/unit/context-management.test.ts`
(`recall on a turn with no new user message (bug 199)`): recall is delivered alone, delivered before
inform, followed by mail, and not duplicated on an ordinary turn. Three of these fail against the old
code.

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

Add `coreWhisperLLMContext`, `llmRecallText` and `suparnaMailLLMContext` to the guard and to
`trailingOnly`, in the ordinary turn's order. The Core whisper is still not computed in continue mode;
it can fire on a chained turn, and is now delivered when it does.

## Verify

In a chat with memories, press Continue. The request log's last user message contains the
"you remember" recall text that the whisper shows.

## Follow-up (PR 88, 2026-10-12)

The trailing-only list was still a second hand-kept copy of the new-message list. Both branches now
draw on one ordered `trailingContextSections` list (the no-message tail adds the scene note in front),
and a test pins the two tails to the same order. The same review found that letters were marked
alerted before the provider call: [bug 227](bug-227-mail-alerted-before-delivery.md).
