# Bug 138 — the Nudge flag is dropped by the wrapper between the button and the server

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-13 |
| **Fixed** | 2026-09-13 |
| **Severity** | Low-Medium (a summoned character may answer "nothing to add" and pass the turn — the one thing an explicit summons is supposed to forbid. Harmless while a pause did not hold, because the rotation carried on regardless; the cost lands with [bug 137](bug-137-paused-chat-still-answers.md), where a passed turn is the *only* turn) |
| **Who it bites** | Anyone who presses **Nudge** in a room with turn-skipping enabled — most sharply in a paused room, where the pass consumes the single turn the operator asked for and the room falls silent again with nothing said |
| **Provenance** | Found while tracing the Nudge path for [bug 137](bug-137-paused-chat-still-answers.md). Not reported — the symptom is a character declining to speak, which is indistinguishable from the feature working as intended |
| **Fix site** | `app/salon/[id]/SalonView.tsx` — `stableTriggerContinueMode` |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-13).** The wrapper forwards the flag:

```ts
const stableTriggerContinueMode = useCallback(
  async (participantId: string, nudge?: boolean) => {
    await triggerContinueModeRef.current(participantId, nudge)
  },
  []
)
```

Everything on either side of it already had the parameter — the ref is typed
`(participantId: string, nudge?: boolean)`, `handleNudge` calls
`triggerContinueMode(participantId, true)` with a comment explaining why, the
request body carries `nudge`, `continueMessageSchema` validates it and
`processMessage` reads it. Only the one-argument wrapper in between did not.
Covered by `__tests__/unit/hooks/useSSEStreaming-send-guard.test.tsx`, which
asserts the posted body carries `nudge: true`.

## Symptom

Press **Nudge** on a character. They may post a Host turn-pass — "nothing to
add" — and say nothing, exactly as if the rotation had reached them on its own.

In a paused room (after bug 137) that is the whole of the turn the operator
asked for: the summons is spent, nobody speaks, and the room is quiet again.

## Root cause

`app/salon/[id]/SalonView.tsx`:

```ts
const stableTriggerContinueMode = useCallback(
  async (participantId: string) => {
    await triggerContinueModeRef.current(participantId)   // ← nudge never passed
  },
  []
)
```

The wrapper exists to give `useTurnManagement` a callback with a stable
identity, reading the live function through a ref. It declared one parameter.
`handleNudge` passes two:

```ts
// Nudge is an explicit summon → withhold the "nothing to add" skip option.
triggerContinueMode(participantId, true)
```

The second argument lands on a function that does not take it, so `nudge` was
`undefined` at the fetch, absent from the request body, and `options.nudge` was
never true on the server. `withholdSkipOption` therefore stayed off for every
nudge in the application's history — the flag was reachable only by a caller
posting to the API by hand.

TypeScript raises nothing: a one-parameter function is assignable to a
two-parameter type, which is the correct rule and exactly the wrong one here.

## Why it survived

The symptom is a character choosing not to speak, which is a feature. Turn
skipping is off by default, and where it is on, a pass after a nudge looks like
the model exercising the option it was given. The rotation continued past it, so
nothing was stuck. And the comment directly above the call states the intent so
plainly that reading the call site convinces you the intent is served.

## The fix

Forward the parameter. Worth noting for the port: the wrapper's purpose is
identity stability, and a wrapper whose only job is to be stable should be
spread-and-forward (`(...args) => ref.current(...args)`) rather than
re-declaring the signature it is proxying, precisely so the compiler cannot
silently accept a narrower one.

## How to verify

With turn skipping enabled, press **Nudge** and watch the request body in the
network pane: it carries `"nudge": true`. Server-side, the turn is built with
the skip option withheld, so the character answers rather than passing.
