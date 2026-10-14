# Bug 141 — a provider that answers with headers and then goes silent wedges chat creation forever

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-14 |
| **Fixed** | 2026-09-14 |
| **Severity** | High (the New Chat dialog cannot be dismissed, so the wedge takes the window with it; nothing is lost, and the chat itself is already complete behind the dialog) |
| **Who it bites** | Anyone creating a chat when the opener's provider stalls. The same unbounded `for await` sits under every Salon turn, every tool loop and every autonomous-room turn — the Salon at least has a Stop button, and an autonomous room does not |
| **Provenance** | Reported from the Electron shell against the `Friday` instance, 2026-09-14: "stuck here when I tried to open a new chat", at *Setting the opening scene…* |
| **Fix site** | `lib/llm/stream-watchdog.ts` (new), applied in `lib/services/chat-message/streaming.service.ts` and `lib/chat/initial-greeting.ts`; the greeting ladder in `app/api/v1/chats/route.ts` ends on a stall; `classifyFallbackTrigger` reads one as `network` |
| **v5 status** | **Applies.** The port inherits the shape wherever it consumes a provider stream — a budget that stops at the response headers is not a budget on the body |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-14).** `withStallWatchdog` gives each `next()` on a
provider stream a deadline — generous for the first chunk (240 s: a long context
with extended thinking legitimately takes minutes to first token), tight between
chunks (120 s: a stream that has started is past the slow part, and a model still
thinking is emitting reasoning deltas, which count). Overdue, it raises
`LLMStreamStalledError`. The greeting takes tighter budgets still (90 s / 60 s):
it is a two-sentence opener with no history, and it runs behind a dialog nobody
can dismiss.

Three consequences follow from the error being *named* rather than merely
messaged. `classifyFallbackTrigger` reads it as `network`, so a Salon turn whose
provider goes quiet reaches the understudy instead of dying. The greeting ladder
ends on the first stall **on the participant's own profile** — attempts 1, 2 and
4 are that one profile three times over, so the budgets it would otherwise spend
are budgets of the same silence — and the scripted greeting takes over, which is
where an exhausted ladder ends up anyway. A stall at the Concierge's uncensored
desk deliberately does *not* end it: that is a different profile on a different
provider, and its going quiet says nothing about the character's own. And the two are distinguishable in the logs from a
provider that actually said no.

The stalled request is **not** cancelled: the plugin owns its SDK client and its
socket, and an async generator suspended at an `await` cannot be resumed from
outside. We stop *waiting*, which is the part that holds a chat open — the same
bargain `withTimeout` and `withDeadline` already strike. Covered by
`__tests__/unit/lib/llm/stream-watchdog.test.ts` and
`__tests__/unit/app/api/v1/chats/route.greeting-stall.test.ts`.

## Symptom

Open a new chat. The Green Room reaches *Setting the opening scene…* and stays
there. Not for a minute — indefinitely. The dialog is deliberately
non-dismissable while creation runs (no close button, no backdrop click, no
Escape — `ChatCreationProgressModal`), and it only offers a Close on the `error`
phase, which never arrives. Reloading the window is the only way out.

The chat is, at that point, entirely built. In the reported incident
(`70e48d6b-1e7b-438a-b757-57a63d4e6638`, "Chat with Riya and Anjali") all twelve
messages were on disk — system prompt, four Prospero whispers, four Host
announcements, three Aurora outfit whispers — and both avatars had been
generated. Only the opening line was missing, and with it the HTTP response.

## Root cause

`autoGenerateFirstMessage` → `generateGreetingMessage` →
`providerClient.streamMessage(...)`, consumed by a bare `for await`. When the
provider sends no chunk, that loop never advances and the `await` in
`createInitialMessagesScenarioAndStaff` never returns, so `POST /api/v1/chats`
never responds.

Nothing below it catches this. The SDK-backed providers do carry a timeout —
`plugin-utils`' `DEFAULT_REQUEST_TIMEOUT_MS` is 300 s and the client is built
with `maxRetries: 2` — but per the rule set out in *A stalled provider no longer
wedges a turn* (`docs/CHANGELOG_V4.md`), **an OpenAI/Anthropic SDK `timeout`
stops at the response headers.** That is exactly what makes it safe to apply on
a streaming path, and exactly what makes it useless once the headers have
landed. `LLMParams.requestTimeoutMs` says so in its own doc comment. A body that
never starts is outside every budget in the system.

