# Recall Multiplier Retuning — Let Relevance Lead

**Status:** Proposed — spec only, no code yet
**Owner:** Charlie
**Drafted:** 2026-10-08
**Follows:** [memory-recall-and-housekeeping-fixes.md](./memory-recall-and-housekeeping-fixes.md)
("Not in scope: retuning `RECALL_MULTIPLIERS` — do it with the replay harness after F4–F7")
**Related:** [memory-consolidation-and-tiers.md](./memory-consolidation-and-tiers.md)

The per-turn recall ranking is a relevance blend multiplied by stacked targeting
boosts. On Friday the boosts now decide what gets whispered, and relevance
barely matters: memories with cosine 0.31–0.40 fill the dynamic head while the
memory that answers the turn sits below it. F7's larger head made this easy to
see, because it admits more of whatever the boosts favour.

This spec changes the shape of the boosts so they can **reorder relevant
memories but not promote irrelevant ones**, and extends the replay harness so the
constants can be tuned against real turns without a code change per attempt.

---

## 1. Evidence (recall-replay, Friday, 2026-10-08)

Both runs: `quilltap recall-replay <chatId> --memory-budget 8000` (head 15).

### Turn A — chat `6cc92fb7…`, turn 11/11

> *Query:* Charlie, Laura, and Friday are reviewing Ariadne's document about how
> Friday's memory reinforcement system works …

| Rank (new path) | cosine | × mult | fired | summary |
|---|---|---|---|---|
| 1 | 0.398 | 2.43 | narrow ctx present fresh24 | overruled engineers to ship wardrobe in 4.10 |
| 2 | 0.353 | 2.43 | narrow ctx present fresh24 | scoped outfit cascade into phase one |
| 3 | 0.343 | 2.43 | narrow ctx present fresh24 | committed to drafting wardrobe search spec |
| 4 | 0.337 | 2.43 | narrow ctx present fresh24 | agreed not to create history |
| 13 | 0.349 | 1.62 | present fresh48 | (an intimate, off-topic memory) |
| 17 | **0.644** | 1.52 | narrow ctx present | reveals LLM rewrite method for personality |
| 24 | **0.616** | 1.52 | narrow ctx present | committed to memory rebuild |
| — | **0.634** | 1.06 | narrow moment ctx present | enabled forgetting mechanism (not in top 25) |

At the pre-F7 head of 5, this turn would have whispered four wardrobe memories
and one more wardrobe memory.

### Turn B — chat `638325c6…`, turn 16/16

> *Query:* They are settling household logistics — the Tessarium lock
> replacement, the piano tuner's window, and who carries the egg crates …
> *Entities:* Amy, Marie, Prospero, Steinway, Tessarium

- The new path's whole head of 15 is cosine **0.31–0.44**, nearly all at ×2.43 or
  ×2.21, and mostly about Marie, amber tests and a covenant. None of it is about
  the lock, the tuner or the crates.
- **"set tuner-window condition, three to music room"** (cosine **0.511**, the
  best match on the turn's actual subject) is #4 on the old path and **absent
  from the new path's top 25**.
- A row at cosine **0.281** appears in the new path, below
  `DEFAULT_MIN_COSINE_NEURAL` (0.30).

### What the numbers say

- **Cosine spread vs. multiplier spread.** Candidates span roughly 0.30–0.65
  cosine. With `RANKING_RELEVANCE_WEIGHT` 0.75 that is a blend spread of about
  0.25. The multipliers then range from ~1.0 to 2.43 — a ×2.4 swing applied on
  top. A 0.35-cosine memory with every tag beats a 0.64-cosine memory with most
  of them.
- **The fresh-event boost is the tie-breaker that isn't.** ×1.6 (24 h) / ×1.35
  (48 h) is applied to anything recent, whatever it is about. On a chat where
  most of yesterday's memories are about one subject, that subject wins every
  turn. Its stated purpose — "what just happened holds ground against evergreen
  present-tagged memories" — is right for a turn that is *about* what just
  happened, and wrong for every other turn.
- **The tags stack freely.** narrow 1.15 × context 1.10 × present 1.20 ×
  fresh 1.60 = 2.43, under a `MULTIPLIER_CLAMP.max` of 4. No individual tag is
  large; the product is.
- **Entity anchoring picks the wrong entities.** `searchMemoriesSemantic` takes
  the first three of the distiller's entities (`entityAnchors.slice(0, 3)`) and
  pulls in every memory that contains one verbatim. On Turn B those were *Amy,
  Marie, Prospero* — household names that appear in hundreds of memories — while
  *Steinway* and *Tessarium*, the two names that identify this turn's subject,
  were cut. The literal hits then collect the same boosts as everything else.

## 2. Changes

### R1. Boosts need relevance first (the main change)

Penalties (multipliers < 1: `past↓`, `moment↓`, anti-repetition, cross-project
down-weight) apply as today. **Boosts (multipliers > 1) apply in proportion to how
relevant the candidate already is:**

```
gate      = max(BOOST_GATE_ABS, bestCosine − BOOST_GATE_MARGIN)
strength  = clamp((cosine − (gate − BOOST_GATE_RAMP)) / BOOST_GATE_RAMP, 0, 1)
boost'    = 1 + (boostProduct − 1) × strength
final     = blend × penaltyProduct × boost'
```

- `bestCosine` is the highest cosine in this search's candidate pool (after the
  floor), so the gate adapts to turns where nothing matches well.
