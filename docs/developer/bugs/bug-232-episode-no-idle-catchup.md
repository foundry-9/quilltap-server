# Bug 232 — The fold episode pass has no idle catch-up, so a capped backlog can stall

| | |
|---|---|
| **Status** | Open — closed by Phase D of the [memory system refactor](../features/memory-system-refactor.md) (one cursor per pass, one sweep), or sooner with an episode sweep |
| **Found** | 2026-10-12, fixing review finding #7 on PR 90 |
| **Fixed** | — |
| **Severity** | Low — episodes for the older part of a long chat are missing until the chat folds enough more times; nothing is lost from the transcript |
| **Who it bites** | a long chat whose episodes were wiped by Regenerate Memories and which then folds rarely or never again |
| **Provenance** | Introduced by the PR 90 review fix that caps each fold pass at 4 slices per run (`FOLD_EPISODE_MAX_SLICES_PER_JOB`). The fold OTHER pass has an idle catch-up that continues its backlog in follow-up jobs; the episode pass has none |
| **Defect site** | `lib/memory/fold-episode-pass.ts` (the per-run slice cap); no episode equivalent of `runFoldOtherCatchup` (`lib/memory/fold-other-pass.ts`) or of the idle sweep that drives it |
| **Fix site** | — |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

After a regenerate clears `chats.episodeExtractionWatermarkMessageId`, the next hard-rebuild fold
reads at most 4 × 60 eligible messages of episodes and stops. Each later fold reads up to 4 more
slices. A chat that never folds again keeps episodes for only its first ~240 eligible messages.

## Root cause

The episode pass runs only from a fold (`generateContextSummary`). Since the review fix it reads
from its own watermark through the fold's window (`foldPassRange`, `lib/memory/fold-window.ts`), so
no slice is ever skipped, but it advances at most 4 slices per fold. The OTHER pass has the same
cap and an idle sweep that enqueues follow-up catch-up jobs (`continue:<watermark>`,
`lib/background-jobs/handlers/memory-extraction.ts`); nothing does that for episodes.

## Why it survived

The cap was added to bound a job's size (review finding #7); its consequence for a pass with no
sweep was noticed in the same change and filed rather than widened.

## Fix

Add an episode catch-up beside the OTHER one: the idle sweep enqueues it when the episode watermark
is behind the chat's last eligible message, and it re-enqueues itself while slices remain. Phase D's
cursor table and single sweep cover both passes.

## Verify

Regenerate a 600-message chat, fold once, then leave it idle: the sweep advances the episode
watermark to the end in follow-up jobs, monotonically.
