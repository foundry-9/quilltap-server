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
| **Fix site** | `lib/chat/context-manager.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `suparnaMailLLMContext` is now in the trailing-only branch's guard and in
`trailingOnly`, between the scene note and the progressions report — the same relative order it has in
`trailingContextSections`. Test: `__tests__/unit/context-management.test.ts`, *mail on a turn with no
new user message (bug 227)*.

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

Add `suparnaMailLLMContext` to the guard and to `trailingOnly`. The comment above the branch now names
the mail and why it cannot be left out.

Recall (`llmRecallText`) has the same gap on these turns. That is bug 199, reserved by the
[memory system refactor](../../features/memory-system-refactor.md) spec and not part of this fix.

## Verify

Deliver a letter to a character, then press Continue (or let an autonomous room take the turn) without
writing a message. The model's request (LLM log) ends with a user message carrying "Suparṇā of the Post
Office has delivered new mail to you", and the character can answer it.
