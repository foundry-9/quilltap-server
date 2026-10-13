---
url: /settings?tab=memory&section=memory-housekeeping
---

# Memory Housekeeping

> **[Open this page in Quilltap](/settings?tab=memory&section=memory-housekeeping)**

The Commonplace Book grows. Every conversation adds entries, reinforces old ones, and links related observations together. Left entirely to its own devices, a much-loved character's memory shelves can run to tens of thousands of items — a splendid predicament, but rather a heavy one for a local machine to lift at every turn. *Memory Housekeeping* is the invisible hand that sweeps and dusts the forgotten corners and carries what nobody has asked after lately down to the cellar, so the character's living memory stays sharp rather than sprawling.

Housekeeping is **off by default**, and even when it is on it does not destroy anything an extraction wrote. It *archives*.

## The Archive (Active and Archived Memories)

Every memory lives on one of two shelves:

- **Active** (internally, *hot*) memories are the ones a character can actually recall: the standing archive in every prompt, the handful of memories surfaced fresh each turn, what one character remembers of another, the recap at the start of a chat.
- **Archived** (internally, *cold*) memories are kept, but no longer whispered. They still stop the same fact from being written down twice, the character can still find them by searching their own memory (they come back marked *archived*), and you can still browse them in the Commonplace Book, where a filter separates the two shelves.

A memory goes to the archive in one of two ways: housekeeping moves it there under cap pressure, or [Memory Consolidation](memory-consolidation.md) folds it into a digest and files the original away behind it. If the world brings up an archived memory again — and it was archived by housekeeping, not replaced by a digest — it is promoted straight back to the active shelf. Re-observing something a digest has absorbed reinforces the digest instead.

A memory housekeeping archived is not forgotten in a drawer, either. The next consolidation run considers it alongside the active shelf, so what it said can be folded into a digest; once it has been, it sits behind that digest like any other replaced note, and the Consolidation card's cold-retention setting can eventually clear it away.

## What Housekeeping Does

When enabled, housekeeping runs in two ways:

- **Reactively**, whenever a character approaches 90% of their per-character cap after a new memory is written. The check is cheap; the sweep runs as a background job so it never blocks a chat turn.
- **On a schedule**, once a day, as a safety net for characters whose counts crept up while no one was chatting with them.

You can also run it on demand with the **Run housekeeping now** button — handy after importing a large archive or after flipping the feature on for the first time.

## What Housekeeping Protects

Housekeeping is conservative by design. A memory you typed yourself — one whose source is **MANUAL** — is never archived or deleted, no matter what, and neither is a digest written by [Memory Consolidation](memory-consolidation.md). Neither counts against the cap, either: the cap measures only the memories housekeeping is actually permitted to move, so a character rich in hand-written notes and digests is never declared "over the limit" on their account, and the housekeeper is never sent off on a sweep it could not possibly finish. Everything else is weighed by a **blended score** that combines four streams of evidence: the LLM's importance rating (content), the reinforcement count (how many times the memory has been re-observed), the graph degree (how many related memories link to it), and whether it has been accessed recently. A memory whose blended score sits above the protection threshold is spared by the slow retention sweep. When a character is over the cap, the cap-enforcement sweep archives just enough memories to come back inside it, starting from the lowest score — so the well-reinforced, well-connected, recently recalled memories are the last to go.

The scoring stream worth dwelling on is the content component. The LLM's importance rating is time-decayed with a **thirty-day half-life**, and — crucially — its contribution to the protection score is **capped** so that importance alone can never make a memory permanent. A fresh fact the LLM rated 0.9 contributes the same 0.40 to its protection score as a fresh fact the LLM rated 0.4; to cross the protection threshold, the memory must also earn some evidence of use. At least one reinforcement, one related-memory link, or one recent access, combined with the capped content contribution and the small default reinforcement bonus, is typically enough. Without those signals, the LLM's one-shot importance rating is simply insufficient evidence for permanent protection — which is the whole point of the blend. The reference clock is reset every time the memory is reinforced with new details, so a fact that remains relevant — revisited, reinforced, linked, accessed — stays protected, while one the chats have genuinely moved on from becomes eligible for the cap-enforcement sweep. This replaces the earlier rule in which any memory rated 0.7 or higher was immortal regardless of age or usage, which — in practice — turned the housekeeper into a doorman who waved almost everyone through.

A re-observation counts as reinforcement however faithfully it restates the original. A retelling close enough to be a near-copy writes no new memory and changes none of the existing one's words, but it still adds to that memory's reinforcement tally — so the facts a character is told most consistently are no longer, absurdly, the ones that look least established.

Reinforcement and graph degree both saturate logarithmically: the first few reinforcements matter more than the next ten, and the first few related-memory links matter more than the next handful. Recent access is a flat bonus awarded to memories read within the last 90 days — "read" meaning the memory actually reached a character (whispered into a turn, returned by a search the character ran), not merely that a search glanced at it on the way past, nor that you opened it to have a look in the Commonplace Book or through the API. All four signals combine into a single number used by the protection gate.

The conservative first-pass retention rule still applies: a memory is *also* only eligible for the slow sweep when it is old (more than 6 months), low-importance (below 0.3 after reinforcement), and either never accessed or inactive for 6+ months. The blended score changes what the cap-enforcement sweep can touch; it does not change the first pass.

Both sweeps *archive* rather than delete. Once the retention-policy sweep is complete, if the character still has more automatic memories on the active shelf than their cap, housekeeping archives the lowest-scoring of them until the count is back inside the cap — exactly as many as the excess, and not one more. The score is the same blended protection score described above, so the thing that decides whether a memory may go also decides which goes first.

