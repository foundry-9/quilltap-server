# Bug 164 — the summary fold overwrites a title the user set by hand

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-23)** |
| **Found** | 2026-09-23, by code reading while tracing bug 163 |
| **Fixed** | 2026-09-23, v4.10-dev |
| **Severity** | **Medium** — a user-chosen title is silently replaced, and replaced again at every fold (every five turns once a chat passes turn 10). The checkpoint titler has always honoured the flag, so the user has every reason to think a hand rename is permanent |
| **Who it bites** | anyone who renames a chat and keeps talking past turn 10. Autonomous rooms named through their settings dialog pin `isManuallyRenamed` too, so their titles were exposed the same way whenever a room folded |
| **Provenance** | Original to v4, same origin as bug 163: the fold's title write was added without the guard the `TITLE_UPDATE` handler had |
| **Fix site** | `lib/chat/auto-title.ts` (`applyAutoTitle` refuses a hand-renamed chat), `lib/chat/context-summary.ts` (skips the title call up front) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-23).** The fold now skips the title call entirely when
`chat.isManuallyRenamed` is set. `applyAutoTitle` checks the flag again against a fresh read,
so a rename made while a title call is in flight still wins. Only the user's explicit
**Use automatic naming** (`?action=regenerate-title`) overrules a hand rename, and it hands the chat back to the automatic
titler, as it always has.

## Symptom

A chat renamed by hand gets its title replaced by an LLM-written one the next time the running
summary folds, and again at every fold after that.

## Root cause

`isManuallyRenamed` was checked in exactly one reader, `handleTitleUpdate`
(`lib/background-jobs/handlers/title-update.ts:50`). `generateContextSummary`
(`lib/chat/context-summary.ts:~583`) called `generateTitleFromSummary` and wrote the result to
`chats.title` without looking at the flag.

## Why it survived

The fold only fires past turn 10, and a hand rename usually happens early, so the overwrite comes
long after the rename and reads as the chat "renaming itself". The flag is set by three writers
(the rename UI, help chats, autonomous-room settings) and honoured by one, and nothing
cross-checked them.

## Fix

The manual-rename rule moved into `applyAutoTitle`, which every automatic titler now calls (see
bug 163). The fold also checks the flag before its title call, so a hand-renamed chat no longer
spends a cheap-LLM call on a title it will throw away.

## Verify

- `__tests__/unit/lib/chat/auto-title.test.ts` — a hand-renamed chat keeps its title, and the
  checkpoint cursor still advances.
- `__tests__/unit/lib/chat/context-summary-fold-title.test.ts` — on a hand-renamed chat the fold
  runs but neither the title call nor `applyAutoTitle` fires.
