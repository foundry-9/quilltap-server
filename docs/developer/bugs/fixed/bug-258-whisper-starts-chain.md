# Bug 258 — an operator whisper starts a turn chain of its own, beside any chain already running

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-22, reported by the operator from ordinary use and traced while designing a Storyteller turn mode |
| **Fixed** | 2026-10-22 |
| **Severity** | Medium. Nothing is lost or stored wrongly, but the room's turn order goes wrong. Two chains pick speakers from the same queue and rotation, and the second one runs where the Salon cannot show it |
| **Who it bites** | anyone who whispers to a character from the participant sidebar in a multi-character chat, especially while characters are already taking turns |
| **Provenance** | Original to the operator Whisper dialog. `handleSendMessage` has always run `executeTurnChain` after the first reply, and nothing ever kept a whisper send out of it |
| **Fix site** | `lib/chat/turn-control.ts` (`waitForEarlierTurns`), `lib/services/chat-message/whisper-send.ts` (`isOperatorWhisperSend`), `lib/services/chat-message/orchestrator.service.ts` (`handleSendMessage`), `components/chat/WhisperDialog.tsx` (comment), `help/chat-multi-character.md` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-22).** A send carrying `targetParticipantIds` and not in continue mode is
an operator whisper (`isOperatorWhisperSend`). `handleSendMessage` now gives it two differences
from a public post:

- It runs single-turn: the target answers once and `executeTurnChain` returns without chaining.
- Before anything is persisted, it waits for every Salon stream that opened in the same chat before it
  to settle (`waitForEarlierTurns`).

Only earlier streams are awaited, so two whispers sent back to back queue in order and cannot
deadlock. A Stop while a whisper waits pauses the room first, so the whisper is then held like
any typed message in a paused chat. Tests: `__tests__/unit/lib/chat/turn-control.test.ts`
(`waitForEarlierTurns`) and `__tests__/unit/lib/services/chat-message/whisper-send.test.ts`.

Verified live on `V4test` (chat `fd40d93a-5930-4a02-a9aa-f7a808362cff`, Lorian and Riya with a
user-controlled Tester):

- **Whisper with nothing running.** A whisper to Lorian streamed one `turnStart` and one `done`,
  with no chain.
- **Whisper during a chain.** A public post started a Riya → Lorian chain, and 1.5 s later a whisper
  to Riya logged `Waiting for earlier stream(s) to finish`. Lorian's reply was saved at 12:30:28.731
  and the whisper's own message at 12:30:28.798, after the chain closed. Riya then answered once,
  and the stream logged `singleTurn: skipping chain loop`.

## Symptom

The operator reported that whispering to a character with the Whisper button "kicks off its own
somewhat-concurrent chain of responses and mucks with the turn system." Characters answered out
of order, turns appeared that nobody had asked for, and the rotation shown in the sidebar stopped
matching who actually spoke.

## Root cause

`WhisperDialog` (`components/chat/WhisperDialog.tsx`) POSTs to `/api/v1/chats/[id]/messages`
with `targetParticipantIds`, closes itself, and reads the SSE stream to its end without rendering
any of it. On the server, `handleSendMessage` (`lib/services/chat-message/orchestrator.service.ts`)
treated that like any other send:

1. `processMessage` made the whisper's target the first responder (the
   `respondingId` fallback to `targetParticipantIds[0]`).
2. `executeTurnChain` then chained on through the room, to the depth cap or the next user seat,
   exactly as after a public post.

Two problems followed:

- **The extra round.** Even with nothing else running, a private aside started a full public round.
  The other characters answered a whisper they could not see.
- **Concurrent chains.** `runWithTurnControl` keeps a *set* of open streams per chat, and nothing
  stopped a second stream opening. Whispering while a chain ran gave two chains, each calling
  `shouldChainNext` against the same `turnQueue`, `spokenThisCycleParticipantIds` and
  `cycleOrderParticipantIds`. They could pick the same speaker twice or double-count the cycle.
  The whisper's chain ran in the dialog's hidden stream, so its turns appeared only on the next
  refetch, out of step with the stream the Salon was showing.

## Why it survived

- **Single-character chats.** Whispers are offered only in multi-character chats, and with one
  responder the chain stops at once.
- **Invisible stream.** Because the dialog's stream was never rendered, the extra turns looked like
  ordinary chain turns that had arrived late, not like a second chain.
- **Untested combination.** `turn-control.ts` was written for Stop and the raised hand, which act on
  every open stream. Running two streams in one chat was never a case anyone set out to test.

## The fix

See the FIXED paragraph above. `singleTurn` already existed for the autonomous-room handler and
does exactly the right thing here: return after the initial turn. The whisper path sets it
internally rather than through the request body, so a client cannot turn it off.

## How to verify

1. In a multi-character chat with two or more LLM characters, whisper to one of them from the
   participant sidebar. Exactly one reply should appear, from that character, and the floor
   returns to you.
2. Post a public message, and while the characters are still answering, whisper to one of them.
   The whisper should appear only after the running round finishes, followed by one reply from
   its target. In `logs/combined.log`, look for `[TurnControl] Waiting for earlier stream(s) to
   finish` and then `[TurnOrchestrator] singleTurn: skipping chain loop`.
