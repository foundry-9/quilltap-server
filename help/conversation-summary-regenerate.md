---
url: /settings?tab=memory&section=conversation-summaries-regenerate
---

# Regenerate Conversation Summaries

> **[Open this page in Quilltap](/settings?tab=memory&section=conversation-summaries-regenerate)**

Every conversation a character takes part in leaves behind a tidy little dossier — a rolling summary of all that transpired — and a fair copy of that dossier is filed away on the character's own shelves, in a folder marked *Conversation Summaries*. The Commonplace Book consults those files before a character speaks, leafing through past dialogues for the ones that bear on the present moment and slipping the most pertinent into the character's ear. It is a quietly clever arrangement: a character may not remember every word of a chat from a fortnight ago, but they can be reminded that the chat happened, and pull the full transcript at will.

The filing, however, only happens going forward. Conversations that ran their course *before* this arrangement was installed never had their dossiers copied to the shelves — and a character cannot recall a file that was never filed. *Regenerate Conversation Summaries* is the brass lever that goes back through the archive and files them all, at once.

## What It Does

When you press the lever, Quilltap walks every conversation in the instance that has a summary to its name and, for each one, writes a fresh copy of that summary into the *Conversation Summaries* folder of every character who took part. The work runs in the background; you may close the tab and return whenever it suits you.

- Only conversations that already carry a summary are touched. A brand-new chat that has not yet been summarised has nothing to file, and is passed over.
- Each summary is filed under the conversation's own permanent identifier, so re-running the lever simply replaces the existing file rather than littering the shelves with duplicates. Running it twice does no harm.
- The files are written to every participating character's vault — both the AI-played and the player-played — exactly as the live summariser would have written them.

## Why You Would Pull It

Reach for the lever when:

- You have conversations that predate the *Conversation Summaries* arrangement and you would like their characters to be able to recall and revisit them.
- The summary file format has changed and you wish the existing files brought up to the current pattern.
- You suspect the shelves have fallen out of step with the conversations themselves and would like them set right.

It is a one-off restorative, not a routine chore — the live summariser keeps the shelves current of its own accord every time a conversation is summarised, and refreshes a character's *relevant past conversations* on each fold. You should rarely need this lever more than once.

## Watching the Work

While the regeneration runs, the *Sum* badge in the page header shows the queue depth, and the card itself displays a count of the regeneration jobs still in flight, refreshed on a five-second poll. When the count reaches zero, every summary has been filed.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=conversation-summaries-regenerate")`

## Related Settings

- [Regenerate the Commonplace Book](memory-regenerate.md) — The neighbouring lever that wipes and rebuilds chat-derived *memories* (a different thing entirely from these conversation summaries)
- [Embedding Profiles](embedding-profiles.md) — The filed summaries are chunked and embedded with the active profile, which is what makes them retrievable
- [Memory Housekeeping](memory-housekeeping.md) — Routine pruning of low-importance memories as characters approach their cap
