# Refactor 4.13 — One stream lifecycle in the Salon, then the SalonView split

**Status:** Proposed (2026-11-10), written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #172 by construction and #173 on the way. This is the follow-up the 4.12 set deferred: "`useSSEStreaming` at 1,831 lines and `SalonView` at 2,343: splitting them is desirable, but the bag protocol is what prevents it." The [stream-frames spec](refactor-4-12-salon-stream-frames.md) is done, so the split is unblocked.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

`app/salon/[id]/hooks/useSSEStreaming.ts` is 1,846 lines, takes 23 parameters and returns a wide bag. It contains four stream lifecycles that were written one after another:

| Lifecycle | Lines (approx.) |
|---|---|
| `sendMessage` | `:1022-1336` |
| `openChat` | `:1337-1422` |
| `triggerContinueMode` | `:1459-1609` |
| `runStorytellerSelection` | `:1610-1726` |

Each one builds its own fetch, installs its own abort controller, wires `onTurnStart` / `onTurnComplete` / `onChainComplete`, and has its own `finally`. The reset triple `resetStreamingContent(); setStreaming(false); setWaitingForResponse(false)` appears about 25 times. The continue and storyteller lifecycles (`:1554-1601`, `:1676-1716`) are near-identical and disagree only on `setConcurrentStreams([])` and `notifyQueueChange()`.

Because the lifecycles do not know about each other:

- `sending` is set only by `sendMessage`, so its guard (`if (sending)`, about `:1049`) does not see a continue, opening or storyteller run. `ChatComposer.tsx` blocks the Send button on `isGenerating` (`:747`) but the Enter path only on `composerLocked` (`:350`). Enter during a run starts a second stream (#172).
- Each lifecycle overwrites `abortControllerRef` (about `:1142`) without aborting the previous one. The first stream's `finally` then clears the flags and the controller under the second.

`app/salon/[id]/SalonView.tsx` is 2,419 lines: logic `:139-1772`, JSX `:1773-2419`, with 27 `useState`, 26 `useEffect`, 32 `useCallback`. Its sidebar call (about `:2290`) passes 84 props, 13 of which cross three levels untouched.

## 2. Goal

- One `runTurnStream({ request, kind, onDone })` that owns the abort controller, the in-flight flag, the frame handlers and the `finally`. The four lifecycles become four request builders.
- "A stream is in flight" is one piece of state that every entry point checks.
- `SalonView` loses its largest separable blocks to hooks, and the sidebar reads actions from context.

## 3. Non-goals

- The SSE transport and the `StreamFrame` union. The frame `switch` blocks move; they do not change.
- TanStack Query adoption for the stream. CLAUDE.md: "migrate the reads around streaming, never the stream itself."
- `ChatSidebar.tsx`'s internals (that is in the [client server-state spec](refactor-4-13-client-server-state.md)), beyond how it receives props.
- Visual or behavioural change, other than the two bug fixes.

## 4. Known state

Verified by reading (2026-11-10): `composerLocked = disabled || sending` and `isGenerating = streaming || waitingForResponse` (`ChatComposer.tsx:238-239`); the Enter guard at `:350`; the send guard at `useSSEStreaming.ts:1049`; `useChatData.ts` has exactly one `setError` call (`:215`) and `SalonView.tsx:1753` renders the error screen on `error || !chat` (#173).

Not verified: whether the server runs two turns concurrently when a second stream is opened, or serialises them (the audit read `orchestrator.service.ts:203-207` as queuing only whispers). The client fix does not depend on the answer, but record what you find.

## 5. Design

### 5.1 Module split of `useSSEStreaming`

| New module | From | Kind |
|---|---|---|
| `stream-helpers.ts` | `:76-271` (already exported pure helpers) | plain functions |
| `useStreamingBuffers` | `:356-430` (rAF-buffered content and reasoning) | hook |
| `useStreamingToolBatches` | `:530-606` | hook |
| `readTurnStream(reader, handlers)` | `:608-933`, with its three `switch (frame.kind)` blocks (`:658`, `:689`, `:751`) | plain async function, no React |
| `useTurnStream` | the four lifecycles and stop / raise-hand (`:1727-1830`) | hook |

`readTurnStream` being a plain function is the point: it can be unit-tested with a fake reader and a handler object, without rendering.

### 5.2 `runTurnStream`

```ts
type StreamKind = 'send' | 'open' | 'continue' | 'storyteller'
runTurnStream({ kind, request, before?, onDone?, extras? })
```

- Refuses (returning `false`, with the existing "the room is still speaking" toast where the caller is a user send) when a stream is in flight.
- Creates the one abort controller; nothing else assigns `abortControllerRef`.
- Installs the shared handlers; `extras` carries the per-kind differences (`setConcurrentStreams([])`, `notifyQueueChange()`).
- One `finally` with the reset triple, written once.

The hook exposes `isStreamInFlight`. `ChatComposer` uses it for both Enter and the Send button. `sending` either becomes derived from it or is removed.

### 5.3 #173 while in the file's neighbourhood

`useChatData` clears `error` on a successful fetch; `SalonView` shows the full-page error only when there is no chat to show, and otherwise a toast.

### 5.4 SalonView, after 5.1–5.2 land

The stream hook's return bag shapes most of SalonView, so this comes second.

| Extract | From | Size |
|---|---|---|
| `useSalonAvatars` | avatar watch and face resolution, `:322-395` and `:1352-1507` | about 230 lines |
| `useMessageReveal` | search and reveal, `:1508-1653` | about 145 lines |
| effects sorted by owner | the block of 13 effects at `:982-1350` | moves into the hooks that own each concern |

Sidebar props: `components/providers/chat-context.tsx` exists but `ChatProvider` is never mounted, so `useChatContext()` always returns its empty fallback (see the [dead-code list](refactor-4-13-dead-code-and-leftovers.md)). Either mount it in SalonView carrying a `ChatActions` value for the 13 pass-through props, or delete the provider and the hook. Decision 2 below.

## 6. Phases

1. **Tests first.** Extend `useSSEStreaming-send-guard.test.tsx`: start `triggerContinueMode`, call `sendMessage`, assert no second fetch (#172). A `useChatData` test: a failed fetch then a successful one ends with `error === null` (#173).
2. **Fix #172 and #173 in place** with the smallest change. They should not wait for the split.
3. **Pure moves**: `stream-helpers.ts`, `readTurnStream`, the two small hooks. No behaviour change; the existing streaming tests pass unmodified.
4. **`runTurnStream`**; the four lifecycles onto it one at a time, continue and storyteller first (they are the near-duplicates).
5. **SalonView extractions**; the context decision.

## 7. Tests and gates

- New unit tests for `readTurnStream` per frame kind, using `encodeFrame` to build input.
- Verify in a browser on V4test (dev on :3005; never Friday): a send, a continue, a storyteller round, an opening, Stop and Raise Hand during each, and Enter during each.
- Mind the notes on file: SalonView's early `if (loading) return` means mount effects that need message DOM include `isLoading` in their deps; the composer's editor owns live text, so do not reintroduce per-keystroke `setInput`.
- Expected size: 250–350 lines removed from the streaming hook, about 100 from SalonView, the rest moves. Medium risk.
- CHANGELOG cites `#172`, `#173`. No help-doc change.

## 8. Decisions for the human

1. Enter during a run: refuse with the existing toast and keep the text (proposed), or queue the message to send when the run ends?
2. `ChatProvider`: mount it and move the pass-through sidebar props into context (proposed), or delete it?
