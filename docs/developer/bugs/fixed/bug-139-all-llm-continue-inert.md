# Bug 139 — "Continue" in the all-LLM pause dialog only closes the dialog

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-13 |
| **Fixed** | 2026-09-13 |
| **Severity** | Low-Medium (nothing is lost, but the primary action of a dialog the house raises by itself does nothing at all, and the room it was raised about cannot be restarted from it) |
| **Who it bites** | Anyone running an all-LLM room past a pause threshold (3, 6, 12, 24 turns…) who presses **Continue (N more turns)** and finds the conversation has not continued |
| **Provenance** | Found while tracing the pause paths for [bug 137](bug-137-paused-chat-still-answers.md). The two bugs mask each other: before 137, the room answered one turn per user message, so a "continue" that did nothing looked like a room that had simply gone quiet |
| **Fix site** | `app/salon/[id]/SalonView.tsx` — `handleAllLLMContinue` |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-13).** The handler now does what the button says:

```ts
const handleAllLLMContinue = useCallback(async () => {
  modals.setAllLLMPauseModalOpen(false)
  await chatControls.setPauseState(false)
  await turnManagement.handleContinue()
}, [modals, chatControls, turnManagement])
```

The `await` on the resume matters: `handleContinue` asks the server for the next
speaker and requests its turn, and the server reads `isPaused` when that request
arrives. Resuming without waiting for the persist would grant a single turn and
stop again — the correct behaviour for a nudge, the wrong one for a button
labelled "Continue".

## Symptom

An all-LLM room reaches a pause threshold. The house pauses it and raises **All
Characters Controlled by AI**, offering **Continue (N more turns)**, **Stop**,
and a list of characters to take over.

Press **Continue**. The dialog closes. Nothing else happens — not then, and not
afterwards: the chat is still paused, so the room stays silent until the
operator finds the **Resume** button in the sidebar and then separately gets a
turn out of it.

## Root cause

`app/salon/[id]/SalonView.tsx`:

```ts
const handleAllLLMContinue = useCallback(() => {
  modals.setAllLLMPauseModalOpen(false)
}, [modals])
```

That is the whole handler. Its sibling in `useChatControls` was emptier still —
a `useCallback(() => {}, [])` with the comment "The caller should close the
modal" — so the feature had two implementations, one inert and one empty, and
the dialog's own `handleContinue` (`onContinue(turns); onClose()`) dutifully
called the inert one.

The threshold pause is set **server-side** (`repos.chats.update(chatId, {
isPaused: true })` in `shouldChainNext`), so closing a client dialog cannot
affect it. The `turnsToAdd` argument the modal computes and passes is read by
nobody.

## Why it survived

All-LLM rooms are a narrow path, and the dialog offers two other actions that do
work (**Stop** is honest about doing nothing, and **take over a character**
starts impersonation). An operator who pressed Continue and saw silence had a
ready explanation — the room had been paused for running too long, so silence is
what a pause looks like. Bug 137 supplied the rest of the cover: any message
typed afterwards drew exactly one reply, which reads as a room limping along
rather than one that never restarted.

## The fix

Lift the pause, then ask for a turn — the two steps the label promises, in that
order, with the persist awaited. `handleAllLLMStop` keeps its
`setPauseState(true)`: it is already true, and stating the intent is worth the
no-op.

## How to verify

Let an all-LLM room run past a threshold (or pause one by hand while it has no
user messages at all — a room the human has typed into is no longer all-LLM, and
the dialog will not be raised for it). Press **Continue**: the pause lifts, the
next speaker takes the floor, and the rotation carries on to the next threshold.

**Not re-verified in the browser.** The dialog is raised only for a room with no
human participation, and the instance used for the rest of this work had been
typed into. Both halves of the handler are exercised elsewhere — Resume by hand,
and `handleContinue` by the sidebar's Skip control.
