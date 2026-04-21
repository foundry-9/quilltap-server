---
url: /settings?tab=memory&section=memory-housekeeping
---

# Memory Housekeeping

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-housekeeping)**

The Commonplace Book grows. Every conversation adds entries, reinforces old ones, and links related observations together. Left entirely to its own devices, a much-loved character's memory shelves can run to tens of thousands of items — a splendid predicament, but rather a heavy one for a local machine to lift at every turn. *Memory Housekeeping* is the invisible hand that sweeps, dusts, and composts the forgotten corners, so the character's living memory stays sharp rather than sprawling.

Housekeeping is **off by default**. Quilltap will not delete your memories unless you explicitly turn it on.

## What Housekeeping Does

When enabled, housekeeping runs in two ways:

- **Reactively**, whenever a character approaches 90% of their per-character cap after a new memory is written. The check is cheap; the sweep runs as a background job so it never blocks a chat turn.
- **On a schedule**, once a day, as a safety net for characters whose counts crept up while no one was chatting with them.

You can also run it on demand with the **Run housekeeping now** button — handy after importing a large archive or after flipping the feature on for the first time.

## What Housekeeping Protects

Housekeeping is conservative by design. A memory you typed yourself — one whose source is **MANUAL** — is never deleted, no matter what. Everything else is protected by a **blended score** that combines four streams of evidence: the LLM's importance rating (content), the reinforcement count (how many times the memory has been re-observed), the graph degree (how many related memories link to it), and whether it has been accessed recently. A memory whose blended score sits above the protection threshold stays. A memory whose score falls below the threshold becomes eligible for deletion — but only the cap-enforcement sweep actually removes those, and only when the character is over the configured cap.

The scoring stream worth dwelling on is the content component. The LLM's importance rating is time-decayed with a **thirty-day half-life**, so a fact the LLM once rated 0.9 but which no chat has revisited in a month already loses half its standing; a fact that keeps getting reinforced or accessed keeps it. The reference clock is reset every time the memory is reinforced with new details, so a fact that remains relevant — revisited, reinforced, linked, accessed — stays protected, while one the chats have genuinely moved on from becomes eligible for the cap-enforcement sweep. This replaces the earlier rule in which any memory rated 0.7 or higher was immortal regardless of age or usage, which — in practice — turned the housekeeper into a doorman who waved almost everyone through. The blended score treats the LLM's one-shot rating as one opinion among several rather than a final verdict.

Reinforcement and graph degree both saturate logarithmically: the first few reinforcements matter more than the next ten, and the first few related-memory links matter more than the next handful. Recent access is a flat bonus awarded to memories read within the last 90 days. All four signals combine into a single number used by the protection gate.

The conservative first-pass retention rule still applies: a memory is *also* only eligible for the slow sweep when it is old (more than 6 months), low-importance (below 0.3 after reinforcement), and either never accessed or inactive for 6+ months. The blended score changes what the cap-enforcement sweep can touch; it does not change the first pass.

Once the retention-policy sweep is complete, if the character is still over their cap, housekeeping prunes the lowest-weighted remaining memories until the count is back inside the cap. Weighting uses the same formula the chat prompt uses for retrieval, so the memories that survive are the ones your characters would have reached for anyway.

## Settings

### Enable automatic housekeeping

Turns the feature on. When off, no sweeps happen automatically — though the **Run housekeeping now** button still works. Turn it on only after you have reviewed the cap below. Turning it on does not immediately sweep; it schedules the first sweep for the next daily run or the next watermark trigger, whichever comes first.

### Per-character cap

The number of memories a character is allowed to carry before housekeeping engages. Default **2000**. Acceptable range 100 – 100,000. The reactive trigger fires at 90% of this cap — so a 2000-memory cap engages the sweep at 1800.

If you want a different cap for a particular character, that's what the per-character override is for (set programmatically through the API today; a UI for it is on the roadmap). The override takes precedence over the global cap, and any character without an override uses the global one.

### Also merge semantically similar memories during the sweep

When ticked, the sweep performs an extra pass that looks for pairs of memories whose cosine similarity to each other is at least **0.90** (configurable through the API) and collapses the lower-weighted member into the higher-weighted one. Off by default — the pre-write gate already catches most near-duplicates, and this pass is slower. Turning it on is useful after importing legacy memories that predate the stricter gate.

## Running Housekeeping on Demand

The **Run housekeeping now** button enqueues a MEMORY_HOUSEKEEPING background job that sweeps every character owned by your user. It will use whatever cap and merge settings you have currently configured. The job runs in the background; successful completion appears in the server log as `[Housekeeping] Job complete`.

## A Note on Trust

Housekeeping will never touch memories that are (a) manually created, (b) important, (c) recent, or (d) stably reinforced and still useful. That said — before you turn it on for the first time on an instance with a long chat history, it is worth running **Memory Deduplication** first to collapse the worst near-duplicates (the old, lax gate let more of them through). That tool is in the same tab, right below this one.

If your instance was created before Quilltap 4.3, it is also worth running **Repair Missing Embeddings** first. Older gate fallbacks were known to write memories without embeddings when the embedding provider was briefly unavailable; those memories are invisible to the deduplication gate and to semantic search, and the deduplication tool can't see them either. The repair card is the second entry in this tab.

## A Related Knob: Extraction Rate Limits

There is a separate, complementary guard — the *per-hour extraction rate limit* — that applies pressure at the other end of the pipeline. Where housekeeping tidies the shelves after the fact, extraction limits slow down what enters them in the first place. When enabled, it counts how many memories a character has accrued in the trailing hour; once that count approaches the cap, it quietly raises the bar on what the extraction LLM is allowed to commit to memory. Once the cap is reached outright, it simply skips extraction for that exchange altogether.

The rate limiter is **off by default** and is not yet exposed in the UI — it sits under an API-only setting (`memoryExtractionLimits`) for users and plugins that want it. Default values once enabled: 20 memories per character per hour, with the graduated floor kicking in at 70% of that cap (14 memories) and only admitting candidates rated 0.7 importance or higher from then on.

The two features are complementary. Housekeeping is *retrospective*: it lets the Commonplace Book grow to a comfortable size and then keeps it pruned. Rate limits are *prospective*: they stop any one busy hour from producing an explosion of writes in the first place. If you find yourself running the *Run housekeeping now* button constantly, consider turning on extraction limits as well.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-housekeeping")`

## Related Settings

- [Embedding Profiles](embedding-profiles.md) — Housekeeping's merge pass uses the same embeddings the gate uses
- [Chat Settings](chat-settings.md) — Memory cascade preferences for message deletion
