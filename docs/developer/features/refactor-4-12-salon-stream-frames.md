# Refactor 4.12 — Salon stream frames as a tagged union

**Status:** Phases 1 and 2 implemented (2026-11-03); Phase 3 (follow-ups) not started. Decisions taken: `posted` is one kind; validation is off in production. See §10 for where the build departs from the design. Originally proposed 2026-11-02. Part of the [4.12 refactor set](refactor-4-12.md). No schema, API path or help change; the wire format of one SSE stream changes shape, and client and server ship together.

## 1. The problem

A Salon turn streams to the browser as Server-Sent Events whose payload is one untagged object with about fifty optional fields. `interface SSEEvent` (`app/salon/[id]/hooks/useSSEStreaming.ts:60-188`) is the whole protocol: `content?`, `done?`, `error?`, `turnStart?`, `handAsked?`, `carinaAnswer?`, `storytellerBid?`, `confirmationResult?`, … The server has no corresponding type. Each of nineteen `encodeXxxEvent` functions in `lib/services/chat-message/streaming.service.ts` (plus one in `regenerate-swipe-stream.ts:52` and two inline in `tool-execution.service.ts:95,173`) spells its own `JSON.stringify({ flag: true, ...data })`, and the client works out what a frame *is* by testing which flags are present, in a hand-ordered chain (`useSSEStreaming.ts:735-945`).

What that costs showed up in this cycle:

- **The raised-hand chip** (9eab8d2d) had to move its two `if` tests to the top of the chain because "the Storyteller concurrent branch … used to swallow `handAnswered` for concurrent turns": a frame carrying both `concurrent: true` and `handAnswered: true` was claimed by whichever test ran first. The fix is a comment explaining the order (`:737-740`). Nothing stops the next frame kind from needing the same care.
- **The raise-hand POST reply** could overwrite a `handAsked` frame that had already arrived, because two unrelated code paths write the same client state and nothing types which one is authoritative.
- **Concurrent Storyteller turns** are tagged by decoding every outgoing byte chunk back to text, regex-matching `data:` lines, `JSON.parse`-ing, merging `{ participantId, concurrent: true }` and re-encoding (`lib/storyteller/sse-tag.ts:15-28`). That is a frame transform written as a byte transform because there is no frame type to transform.
- **Three client consumers parse the same frames three ways.** `useSSEStreaming` has the full chain; `useRegeneration.ts:163-178` re-tests `status` / `content` / `reasoning` / `error` / `done`; `WhisperDialog.tsx` has its own subset. A new field on `done` (this cycle added `yielded`, `routeTrail` earlier) has to be threaded by hand into whichever consumer happens to need it.
- **`done` means five things.** A normal finish, a skipped turn (`skipped`), a hard stop (`stopped`), an empty response (`emptyResponse` + reason) and a yield (`yielded`) are all `{ done: true }` with different side flags; every consumer re-derives the case (`:1221, :1285, :1483, :1510, :1612`).

The hook is 1,831 lines. Not all of that is the protocol, but the protocol is why the hook cannot be split: every piece of it closes over the same `data` bag.

## 2. Goal

One module, `lib/chat/stream-frames.ts`, that is the single source of truth for what a Salon stream frame is: a Zod discriminated union on `kind`, an `encodeFrame` the server calls, a `parseFrame` the client calls, and nothing else that spells `data: ${JSON.stringify(…)}` on the Salon turn path. Client dispatch becomes an exhaustive `switch (frame.kind)`, so adding a frame kind is a compile error until every consumer handles or explicitly ignores it, and no ordering of tests decides what a frame means.

## 3. Non-goals

- **Changing what the client does with any frame.** This is a protocol-shape change; behaviour is pinned by the existing hook tests plus the golden-stream test in §6.
- **Touching other SSE routes.** The character-creation, scenario-builder, help-chat, Brahma console, AI import and `operation-progress-sse` streams have their own small protocols and consumers. They are out of scope; §8 notes they could adopt the module later.
- **Replacing SSE with WebSockets or TanStack.** The streaming transport stays as it is (CLAUDE.md: migrate the reads *around* streaming, never the stream itself).
- **Splitting `useSSEStreaming` into several hooks.** That becomes possible after this change and is a separate decision.

## 4. Known state (verified 2026-11-02)

