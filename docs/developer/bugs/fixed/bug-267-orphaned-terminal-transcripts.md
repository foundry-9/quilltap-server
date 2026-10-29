# Bug 267 — deleting a chat orphans its terminal transcripts for good

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-26, code reading (not a user report) |
| **Fixed** | 2026-10-26 |
| **Severity** | Low. Disk only: each deleted chat that ever opened an Ariel terminal leaves its `<id>.log` files in `logs/terminals/` forever. No data is lost or exposed beyond the instance's own `logs/` |
| **Who it bites** | anyone who deletes a chat that had terminal sessions, runs a replace-mode restore, or overwrites a chat on import; also any session removed through `DELETE /api/v1/terminals/[id]` |
| **Provenance** | `terminal_sessions.chatId` is `REFERENCES chats(id) ON DELETE CASCADE`, so the rows vanish with the chat, and the one transcript remover worked only from rows |
| **Fix site** | `lib/database/repositories/terminal-sessions.repository.ts` (`sweepOrphanedTranscripts`, new), `lib/background-jobs/scheduled-maintenance.ts` (step 6b), `lib/background-jobs/maintenance/retention-constants.ts` (`ORPHAN_TERMINAL_TRANSCRIPT_GRACE_MS`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-26).** The daily maintenance tick now runs
`TerminalSessionsRepository.sweepOrphanedTranscripts` right after `cleanupClosedSessions`. It lists
`<logsDir>/terminals/*.log` and unlinks each file no `terminal_sessions` row names (by id or by
stored `transcriptPath`), sparing a file whose session is still live in `ptyManager` and a file
written within the last hour (the PTY manager opens the transcript before it inserts the row).
Shell-init artifacts (`init-<id>.bashrc`, `zdotdir-<id>/`) are not touched; they are cleaned on PTY
exit.

Test: `__tests__/unit/database/terminal-transcript-orphan-sweep.test.ts`. Not yet verified live.

## Symptom

`logs/terminals/` keeps growing with transcripts of sessions that no longer exist in the database.
The 30-day closed-session reaper never removes them.

## Root cause

`lib/terminal/pty-manager.ts` writes each session's transcript to `<logsDir>/terminals/<id>.log`.
The only code that deleted those files was `cleanupClosedSessions`
(`terminal-sessions.repository.ts`), which selects rows with `exitedAt` older than the cutoff and
unlinks each row's transcript. Every path that removes a chat — `ChatsRepository.delete` (Salon
delete, help chats, the Brahma console, `lib/cascade-delete.ts`, the import overwrite in
`import-entities.ts`, and replace-mode restore in `lib/backup/restore/delete-service.ts`) — lets
the FK cascade remove the `terminal_sessions` rows and never looks at the files. Once the rows are
gone, nothing names the transcripts. `DELETE /api/v1/terminals/[id]` had the same gap for a single
session.

## Why it survived

The files live under `logs/`, not `files/`, so no file-storage sweep sees them, and terminal
sessions are deliberately left out of backups, so a restore never surfaced the mismatch.

## The fix

An orphan sweep rather than a per-delete unlink, so every path that drops a row is covered,
including ones added later. A chat deleted under a live terminal still leaves the PTY writing with
no row; the sweep asks `ptyManager.get(id)` and spares it.

## How to verify

Live: open a terminal in a chat, exit it, delete the chat, and note the `<id>.log` in
`logs/terminals/`. Back-date its mtime past an hour and trigger maintenance; the file is gone and
the pass logs `Swept orphaned terminal transcripts` with `deleted: 1`.
