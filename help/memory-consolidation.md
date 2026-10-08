---
url: /settings?tab=memory&section=memory-consolidation
---

# Memory Consolidation

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-consolidation)**

Until now the Commonplace Book could do four things with a memory: write it down, underline it when it came up again, pin it to its neighbours, and — under duress — throw it out. What it could not do was *combine*. Five notes about one long conversation stayed five notes, none of them aware of the others, and a much-loved character's shelves filled with shards of what she knew rather than the knowing itself.

*Memory Consolidation* is the missing verb. Every so often a diligent clerk goes through a character's memories, gathers the ones that are plainly about the same thing, and writes a single **digest** in their place: names, dates, numbers and promises intact, the newer word winning wherever the old notes disagree. The original notes are not burned. They go to the archive, where the character can still find them by searching.

Consolidation is **off by default**. The *Consolidate now* buttons work whether or not it is switched on, so you can try it on one character first.

## What a Run Does

For one character at a time, consolidation:

1. **Sorts the character's active memories by subject** — what they remember about each other person, about themselves, and the odd note about nobody in particular.
2. **Gathers clusters.** Within each subject, memories whose meaning sits close together (measured on the same embeddings the rest of the Book uses) are gathered into a cluster. Memories younger than a week are left to settle first. Notes about a particular dated event only cluster with notes about events within a day of it, and become *episode* digests rather than standing facts.
3. **Asks a model to combine each cluster.** One call per cluster. The model writes one or more digests, may keep a note standalone when it is too distinct to fold, and reports any contradictions it found. It may never invent: every sentence must trace back to a note it was given. An answer that does not account properly for its notes is thrown away and nothing is written for that cluster.
4. **Files the result.** Each digest becomes an active memory (marked *Digest* in the Commonplace Book). The notes it replaced move to the archive, each pointing at its digest; links other memories had to those notes are re-aimed at the digest. Where two notes contradicted each other, the older one goes to the archive.
5. **Copies the digests into the character's vault**, one file per subject: `Commonplace/<Name>.md` and `Commonplace/Self.md`. These sit apart from the hand-written `Others/` folder, which consolidation never touches. Memory extraction reads them, so once something has been digested the extractor treats it as already known and stops writing it down again.

A run takes at most a set number of clusters, the biggest first; a large backlog drains over several runs.

## When It Runs

With consolidation switched on, it runs:

- **Daily**, just before housekeeping (housekeeping then waits half an hour so it sees the result), and
- **When a character piles up new notes** — once more than the *watermark* of their active memories have never been looked at by consolidation.

The *Consolidate now* controls run it on demand for one character. **Dry run** does all the gathering and asking but writes nothing, and shows you every proposed digest beside the notes it would replace — the best way to judge whether you like what the clerk is doing before letting it loose. **Consolidate for real** queues the job in the background.

A dry run spends one model call per cluster, so it is capped at a modest number of clusters.

## Settings

- **Enable consolidation** — turns on the daily run and the watermark trigger.
- **Connection profile** — the model that writes digests. Blank uses your cheap LLM. A more capable model writes noticeably better digests, which matters: a poor digest outranks the notes it replaced. Consider a capable model for a first run over a large backlog, and the cheap one for the daily trickle after.
- **Cluster threshold** — how alike two memories must be to share a cluster (default 0.72). Higher makes smaller, tighter clusters.
- **Minimum / maximum cluster size** — the fewest notes worth a digest (default 3; 2 once the notes are a fortnight old) and the most handed to one call (default 30).
- **Mature after (days)** — memories younger than this are left alone (default 7).
- **Clusters per run** — the most model calls one run makes (default 40).
- **Watermark** — how many never-considered active memories trigger a run (default 150).
- **Cold retention (days)** — blank means archived memories are kept forever. A number lets housekeeping delete archived memories that a digest replaced once they are older than that. Memories you wrote by hand are never deleted.

Chats whose Concierge posture is *Locked* or *Unmoderated* are respected: digests drawn from them are written under the same rules as the conversations they came from.

## Memories About Others

> Deep link: [/settings?tab=memory&section=memory-extraction-grain](/settings?tab=memory&section=memory-extraction-grain)

The **Extraction Grain** card, beside Consolidation, changes how often a character writes down what they notice about *other* characters. Writing a note every turn meant a four-person room could produce a dozen fragments a turn about one thread of conversation, each a little different, none reinforcing the others. Now:

- **Hybrid** (the default) — observations of others are gathered from stretches of conversation, at the same points the running chat summary is updated (every five turns or so), with each thread stated once and at most three notes per person per stretch. Per turn, only the weighty observations — promises, agreements, new standing facts, importance 0.75 and up — are still written straight away.
- **Fold** — only the stretch-at-a-time notes; nothing about others is written per turn.
- **Turn** — the old behaviour: every turn.

What a character remembers about *themselves* is still written every turn in every mode. Short chats that never reach a summary point are caught up by the daily maintenance sweep once they have been quiet for two hours. Expect noticeably fewer new memories a day.

## The Commonplace Book List

In a character's memory list:

- The **tier** filter shows *Active* memories, *Archived* ones, or both. Archived memories are dimmed and labelled.
- An archived memory that a digest replaced has a **Superseded by a digest** link that shows you the digest.
- Digests carry a **Digest** badge and say how many notes they were made from; the source filter can show digests alone.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-consolidation")`

## Related Settings

- [Memory Housekeeping](memory-housekeeping.md) — archives the least-used memories when a character has too many active ones
- [Recall Relevance](memory-recall-relevance.md) — how recall prefers digests and leaves the archive alone
- [Regenerate the Commonplace Book](memory-regenerate.md) — rebuild a chat's memories from scratch
- [The Command Line and the Commonplace Book](cli-memories.md) — `quilltap memories consolidate` and the `--tier` filter