- **Emitters.** `streaming.service.ts` exports 19 encoders (`encodeDoneEvent:823`, `encodeTurnDoneEvent:832`, `encodeErrorEvent:868`, `encodeStatusEvent:889`, `encodePendingExternalTurnEvent:928`, `encodeTurnStartEvent:938`, `encodeTurnCompleteEvent:948`, `encodeChainCompleteEvent:958`, `encodeStorytellerRoundEvent:988`, `encodeStorytellerBidEvent:995`, `encodeRoundOpenEvent:1007`, `encodeHandAskedEvent:1016`, `encodeHandAnsweredEvent:1028`, `encodeCarinaAnswerEvent:1048`, `encodeHostAnnouncementEvent:1065`, `encodePascalResultEvent:1085`, `encodeConfirmationResultEvent:1099`, plus the content / reasoning / fileProcessing encoders at `:686-703`). They are called from fourteen service files (`courier-transport`, `danger-orchestrator`, `message-finalizer`, `native-tool-loop`, `pre-compute`, `primary-stream`, `provider-failover`, `recovery`, `regenerate-swipe-stream`, `text-tool-loop`, `tool-execution`, `turn-stream`, `streaming`, `index`). `regenerate-swipe-stream.ts:52` and `tool-execution.service.ts:95,173` build frames inline.
- **Tagging.** `lib/storyteller/sse-tag.ts` `tagSseChunk` / `taggingController` re-encode byte chunks to add `participantId` and `concurrent: true`.
- **Consumers.** `parseSSEData` (`useSSEStreaming.ts:273`) is `JSON.parse` with a cast. The dispatch chain is `:735-945` (hand, storyteller board, concurrent branch, status, content, error, tools, confirmation, done, pendingExternalTurn, turnStart, turnComplete, chainComplete). `useRegeneration.ts:160-180` and `components/chat/WhisperDialog.tsx` read the same bag for their narrower streams. `app/salon/[id]/hooks/index.ts` re-exports.
- **Tests.** `__tests__/unit/app/salon/hooks/` has hook tests driving `handleSSEEvent` with hand-written bags; `yield-signal.test.ts` and `turn-outcome.test.ts` cover the server side of the hand events; `sse-tag` has its own test.
- **`SSEEvent` is not exported**, so nothing outside the hook can name the type; the server encoders take ad-hoc parameter objects.

## 5. Design

### 5.1 The module

`lib/chat/stream-frames.ts` (client-safe: Zod and types only, no `@/lib` server imports).

```ts
export const StreamFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('content'), text: z.string() }),
  z.object({ kind: z.literal('reasoning'), text: z.string() }),          // cumulative, display only
  z.object({ kind: z.literal('status'), status: ResponseStatusSchema }),
  z.object({ kind: z.literal('fileProcessing'), info: … }),
  z.object({ kind: z.literal('toolsDetected'), names: …, arguments: … }),
  z.object({ kind: z.literal('toolResult'), index?, name, success, result?, error? }),
  z.object({ kind: z.literal('turnStart'), participantId, characterName, chainDepth, isSilentMessage? }),
  z.object({ kind: z.literal('done'), outcome: DoneOutcomeSchema, messageId?, reasoningContent?, reasoningSegments?, provider?, modelName?, routeTrail?, attachmentResults? }),
  z.object({ kind: z.literal('turnComplete'), participantId, nextSpeakerId }),
  z.object({ kind: z.literal('chainComplete'), reason, paused?, heldUserTurn? }),
  z.object({ kind: z.literal('error'), message, details?, userMessagePersisted?, pendingToolResultsPersisted? }),
  z.object({ kind: z.literal('pendingExternalTurn'), messageId, participantId, characterName }),
  z.object({ kind: z.literal('posted'), what: z.enum(['carinaAnswer','hostAnnouncement','pascalResult']), message: MessageSchema }),
  z.object({ kind: z.literal('storytellerRound'), round }),
  z.object({ kind: z.literal('storytellerBid'), roundId, bid }),
  z.object({ kind: z.literal('roundOpen'), roundId }),
  z.object({ kind: z.literal('handAsked'), participantId, characterName }),
  z.object({ kind: z.literal('handAnswered'), participantId, characterName, yielded }),
  z.object({ kind: z.literal('confirmationResult'), messageId, confirmed, revised, notes, content? }),
  z.object({ kind: z.literal('swipeDone'), message }),                  // regenerate-swipe-stream
]).and(z.object({ seat: SeatTagSchema.optional() }))                     // { participantId, concurrent: true }
```

Two deliberate consolidations:

- **`done.outcome`** is one enum, `'finished' | 'skipped' | 'stopped' | 'empty' | 'yielded'`, with `emptyResponseReason` / `skippedParticipantId` as fields of the matching variant. Five boolean side flags become one value the consumers switch on.
- **`posted`** replaces the three "here is a full message the server already saved" frames (`carinaAnswer`, `hostAnnouncement`, `pascalResult`), which the client already handles identically (`:801`: `data.carinaAnswer || data.hostAnnouncement || data.pascalResult`). `what` is kept for logging and the one place that differs (the Carina card).

