# Bug 255 — a full-screen program in an Ariel terminal reads back as fragments

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-19, live on `Friday` (chat `505ceffa`), running Claude Code in an Ariel terminal |
| **Fixed** | 2026-10-19 |
| **Severity** | Medium. Nothing is stored wrongly and the operator's own pane is fine, but `terminal_read` and Ariel's summaries return nothing usable for any full-screen program (Claude Code, vim, less, htop), so a character cannot see what is on the screen |
| **Who it bites** | characters with `terminal_read`, and every chat whose terminal runs a full-screen program (Ariel's periodic summaries) |
| **Provenance** | Original to Ariel. Text read-back was always produced by stripping escape codes from the raw byte stream |
| **Fix site** | `lib/terminal/screen.ts` (new: a server-side `@xterm/headless` emulator per session), `lib/terminal/pty-manager.ts`, `lib/tools/handlers/terminal-handler.ts`, `lib/services/ariel-notifications/writer.ts` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-19).** Every PTY session now feeds a headless terminal emulator alongside the
operator's xterm.js pane, and text read-back is rendered from it. `terminal_read` returns the
emulator's lines (scrollback for a shell, the current screen for a full-screen program, flagged with
`buffer: 'alternate'`); an exited session's transcript is replayed through an emulator at the
geometry now stored on `terminal_sessions` (`cols`, `rows`). Ariel posts a snapshot of the screen
while a full-screen program has the terminal, and the lines written since the last summary
otherwise. Covered by `__tests__/unit/lib/terminal/screen.test.ts`.

## Symptom

Run `claude` in an Ariel terminal and work for a while. `terminal_read` returns the bash banner, a
stray `✻ht` and a few prompt fragments. On `Friday`, session `1bcfb8f1` had written 422 KB; the
cleaned text was 526 characters. Ariel's periodic "Terminal output" messages for the session were
equally empty or garbled.

## Root cause

`cleanTerminalOutput` (`lib/terminal/clean-output.ts`) strips ANSI sequences, applies backspaces, and
keeps only the text after the last lone `\r` on each line. That models a program that writes line by
line. A full-screen program does not: Claude Code switches to the alternate screen (`ESC[?1049h`) and
paints with absolute cursor moves (`ESC[H`, `ESC[59;1H`: ~2,900 each in that transcript), relative
moves (`ESC[52B`), cursor-right in place of spaces (`ESC[2C`, `ESC[5C`), and in-place redraws, with
almost no newlines. Stripping deletes the positioning, so spaces vanish, frames pile onto one line, and
the `\r` rule discards most of what is left. Both the tool (`terminal-handler.ts`) and Ariel's flush
(`pty-manager.ts`) went through it. The live read also sliced only the 256 KB ring buffer, a few
seconds of repainting.

## Why it survived

The terminal was tested with shells, whose output strips cleanly. Nothing exercised a full-screen
program, and the operator's own pane renders correctly from the same bytes, so the loss is visible only
to a character.

## The fix

Apply the escape codes instead of deleting them. `TerminalScreen` (`lib/terminal/screen.ts`) wraps a
`@xterm/headless` `Terminal` (5,000 lines of scrollback) sized at spawn and resized with the PTY; its
replies to terminal queries are not wired to the PTY. Rendering joins soft-wrapped rows in a shell's
buffer but not on the alternate screen, which is a grid (a row filled to the edge leaves the wrap flag
on the next row). `takeSummary` snapshots the alternate screen (skipping an unchanged one) or returns
the shell lines since a marker set at the previous summary. Flushes are chained per session so the
session-closed announcement lands after the final output. `cleanTerminalOutput` is no longer on either
path. Migration `add-terminal-session-geometry-v1` adds the geometry columns.

A transcript replay starts mid-stream and at one size, so for a session that was resized it is
approximate; the final screen is what it gets right. Live reads follow every resize.

## How to verify

Open an Ariel terminal, run `vim README.md` (or `claude`), and have a character call `terminal_read`:
the result says a full-screen program has the terminal and shows the file as it appears on screen.
Leave it idle 30 seconds: Ariel posts "Screen of session …" with the same picture. Quit and run `ls`:
the next summary shows `$ ls` and its listing.
