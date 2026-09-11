# Bug 135 — the "user stopped the stream" flag is written three times and read nowhere

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-09-11 |
| **Fixed** | — |
| **Severity** | Low-Medium (nothing is lost or corrupted; a guard that looks like it exists does not, so Stop/Pause does not gate stream processing at all — the abort controller is what actually stops a turn, which is why nobody noticed) |
| **Who it bites** | Anyone reading this code expecting Stop/Pause to have a say in what the stream handler does; and anyone who later relies on the flag, which will silently do nothing |
| **Provenance** | Found while diagnosing the incident behind [the Salon transcript plan](../features/complete/salon-realtime-transcript.md) (§1.1). Not caused by it and not fixed by it — filed here rather than smuggled into that change |
| **Fix site** | `app/salon/[id]/hooks/useChatControls.ts:145` (the ref), `:171` and `:224` (the writes), `app/salon/[id]/hooks/useSSEStreaming.ts:739` (the parameter) and `:746` (the third write) |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../bugs.md) |

## Symptom

None visible today, which is the trouble. `userStoppedStreamRef` reads like a
latch that the SSE read loop consults before doing anything with an incoming
event — "the operator hit Stop, so ignore what is still arriving." It does not.
Stopping a turn works because `stopStreaming` aborts the `AbortController`, and
the fetch dies; the flag contributes nothing.

The risk is the next change. A reader who adds a stop-sensitive branch will
reach for the ref that already exists, wire it, and get a guard that is written
but never consulted anywhere else — or, worse, will assume the guard is already
covering a case it has never covered.

## Root cause

The ref has three writers and no readers:

- `app/salon/[id]/hooks/useChatControls.ts:145` declares it.
- `:171` sets it `true` whenever a fetched chat comes back paused (the bug-123
  reconciliation effect).
- `:224` sets it to the requested value in `setPauseState`.
- `app/salon/[id]/hooks/useSSEStreaming.ts:746` resets it to `false` at the top
  of `sendMessage` when the chat is not paused.

It is threaded from `useChatControls` (`:603`) through `SalonView`
(`:1637`, `:1663`) and `useImpersonationVoice` (`:99`, `:113`, `:288`) into
`sendMessage`'s signature (`:739`) purely so that last write can happen. Nothing
in `readSSEStream`, the `onDone`/`onTurnComplete`/`onChainComplete` handlers, or
any consumer reads `.current`.

`grep -rn userStoppedStreamRef` over the whole checkout returns eleven lines:
one declaration, four writes, and six pass-throughs.

## Why it survived

A write-only ref type-checks, lints clean, and has no runtime effect — there is
nothing for a test to catch. And the behaviour it *appears* to provide is in
fact provided, by a different mechanism (`abortControllerRef.current.abort()`),
so Stop and Pause both work exactly as a user expects. The dead flag is
invisible from outside the code.

## The fix

Decide which of the two it is, and do that one thing:

1. **Delete it.** Remove the ref, its writes, and the parameter it occupies in
   `sendMessage`, `useImpersonationVoice`'s `sendArgs`, and the `SalonView`
   call sites. The abort controller remains the mechanism, as it is today.
2. **Or read it.** If stream processing should in fact ignore late events after
   a Stop — an abort can race a chunk already in the reader's buffer — gate the
   handlers in `readSSEStream` on it and say so in a comment.

(1) is the smaller change and matches the behaviour that ships. Prefer it
unless a concrete race is demonstrated.

## How to verify

`grep -rn 'userStoppedStreamRef' --include='*.ts*' .` returns nothing (fix 1),
or returns at least one `if (userStoppedStreamRef.current)` inside the stream
handlers (fix 2). Stop mid-turn and Pause both continue to behave as they do
today in either case.