The evidence was unambiguous on the running instance: one `ESTABLISHED` socket
to DeepSeek (`192.168.68.53:54055 → 3.173.21.63:443`) with empty send and
receive queues, held on the **same file descriptor** across eleven minutes —
well past the 300 s client timeout, so the SDK had not aborted and had not
retried. An idle event loop under `sample`. No `llm_logs` row, those being
written only when a call finishes. The last log line was the third Aurora
whisper; `[Chats v1] Chat created`, which follows the greeting, never appeared.

## Why it survived

Three things kept it off the list.

A stall is rare and looks like slowness. The Green Room narrates *Setting the
opening scene…* whether the model is thinking or dead, so for the first minute
the correct behaviour and the wedge are the same picture.

The neighbouring case was fixed, and read as having fixed this one. *A stalled
provider no longer wedges a turn* bounded the cheap-LLM path — the memory recap
that froze a turn at *Recalling <name>'s memories…* — at three levels, and
introduced `requestTimeoutMs` as "the hard per-request ceiling providers must
not retry past". Every one of those budgets is real. All three sit on the
*request*, and the write-up says so plainly in its own table of what each
transport measures. The gap they leave is precisely a stream that begins and
then stops. ([Bug 107](bug-107-cheap-llm-budget-wall.md) and
[bug 115](bug-115-interactive-distill-background-budget.md) later retuned those
ceilings, which is more traffic over the same ground with the same blind spot.)

And the greeting path is the one streaming consumer that does not go through
`lib/services/chat-message/streaming.service.ts` — it calls
`providerClient.streamMessage` directly. So the two call sites that needed the
guard were easy to see as one.

## The fix

Put the budget where the chunks are counted, since that is the only place that
can tell a silent stream from a slow one:

1. `lib/llm/stream-watchdog.ts` — `withStallWatchdog(source, options)` wraps a
   provider stream and races each `next()` against a deadline, first-chunk and
   between-chunks budgeted separately. `LLMStreamStalledError` carries the
   budget, the chunk count, the provider and the model.
2. Apply it at both `provider.streamMessage` call sites — the shared streaming
   service and the greeting.
3. `classifyFallbackTrigger`: `LLMStreamStalledError` → `network`, beside
   `CheapLLMTimeoutError`, which is there for the same reason.
4. The greeting ladder abandons its remaining rungs on a stall — but only on
   one from the participant's own profile, which is the profile those rungs
   would use. The uncensored desk is scoped out of the flag.

On the `finally`, the source is asked to unwind — awaited on an ordinary early
`break` (a Stop, a tool loop cutting the turn short), where that is what closes
the provider's stream; **not** awaited on a stall, where the generator is
suspended behind a promise that never settles and awaiting its `return()` would
reproduce the hang.

### Not done here

Actually killing the socket needs an `AbortSignal` on `LLMParams`, which is a
`@quilltap/plugin-types` contract change, a `plugin-utils` change, a republish
and a rebuild of all fifteen plugins. Worth doing; out of scope for the wedge.
Until then a stall leaks one socket and one suspended generator, which unwind on
their own if the provider ever speaks again.

The Green Room's own ceiling — offering a Close after long enough, rather than
only on the `error` phase — is also still open. With the watchdog in place the
dialog now resolves within 90 s of a stall, so it is defence in depth rather
than the fix.

## How to verify

Unit: `npx jest __tests__/unit/lib/llm/stream-watchdog.test.ts` covers a healthy
stream passing through, a first chunk that never arrives, a mid-stream silence
after partial chunks, a slow-but-progressing stream that must **not** be aborted
(six gaps each inside the idle budget, total well past it — the budget is
per-gap, not cumulative), early `break` closing the source, and a real provider
error arriving as itself.
`npx jest __tests__/unit/app/api/v1/chats/route.greeting-stall.test.ts` covers
the ladder: one attempt on a stall, two on an ordinary failure, a 201 and the
scripted opening line either way, and — the scoping rule — a silence at the
uncensored desk still followed by an attempt on the character's own profile.

Live: point a character at an endpoint that accepts a streaming request and
sends no body, and create a chat. The Green Room resolves inside ninety seconds,
the chat opens with its scripted greeting, and
`[LLMStream] Abandoned a stalled provider stream` names the provider, the budget
and the chunk count in the log.
