# Cache stability eval harness

Asserts that the cacheable prefix of an LLM request stays byte-stable across
turns. Drift in any tier (system block 1 / system block 2 / tools / frozen
history) means provider caches will miss; the report at
`docs/developer/features/llm_api_costs_breakdown.md` documents why this matters.

## What we measure

For each fixture chat (a sequence of synthesized turns):

- **systemBlock1Hash** — must be identical across all turns once the chat is
  seeded. Drift here means something dynamic leaked into the long stable
  prefix (timestamp, request id, randomized macro, plugin Map iteration).
- **systemBlock2Hash** — must be identical across all turns. The static
  identity reminder should never reference the participant list or anything
  variable.
- **toolsArrayHash** — must be identical across all turns within the same
  `projectVersion`.
- **historyAppendOnlyRatio** — fraction of `historyTailHash` transitions
  where the new frozen history strictly extends the prior one. Should be
  close to 1.0; values < 0.95 indicate mid-history reshuffling.

## Layout

- `fixtures/` — recorded turn streams (eventually). Today: programmatic
  synthesis from a fixture builder.
- `*.test.ts` — assertions over fixture streams.

## Adding a new fixture

The harness will take recorded `BuiltContext` snapshots from a real Salon
chat eventually. For Phase 1, a programmatic fixture suffices: build a
sequence of `LLMMessage[]` arrays representing turns 1..N and pipe them
through `computeRequestPrefixHashes`.
