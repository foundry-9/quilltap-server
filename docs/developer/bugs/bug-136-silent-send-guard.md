# Bug 136 — a send swallowed by the `sending` guard is indistinguishable from one that failed

| | |
|---|---|
| **Status** | Open |
| **Found** | 2026-09-11 |
| **Fixed** | — |
| **Severity** | Low-Medium (nothing is lost — the composer keeps the text — but the operator gets no signal at all, and the same silence covers a genuinely dropped send) |
| **Who it bites** | Anyone who submits while a turn is still in flight: a fast second Enter, the In Their Own Words dialog re-dispatching a submit, a multi-character chain that has not finished |
| **Provenance** | Found while diagnosing the incident behind [the Salon transcript plan](../features/complete/salon-realtime-transcript.md) (§1.1) — the silence is what made that incident hard to tell apart from an ordinary no-op. Not caused by that change and not fixed by it |
| **Fix site** | `app/salon/[id]/hooks/useSSEStreaming.ts:742` (the bare `return` in `sendMessage`); the same shape guards `triggerContinueMode` |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../bugs.md) |

## Symptom

Press Enter while a reply is still generating. Nothing happens. No toast, no
disabled-button flash, no "hold on" — the line simply does not go, and the
operator is left to guess whether the app is thinking, whether the send failed,
or whether they mis-pressed.

It is the same silence a genuinely broken send produces, which is what makes it
worth fixing rather than documenting: the one signal that would distinguish "I
declined to send that" from "something went wrong" is missing.

## Root cause

`app/salon/[id]/hooks/useSSEStreaming.ts:742`:

```ts
if ((!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) || sending) return
```

One `return` covers two quite different cases. The empty-input half is correct
and wants no feedback — there is nothing to send and the operator knows it. The
`sending` half is a real refusal of a real request, and says nothing.

`triggerContinueMode` has the same shape (`if (streaming || waitingForResponse) return`).

## Why it survived

The composer does not clear on the refused path, so the text is still there and
a second press after the turn lands works. The failure mode is a moment of
confusion, not lost work, and it only shows up under a race the author of the
guard was deliberately preventing.

## The fix

Split the two cases. Leave the empty-input return silent; on the `sending`
branch, tell the operator something — the house pattern is
`showInfoToast(...)`, in the Salon's voice ("One moment — the room is still
speaking."). A disabled-with-tooltip Send button would be better still, but the
toast is the small fix and can land on its own.

Do the same for `triggerContinueMode`, whose guard is refusing a click on an
explicit control and so is, if anything, more deserving of an answer.

## How to verify

Send a line, and while the reply is streaming press Enter again: a notice
appears and the composer keeps its text. With an empty composer, pressing Enter
still does nothing and says nothing.
