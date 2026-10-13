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

Housekeeping is one round of a single errand the house runs for each character in turn: the *memory maintenance* job. The errand always goes in the same order, and any step that is switched off is simply skipped:

1. **Fold near-duplicates.** Extracted memories that say the same thing about the same person on the same occasion — very nearly word for word, by the house's reckoning — are folded into the sturdiest of them, any stray detail kept as a footnote. No model is consulted; it is plain arithmetic. Hand-written memories, digests and archived memories are never folded.
2. **Consolidate** — [Memory Consolidation](memory-consolidation.md), when it is switched on.
3. **Archive the excess** — the cap, described below.
4. **Retire** archived memories a digest has long since replaced, when the Consolidation card's cold-retention setting asks for it.
5. **Refresh the vault copies** of any digests the round changed.

Because consolidation comes first, the cap only ever measures what is left after the clerk has combined what can be combined, and anything the cap sends to the archive is waiting for the clerk's next visit.

When enabled, the errand runs in two ways:

- **Reactively**, whenever a character reaches 90% of their per-character cap after a new memory is written. The check is cheap, and it is made in the server's own head, which also remembers when it last ran: it will not send the housekeeper round again for at least fifteen minutes, nor for an hour after a round that could barely make a dent. The work itself runs as a background job, so it never blocks a chat turn.
- **On a schedule**, once a day, as a safety net for characters whose counts crept up while no one was chatting with them.

Only one round is ever under way for a character at a time: a reactive round, the daily round and a button-press all queue behind the one already waiting, which simply takes on whatever extra steps the newcomer asked for.

You can also run it on demand with the **Run housekeeping now** button — handy after importing a large archive or after flipping the feature on for the first time.

## What Housekeeping Protects

Housekeeping is conservative by design. A memory you typed yourself — one whose source is **MANUAL** — is never archived or deleted, no matter what, and neither is a digest written by [Memory Consolidation](memory-consolidation.md). Neither counts against the cap, either: the cap measures only the memories housekeeping is actually permitted to move, so a character rich in hand-written notes and digests is never declared "over the limit" on their account, and the housekeeper is never sent off on a sweep it could not possibly finish. Everything else is weighed by a **blended score** that combines four streams of evidence: the LLM's importance rating (content), the reinforcement count (how many times the memory has been re-observed), the graph degree (how many related memories link to it), and whether it has been accessed recently. When a character is over the cap, the housekeeper archives just enough memories to come back inside it, starting from the lowest score — so the well-reinforced, well-connected, recently recalled memories are the last to go.

The scoring stream worth dwelling on is the content component. The LLM's importance rating is time-decayed with a **thirty-day half-life**, and — crucially — its contribution to the protection score is **capped** so that importance alone can never make a memory permanent. A fresh fact the LLM rated 0.9 contributes the same 0.40 to its protection score as a fresh fact the LLM rated 0.4; to cross the protection threshold, the memory must also earn some evidence of use. At least one reinforcement, one related-memory link, or one recent access, combined with the capped content contribution and the small default reinforcement bonus, is typically enough. Without those signals, the LLM's one-shot importance rating is simply insufficient evidence for permanent protection — which is the whole point of the blend. The reference clock is reset every time the memory is reinforced with new details, so a fact that remains relevant — revisited, reinforced, linked, accessed — stays protected, while one the chats have genuinely moved on from becomes eligible for the cap-enforcement sweep. This replaces the earlier rule in which any memory rated 0.7 or higher was immortal regardless of age or usage, which — in practice — turned the housekeeper into a doorman who waved almost everyone through.

A re-observation counts as reinforcement however faithfully it restates the original. A retelling close enough to be a near-copy writes no new memory and changes none of the existing one's words, but it still adds to that memory's reinforcement tally — so the facts a character is told most consistently are no longer, absurdly, the ones that look least established.

Reinforcement and graph degree both saturate logarithmically: the first few reinforcements matter more than the next ten, and the first few related-memory links matter more than the next handful. Recent access is a flat bonus awarded to memories read within the last 90 days — "read" meaning the memory actually reached a character (whispered into a turn, returned by a search the character ran), not merely that a search glanced at it on the way past, nor that you opened it to have a look in the Commonplace Book or through the API. All four signals combine into a single number used by the protection gate.

