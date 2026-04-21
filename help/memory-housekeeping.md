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

Housekeeping is conservative by design. A memory is **never** deleted if any of the following hold:

- Its effective importance (reinforced importance, or raw importance if never reinforced) is at least **0.7**.
- Its source is **MANUAL** — you typed it yourself.
- It was last accessed by retrieval within the last **3 months**.
- It has been reinforced **5 or more times** *and* either its effective importance is at least 0.5 *or* it was accessed within the last 90 days. (Without that second condition, noisy phrase-variant duplicates could become immortal just because they got re-extracted many times.)

Everything else is eligible for pruning, but only when it is *also* old (more than 6 months) *and* low-importance (below 0.3) *and* has either never been accessed or has been inactive for more than 6 months. In practice, housekeeping targets the long tail: observations from chats you haven't visited in half a year, scored low at extraction, never retrieved. It leaves the shelves in the middle alone.

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

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=memory-housekeeping")`

## Related Settings

- [Embedding Profiles](embedding-profiles.md) — Housekeeping's merge pass uses the same embeddings the gate uses
- [Chat Settings](chat-settings.md) — Memory cascade preferences for message deletion