## Settings

### Enable automatic housekeeping

Turns the feature on. Like every other Commonplace Book setting, it belongs to the whole instance rather than to any one user's chat settings, so whoever flips it flips it for the house. When off, no sweeps happen automatically — though the **Run housekeeping now** button still works. Turn it on only after you have reviewed the cap below. Turning it on does not immediately sweep; it schedules the first sweep for the next daily run or the next watermark trigger, whichever comes first.

### Per-character cap

The number of **automatic** memories a character may keep on the active shelf before housekeeping engages. Archived memories, memories you wrote by hand, and consolidation digests do not count against it. Default **2000**. Acceptable range 100 – 100,000 — the same bounds govern the overrides below and the **Run housekeeping now** dialog, so no corner of the house keeps a different ledger. The reactive trigger fires at 90% of this cap — so a 2000-memory cap engages the sweep at 1800.

If you want a different cap for a particular character, open **Per-character overrides** beneath the cap. Each character is listed with two figures: how many memories are *counted* against the cap, and how many are *protected* (hand-written and digests) and so exempt. The counted figure turns red when it is over that character's cap. An override takes precedence over the global cap; leave the box blank and the character uses the global one. The **Memory Cleanup** dialog on a character's own memory page opens on that character's cap — override and all — so a one-off cleanup measures against the same figure the automatic sweep would; type a different number only if you mean to.

### Merging similar memories (retired)

Earlier versions offered a tick-box to merge near-identical memories during the sweep. That job now belongs to [Memory Consolidation](memory-consolidation.md), which combines whole clusters of related memories into digests and keeps the originals in the archive. The old setting has been cleared out of saved configuration altogether, along with its threshold. **Memory Deduplication**, further down this tab, still merges pairs on demand.

### Deleting archived memories

Nothing is ever deleted by policy unless you ask for it. The Consolidation card's **cold retention** setting (blank by default, meaning *never*) lets the sweep delete archived memories that a digest has replaced and that have sat in the archive longer than the number of days you give. A memory housekeeping archived is not deleted this way until consolidation has folded it into a digest — at which point it has been replaced like any other. Anything you wrote by hand is never deleted this way.

## Running Housekeeping on Demand

The **Run housekeeping now** button enqueues one MEMORY_HOUSEKEEPING background job for each character owned by your user. Each uses whatever cap you have currently configured for that character. A character already being swept — by the daily round, by the reactive trigger, or by an earlier press of the button — is not swept twice at once; the job already under way covers it. The jobs run in the background; each successful sweep appears in the server log as `[Housekeeping] Job complete`.

## A Note on Trust

Housekeeping will never touch memories that are (a) manually created or (b) consolidation digests; the slow retention sweep also spares anything (c) important, (d) recent, or (e) stably reinforced and still useful, and the cap sweep takes those last of all — and what it does touch goes to the archive, not the bin. That said — before you turn it on for the first time on an instance with a long chat history, it is worth running **Memory Deduplication** first to collapse the worst near-duplicates (the old, lax gate let more of them through). That tool is in the same tab, right below this one.

If your instance was created before Quilltap 4.3, it is also worth running **Repair Missing Embeddings** first. Older gate fallbacks were known to write memories without embeddings when the embedding provider was briefly unavailable; those memories are invisible to the deduplication gate and to semantic search, and the deduplication tool can't see them either. The repair card is the second entry in this tab.

## A Related Knob: Extraction Rate Limits

There is a separate, complementary guard — the *per-hour extraction rate limit* — that applies pressure at the other end of the pipeline. Where housekeeping tidies the shelves after the fact, extraction limits slow down what enters them in the first place. When enabled, it counts how many new memories the house has actually written for a character in the trailing hour — and keeps counting as each new one is written, so a long stretch of conversation read in one sitting is held to the cap partway through rather than only at the start. Once that count approaches the cap, it quietly raises the bar on what the extraction LLM is allowed to commit to memory; once the cap is reached outright, that character simply forms no new memories from the exchange. The tally is kept in the server's head rather than its ledgers, so a restart begins the hour afresh. Rebuilding history — a regenerate, *Re-extract Memories*, or an imported chat — is not held to the limit at all and does not count towards it, so a long chat is rebuilt whole rather than trimmed to its first hour's worth. And when the stretch-at-a-time passes find everyone concerned already at the cap, they leave that stretch unread and return to it later, rather than passing over it for good.

The rate limiter is **off by default** and is not yet exposed in the UI — it sits under an API-only setting (`memoryExtractionLimits`) for users and plugins that want it. Default values once enabled: 20 memories per character per hour, with the graduated floor kicking in at 70% of that cap (14 memories) and only admitting candidates rated 0.7 importance or higher from then on.

The two features are complementary. Housekeeping is *retrospective*: it lets the Commonplace Book grow to a comfortable size and then keeps it pruned. Rate limits are *prospective*: they stop any one busy hour from producing an explosion of writes in the first place. If you find yourself running the *Run housekeeping now* button constantly, consider turning on extraction limits as well.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-housekeeping")`

## Related Settings

- [Memory Consolidation](memory-consolidation.md) — Combines clusters of memories into digests and archives the originals
- [Embedding Profiles](embedding-profiles.md) — The gate and consolidation both cluster on these embeddings
- [Chat Settings — The Staff Behind the Scenes](chat-settings-ai-services.md) — Memory cascade preferences for message deletion
