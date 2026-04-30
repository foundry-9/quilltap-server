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

Phase 1, 2, and 3 ship only this README and the scaffold directory. Phase 3
deliberately keeps identity-reinforcement structure unchanged (the
`Identity Reminder` block, persona content, and per-turn template bodies
are untouched); the structural changes are mechanical:

- Frozen memory archive sorted by `memory.id` instead of effective weight
  (deterministic ordering for cache stability — same memories, same
  surface-form summaries).
- Dynamic head capped at 200 tokens with `[m_xxxx]` rank tags (smaller
  surface in the tail, but per-memory body length unchanged).
- Whisper anchoring (no observable change to LLM context — only changes
  *which* whispers get swept on regen).

Cache-determinism is covered by `__tests__/unit/cache-determinism/`; unit
coverage of the new memory-injector format is in
`__tests__/unit/lib/chat/context/memory-injector.test.ts`.

The runnable voice-regression harness (real fixture capture vs. Sonnet
baseline) lands in Phase 4, where the structured-base-summary +
voice-rewrite redesign genuinely changes what the LLM is being told about
the past. That is the change with material voice-regression risk.

## What lands here in Phase 4

- `fixtures/<character-id>/turns.json` — recorded user/assistant turn pairs.
- `fixtures/<character-id>/baseline.json` — assistant outputs at known-good
  model + prompt structure.
- `similarity.ts` — computes lexical overlap between two completion strings.
- `voice-regression.test.ts` — for each character + turn, assert similarity
  against baseline ≥ threshold.
- Per-character summary leak test — assert no character's summary contains
  entities they couldn't have witnessed (the Phase 4 architectural promise).
