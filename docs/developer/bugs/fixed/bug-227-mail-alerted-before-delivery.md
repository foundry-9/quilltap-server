# Bug 227 — A letter is marked announced before its turn is known to succeed

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, review of the [bug 199](bug-199-continue-turn-recall-dropped.md) fix (PR 88) |
| **Fixed** | 2026-10-12, v4.10-dev |
| **Severity** | Medium — a letter is lost to its recipient's model whenever the turn that announced it fails; the Salon bubble still appears, so nothing looks wrong |
| **Who it bites** | any character whose mail is announced on a turn that then fails before a reply is saved (provider error, empty response), and any chat where a swipe runs while unannounced mail is waiting |
| **Provenance** | Original to v4. Present since the Post Office's mail check was added to `buildContext` |
| **Defect site** | `lib/chat/context-manager.ts`, `buildContext`: the Post Office block called `markAlerted` on each letter |
| **Fix site** | `lib/chat/context-manager.ts`, `lib/post-office/mailbox.ts` (`markMailAlertsDelivered`), `lib/services/chat-message/message-finalizer.service.ts`, `primary-stream.service.ts`, `orchestrator.service.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `buildContext` no longer marks letters. It returns them as
`BuiltContext.mailAlertsOwed`, and `markMailAlertsDelivered` flips them only once the turn has delivered
them: the finalizer (reply persisted), the preserved-partial path, a tool-only save, or a deliberate pass.
A provider failure that saves nothing leaves them unalerted, so the next attempt announces them again. A
swipe skips the mail check. The trailing sections are also built once, in one ordered list used by both
branches, so the no-message tail can no longer drift from the new-message one (bug 199's root cause).
Tests: `__tests__/unit/context-management.test.ts`, the finalizer and primary-stream suites, and
`lib/post-office/__tests__/mailbox.test.ts`.

## Symptom

Suparṇā announces a letter in the Salon, the provider call then fails, and the letter is never offered
to the character again. Separately, swiping a line while new mail is waiting posts a mail whisper into
the re-roll and spends the letter there.

## Root cause

The Post Office block in `buildContext` collects unalerted letters, posts the whisper, builds
`suparnaMailLLMContext`, and called `markAlerted` on every letter, all before the provider call. Bug 199
made the text reach the model on every kind of turn, but a turn that fails after context building still
spent the letter: on the next turn it was already `alerted`.

The swipe path (`regenerate-swipe.service.ts`) builds its context through the same `buildContext`, in
continue mode. So a re-roll of an old line ran the mail check too: it posted a whisper and marked any
letter that had arrived since, inside a line the operator may discard.

## Why it survived

The Salon whisper is posted either way. Failures are rare, and the swipe case needs mail to arrive
between a line and its re-roll.

## Fix

The flip follows the inform block's rule: consume only against something the chat keeps.
`markMailAlertsDelivered` is warn-only per letter and is called from exactly four places:

- `finalizeMessageResponse`, after the assistant message is saved;
- `makePreservePartialOnError`, after a partial reply is saved;
- the orchestrator's tool-only branch, after tool results are saved without prose;
- `handleTurnSkip`, when the character reads its mail and passes.

A turn that fails before saving anything announces the letter again on its retry. That second whisper
is the visible record of the re-read; `help/post-office.md` says so. A swipe (`regenerationOfMessageIds`
present) skips the mail check entirely, as the inform block keeps new passages out of a re-roll.

## Verify

Deliver a letter and make the provider fail (an invalid API key will do). The letter's frontmatter still
reads `alerted: false`, and the next working turn announces it again and the model answers it. Swipe a
line while a fresh letter is waiting: no mail whisper appears in the re-roll, and the letter is announced
on the next ordinary turn.
