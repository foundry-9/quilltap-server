# Bug 246 — Consolidation's fixed 4,000-token budget starves a reasoning model, and the cluster is skipped

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-10-13, V4test dogfood of the memory refactor (a real consolidation run on Lorian) |
| **Fixed** | — |
| **Severity** | Low–Medium — a cluster whose model spends its whole budget reasoning returns no answer; consolidation logs a parse failure and skips it, so the cluster waits for a later round and the call is paid for nothing. Nothing is written wrongly. It bites every round on a reasoning model whose thinking runs long |
| **Who it bites** | instances whose consolidation (or cheap-LLM) profile is a reasoning model — on V4test, DeepSeek `deepseek-v4-flash` |
| **Provenance** | Original to v4, from the consolidation feature (`d58548051`, 2026-10-08). Extraction moved to the connection profile's budget (`resolveMaxTokens`) in Phase D; consolidation kept its constant |
| **Defect site** | `lib/memory/cheap-llm-tasks/consolidation-tasks.ts:41` — `const CONSOLIDATION_MAX_TOKENS = 4000`, passed to `executeCheapLLMTask` regardless of the profile |
| **Fix site** | — |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

V4test, 2026-10-13 23:18–23:19 UTC, `quilltap memories maintain --character Lorian --phases
consolidate`: two clusters selected, one digest written, the other skipped with

```
Consolidation answer failed validation; cluster skipped — reason: unparseable JSON: Unexpected end of JSON input
```

The LLM log for that call (`11fc3e65`, `deepseek-v4-flash`) shows `maxTokens: 4000`,
`completionTokens: 4000`, and an **empty** response body: the model spent every output token
reasoning and never wrote the answer.

## Root cause

Consolidation caps each cluster's answer at a fixed 4,000 tokens, sized for the *answer* ("a
30-member cluster fits comfortably"). A reasoning model counts its thinking against the same
ceiling, so on a long think nothing is left for the JSON. Extraction on the same model takes the
profile's output budget through `resolveMaxTokens` (8,000 on V4test) and does not hit this. The empty
content then reaches the parser rather than the cheap-LLM layer's empty-answer handling, so it
reads as a malformed answer instead of an exhausted budget.

## Why it survived

The consolidation tests mock the model's answer; Friday's backfill ran on NanoGPT's
`deepseek-v4.1-flash`, which answered within the budget.

## Fix (proposed, not built)

Take the budget from the consolidation profile the way extraction does (`resolveMaxTokens`), with
4,000 as a floor rather than the ceiling. Treat an empty answer that used the whole budget as a
budget failure in the log, so it is not mistaken for a model that cannot write JSON.

## How to verify

On V4test with DeepSeek as the cheap profile, lower the consolidation maturity window and TF-IDF
cluster threshold so Lorian has clusters (0 days and 0.15 reproduced it), run consolidation for
real a few times, and confirm no cluster is skipped as unparseable with `completionTokens` equal to
the cap. Restore the settings afterwards.
