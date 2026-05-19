---
url: /salon
---

# Ariel — Terminals in the Salon

The modern Salon, that cathedral of conversational commerce, has long lacked one essential instrument of the contemporary workplace: a proper terminal. Your characters may discourse upon technical matters whilst remaining blind to the actual machinery churning beneath the floorboards. Ariel attends to this deficiency by opening a live shell session directly into a chat — a genuine PTY (pseudo-terminal) running under bash, zsh, or PowerShell, depending on your platform, so you and your assembled cast may witness the business of computation unfold in real time.

## What Ariel does

When you summon Ariel via the terminal button in the Salon composer, a live shell session emerges in a chat bubble. Every command you type executes on your machine, in the working directory where the Quilltap server is running, with the same environment variables and permissions that the server itself possesses. Characters with appropriate capabilities may, should you grant them the right tools, *read* the terminal scrollback and historical output — but only the user (that is, you) may command the machine.

**This is read-only for the LLM in this release.** Characters see but cannot dictate. You hold exclusive dominion over the keyboard.

Each chat maintains its own independent terminal session. Close the chat, and the session vanishes. Kill the terminal button, and the session ends. It is a creature of that particular conversation, ephemeral as candlelight.

## Opening a terminal

Look for the terminal icon in the Salon composer — the same toolbar where you would ordinarily find buttons for attachments or other niceties. Click it, and Ariel establishes the session. A fresh terminal window materializes in the chat thread, awaiting your first command.

## What characters can see

Should you enable terminal-reading capabilities (the `terminal_read` and `terminal_list` tools), a character may consult the session's recent scrollback: recent commands, their output, directory listings, file contents — the usual fare of a terminal session. They cannot run commands. They cannot alter files. They witness only what you have already caused to occur.

Think of them as spectators in the control room, able to read the instruments but not touch the switches.

## Caveats

Ariel operates under Quilltap's own user account and working directory. When you open a terminal, you inherit whatever shell environment the server runs under. Treat this as you would any terminal on your own machine: it can execute any command your user can execute, access any file your user can access, and alter any data your user can alter. An errant `rm -rf` here is as catastrophic as it would be anywhere else.

Similarly, environment variables, shell aliases, and PATH configuration are inherited from the server process. If you have questions about what is accessible from within a terminal session, apply the same caution and verification you would apply to any shell on your system.

## Terminal Mode — promoting Ariel from the chat thread to a dedicated pane

A terminal stuffed inside a chat bubble is a fine arrangement for an occasional check, but for sustained work — tailing logs, running a build, watching a server start up — the bubble grows tiresome. Terminal Mode offers proper accommodations: a dedicated pane on the right of the Salon, with the chat reposed quietly on the left, exactly the way Document Mode arranges its scribbling.

Click the terminal button in the composer with no terminal yet running, and Ariel will spawn one and usher you straight into Terminal Mode. If a terminal session is already running in this chat, you'll be presented with a small picker — choose an existing session to bring into the pane, or commission a new one. Either way, the pane appears on the right, divider draggable, and the chat retreats to its half of the salon.

Should you enter Document Mode while Terminal Mode is also active, the right-hand pane partitions itself horizontally — document on top, terminal beneath — with a second draggable divider between them. Both halves remain interactive; resize at your leisure.

The terminal pane offers two distinct exit ceremonies, located at the right of its header:

- **Close pane** (the dash icon) — the pane folds away, but the terminal session itself continues to draw breath. The familiar message-bubble embed in the chat thread becomes interactive once more; should you wish to consult the terminal again, click the composer's terminal button and the pane returns with the same session intact.
- **Kill** (the red ✕) — terminates the underlying shell *and* closes the pane. Ariel's customary closing announcement appears in the chat. (The first click arms the kill; a second, within four seconds, executes it. This is to forestall accidental regicide.)

The pane state — whether it is open, which session it shows, where you set the dividers — persists with the chat record, so reloading the page returns you to precisely the arrangement you left.

**Keyboard shortcut:** ⌘⇧T (or Ctrl+Shift+T) toggles Terminal Mode. Escape exits focus mode back to a split.

## Closing a session

Either click the termination button within the terminal bubble (or the red ✕ in the Terminal Mode pane), or simply leave the chat — Ariel will tidy up the session when the conversation ends. Both methods are equally graceful; neither will leave orphaned processes.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```
