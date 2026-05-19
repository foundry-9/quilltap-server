---
url: /settings?tab=memory&section=memory-regenerate
---

# Regenerate the Commonplace Book

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-regenerate)**

Every so often, a thoughtful proprietor finds themselves staring at the Commonplace Book and wishing — wistfully, regretfully — that the whole charming clutter could be reshelved from scratch. Perhaps the extraction LLM has grown more discerning since the early entries were inscribed; perhaps the gate has been recalibrated; perhaps a small tide of duplicates has washed in from a long-running chat and refused to leave. *Regenerate Memories* is the brass lever that does precisely that: it sweeps every chat-derived memory off the shelves and writes the room afresh, with the current pipeline doing the writing.

It is, by design, a deliberate choice. The button waits behind a confirmation; the work itself runs in the background while you carry on with whatever you were doing.

## What It Does

When you press the lever — and confirm — three things happen, in order, for every conversation in the instance:

1. **The chat's memories are wiped.** Every Commonplace Book entry tied to that chat is deleted, and its trace is removed from the character's vector store so it cannot resurface in semantic searches.
2. **The chat is broken back into turns.** Each user message marks the opening of a turn; the assistant replies that follow it, up to the next user message, are the body. A greeting-only chat (no user messages yet) is treated as a single turn.
3. **One extraction job is enqueued per turn.** The current pipeline, with whatever gates and importance signals are presently in force, runs against each turn and writes new entries.

Manual memories — the ones you typed in yourself, with **MANUAL** as their source — are scoped out of the operation entirely. So are project notes and any other memories that were never tied to a specific chat. They stay exactly as they were.

Memories whose chat has already been deleted (orphans) are also wiped, since nothing remains to regenerate them from. Their vector store entries go with them.

## What About Dangerous Chats?

If a chat has been classified as containing dangerous content and you have configured a **dangerous-compatible cheap LLM** in the Chat tab — either via the explicit *Uncensored Text Profile* setting or by marking a connection profile as both *Cheap* and *Dangerous-Compatible* — that profile will be used to extract memories from that chat. Other chats use your standard cheap LLM as usual. This routing happens automatically; you don't need to do anything special beyond having the dangerous profile configured.

## Memory Extraction Concurrency

By default, the background processor runs memory extraction one chat at a time. On a fresh instance with a handful of chats, this is plenty fast. On a long-lived instance with hundreds of chats, the wait can grow tedious — and many cloud providers will happily accept several requests in flight at once.

The **Memory extraction concurrency** setting at the top of this card lets you raise the parallelism, from 1 (sequential) up to 32 — matching the upper bound of the `memory-diff` CLI's `--concurrency` flag. Higher numbers finish a sweep faster but spawn more simultaneous LLM calls; if your provider rate-limits aggressively, or if you're routing through a small local model, keep the value low. A comfortable starting point for cloud providers (OpenAI, Anthropic, Z.AI) is 8–16; local Ollama generally prefers 2–4. The 32 ceiling is reserved for beefy remote APIs that can absorb the parallel load without throttling.

The setting takes effect immediately on save and persists across restarts. It also applies to the regular per-turn extraction that runs during ordinary chats, not just to regeneration sweeps.

## Watching the Sweep

While the regeneration is running, the *Mem* badge in the page header shows the queue depth, and the regenerate card itself displays a count of the wipe and extraction jobs still in flight. Both update on a five-second poll. When everything reaches zero, you're done.

## When to Use This

Reach for the lever when:

- The extraction pipeline has changed significantly (new gate, new prompt, new importance heuristic) and the old corpus no longer reflects what the current logic would have produced.
- A chat or two has accreted obvious junk you'd rather rebuild than prune by hand.
- You've just imported a large archive and want every chat-derived memory to pass through your current gate's filter rather than the historical one's.

It is **not** the right tool for routine maintenance — that's what *Memory Housekeeping* is for, on the next card up. Regeneration is intentional, somewhat expensive (it pays the LLM costs of every extraction pass over again), and final.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-regenerate")`

## Related Settings

- [Memory Housekeeping](memory-housekeeping.md) — Routine pruning of low-importance memories as characters approach their cap
- [Embedding Profiles](embedding-profiles.md) — Regeneration writes new embeddings too, using whichever profile is currently active
- [Chat Settings](chat-settings.md) — Where the dangerous-compatible profile and cheap-LLM routing are configured
