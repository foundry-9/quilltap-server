# Character-voice eval harness (scaffold)

Phase 3 / Phase 4 of the LLM cost-reduction plan moves identity reinforcement,
memory injection, and (eventually) summary generation around. These changes
have a real chance of regressing in-character voice — especially Phase 3's
move of memory rank instructions out of the system block and into the tail.

This harness is the gate for those phases:

- A fixture set of representative characters + 50-turn conversations.
- Baseline outputs captured pre-change with a known-good model (Sonnet 4.6).
- Subsequent runs assert output similarity against the baseline within
  tolerance (lexical-overlap or BLEU-style metric — sufficient for catching
  regressions, not for grading quality).

## Status

Phase 1 ships only this README and the scaffold directory. The fixture
captures and similarity assertions land in Phase 3 alongside the structural
prompt changes. We don't gate Phase 1 / Phase 2 on this harness because they
don't move identity reinforcement or persona content.

## What lands here in Phase 3

- `fixtures/<character-id>/turns.json` — recorded user/assistant turn pairs.
- `fixtures/<character-id>/baseline.json` — assistant outputs at known-good
  model + prompt structure.
- `similarity.ts` — computes lexical overlap between two completion strings.
- `voice-regression.test.ts` — for each character + turn, assert similarity
  against baseline ≥ threshold.