`encodeFrame(encoder, frame)` is the only producer of `data: …\n\n` bytes on this path; it validates with the schema in development and test (`safeParse` + `logger.error`), and skips validation in production. `parseFrame(raw): StreamFrame | null` is the client's only parser: `safeParse`, and an unknown `kind` is logged once and ignored rather than crashing a stream mid-turn.

`tagFrame(frame, participantId)` returns `{ ...frame, seat: { participantId, concurrent: true } }`. `taggingController` wraps a controller whose `enqueue` takes *frames*, not bytes, and tags before encoding. `tagSseChunk` and the regex go.

### 5.2 Server

Each `encodeXxxEvent` becomes a one-line `encodeFrame(encoder, { kind: 'xxx', … })` or is deleted in favour of callers constructing the frame literal. The two inline emitters in `tool-execution.service.ts` and the one in `regenerate-swipe-stream.ts` are replaced. A grep-test (`__tests__/unit/lib/chat/stream-frames-chokepoint.test.ts`) asserts that no file under `lib/services/chat-message/`, `lib/storyteller/` or `lib/chat/turn-manager/` contains `data: ${` except `stream-frames.ts`.

### 5.3 Client

`handleSSEEvent` becomes:

```ts
const frame = parseFrame(raw); if (!frame) return;
if (frame.seat?.concurrent) return handleConcurrentFrame(frame);
switch (frame.kind) { case 'handAsked': …; case 'handAnswered': …; /* every kind */ default: assertNever(frame) }
```

The concurrent branch is one function that takes the frame and the seat, so the "which test runs first" question cannot arise: a frame is concurrent or not, and then it is exactly one kind. `useRegeneration` and `WhisperDialog` use `parseFrame` and switch on the subset they care about, with `default: break`.

