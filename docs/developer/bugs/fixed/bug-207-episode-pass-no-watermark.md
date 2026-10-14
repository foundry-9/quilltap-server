# Bug 207 — The fold episode pass re-extracts the whole history on every hard rebuild

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase D of the [memory system refactor](../../features/complete/memory-system-refactor.md)) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix A) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — every 50 turns each present character gets up to two more episode memories distilled from the whole chat so far, which either inflate reinforcement on existing episodes or land as new near-duplicates |
| **Who it bites** | every chat long enough to hit a hard rebuild (every 50 interchanges, `T_HARD_TURN_THRESHOLD`), and every SillyTavern import (which forces one); worst in long chats with several characters present |
| **Provenance** | Original to v4. Came in with the fold-time episode pass (episodic recall overhaul, `lib/memory/fold-episode-pass.ts`) |
| **Defect site** | `lib/chat/context-summary.ts:389-404` (hard-rebuild window), `:549-567` (episode pass call); `lib/memory/fold-episode-pass.ts:57-224` (no cursor, no eligibility filter) |
| **Fix site** | `lib/memory/fold-episode-pass.ts` (watermark, eligibility filter, slices), `lib/memory/fold-window.ts`, `lib/chat/context-summary.ts`, `lib/background-jobs/handlers/memory-regenerate-chat.ts` (reset), `lib/schemas/chat.types.ts`, `lib/database/repositories/chats.repository.ts` (patch-only), migration `add-episode-extraction-watermark-v1`, export schema, import and restore remaps; Phase D still owns the `ExtractionCursor` move |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The episode pass has its own watermark,
`chats.episodeExtractionWatermarkMessageId` (patch-only, like the OTHER watermark; added by
migration `add-episode-extraction-watermark-v1`, which backfills it from the last
`summaryAnchorMessageIds` entry so chats that have already folded do not re-extract their history on
the next hard rebuild). `runFoldEpisodePass` cuts its window to messages past the watermark, applies
the shared eligibility filter (`isFoldEligibleMessage`, which drops empty and seatless rows the pass
used to render as `Speaker: ` lines), and reads what remains in consecutive slices of at most
`FOLD_EPISODE_MAX_WINDOW_MESSAGES` (60), advancing the watermark past each slice. A slice lost to a
cheap-LLM timeout stops the run and leaves the watermark before it. A hard rebuild therefore hands
the pass only what it has not read, and a refold after `?action=rebuild-summary` reads nothing it
already covered. Memory regeneration clears the watermark (the wipe took the episodes with it), so
the next hard rebuild rebuilds them in slices. The column is carried in `.qtap` exports
(`qtap-export.schema.json`), remapped on restore (`uuid-remap.ts`) and on fresh-id import
(`message-id-remap.ts`). Tests: `__tests__/unit/lib/memory/fold-episode-pass.test.ts` ("watermark
and slices"), `memory-regenerate-chat-fold-other.test.ts`, the migration's integration test, and the
remap/restore/patch-only tests. Review follow-up: the pass reads from its watermark through the end of the
fold's window (`foldPassRange`), so a slice lost to a timeout is read by the next fold rather than
jumped; it reads at most `FOLD_EPISODE_MAX_SLICES_PER_JOB` (4) slices per fold, so a long backlog
(after a regenerate, say) is rebuilt over several folds; it no longer links an episode it wrote
earlier in the same run as a "fragment" of a later one; and the fold hands both passes the
transcript it already read instead of each re-reading it.

## Symptom

In a long chat, the Commonplace Book gains a fresh batch of `kind: 'episodic'` memories every 50
turns whose narratives summarise the chat from the beginning ("Over the past weeks, …"), next to
the episodes already written for the same events by earlier folds. Older episodes' reinforcement
counts rise without any new telling of them.

## Root cause

The fold decides its window in `generateContextSummary`. A hard rebuild (`forceRegenerate`, which
`evaluateSummarizationGate` returns when `currentTurn − lastFullRebuildTurn >= 50`,
`context-summary.ts:81-83`) folds from turn 1:

```ts
if (isHardRebuild) {
  foldFromTurn = 1
  foldThroughTurn = Math.max(1, currentTurn - FOLD_TAIL_FLOOR)     // :392-394
}
```

The episode pass is then handed that window (`:555-564`). The OTHER pass filters its window
against a watermark (`fold-other-pass.ts:172-192`); the episode pass has no equivalent.
`runFoldEpisodePass` (`fold-episode-pass.ts:57`) renders every message it is given (`:94-98`) and
asks for 0–2 episodes over all of it (`:100`).

It also applies no eligibility filter of its own. The spec lists this as a separate defect; it is
smaller than it sounds. Staff whispers never reach the pass, because `partitionMessagesIntoTurns`
already drops every `systemSender` message and every non-USER/ASSISTANT row
(`context-summary.ts:266-270`). What the pass lacks relative to `isFoldOtherEligibleMessage`
(`fold-other-pass.ts:130-136`) is the non-empty-content and `participantId` checks, so empty
messages render as `Speaker: ` lines. The real cost is the missing cursor.

**How the gate treats the re-extracted episodes (the spec's wording overstates this).** The spec
says the date guard keeps them from being absorbed. That holds only in part. The date guard
(`memory-gate.ts:329-349` at `4a38222`) fires when the best match's `occurredAt` is more than 7
days from the candidate's. A whole-history window anchors an unresolved `when` to the window's
first message (`fold-episode-pass.ts:114-128`), so in a chat spanning more than a week the new
episode is often dated far from the original and is inserted and linked rather than absorbed.
When the dates agree, the gate does what it does for any retelling: absorbs at ≥ 0.90 or
reinforces at ≥ 0.85, which counts a re-read of the same text as a new observation. Below 0.85 the
broader narrative is simply inserted. In each case the row count or the reinforcement count moves
without anything new having happened.

## Why it survived

The episode pass was designed against the ordinary fold (5 turns per batch), where each window is
new. The hard rebuild exists for the summary and reuses the same post-fold hooks; nobody checked
what a turns-1-to-N window does to a pass with no memory of what it already read.

## Fix

Phase D gives the `episode-fold` pass its own `ExtractionCursor` (`memory_extraction_cursors`) and
the same eligibility filter as the other passes. A hard rebuild hands it only messages past its
cursor, in slices no wider than the pass's window, so a rebuild never re-reads history the pass has
already covered.

## Verify

On a chat past 50 interchanges, record the count of `kind: 'episodic'` memories and their
reinforcement counts, force a hard rebuild, and compare. Only messages past the episode cursor are
sent to the model (check the LLM log for `fold-episode-extraction`); existing episodes' counts do
not change.
