---
url: /settings?tab=memory&section=memory-maintenance
---

# Memory Maintenance

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-maintenance)**

The Commonplace Book grows. Every conversation adds entries, underlines old ones, and pins related observations together. Left entirely to its own devices, a much-loved character's shelves can run to tens of thousands of items — a splendid predicament, but rather a heavy one for a local machine to lift at every turn, and a muddle besides: five notes about one long evening stay five notes, none of them aware of the others.

*Memory Maintenance* is the household staff that sees to all of it. Once a round, for one character at a time, they fold away repetitions, gather related notes into a single **digest**, carry what nobody has asked after lately down to the archive, and — only if you ask — let go of archive notes that a digest long since replaced. One card on the **Commonplace Book** tab governs the lot; it replaces the old Housekeeping, Consolidation and Near-Duplicate Folding cards, and links to any of those now open it.

Maintenance is **off by default**, and nothing it does destroys a note you wrote by hand. What it moves, it *archives*.

## The Archive (Active and Archived Memories)

Every memory lives on one of two shelves:

- **Active** (internally, *hot*) memories are the ones a character can actually recall: the standing archive in every prompt, the handful surfaced fresh each turn, what one character remembers of another, the recap at the start of a chat.
- **Archived** (internally, *cold*) memories are kept, but no longer whispered. They still stop the same fact being written down twice, the character can still find them by searching their own memory (they come back marked *archived*), and you can still browse them in the Commonplace Book, where a filter separates the two shelves.

A memory goes to the archive in one of two ways: the cap sends it there, or consolidation folds it into a digest and files the original away behind it. If the world brings up an archived memory again — one the cap archived, not one a digest replaced — it is promoted straight back to the active shelf. Re-observing something a digest has absorbed reinforces the digest instead.

A memory the cap archived is not forgotten in a drawer, either. The next consolidation considers it alongside the active shelf, so what it said can be folded into a digest; once it has been, it sits behind that digest like any other replaced note.

## The Round, Step by Step

The round always goes in the same order, and a step that is switched off is simply skipped:

