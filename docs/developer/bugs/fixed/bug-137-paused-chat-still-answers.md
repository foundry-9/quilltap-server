# Bug 137 — a paused conversation answers one message per post, and a nudge lifts the pause without saying so

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-13 |
| **Fixed** | 2026-09-13 |
| **Severity** | Medium (nothing is lost or corrupted, but the control does not do what its name and its help text say, and the two ways out of a pause both end it silently — so a room the operator believes is held is in fact back in the rotation) |
| **Who it bites** | Anyone who presses **Pause** to think, to set a scene, or to stop a room that is running away: every message they type while "paused" still draws a reply, and a single **Nudge** hands the whole rotation back |
| **Provenance** | Reported by the operator on 2026-09-13, after asking what Pause actually changes. Not a regression — the chain-only semantics are as old as the button |
| **Fix site** | `lib/services/chat-message/orchestrator.service.ts` (the hold), `lib/services/chat-message/paused-hold.ts` (the rule), `app/salon/[id]/hooks/useTurnManagement.ts` and `app/salon/[id]/hooks/useSSEStreaming.ts` (the summons) |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-13).** A paused room now moves only when the operator
asks it to, one turn at a time. The rule has two halves and they were only ever
half-written: `executeTurnChain` already stopped anything from *following* a
turn, and nothing stopped one from *starting*. `shouldHoldUserTurnForPause`
(`lib/services/chat-message/paused-hold.ts`) is the missing half —

```ts
if (input.isContinueMode) return false      // Nudge / Skip / Continue: the operator asking
if (input.neverPauseForUser === true) return false  // autonomous rooms run on runState
return input.chatIsPaused === true
```

— and `processMessage` consults it once, at the top, then returns through
`finishHeldUserTurn` at the seam between "record what the operator wrote" and
"prepare a character's turn". Everything above that seam still runs: staged tool
results, auto-detected dice, attachments and their Librarian announcement, the
danger classification and its flags, inline `@Name:` queries. Everything below
it — tool loading, memory recall, context assembly, the model call — does not.
Two turn-preparation writes are guarded with it, because they belong to a turn
that no longer happens: the `requestFullContextOnNextMessage` flag is not spent,
and the Prospero context whisper (which briefs *the character about to speak*)
is not posted.

Nudge and Skip stopped lifting the pause. They did not need to: the chain guard
is what holds the room after the summoned turn, so the turn runs and the floor
comes straight back. `triggerContinueMode`'s own `if (isPaused) return` — which
is why they had to lift it — is deleted.

The silence is announced once per pause. `finishHeldUserTurn` flags its
`chainComplete` as `heldUserTurn`, and the Salon answers the first held message
of each pause with **Your remark is in the record. The room stays paused — nudge
a character for a single turn, or press Resume.** Subsequent messages pass
without comment; the ref resets when the pause lifts.

Verified in the browser against a real instance: paused, typed — message
recorded, no reply, notice shown; typed again — recorded, no reply, no second
notice; nudged — the Host's summons and exactly one reply, with `isPaused` still
`1` in the row afterwards.

## Symptom

Press **Pause** in the participants sidebar. The button reads **Resume**, the
toast says auto-responses are paused, and then:

- Type a message. A character answers it. Exactly one, every time.
- Press **Nudge**. The character answers — and so does the next, and the next,
  because the pause was silently lifted before the nudge was sent. The button
  still reads **Resume** until the next fetch reconciles it.

The help text said "Characters stop responding". They did not.

## Root cause

Two halves of one rule, only one of which was written.

**The half that existed.** `executeTurnChain`
(`lib/services/chat-message/turn-orchestrator.service.ts:341`) returns early
when the initial result is paused, and `shouldChainNext` refuses each subsequent
decision. That stops the *chain* — everything after the first turn.

**The half that did not.** Nothing consulted `isPaused` before the first turn.
`processMessage` read the chat, resolved a responding participant, built the
context and called the model exactly as it would in an unpaused room; the pause
was consulted only afterwards, to decide whether to continue. "Paused" therefore
meant "one reply per message" rather than "no replies", which is a coherent
behaviour but not the one the button claims.

**The consequence for the summons.** Because the pause was only ever a
chain-stopper and never a turn-stopper, the client's own
`triggerContinueMode` had `if (isPaused) return` — a guard that made Nudge and
Skip do nothing at all in a paused room. Both worked around it by lifting the
pause first (`handleNudge`, `handleSkipUserTurn` → `onUnpause()`), which made
the one control an operator would reach for to get a *single* turn out of a
paused room the control that ended the pause entirely. Nothing said so.

## Why it survived

Every piece of it is defensible in isolation, and the composite is invisible:

- One reply per message is a plausible reading of "paused" if you have not read
  the help, and it is *useful* — it looks like a deliberate "manual mode".
- The nudge's unpause is commented as a fix for a real problem ("or the next
  speaker would be refused by the pause guard"), and it is: given the guard, the
  workaround was correct.
- Nothing errors, nothing is lost, and the Salon's own pause notice (bug 123)
  covers the *chain* stopping, which reinforced the chain-only reading.

The two halves also live on opposite sides of the client/server line and were
written for different reasons, so no single file said what a pause was.

## The fix

Name the rule and apply it at the top of the turn, not the bottom:

1. `shouldHoldUserTurnForPause` in a module of its own, with the two
   exemptions — continue mode (the operator's own summons) and
   `neverPauseForUser` (autonomous rooms, which run on `runState`).
2. `processMessage` computes it once from the chat it has just read, and returns
   through `finishHeldUserTurn` after the user's message and its side effects
   are persisted and before any turn preparation.
3. Guard the two writes that belong to the turn rather than the message:
   `requestFullContextOnNextMessage` and the Prospero cadence whisper.
4. Delete `triggerContinueMode`'s pause guard and both `onUnpause` calls, along
   with the `isPaused` / `onUnpause` parameters of `useTurnManagement` that
   existed only to serve them.
5. Say something the first time each pause swallows a message.

The fairness guard (`maybePauseForUserSeatTurn`) is skipped when the hold
applies: both persist a user message that nobody answers, and the hold's copy is
the complete one.

## How to verify

In a chat with an LLM character, press **Pause**:

1. Send a message. It appears in the transcript, no character replies, and a
   notice says the room stays paused. Send a second: recorded, no reply, no
   second notice.
2. Press **Nudge** on a character. The Host announces the summons, that
   character replies once, and nothing follows. The sidebar still reads
   **Resume**, and `SELECT isPaused FROM chats WHERE id = …` is still `1`.
3. Press **Resume** and send: the rotation runs as it always did.

Autonomous rooms are unaffected — they pass `neverPauseForUser` and obey
`runState` — and the Courier still parks a chat on the same flag while it waits
for a pasted reply, which now also means the chat records what you type while it
waits instead of dispatching a second request.
