---
url: /settings?tab=memory&section=memory-recall
---

# Recall Relevance

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-recall)**

A character's memories are not all of a piece. Some are true of them wherever they go — that they are a coward in matters of the heart, that they cannot abide a poorly steeped tea. Others are true only within the walls of a particular project or story — a vow sworn to a figure who exists only in *that* tale, a fact about a city that stands only in *that* world. The Commonplace Book has, for some time now, quietly noted which of the two each memory is. *Recall Relevance* is where you decide what Quilltap does with that note when a memory tries to surface in a conversation it may not belong to.

## The Trouble With a Wandering Memory

Picture a character who keeps company with you across several projects. In the first, a sweeping naval saga, they once resolved to mutiny against a captain. That resolution is *true only inside the naval saga* — it has no business at all in your second project, a quiet drawing-room comedy, where there is no captain and no ship to mutiny upon. Yet, left unchecked, a sufficiently vivid memory can come wandering through the wrong door, and the character will appear to "remember" something that, in the present company, never happened. It is, at best, a non-sequitur; at worst, it quietly corrupts the character's sense of where they are.

This setting closes that door.

## Your Two Choices

When a project-specific memory tries to surface in a chat belonging to a **different** project, Quilltap can do one of two things:

- **Down-weight** *(the recommended default)* — the memory is heavily penalised, so it will almost never rise to the surface in the wrong project, but it is never absolutely forbidden. Should the present conversation match it with overwhelming force, it may still break through. This is the gentler hand: it demotes, but does not censor.
- **Exclude** — the memory is struck from consideration entirely. A project-specific memory simply cannot appear outside its own project, full stop. This is the firmer guard, for those who would rather a clean separation than an occasional exception.

A memory that is true of the character *everywhere* is never touched by either setting — it surfaces wherever it is relevant, as it always has. And a memory from a chat that belongs to **no** project, or one filed before the Commonplace Book learned to take such notes, is likewise left in peace: Quilltap never penalises a memory for missing information.

## What Else Recall Quietly Does

Independently of your choice above, the recall path now also gives a gentle backward glance to memories the character has explicitly outgrown. A fact that *was* true once but is no longer — a former allegiance, an abandoned plan — is quietly nudged down the running order, so that a live, present truth is not elbowed aside by a superseded one. This requires no setting; it is simply the Book becoming a slightly better librarian.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-recall")`

## Related Settings

- [Memory Housekeeping](memory-housekeeping.md) — prunes the shelves once a character's memories grow numerous
- [Embedding Profiles](embedding-profiles.md) — the semantic match that recall ranks on top of
- [The Command Line and the Commonplace Book](cli-memories.md) — survey and search the memories themselves