The raise-hand POST reply stops writing `handStatus`; the stream owns it, and the POST handler only reports an HTTP failure. (That was the intent of 9eab8d2d's "no longer overwrites" fix, made structural.)

### 5.4 What gets smaller

| Before | After |
|---|---|
| 19 encoders + 3 inline, ~230 lines | `encodeFrame` + the schema, ~180 lines, and the schema is also the documentation |
| `SSEEvent` bag, 128 lines of optional fields and comments | gone; the schema replaces it |
| `sse-tag.ts` byte re-encoder, 60 lines | `tagFrame`, ~10 lines |
| dispatch chain `:735-945`, 210 lines of ordered `if`s | one `switch`, roughly the same length but exhaustive and order-free |
| five `done` re-derivations across the hook | one `switch (frame.outcome)` |

The net line reduction is modest (perhaps 150–200). The simplification is the point: one type, one encoder, one parser, no ordering.

## 6. Tests

- **Golden stream.** Record the frames of four real turns on V4test (plain reply, tool-using reply, concurrent Storyteller round with a raised hand, Courier external turn) into fixtures *before* the change, as the current bag shape. Write a one-time translator from bag to frame for the fixtures. After the change, the hook tests replay the translated fixtures and assert the same state transitions the old tests asserted. The fixtures stay as the regression set.
- **Schema round-trip.** For every variant, `parseFrame(decode(encodeFrame(frame)))` deep-equals `frame`.
- **Exhaustiveness.** A compile-time `assertNever` in the client switch; the chokepoint grep-test in §5.2.
- Existing: `yield-signal.test.ts`, `turn-outcome.test.ts`, the sse-tag test (rewritten against `tagFrame`), the hook tests.

## 7. Phases

1. **Module and server.** Add `stream-frames.ts`; switch every encoder to `encodeFrame` while emitting the *old* bag shape from a `toLegacyBag(frame)` adapter, so the client is untouched. Ship; soak one dev cycle. This step alone deletes the inline emitters and the byte re-encoder.
2. **Client.** Switch the three consumers to `parseFrame` and the `switch`; drop `toLegacyBag`; delete `SSEEvent`. Golden-stream replay must pass before and after.
3. **Follow-ups (separate decisions).** Split `useSSEStreaming` along frame families (turn lifecycle, tool batches, Storyteller board, hand). Offer the module to the other SSE routes.

## 8. Decisions needed from the human

1. **`posted` as one kind** (recommended) or keep three kinds. One kind reflects how the client treats them; three keeps the wire self-describing without reading `what`.
2. **Validation in production**: off (recommended; a malformed frame is a server bug caught in dev/test) or on with a warn log.

## 9. Risks

- **A held-open stream across a deploy.** A browser mid-turn on the old client would receive new-shape frames after a server restart. Turns do not survive a server restart today, so the window is empty, but Phase 1's legacy adapter removes it anyway.
- **Hidden consumers.** Anything that reads the raw stream outside the three known hooks (a Playwright test, the help-chat?) will surface in Phase 2 as a failing test. The chokepoint grep in §5.2 covers emitters; a second grep for `parseSSEData` / `getReader()` under `app/salon` and `components/chat` covers consumers.

## 10. As built (2026-11-03)

Two commits: Phase 1 (server on `encodeFrame`, wire shape unchanged through `toLegacyBag`, proven against the golden fixtures), then Phase 2 (the wire flips to frames; the client switches).

- **Module.** `lib/chat/stream-frames.ts` as §5.1, with these differences from the sketch: every variant takes an optional `seat` (spread into each object, so the union stays a plain `discriminatedUnion`); `turnComplete` carries `participantId`, `messageId`, `chainDepth`, `skipped?` and `chainComplete` carries `nextSpeakerId` and `chainDepth`, as the server actually sent them; `error` keeps `errorType`. Nested payloads (messages, the Storyteller board, `routeTrail` entries, tool results) are `z.custom` with a shape check rather than re-validated, since `parseFrame` runs on every client frame. `done` keeps `pendingExternalTurn` as a field (the Courier's parked turn) rather than a sixth outcome.
- **Seats.** `tagFrame` exists as specified, but the tag is applied by the *encoder*, not by a frame-taking controller: `seatedFrameEncoder(participantId)` returns a `TextEncoder` registered (in a module `WeakMap`) with its seat, and `encodeFrame` tags before encoding. The turn path passes `(controller, encoder)` through about fifty functions; carrying the seat on the encoder left every signature alone. The byte re-encoder is deleted; `lib/storyteller/sse-tag.ts` keeps only `sharedStreamController` (forward, never close) and `sinkController`.
- **Encoders.** The `encodeXxxEvent` functions remain as one-line `encodeFrame` calls (§5.2 allowed either), which kept the fourteen calling services and their tests unchanged. `encodeDoneEvent` takes `outcome` (default `finished`). The inline frames in `tool-execution.service.ts` and `regenerate-swipe-stream.ts` are gone. The chokepoint grep-test is `__tests__/unit/lib/chat/stream-frames-chokepoint.test.ts` (it also forbids `tagSseChunk` / `taggingController`).
- **`toLegacyBag` is not deleted.** The help chat, the Brahma console, the Scenario Builder and the one-shot tool loop share `streaming.service` encoders and `processToolCalls` with the Salon, and their clients read the old bag (§3 keeps them out of scope). They now write through `legacyFrameEncoder()`, which renders frames with `toLegacyBag`. When each adopts `parseFrame` (§7 Phase 3), its `legacyFrameEncoder` call goes, and the adapter with the last one.
- **Client.** `useSSEStreaming`'s `handleLine` is `parseFrame` → `handleSeatFrame` (a frame with a `seat`) or `handleFrame`, each an exhaustive `switch` ending in `assertNever`; the hand and board frames share `applyFloorFrame`, so a seat-tagged `handAnswered` is handled the same as an untagged one. `SSEEvent` and `parseSSEData` are deleted. The six hand-built optimistic assistant messages are one `assistantMessageFromDone`; `doneLeavesNoReply(outcome)` replaces the `skipped || stopped` tests. `useRegeneration` switches on `status` / `content` / `reasoning` / `error` / `swipeDone`. `WhisperDialog` only drains its stream and needed no change.
- **Raise-hand reply.** It no longer lowers the hand on `raised: false`. It still lowers a hand still `raised` when the reply says `active: false`: no stream is open, so no frame will ever settle it.
- **Golden streams.** V4test was not reachable, so the fixtures were recorded from the pre-change encoders (and, for the Storyteller round, the old byte tagger) in a scratch test, as six synthetic streams: plain reply, tool-using reply, concurrent Storyteller round with a raised hand, Courier external turn, the failure/edge frames, and a swipe — between them every frame kind. `__tests__/helpers/salon-stream-golden.ts` holds the one-time translator (`fromLegacyBag`). `stream-frames.test.ts` checks every fixture round-trips through `toLegacyBag` and through `encodeFrame` → `parseFrame`; `useSSEStreaming-golden.test.tsx` replays the frame streams through the hook. The same replay, run against the pre-change hook with the recorded bags, passed identically.
- **Found in passing, then fixed.** A concurrent seat's optimistic bubble was built from text read inside a `setConcurrentStreams` updater, which React need not run before the next line, so the bubble could land empty until the end-of-run refetch replaced it (the pre-change hook did the same). The reader now keeps each seat's text in a stream-local map beside the state; the golden test asserts the content.
