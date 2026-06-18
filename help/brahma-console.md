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

Every message in the transcript — yours and the engine's alike — wears a small **copy mark** just beneath it. A single press tucks that message's text, in its original Markdown, onto your clipboard, ready to be pasted wherever you please; the mark winks to a checkmark for a moment to confirm the deed is done.

## Choosing your engine

Every Console conversation talks to exactly one **connection profile** (your configured model). When you open a fresh conversation, the Console reaches for your **default** profile. Once a conversation is underway, a **model picker** appears in the window's title bar: press it to survey every profile you've established — provider and model plainly labelled — and choose another.

Switching the engine **continues the same conversation**. The transcript carries on uninterrupted; only the machine answering from that point forward has changed. Should you wish to put the same question to two different engines, simply ask, switch, and ask again.

> A connection profile is the one prerequisite. With none established, the Console mark sits dimmed; visit the Foundry's system settings to add one, then return.

## What the Console can do

The Console is a capable, concise, neutral assistant. Beyond plain conversation, it carries a deliberately small kit of tools:

- **Search** — It can search across your past conversations and every one of your document stores, including the knowledge folders within them.
- **Documents** — It has full reach into your document stores: it can read files, list and grep their contents, and **write** to them as well.
- **The ledgers themselves** — It can put **read-only questions** straight to the databases that keep your establishment running. See *Consulting the ledgers*, below.
- **The wider world** — When the chosen connection profile permits it, the Console can search the web; and when the `curl` plugin is installed and enabled, it can fetch URLs directly.

## Watching the engine think

The Console's replies arrive as they are composed, word following word across the wire rather than landing all at once when the engine has finished. And when you have chosen an engine given to **reasoning aloud** — one of the thinking models — the Console will show you its working as well as its conclusion.

Above each such answer sits a small, dimmed **Thinking** panel. While the engine deliberates the panel stands open, and you may watch the chain of thought unspool in real time; once the answer is settled the panel folds itself shut, leaving the reply uncluttered. Press it open again at any time, on a fresh answer or one long since concluded, to revisit how the engine reasoned its way there.

This musing is shown to you and to you alone. Like everything in the thinking panel throughout Quilltap, it is **for your eyes only** — never fed back to the engine, never filed into a memory, never counted as part of the answer. Engines that do not reason aloud simply show no panel at all.

## Consulting the ledgers

Behind every character, every conversation, every memory and document and tallied expense, there are three great ledgers — Quilltap's databases — and the Console may now read them directly. Ask it a question in the plain language of your world — *"how lopsided is this character's sense of importance?"*, *"which engine has cost me the most this fortnight?"*, *"how many conversations mention the airship?"* — and it will quietly translate your question into a query, consult the appropriate ledger, and answer you in your own terms. You need never see a line of SQL unless you ask to.

Three points of etiquette govern the arrangement:

- **It reads only; it never writes.** The Console may pore over the ledgers to its heart's content, but the pen is locked away. Any attempt to alter, add, or erase is refused before it can run — querying is perfectly safe, and you may invite it to explore freely.
- **The three ledgers are kept in separate rooms.** There is the **main** ledger (characters, chats, messages, memories, profiles, projects), the **engine log** (every model call, its tokens, its cost, its duration), and the **document index** (the document stores, and the full text of every character, project, and group vault). A single question reaches into one room at a time; for a question that spans rooms, the Console carries the answer from one to the next.
- **Inspection is not remembrance.** That the Console may now *read* the memory ledger — to summarise it, to count it, to chart how importance is distributed — is a different thing entirely from *recalling* a memory. Reading the table changes nothing and is filed nowhere; the Console still forms no memories of its own, and its search still cannot draw upon them as a source.

### Seeing the Console's working

You need never read a line of SQL — but should curiosity strike, the working is laid bare. Each time the Console consults a ledger, two tidy panels slip into the transcript at that very spot. The first, marked **Query**, holds the exact query it composed, set in a syntax-highlighted hand and copyable with a press. The second, marked **Result**, lays the ledger's answer out as a proper table — columns ruled, rows tallied, and a quiet note when the haul was trimmed to the row cap. Both panels appear the instant the query lands and may be folded shut with a tap, so the conversation stays unhurried while the evidence remains within easy reach.

Should a query go awry — a misremembered column, a table that isn't there — the **Result** panel reports the ledger's own complaint in plain words rather than a polite shrug, so you (and the engine) can see exactly what went wrong. The Console takes such a rebuff as a cue to inspect the ledger's true shape and try again, rather than guess a second time.

## What the Console deliberately forgets

The Console is, by design, an amnesiac of impeccable discretion:

- **It keeps no memories.** Nothing said in the Console is ever filed away into your characters' commonplace books. When a conversation ends, only the visible transcript remains.
- **It recalls no memories, either.** The memory stores are simply not among the things its **search** can draw upon — that remains intentional, not an oversight. (Its read-only SQL window may *inspect* the memory ledger for tallies and summaries, as *Consulting the ledgers* describes; reading is not recalling, and it remembers nothing of what it reads.)
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
