# Memory consent eval (opt-in)

Live-model check for manufactured consent in memory extraction — mechanism 6
of [prompt-trust-and-anti-committee.md](../../../docs/developer/features/prompt-trust-and-anti-committee.md)
(§10.3). The deterministic half lives in
`lib/memory/cheap-llm-tasks/__tests__/memory-consent-regression.test.ts`; the
shared fixtures are in `__tests__/unit/lib/fixtures/proposal-no-reply.ts`.

The suite is skipped unless `MEMORY_CONSENT_EVAL_MODEL` is set, so it never
runs in CI. It builds the real SELF and OTHER extraction prompts with the real
extractor and sends them to any OpenAI-compatible chat-completions endpoint.

| Variable | Meaning | Default |
|---|---|---|
| `MEMORY_CONSENT_EVAL_MODEL` | model name (required to run) | — |
| `MEMORY_CONSENT_EVAL_BASE_URL` | endpoint base, without `/chat/completions` | `https://api.openai.com/v1` |
| `MEMORY_CONSENT_EVAL_API_KEY` | bearer token, if the endpoint needs one | none |
| `MEMORY_CONSENT_EVAL_REPETITIONS` | runs per assertion | `5` |

Point it at the same model your cheap-LLM profile uses, e.g.:

```bash
MEMORY_CONSENT_EVAL_MODEL=gpt-4.1-mini MEMORY_CONSENT_EVAL_API_KEY=sk-… \
  npx jest __tests__/eval/memory-consent
# or a local Ollama model
MEMORY_CONSENT_EVAL_BASE_URL=http://localhost:11434/v1 MEMORY_CONSENT_EVAL_MODEL=qwen3:8b \
  npx jest __tests__/eval/memory-consent
```

## What it asserts

1. **No invented assent.** Over the proposal-no-reply fixture, no memory about
   Owen (his own SELF pass with the user-persona preamble, plus Friday's and
   Amy's OTHER passes) matches `/\b(agreed|accepted|consented|committed)\b/i`.
   Gated at N/N.
2. **The condition is attributed, and marked unanswered.** At least one OTHER
   memory names Amy with `proposed | asked | set a condition | …`, and every
   such memory contains `not yet responded`. Gated at N/N.
3. **The limit survives.** Over the custody fixture, a memory about the keys
   still contains `breakfast`. Reported, not gated.

The pass rates print to the console; record them in the spec's "As built"
section when you run it.
