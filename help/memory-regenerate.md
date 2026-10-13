---
url: /settings?tab=memory&section=memory-regenerate
---

# Regenerate the Commonplace Book

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-regenerate)**

Every so often, a thoughtful proprietor finds themselves staring at the Commonplace Book and wishing — wistfully, regretfully — that the whole charming clutter could be reshelved from scratch. Perhaps the extraction LLM has grown more discerning since the early entries were inscribed; perhaps the gate has been recalibrated; perhaps a small tide of duplicates has washed in from a long-running chat and refused to leave. *Regenerate Memories* is the brass lever that does precisely that: it sweeps every chat-derived memory off the shelves and writes the room afresh, with the current pipeline doing the writing.

It is, by design, a deliberate choice. The button waits behind a confirmation; the work itself runs in the background while you carry on with whatever you were doing.

## What It Does

When you press the lever — and confirm — these things happen, in order, for every conversation in the instance:

1. **The chat's memories are wiped.** Every Commonplace Book entry tied to that chat is deleted, and its trace is removed from the character's vector store so it cannot resurface in semantic searches.
2. **The chat is broken back into turns.** Each user message marks the opening of a turn; the assistant replies that follow it, up to the next user message, are the body. The character's greeting, before the first user message, is a turn of its own (and a greeting-only chat is just that one turn), and in an autonomous room — where no user ever speaks — each character's contribution is a turn of its own, exactly as the room recorded them live.
3. **One extraction job is enqueued per turn.** The current pipeline, with whatever gates and importance signals are presently in force, runs against each turn and writes new entries. The hourly extraction limit, if you have switched it on, does not apply to a rebuild.
4. **Observations of other characters are gathered again in one sweep.** Under the default extraction setting most of what a character notices about the others in a conversation is collected over stretches of conversation rather than turn by turn (see [Memory Consolidation](memory-maintenance.md#memories-about-others)). The regenerate resets that bookmark for the chat and queues one pass over the whole conversation, read sixty messages at a time from the first page to the last, so those observations are rebuilt along with everything else — the early chapters every bit as thoroughly as the latest.

5. **The episodes are written again from the first page.** The chat's *episodes* — the dated narratives the Book composes as the Librarian folds a chapter away (see [Episodic Memory](episodic-memory.md)) — go out with the wipe, so the Book also sets its episode bookmark back to the beginning and queues one pass over every page the Librarian has folded away, sixty messages at a time, each pass handing the remainder to the next until the folded history has its episodes once more. Pages the Librarian has not yet folded are left for the ordinary course of the chat, as they always are.

Manual memories — the ones you typed in yourself, with **MANUAL** as their source — are scoped out of the operation entirely. So are project notes and any other memories that were never tied to a specific chat. The wipe likewise leaves alone the entries that have gone to the archive (the *cold* tier), and any consolidated digest that still has a member to speak for; extraction would never write those back, and pulling a digest from under its members would leave them pointing at an empty shelf. A digest whose members have all departed is swept with the rest. All of these stay exactly as they were, and the per-entry delete in the Commonplace Book remains the way to remove any one of them on purpose.

Memories whose chat has already been deleted (orphans) are also wiped, since nothing remains to regenerate them from. Their vector store entries go with them.

## What About Dangerous Chats?

If a chat is **Unmoderated** and an uncensored text profile is available — either named as the *Uncensored text profile* on the Concierge's desk (`/settings?tab=concierge&section=uncensored-desk`) or found by marking a connection profile as both *Cheap* and *Uncensored-compatible* — that profile will be used to extract memories from that chat. Other chats use your standard cheap LLM as usual. This routing happens automatically; you don't need to do anything special beyond having the dangerous profile configured.

## How Fast the Sweep Runs

How many extraction jobs run shoulder-to-shoulder is no longer set here — it is governed by the single **Simultaneous Labours** dial that presides over *every* background errand. You will find it atop the **Tasks Queue** card in the **Data & System** tab of Settings. Nudge it upward when a capable backend can shoulder more at once; leave it at the modest factory setting of four when in doubt. See [Managing Tasks](system-tasks-queue.md) for the full account.

## Watching the Sweep

While the regeneration is running, the *Mem* badge in the page header shows the queue depth, and the regenerate card itself displays a count of the wipe and extraction jobs still in flight. Both update on a five-second poll. When everything reaches zero, you're done.

## When to Use This

Reach for the lever when:

- The extraction pipeline has changed significantly (new gate, new prompt, new importance heuristic) and the old corpus no longer reflects what the current logic would have produced.
- A chat or two has accreted obvious junk you'd rather rebuild than prune by hand.
- You've just imported a large archive and want every chat-derived memory to pass through your current gate's filter rather than the historical one's.

It is **not** the right tool for routine maintenance — that's what *Maintenance* is for, a few cards up. Regeneration is intentional, somewhat expensive (it pays the LLM costs of every extraction pass over again), and final.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-regenerate")`

## Related Settings

- [Memory Maintenance](memory-maintenance.md) — Routine pruning of low-importance memories as characters approach their cap
- [Embedding Profiles](embedding-profiles.md) — Regeneration writes new embeddings too, using whichever profile is currently active
- [Chat Settings — The Staff Behind the Scenes](chat-settings-ai-services.md) — Where the dangerous-compatible profile and cheap-LLM routing are configured
