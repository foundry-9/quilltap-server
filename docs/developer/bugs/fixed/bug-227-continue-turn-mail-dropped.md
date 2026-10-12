# Bug 227 — A turn with no new user message marks mail announced but never shows it to the model

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, code review of `buildContext` while reading bug 199 (recall dropped on the same turns, filed in the memory refactor spec) |
| **Fixed** | 2026-10-12, v4.10-dev |
| **Severity** | Medium — a letter is permanently lost to the recipient's model; the Salon bubble still appears, so nothing looks wrong |
| **Who it bites** | any character whose mail arrives just before a continue, nudge, chained or autonomous turn — the turns that carry no new user message |
| **Provenance** | Original to v4. Present since the Post Office's LLM context was added to `buildContext`; the trailing-only branch was written for the scene note and later widened for progressions and informs, never for mail |
| **Defect site** | `lib/chat/context-manager.ts`, `buildContext`: the `else if (...)` branch that builds `trailingOnly` |
| **Fix site** | `lib/chat/context-manager.ts`, `lib/post-office/mailbox.ts` (`markMailAlertsDelivered`), `lib/services/chat-message/message-finalizer.service.ts`, `primary-stream.service.ts`, `orchestrator.service.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Two parts. The trailing sections are now built once, in one ordered
list (`trailingContextSections`), and both branches use it: the new-user-message branch appends it to
the message, the no-message branch sends it as its own user message with the scene note leading. The
mail rides between recall (bug 199) and the progressions report on both. And the letters are no longer
marked `alerted` in `buildContext`: it returns them as `BuiltContext.mailAlertsOwed`, and
`markMailAlertsDelivered` flips them only once the turn has delivered them — the finalizer, the
preserved-partial path, a tool-only save, or a deliberate pass. A provider failure that saves nothing
leaves them unalerted, so the next attempt announces them again. A swipe skips the mail check entirely.
Tests: `__tests__/unit/context-management.test.ts` (*trailing sections on a turn with and without a new
user message*; *mail on a turn with no new user message (bug 227)*), the finalizer and primary-stream
suites, and `lib/post-office/__tests__/mailbox.test.ts`.

## Symptom

A letter delivered to a character's `Mail/` folder is announced in the Salon by Suparṇā's whisper on
that character's next turn. If that turn is a continue, a nudge, a chained reply or an autonomous-room
turn, the model never receives the letter text, and on every later turn the letter is already marked
`alerted`, so it is never offered again. The character behaves as though no mail came.

## Root cause

The Post Office block in `buildContext` runs on every turn. It collects unalerted letters, posts the
whisper, sets `suparnaMailLLMContext`, and calls `markAlerted` on each letter.

The text reaches the model only through `trailingContextSections`, which is used only when there is a
`newUserMessage`. The `else if (userNarrationAnchor || turnSkipInstruction || progressionsLLMContext ||
informBlock)` branch, which pushes a standalone trailing user message for turns without one, neither
tested for `suparnaMailLLMContext` nor included it in `trailingOnly`. The side effects ran; the
delivery did not.

## Why it survived

The Salon whisper is posted either way, so the operator sees the announcement and has no reason to
suspect the model missed it. Tests built mail context only on turns with a new user message, and the
`context-management` tests seeded characters with no vault, so the mail block never ran there at all.

## Fix

Review of the first fix found the same class twice more. `coreWhisperLLMContext` was also missing from
the no-message branch (the Core whisper fires on chained and autonomous turns, not only on new
messages), and the guard and the list were two hand-kept copies of the same six names. One ordered list
now feeds both branches.

Delivering the text did not close the loss on its own: `markAlerted` ran while the context was being
built, before the provider call, so a failed turn still spent the letter. The flip now follows the
inform block's rule (consume only against something the chat keeps). A turn that fails before saving
anything posts a second Suparṇā whisper on its retry; that is the honest record of a letter read again.

A swipe re-rolls a line already spoken and never reaches the finalizer, so it skips the mail check —
the same rule the inform block keeps for passages that arrived since.

The no-message tail can follow a user-role line (every other seat's line is attributed as `user` in a
multi-character chat). That shape predates this bug: the scene note, progressions and informs have
always ridden there. OpenAI-compatible APIs accept adjacent user messages, Anthropic's Messages API
combines them, and the Google plugin merges them before sending.

Recall (`llmRecallText`) had the same gap on these turns; that is [bug 199](bug-199-continue-turn-recall-dropped.md),
fixed in the same change.

## Verify

Deliver a letter to a character, then press Continue (or let an autonomous room take the turn) without
writing a message. The model's request (LLM log) ends with a user message carrying "Suparṇā of the Post
Office has delivered new mail to you", and the character can answer it.