1. **Fold near-duplicates.** Extracted memories that say the same thing about the same person on the same occasion — very nearly word for word, by the house's reckoning — are folded into the sturdiest of them, any stray detail kept as a footnote. No model is consulted; it is plain arithmetic.
2. **Consolidate.** A clerk gathers the notes that are plainly about the same thing and writes a digest in their place — see [Consolidation](#consolidation) below.
3. **Demote over the cap.** If a character has more extracted notes in active service than the cap allows, the least protected go to the archive until the count is back inside it — see [The Cap](#the-cap).
4. **Retire old archive notes.** Archived notes a digest has replaced, and that have sat in the archive longer than the retention window, are let go for good — but only when you have set a window.
5. **Refresh the Commonplace files** in the character's vault for any digest the round changed.

Because consolidation comes before the cap, the cap only ever measures what is left once the clerk has combined what can be combined, and whatever the cap archives is waiting for the clerk's next visit.

Hand-written memories and digests are never folded, never demoted and never let go by any of this, and archived memories are never folded.

## When It Runs

With **Enable automatic maintenance** ticked, the staff call:

- **Once a day**, as a safety net for characters whose shelves crept up while no one was chatting with them.
- **When a character nears the cap** — nine-tenths of it, measured after new notes are written. The check is cheap and made in the server's own head, which also remembers when it last called: not again for at least fifteen minutes, nor for an hour after a round that could barely make a dent.
- **When a character piles up new notes** — once more than the *watermark* of their active notes have never been looked at by consolidation, and no more often than every six hours (this one needs consolidation switched on).

The work runs as a background job, so it never holds up a chat turn. Only one round is ever under way for a character at a time: a daily round, a watermark visit and a press of the button all join the round already waiting, which simply takes on whatever extra steps the newcomer asked for; a request that arrives while a round is actually under way waits its turn behind it.

## The Switches

**Enable automatic maintenance** governs the daily and near-the-cap rounds. Beneath it, each step has its own switch:

- **Fold near-duplicates**, **Demote over the cap** and **Retire old archive notes** — on by default once maintenance is enabled.
- **Consolidate** — has a switch of its own, separate from the master switch, because it costs model calls. Off by default.
- **Archive retention** — the number of days an archived note a digest replaced is kept before **Retire** lets it go. Blank (the default) means *never*: retirement then does nothing at all. The clock starts when a note goes down to the cellar, and is not wound back by later tidying. A note the cap archived is never let go until a digest has replaced it. When an archived note does go, its digest's tally is corrected to match — though retirement never takes the digest itself, which was written precisely to outlive the notes it replaced.

The switches govern every step the house decides on for itself. A step you ask for by hand — through **Run maintenance…**, the character page's **Maintenance** button, or `quilltap memories maintain` — runs regardless of them.

## The Cap

The **per-character cap** is the number of **extracted** notes a character may keep in active service before the cap starts sending them to the archive. Archived notes, hand-written notes and digests do not count against it, so a character rich in hand-written notes is never declared "over the limit" on their account. Default **2000**; acceptable range 100 – 100,000, the same bounds everywhere the cap is typed.

**Per-character overrides**, beneath the cap, list each character with two figures: how many notes are *counted* against the cap, and how many are *exempt* (hand-written notes and digests, which are never counted and never archived). The counted figure turns red when it is over that character's cap. An override takes precedence over the global cap; leave the box blank and the character uses the global one.

### What the cap protects

When a character is over the cap, the staff archive exactly as many notes as the excess — not one more — starting from the least protected. Protection is a **blended score** of four kinds of evidence:

- **Content** — the model's importance rating, fading with a thirty-day half-life and *capped*, so that importance alone can never make a note permanent. A fresh note rated 0.9 contributes no more than a fresh note rated 0.4; to be safe, a note must also show signs of use.
- **Reinforcement** — how many times the note has been observed again. A retelling close enough to be a near-copy writes no new memory but still counts here, so the facts a character is told most consistently are the best established. The reference clock resets whenever a note is reinforced with new details.
- **Links** — how many related notes point at it.
- **Recent use** — whether it actually reached a character (whispered into a turn, returned by a search the character ran) in the last ninety days. Your opening it in the Commonplace Book, or through the API, does not count.

Reinforcement and links both count for less with each addition: the first few matter more than the next ten. Age and neglect are already in the score, so there is no separate "old and unimportant" rule.

## Consolidation

The clerk's errand, for one character at a time:

1. **Sorts the character's active notes by subject** — what they remember of each other person, of themselves, and the odd note about nobody in particular. Notes the cap carried to the archive, and that no digest has yet replaced, are brought back up for the occasion.
2. **Gathers clusters.** Within each subject, notes whose meaning sits close together (on the same embeddings the rest of the Book uses) are gathered. Notes younger than a week are left to settle. Notes about a dated event only cluster with notes about events within a day of it, and become *episode* digests.
3. **Asks a model to combine each cluster**, one call per cluster. The model writes one or more digests — names, dates, numbers and promises intact, the newer word winning wherever the old notes disagree — may keep a note standalone when it is too distinct to fold, and reports contradictions. It may never invent: every sentence must trace back to a note it was given, and an answer that does not account for its notes is thrown away.
4. **Files the result.** Each digest becomes an active memory (marked *Digest* in the Commonplace Book). The notes it replaced move to the archive, each pointing at its digest; links other memories had to those notes are re-aimed at the digest. Where two notes contradicted each other, the older goes to the archive.
5. **Copies the digests into the character's vault**, one file per subject: `Commonplace/<Name>.md` and `Commonplace/Self.md`, apart from the hand-written `Others/` folder, which is never touched. Memory extraction reads them, so once something has been digested the extractor treats it as already known. The copy is made only *after* the round's writes are safely entered in the Book, and from what was entered — a round that stumbles at the last fence leaves the vault files exactly as they were. Delete a digest yourself and its subject's file is copied afresh without it; delete the last digest about someone and their file is cleared away.

A round takes at most a set number of clusters, the biggest first; a large backlog drains over several rounds. Chats whose Concierge posture is *Locked* or *Unmoderated* are respected: digests drawn from them are written under the same rules as the conversations they came from.

### Consolidation particulars

Open **Consolidation particulars** on the card for:

- **Connection profile** — the model that writes digests. Blank uses your cheap LLM. A more capable model writes noticeably better digests, which matters: a poor digest outranks the notes it replaced. Consider a capable model for the first, large backlog and the cheap one for the daily trickle.
- **Cluster threshold** — how alike two notes must be to share a cluster (default 0.72). Higher makes smaller, tighter clusters.
- **Cluster threshold (Built-in)** — the same measure, used instead when the default embedding profile is the Built-in (TF-IDF) one (default 0.30), which reckons likeness by shared words alone and scores even close cousins modestly.
- **Smallest / Largest cluster** — the fewest notes worth a digest (default 3; 2 once the notes are a fortnight old) and the most handed to one call (default 30).
- **Mature after (days)** — notes younger than this are left alone (default 7).
- **Clusters per run** — the most model calls one round makes (default 40).
- **Watermark** — how many never-considered active notes bring the staff round (default 150).

A threshold given for a single run (through the API or `quilltap memories maintain --threshold`) is honoured by a real run just as by a dry run, so the rehearsal and the performance gather the same clusters.

## Running It Yourself

**Run maintenance…** on the card opens a dialog: choose a character (or *Every character*), tick the steps you want, and optionally give a cap for this run alone. Then:

- **Dry run** does all the planning — and, for consolidation, all the asking — but writes not a word, and shows what each step would do: the sets it would fold, every proposed digest beside the notes it would replace, how far over the cap the character stands and how many notes would go to the archive. A dry run that includes consolidation spends one model call per cluster, so it is capped at a modest number of clusters and can be held for one character at a time; the arithmetic steps can be rehearsed for every character at once.
- **Run for real** queues the round in the background and goes ahead whatever the switches say.

The same dialog opens from the **Maintenance** button on a character's own memory page, fixed to that character.

## The Ledger

The card's **ledger** shows, for each character the staff have visited since the server last started, when each step last ran and why (*daily round*, *nearing the cap*, *by hand*), and what the last round did. It refreshes itself when a round finishes. `quilltap memories status` prints the same.

## Before You Switch It On

On an instance with a long history, rehearse first: open **Run maintenance…**, choose *Every character*, untick **Consolidate**, and press **Dry run** — the table shows how many repetitions each character would lose to folding and how far each stands from the cap. Then try a consolidation dry run on one character before trusting the clerk with the rest.

If your instance predates Quilltap 4.3, run **Repair Missing Embeddings** (just above the card) first. Older versions sometimes wrote memories without embeddings; those are invisible to folding, consolidation and semantic search alike. `quilltap memories validate --repair` will find them too, along with any links left pointing at notes that are no longer there.

## Memories About Others

> Deep link: [/settings?tab=memory&section=memory-extraction-grain](/settings?tab=memory&section=memory-extraction-grain)

The **Extraction Grain** card changes how often a character writes down what they notice about *other* characters. A note every turn meant a four-person room could produce a dozen fragments a turn about one thread of conversation. Now:

- **Hybrid** (the default) — observations of others are gathered from stretches of conversation, at the same points the running chat summary is updated (every five turns or so), with each thread stated once and at most three notes per person per stretch (fewer when the connection profile's reply budget is modest — one note for every 8,000 tokens of reply, never less than one — plus one more when the extra note records a dated or placed event). Per turn, only the weighty observations — promises, agreements, new standing facts, importance 0.75 and up — are still written straight away.
- **Fold** — only the stretch-at-a-time notes; nothing about others is written per turn.
- **Turn** — the old behaviour: every turn.

What a character remembers about *themselves* is still written every turn in every mode. Short chats that never reach a summary point are caught up by the daily round once they have been quiet for two hours.

### Rate limits

The same card carries the **rate limits**, which act at the other end of the pipeline: where maintenance tidies the shelves after the fact, the limits slow what enters them. When **Limit how quickly a character takes notes** is ticked, the house counts how many new notes it has written for a character in the trailing hour — counting as each is written, so a long stretch read in one sitting is held to the limit partway through. Past **Begin choosing at** (a share of the limit, default 0.7), only notes at or above the **Importance floor** (default 0.7) are kept; at **Notes per hour** (default 20) the character forms no new notes from the exchange. The tally lives in the server's head, so a restart begins the hour afresh. Rebuilding history — a regenerate, *Re-extract Memories*, an imported chat — is never held to the limit and never counts towards it. Off by default.

If you find yourself pressing **Run maintenance…** constantly, consider turning the limits on as well.

## The Commonplace Book List

In a character's memory list:

- The **tier** filter shows *Active* memories, *Archived* ones, or both. Archived memories are dimmed and labelled.
- An archived memory that a digest replaced has a **Superseded by a digest** link that shows you the digest.
- Digests carry a **Digest** badge and say how many notes they were made from; the source filter can show digests alone.
- **Maintenance** opens the run dialog for this character.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-maintenance")`

## Related Settings

- [Recall Relevance](memory-recall-relevance.md) — how recall prefers digests and leaves the archive alone
- [Embedding Profiles](embedding-profiles.md) — folding, consolidation and the gate all measure likeness on these embeddings
- [Regenerate the Commonplace Book](memory-regenerate.md) — rebuild a chat's memories from scratch
- [The Command Line and the Commonplace Book](cli-memories.md) — `quilltap memories maintain`, `status` and `validate --repair`
- [Chat Settings — The Staff Behind the Scenes](chat-settings-ai-services.md) — memory cascade preferences for message deletion
