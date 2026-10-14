# Bug 163 — a title from the summary fold never cues a story background

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-23)** |
| **Found** | 2026-09-23, live on the `Friday` instance, chat `60397907-22e5-47a3-8d8f-835dcd4b59fd` ("Stars Over Bear Lodge") |
| **Fixed** | 2026-09-23, v4.10-dev |
| **Severity** | **Low** — nothing is lost or wrong, but the Lantern misses most scene changes in a long chat. The backdrop stays on the first scene while the conversation moves on |
| **Who it bites** | every chat with Story Backgrounds enabled that runs past the fold threshold (10 turns). After turn 10 the checkpoint title check runs only every 10 interchanges and rarely changes a title that already fits, so from then on most renames come from the fold |
| **Provenance** | Original to v4. The fold's title write was added beside the rolling-window summary; the story-background trigger had only ever lived in the `TITLE_UPDATE` handler |
| **Fix site** | `lib/chat/auto-title.ts` (new — `applyAutoTitle`, plus `queueStoryBackgroundIfEnabled` moved from `lib/background-jobs/handlers/title-update.ts`), `lib/chat/context-summary.ts`, `lib/background-jobs/handlers/title-update.ts`, `app/api/v1/chats/[id]/actions/title.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-23).** Every path that puts a cheap-LLM title on a chat now goes through
`applyAutoTitle` (`lib/chat/auto-title.ts`). It re-reads the chat, writes the title only if it
changed, and queues a story background whenever it does. The three paths are the checkpoint title
check, the context-summary fold, and the rename dialog's **Use automatic naming** box (`?action=regenerate-title`). The write-up below is
the original diagnosis.

## Symptom

The LLM inspector for the chat showed four successful `IMAGE_GENERATION` calls, but the project
gallery held one story background. Three of the four were Aurora avatar portraits (Amy twice,
Abigail once, after outfit changes), so the count itself was fine. The real problem was the
timeline. The chat was retitled three times:

| When (UTC) | Title | Set by | Background queued |
|---|---|---|---|
| 04:01:54 | Flying Above the Clouds | `TITLE_UPDATE` (interchange 2) | yes |
| 04:34:54 | Bread, Cheese, and Borrowed Stars | context-summary fold | **no** |
| 04:58:56 | Stars Over Bear Lodge | context-summary fold | **no** |

The log shows exactly one `STORY_BACKGROUND_GENERATION` job for the chat. The title checks at
interchanges 3, 5, 7 and 10 all answered `needsNewTitle: false`.

## Root cause

A story background is queued only by `queueStoryBackgroundIfEnabled`, and before this fix the
only caller was `handleTitleUpdate` (`lib/background-jobs/handlers/title-update.ts:238`), after a
successful rename. `generateContextSummary` (`lib/chat/context-summary.ts:~583`) generates a
title from the new summary after every fold and wrote it straight to `chats.title`, with no
background. `handleRegenerateTitle` (`app/api/v1/chats/[id]/actions/title.ts`) did the same.

## Why it survived

Nothing fails. The fold's retitle looks right in the sidebar, and the backdrop from the first
scene is still a plausible picture. The help page said backgrounds follow "chat title updates", so
the design intent was clear. The implementation covered only one of the three writers.

## Fix

- `lib/chat/auto-title.ts` — `applyAutoTitle({ userId, chatId, title, chatSettings, extraPatch?,
  clearManualRename?, source })` re-reads the chat, refuses a hand-renamed chat (bug 164), returns
  `unchanged` without writing a title when nothing changed, and otherwise writes the title and
  calls `queueStoryBackgroundIfEnabled`, skipping help chats. `queueStoryBackgroundIfEnabled`
  moved here unchanged.
- `handleTitleUpdate` passes its checkpoint cursor as `extraPatch`.
- The fold loads chat settings and calls the chokepoint with `source: 'summary-fold'`.
- Regenerate calls it with `clearManualRename: true`.

A title the fold produces again unchanged queues nothing, so one fold does not repaint the same
scene.

## Verify

- `__tests__/unit/lib/chat/auto-title.test.ts` — applied / unchanged / help chat / no settings /
  regenerate.
- `__tests__/unit/lib/chat/context-summary-fold-title.test.ts` — the fold routes through
  `applyAutoTitle` with chat settings and never writes `title` itself.
- Live: in a chat with Story Backgrounds on, pass turn 10. When the Librarian posts a fold and
  the title changes, a `STORY_BACKGROUND_GENERATION` job appears in the Tasks Queue and the log
  shows `[Auto Title] Queued story background generation`.
