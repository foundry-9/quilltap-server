# Bug 242 — A single-character turn finishes through the chain's intermediate path

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, by code reading while fixing bug 241 (reported by the fixing agent, confirmed against the source) |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — after an ordinary single-character reply the Salon skips its end-of-turn work: no transcript refetch, no queue notification, no "empty response" toast, live tool batches and the responder indicator not reset |
| **Who it bites** | every single-character chat (and a multi-character turn that produced no content and was not skipped) |
| **Provenance** | `5a99e4b8f` (2026-05-25, "align streaming bubble avatar with server's chosen responder") made `processMessage` emit a depth-0 `turnStart` for every first turn; the client treats any `turnStart` as entering a chain |
| **Defect site** | `lib/services/chat-message/orchestrator.service.ts:410` (`encodeTurnStartEvent` at `chainDepth: 0`, unconditionally); `lib/services/chat-message/turn-orchestrator.service.ts:317` (`executeTurnChain` returns for `!isMultiCharacter` without a `chainComplete`); `app/salon/[id]/hooks/useSSEStreaming.ts:738-743` (`done` with `inChain` routes to `onIntermediateDone`) and `:755-757` (`turnStart` sets `inChain = true`) |
| **Fix site** | `app/salon/[id]/hooks/useSSEStreaming.ts` (`readSSEStream`: only a `turnStart` with `chainDepth > 0` sets `inChain`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** The stream reader now enters a chain only on a `turnStart` whose
`chainDepth` is above 0. The depth-0 event the server sends before every first turn still drives
`onTurnStart` (the bubble's avatar and name), but no longer sets `inChain`, so a lone `done` reaches
`onDone` again — refetch, queue notification, the empty-response toast and the indicator resets.
In a multi-character chain the first turn's `done` also goes to `onDone`, as it did before
`5a99e4b8f`; the chained turns (depth ≥ 1) still take the intermediate path and the chain still
ends with `onChainComplete`. `triggerContinueMode` shares the same reader, so the continue path is
fixed with it. Test: `__tests__/unit/hooks/useSSEStreaming-single-turn-done.test.tsx` (fails
without the fix).

## Symptom

In a single-character chat the server's stream is `turnStart (depth 0) → … → done → EOF`. The
client's `readSSEStream` sets `inChain = true` on the `turnStart`, so the `done` goes to
`sendMessage`'s `onIntermediateDone` instead of `onDone`. That callback only appends the temporary
assistant message and stops streaming. Skipped entirely:

- `fetchChat()` — the persisted rows (the user message, the assistant row with its interspersed
  tool calls, attachments, whispers posted after the turn) are not read back by the send path;
- `notifyQueueChange()`;
- `setStreamingToolBatches([])`, `setRespondingParticipantId(null)`, `scrollOnStreamComplete()`,
  `clearPendingToolExecutionStatus()`;
- the `emptyResponse` branch — `onIntermediateDone` returns silently on `data.emptyResponse`, so an
  empty reply shows no "The AI returned an empty response" toast.

`sendMessage`'s `finally` still resets `sending` / `waitingForResponse` and calls
`clearProvisionalMessages()`, which retires optimistic bubbles when the last read succeeded — with
no read after the reply, the temporary user bubble can disappear until a realtime refetch brings
the persisted row back.

## Root cause

The first-turn `turnStart` was added so the streaming bubble shows the right responder, but the
client's stream reader already used `turnStart` to mean "a chained turn has begun". For a
multi-character chat the chain later ends with `chainComplete`, which runs `onChainComplete`
(refetch, queue notify, focus). A single-character turn never gets a `chainComplete`, so nothing
runs the end-of-turn work.

## Why it survived

Realtime topics usually refetch the transcript shortly after anyway, which hides the missing
`fetchChat`; the empty-response path is rare; and no test drives `sendMessage` with a depth-0
`turnStart` followed by `done`.

## Fix

Make "in a chain" mean what it says: set `inChain` only for `turnStart` events with
`chainDepth > 0` (the depth-0 event still drives `onTurnStart` for the avatar), or have the server
mark the first-turn event (`firstTurn: true`) and the reader ignore it for chain state. Either way a
lone `done` then reaches `onDone`. Check `triggerContinueMode`'s callbacks for the same
assumption.

## Verify

Test: feed `sendMessage` a stream of `turnStart{chainDepth:0}`, content, `done` — `onDone` runs
(`fetchChat` and `notifyQueueChange` called) and an `emptyResponse` done shows its toast. Live: send
in a single-character chat and confirm the log shows the post-turn transcript read.
