# Bug 268 — Kill leaves an interactive bash running, and deleting a chat leaves its shells running

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-27, while fixing bug 267 (reproduced with node-pty directly, not yet in the app) |
| **Fixed** | 2026-10-27 |
| **Severity** | Medium. The terminal's Kill control and `DELETE /api/v1/terminals/[id]` do nothing to an interactive bash; a deleted chat's shells run on with no row, no pane and no way to reach them |
| **Who it bites** | anyone who kills an Ariel terminal running bash (zsh not checked), or deletes a chat with a terminal open |
| **Provenance** | Both routes sent `SIGTERM`, which an interactive bash ignores. `PtyManager.kickAllForChat` existed but nothing called it, so a chat delete (which cascades the `terminal_sessions` rows) never touched the live PTYs |
| **Fix site** | `lib/terminal/pty-manager.ts` (`terminate`, `disposeChatSessions`), `app/api/v1/terminals/[id]/route.ts`, `lib/database/repositories/chats.repository.ts` (`delete`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-27).** `ptyManager.terminate(id)` sends `SIGHUP` (what closing a terminal
window sends; bash exits and passes it to its jobs) and `SIGKILL` if the process has not exited
3 s later. The `?action=kill` and `DELETE` routes use it; `?action=signal` still sends exactly the
signal asked for. `disposeChatSessions(chatId)` replaces the unused `kickAllForChat`: it terminates
the chat's sessions and drops them from the map. `ChatsRepository.delete` calls it after the row is
deleted, so every chat delete — the Salon, help chats, the Brahma console, cascade delete, import
overwrite and replace-mode restore — ends the chat's shells. The exit handlers then find no chat
and no row, so no announcement is posted and no exit state written; the transcripts are left for
bug 267's orphan sweep.

Tests: `lib/terminal/__tests__/pty-termination.test.ts`,
`__tests__/unit/lib/database/repositories/chats-delete-terminals.test.ts`. Not yet verified live.

## Symptom

Clicking Kill on a bash terminal (twice, to confirm) leaves the shell running; no closing
announcement appears. Deleting a chat with a terminal open leaves its shell running.

## Root cause

`app/api/v1/terminals/[id]/route.ts` called `ptyManager.kill(id, 'SIGTERM')` in both `handleKill`
and `handleDelete`. bash ignores `SIGTERM` when interactive (so that `kill 0` does not kill it). With
node-pty, `bash -i` killed with `SIGTERM` was still alive 2 s later; with `SIGHUP` it exited in
under 5 ms. `kickAllForChat` had no callers, and also used `SIGTERM`.

## How to verify

Open a bash terminal in a chat and click Kill: Ariel's closing announcement appears with
signal 1. Open another, delete the chat, and check `ps` for the shell: it is gone, and
`combined.log` has `Terminated sessions of deleted chat`.
