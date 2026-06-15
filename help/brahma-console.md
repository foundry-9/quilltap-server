---
title: Brahma Console
url: /brahma-console
tags: [help, chat, console, llm, model, tools, brahma]
---

# The Brahma Console

> **The Brahma Console is summoned from the sidebar, by the tetra-radial console mark sitting just beneath the question-mark.**

Where the Help Chat sends you a well-mannered concierge — a *character*, with a personality and a fondness for the house documentation — the Brahma Console dispenses with all such ceremony. It is, quite simply, a direct line to a large language model: no persona, no costume, no scene to play. You choose an engine, and you speak to it plainly. Think of it as the telegraph key in the corner of the workshop, ready at any hour for a frank word with the machine.

## Opening the Console

At the foot of the left sidebar, just below the Help icon, you will find the **tetra-radial console mark** — a ring of four nodes wired to a central hub. A single press and the Console floats into view, a draggable, resizable window that hovers obligingly over whatever page you happen to be on. (It cares not one whit which page that is; see *What the Console deliberately forgets*, below.)

The Console opens, as the Help Chat does, to a roster of your **past conversations**. Select one to resume it exactly where you left off, or begin afresh with the composer at the bottom of the window.

## Choosing your engine

Every Console conversation talks to exactly one **connection profile** (your configured model). When you open a fresh conversation, the Console reaches for your **default** profile. Once a conversation is underway, a **model picker** appears in the window's title bar: press it to survey every profile you've established — provider and model plainly labelled — and choose another.

Switching the engine **continues the same conversation**. The transcript carries on uninterrupted; only the machine answering from that point forward has changed. Should you wish to put the same question to two different engines, simply ask, switch, and ask again.

> A connection profile is the one prerequisite. With none established, the Console mark sits dimmed; visit the Foundry's system settings to add one, then return.

## What the Console can do

The Console is a capable, concise, neutral assistant. Beyond plain conversation, it carries a deliberately small kit of tools:

- **Search** — It can search across your past conversations and every one of your document stores, including the knowledge folders within them.
- **Documents** — It has full reach into your document stores: it can read files, list and grep their contents, and **write** to them as well.
- **The wider world** — When the chosen connection profile permits it, the Console can search the web; and when the `curl` plugin is installed and enabled, it can fetch URLs directly.

## What the Console deliberately forgets

The Console is, by design, an amnesiac of impeccable discretion:

- **It keeps no memories.** Nothing said in the Console is ever filed away into your characters' commonplace books. When a conversation ends, only the visible transcript remains.
- **It reads no memories, either.** The memory stores are simply not among the things it can search. This is intentional, not an oversight.
- **It is not page-aware.** Unlike the Help Chat, the Console neither knows nor tracks which screen you are viewing. It will not volunteer help about your current page, because it has no notion of where you are.
- **It has no character.** No identity, no personality, no avatar, no roleplay. It speaks in its own plain voice.

## In-Chat Navigation

To direct the user to the sidebar where the Console mark lives:
```
help_navigate(url: "/")
```

## Related Pages

- [Help Chat](help-chat.md) --- The in-character assistant, by contrast
- [Left Sidebar](sidebar.md) --- Where the Console mark lives
- [Connection Profiles](connection-profiles.md) --- Establish the engines the Console can call upon
- [The Scriptorium](scriptorium.md) --- The document stores the Console can read and write