Age and neglect are already in that score — the content component fades with time, and an unread memory earns no access bonus — so there is no separate "old and unimportant" rule any longer, and the age, inactivity and importance knobs the cleanup dialog once offered have been retired with it.

The cap *archives* rather than deletes. If the character has more automatic memories on the active shelf than their cap, housekeeping archives the lowest-scoring of them until the count is back inside the cap — exactly as many as the excess, and not one more. The score is the blended protection score described above, so the thing that decides whether a memory may go also decides which goes first.

## Settings

### Enable automatic housekeeping

Turns the feature on. Like every other Commonplace Book setting, it belongs to the whole instance rather than to any one user's chat settings, so whoever flips it flips it for the house. When off, no sweeps happen automatically — though the **Run housekeeping now** button still works. Turn it on only after you have reviewed the cap below. Turning it on does not immediately sweep; it schedules the first sweep for the next daily run or the next watermark trigger, whichever comes first.

### Per-character cap

The number of **automatic** memories a character may keep on the active shelf before housekeeping engages. Archived memories, memories you wrote by hand, and consolidation digests do not count against it. Default **2000**. Acceptable range 100 – 100,000 — the same bounds govern the overrides below and the **Run housekeeping now** dialog, so no corner of the house keeps a different ledger. The reactive trigger fires at 90% of this cap — so a 2000-memory cap engages the sweep at 1800.

If you want a different cap for a particular character, open **Per-character overrides** beneath the cap. Each character is listed with two figures: how many memories are *counted* against the cap, and how many are *protected* (hand-written and digests) and so exempt. The counted figure turns red when it is over that character's cap. An override takes precedence over the global cap; leave the box blank and the character uses the global one. The **Memory Cleanup** dialog on a character's own memory page opens on that character's cap — override and all — so a one-off cleanup measures against the same figure the automatic sweep would; type a different number only if you mean to.

### Merging similar memories

Earlier versions offered a tick-box to merge near-identical memories during the sweep. Its work is now done two ways: the round's first step folds true near-duplicates on its own, and [Memory Consolidation](memory-consolidation.md) combines whole clusters of related memories into digests. The old setting has been cleared out of saved configuration altogether, along with its threshold. **Near-Duplicate Folding**, further down this tab, runs the first step by itself, with a preview, for every character at once.

Each of the round's own steps — folding, archiving the excess, retiring — can be switched off on its own through the maintenance settings (`phases` on `?action=maintenance-config`); a round you start by naming its steps runs them regardless.

### Deleting archived memories

Nothing is ever deleted by policy unless you ask for it. The Consolidation card's **cold retention** setting (blank by default, meaning *never*) lets the sweep delete archived memories that a digest has replaced and that have sat in the archive longer than the number of days you give. A memory housekeeping archived is not deleted this way until consolidation has folded it into a digest — at which point it has been replaced like any other. Anything you wrote by hand is never deleted this way.

## Running Housekeeping on Demand

The **Run housekeeping now** button enqueues one MEMORY_MAINTENANCE background job for each character owned by your user, asking for the archive and retire steps. Each uses whatever cap you have currently configured for that character. A character already being seen to — by the daily round, by the reactive trigger, or by an earlier press of the button — is not visited twice at once; the job already waiting takes on the request. The jobs run in the background; each finished round appears in the server log as `Maintenance job complete`, and `quilltap memories status` shows when each step last ran for every character.

## A Note on Trust

Housekeeping will never touch memories that are (a) manually created or (b) consolidation digests; the cap takes (c) important, (d) recent, and (e) stably reinforced and still useful memories last of all — and what it does touch goes to the archive, not the bin. That said — before you turn it on for the first time on an instance with a long chat history, it is worth previewing **Near-Duplicate Folding** first, to see how many of the worst repetitions (the old, lax gate let more of them through) the first step would fold. That card is in the same tab, right below this one.

If your instance was created before Quilltap 4.3, it is also worth running **Repair Missing Embeddings** first. Older gate fallbacks were known to write memories without embeddings when the embedding provider was briefly unavailable; those memories are invisible to the gate and to semantic search, and near-duplicate folding cannot see them either. The repair card is the second entry in this tab.

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