- Starting values, neural embeddings: `BOOST_GATE_ABS` 0.45, `BOOST_GATE_MARGIN`
  0.15, `BOOST_GATE_RAMP` 0.10. TF-IDF (`BUILTIN`) needs its own scale, like
  `DEFAULT_MIN_COSINE_TFIDF`; derive it from the same replays on a TF-IDF
  instance, and until then leave the gate off for `BUILTIN`.
- Literal-phrase and entity hits are gated on their **raw** cosine, before
  `applyLiteralBoost`, so a verbatim name can still be found (it stays in the
  pool) but cannot ride the boosts past more relevant memories.
- Expansion neighbours (`related↗`) are gated the same way.

Illustration with these constants (R1 + R2) on Turn B: `bestCosine` 0.511 → gate
0.45, so boosts are at full strength from 0.45 and fade to nothing at 0.35. The
0.31–0.35 fresh rows lose their boost entirely and a 0.40 row keeps half;
"set tuner-window condition" keeps its full ×1.52 (blend 0.542 → 0.824) and moves
to the top, ahead of the best fresh row (0.443 cosine, capped and scaled to ×1.56,
→ 0.744). On Turn A, `bestCosine` 0.644 → gate 0.494; the wardrobe rows
(0.34–0.40) keep almost none of their boost and the memory-system rows (cosine
0.56–0.64) lead. "enabled forgetting mechanism" stays low because of its
`moment↓` penalty, which R1 leaves alone — whether that tag is right is a
separate question.

### R2. Cap the stacked boost

Split `MULTIPLIER_CLAMP` into a penalty floor (unchanged, 0) and a **boost cap of
1.6** on the product of boosts, applied before R1's scaling. No combination of
tags can then outweigh more than a moderate cosine gap. The value is a starting
point to tune in the harness.

### R3. Retune the fresh-event boost

With R1 in place the fresh boost only acts on relevant memories, which is its
intent. Lower it to **×1.3 (24 h) / ×1.15 (48 h)** so it breaks ties among
relevant memories rather than overriding the ranking. Keep it unconditional (not
gated on the retrospective flag) — R1 already supplies the condition that
matters.

### R4. Choose entity anchors by how specific they are

Replace `entityAnchors.slice(0, 3)` with a selection that prefers names that
narrow the search:

1. Drop entities that are participants present this turn — `present↑` already
   covers them, and they match a large share of the corpus.
2. Rank the rest by how few memories contain them (one `COUNT` per candidate
   entity via the existing content search, capped at the distiller's list),
   fewest first.
3. Take up to three.

On Turn B this picks *Tessarium* and *Steinway* (and *Prospero* if it is not
present), not *Amy* and *Marie*.

### R5. Check the floor on probe and anchor candidates

Turn B shows a 0.281 row past a 0.30 floor. Find which path admits it (extra
probes, entity hits or related-expansion, which deliberately skips `minScore`)
and make the intended exemption explicit: expansion may stay exempt by design,
but nothing else should be.

### R6. Tuning in the harness, not in code

Extend `POST /api/v1/chats/[id]?action=recall-replay` (and `quilltap
recall-replay`) with an optional `tuning` object — the R1 gate constants, the R2
cap, and any `RECALL_MULTIPLIERS` overrides — applied to the **new** path only.
The old path stays the reference. Print the active tuning in the CLI header.
This lets each constant be tried on the same turn in seconds; the chosen values
then go into code once.

## 3. Validation

1. Build a **probe set** of 8–12 Friday turns, each with the memories that should
   be in the head written down beforehand ("gold"). Include Turns A and B, at
   least two "what just happened" turns where the fresh memory **is** the right
   answer, one retrospective turn, and one multi-character turn.
2. For each candidate tuning, record per turn: gold memories in the head of 15,
   off-topic memories in the head, and the head's token spend.
3. Accept when gold recall improves on the set as a whole, the "what just
   happened" turns still surface their fresh memory, and no turn's head loses a
   gold memory it had before.
4. Keep the probe set and its results in the spec's implementation notes so later
   tuning starts from the same baseline.

## 4. Not in scope

- The blend weights (`RANKING_RELEVANCE_WEIGHT` / `RANKING_PRIORITY_WEIGHT`) —
  revisit only if R1–R3 leave relevant memories losing to weightier irrelevant
  ones.
- The Memory Gate thresholds (0.85 / 0.90). The F2 result shows restatements at
  about 0.65–0.73; gathering them is the consolidation spec's job.
- The frozen archive's selection — it does not use these multipliers.

## Chores

`docs/CHANGELOG.md` entry; update `help/memory-recall-relevance.md` ("What Else
Recall Quietly Does") where it describes the fresh and present boosts; extend the
`recall-tags` and `recall-replay` unit tests for R1–R6; regenerate nothing — no
schema change.
