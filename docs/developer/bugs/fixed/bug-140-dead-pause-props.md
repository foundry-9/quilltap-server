# Bug 140 — the transcript's pause props are threaded three components deep and rendered by nobody

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-13 |
| **Fixed** | 2026-09-13 |
| **Severity** | Low (no runtime effect beyond a wasted re-render of every message row on each pause flip; the cost is owed to the reader who finds a pause control apparently wired into the transcript and believes it) |
| **Who it bites** | Nobody today. The next person to wire an inline pause affordance into the message list, who will find `isPaused` already arriving at `MessageRow` and conclude it is in use |
| **Provenance** | Found while tracing the pause paths for [bug 137](bug-137-paused-chat-still-answers.md) — the same sweep that produced 138 and 139. Same shape as [bug 135](bug-135-user-stopped-stream-never-read.md): a prop that type-checks, lints clean, and is consulted by no renderer |
| **Fix site** | `app/salon/[id]/components/MessageRow.tsx`, `app/salon/[id]/components/VirtualizedMessageList.tsx`, `app/salon/[id]/SalonView.tsx`, `app/salon/[id]/hooks/useChatControls.ts` |
| **v5 status** | Not yet assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-13).** Deleted rather than wired, no inline control
having been asked for: `isPaused` and `onTogglePause` are gone from
`MessageRow`'s props, from the destructure, from
`VirtualizedMessageList`'s props and its pass-through, and from both
`SalonView` call sites. The memo comparison

```ts
if (prev.isPaused !== next.isPaused) return false
```

goes with them — it was forcing every visible row to re-render on a flag no row
read. `useChatControls`' `triggerContinueModeRef` parameter, destructured and
never referenced, is deleted in the same pass along with `SalonView`'s hand-off;
the ref itself is still live and still feeds `stableTriggerContinueMode`.

The pause control the operator actually uses is in `ChatSidebar` — the button in
the participants drawer and the icon on the collapsed strip — and is untouched.

## Symptom

None visible. `SalonView` passes `isPaused` and `onTogglePause` to
`VirtualizedMessageList`, which declares both and forwards them to every
`MessageRow`, which declares both, destructures both, defaults `isPaused` to
`false` — and renders neither. The only consumer anywhere in the chain is the
row's own `areEqual`, which compares `isPaused` and returns `false` on a change,
so flipping the pause re-renders every row in the viewport to produce identical
output.

`MessageRow` genuinely does render turn controls — it takes `turnState`,
`onHandleNudge` and `onHandleContinue` and uses all three — which is what makes
the two dead props read as part of that set.

## Root cause

A prop chain outlived whatever was going to read it, or preceded something that
never arrived. The sidebar is where the pause control lives; the transcript-side
props were never removed (or never used). Nothing flags this: passing a declared
prop that the component ignores is valid TypeScript and valid React, and the
memo comparison gives it the *appearance* of a consumer.

## Why it survived

Three files each look correct in isolation — a parent passing state down, a list
forwarding it, a row accepting it — and the wrongness exists only in the absence
of a fourth thing. `grep isPaused` in the Salon returns plenty of hits, all of
them real somewhere, which is exactly the noise that hides a dead one.

## The fix

Delete the chain. The test for a prop of this kind is a search for *renderers*,
not for declarations — the same test bug 135 recorded for refs.

If an inline pause affordance is wanted in the transcript later (there is a case
for one: after bug 137, a message typed into a paused room draws no reply, and
the sidebar may be collapsed), it should be added deliberately, with the props
re-introduced alongside the control that reads them.

## How to verify

`grep -rn 'isPaused\|onTogglePause' app/salon/\[id\]/components/` returns
nothing. The sidebar's Pause/Resume button still works, and toggling it no
longer re-renders the message list.
