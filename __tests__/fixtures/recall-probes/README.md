# Recall probe fixture

`probe-set.json` is a synthetic stand-in for the Friday probe set
([recall-probe-set-runbook.md](../../../docs/developer/features/complete/recall-probe-set-runbook.md)):
nine turns named after its slots (A, B, C, F1, F2, M, O2, O3, O4), one
character's corpus of 158 memories with 64-dimension vectors whose cosines to
each turn's query are set by construction, and an embedding table for every
query and retrospective probe.

Each turn's `expected` rows were captured on 2026-10-13 from the pre-Phase-E
`searchMemoriesSemantic` under the shipped `cap14` tuning, before any recall code
moved. The corpus exercises every ranking path the probe set does: the R1 gate
and R2 cap, R4 entity anchors, retrospective probes, the time window (soft, and
hard on O3), related expansion, the anti-repetition ring, cross-project scope
under both policies, the fresh-event boost, cold rows and the text fallback (O4's
query embeds at a different length).

`__tests__/unit/lib/memory/recall/probe-fixture.test.ts` runs the Phase E stages
over it and asserts every row — id, order, cosine, salience, multiplier labels
and blended score — and the gold-at-head total. A tuning change is a separate
commit with a new fixture and Charlie's sign-off (spec §5.1).

It does not replace the real probe set: the `cap14` scores on Friday's corpus are
still checked with `quilltap recall-replay` against that instance.
