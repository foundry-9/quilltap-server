# Bug 206 — The fold OTHER pass skips messages it trimmed from its window

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase D of the [memory system refactor](../../features/complete/memory-system-refactor.md)) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix A) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — characters permanently form no fold-grain observations of each other for any part of a long window older than its newest 60 eligible messages, and nothing reports the loss above debug level |
| **Who it bites** | chats in `fold` or `hybrid` extraction mode whose OTHER window exceeds 60 eligible messages: memory regeneration of a long chat, the first catch-up or hard rebuild on a chat with no watermark (an imported chat, or one that predates the watermark), and a catch-up after a long unswept stretch |
| **Provenance** | Original to v4. Came in with the fold-grain OTHER pass (`lib/memory/fold-other-pass.ts`, first in this history at `d585480`, 2026-10-08) |
| **Defect site** | `lib/memory/fold-other-pass.ts:194-197` (cover-through vs. trim), `:408-409` (watermark advance); `lib/memory/fold-other-pass.ts:620-633` (catch-up passes the whole post-watermark history); `lib/background-jobs/handlers/memory-regenerate-chat.ts:121-164` (regenerate relies on it; lines at `4a38222`) |
| **Fix site** | `lib/memory/fold-other-pass.ts` (`runFoldOtherPass` reads the window in slices), `lib/memory/fold-window.ts` (new: `sliceFoldWindow`, shared eligibility and watermark cut), `lib/background-jobs/handlers/memory-regenerate-chat.ts` (comment); Phase D still owns the `ExtractionCursor` move |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `runFoldOtherPass` no longer trims its window to the newest
`FOLD_OTHER_MAX_WINDOW_MESSAGES` (60) eligible messages. It splits the eligible window into
consecutive slices of at most 60, oldest first (`sliceFoldWindow`, new `lib/memory/fold-window.ts`),
runs every observer over each slice, and advances `chats.otherExtractionWatermarkMessageId` past each
slice as it is read: to the slice's last eligible message, and for the last slice to the caller's
`coverThroughMessageId` (or the end of the window). A slice that loses a pass to a timeout stops the
run there and leaves the watermark at the last slice fully read, so nothing is marked covered
unread. Character hydration and speaker names are resolved once for all slices. The catch-up, the
regenerate's catch-up and the hard-rebuild fold all go through this path, so a regenerate of a
150-message chat now reads three slices and its fold-grain observations cover the whole history.
The watermark stays a `chats` column; moving it to `memory_extraction_cursors` remains Phase D work.
Tests: `__tests__/unit/lib/memory/fold-other-pass.test.ts` ("wide windows are read in slices").
Review follow-up: the pass now reads from its watermark through the end of the window it is handed
(`foldPassRange`), so a slice lost to a timeout is read before a later fold's newer window instead
of being jumped; one run reads at most `FOLD_OTHER_MAX_SLICES_PER_JOB` (4) slices, and the catch-up
handler enqueues a follow-up job (`continue:<watermark>`) for the rest of a longer backlog.

## Symptom

Regenerate memories for a 300-message chat in `fold` mode. The rebuilt fold-grain observations
(what each character took away about the others) cover only the last 60 eligible messages. The
other 240 are never read again: the watermark now sits at the chat's last message, so no later
fold or catch-up revisits them. The job report shows success.

## Root cause

`runFoldOtherPass` (`fold-other-pass.ts`) computes, in this order:

```ts
const coverThrough =
  input.coverThroughMessageId ?? window[window.length - 1]?.id ?? null    // :194-195
const eligible = window.filter(isFoldOtherEligibleMessage)                // :196
const trimmed = eligible.slice(-FOLD_OTHER_MAX_WINDOW_MESSAGES)           // :197  (60, :71)
```

The prompt sees only `trimmed`, but when no pass times out the watermark advances to
`coverThrough` (`:408-409`), the end of the untrimmed window. Everything in `eligible` before the
trim is marked covered without having been read. The trim is logged at debug (`:198-204`).

Callers that can hand it more than 60 eligible messages:

- **Catch-up.** `runFoldOtherCatchup` passes every message past the watermark, or the whole history
  when there is no watermark (`:584`, `messagesPastWatermark` at `:143-151`), with
  `coverThroughMessageId` set to the chat's last message (`:632`).
- **Regenerate.** `rebuildFoldGrainObservations`
  (`memory-regenerate-chat.ts:128-164`) clears the watermark and enqueues a catch-up with
  `foldOtherIgnoreIdle`. Its own comment states the outcome (`:125-126`): "The catch-up covers the
  chat's newest `FOLD_OTHER_MAX_WINDOW_MESSAGES` messages".
- **Hard rebuild fold.** A `forceRegenerate` fold folds turns 1 through `currentTurn − 5`
  (`lib/chat/context-summary.ts:392-394`) and passes that whole window (`:575-591`); only the part
  past the watermark survives the filter at `fold-other-pass.ts:175-192`, which is everything when
  the chat has no watermark (for example a SillyTavern import, which forces a hard rebuild,
  `lib/import/sillytavern-import-service.ts:599-606`).

Ordinary folds (5 turns at a time) rarely exceed 60 eligible messages, which is why the defect does
not show day to day.

## Why it survived

The 60-message cap was added to bound prompt size, and the watermark was written to mean "the
fold has seen up to here". The two were never reconciled. Regenerate's comment records the
behaviour as intended; nothing above debug logs it; and the missing observations are an absence,
not an error.

## Fix

Phase D replaces the watermark with an `ExtractionCursor` (`memory_extraction_cursors`, migration
`add-memory-extraction-cursors-v1`, backfilled from `chats.otherExtractionWatermarkMessageId`). A
pass advances its cursor only past messages its window covered. A window wider than
`FOLD_OTHER_MAX_WINDOW_MESSAGES` is processed in consecutive slices, each advancing the cursor.

## Verify

In `fold` mode, regenerate a chat with about 150 eligible messages and several characters. The
catch-up processes three slices and the fold-grain OTHER memories have `sourceMessageId`s spread
across the whole history, not only its last 60 messages. The cursor ends at the last message.
