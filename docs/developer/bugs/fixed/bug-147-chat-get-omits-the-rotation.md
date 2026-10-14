# Bug 147 — the chat GET omits the cycle rotation, so the Salon re-rolls the speaker on every recompute

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-16)** |
| **Found** | 2026-09-16 (Friday, chat `e59f8969`, running 4.10.0-dev.40 under Electron — i.e. **with [Bug 146](bug-146-banner-passes-the-composers-seat.md)'s fix already in place**, which is what exposed this as the deeper cause) |
| **Fixed** | 2026-09-16 |
| **Severity** | **High** — the client's answer to "who speaks next" was a fresh weighted roll, unrelated to the rotation the server had drawn and persisted. It mislabelled the turn banner, mis-targeted its Skip (writing a Host turn-pass against a seat that never held the floor), and made the participant sidebar's predicted order a guess in which nobody was ever marked as having spoken |
| **Who it bites** | every multi-character chat, continuously — but visibly only where the client's answer *matters before the next server round trip*, which is the turn banner and the sidebar. Rooms where the human drives two seats feel it worst, because there the wrong answer costs a wasted pass |
| **Provenance** | v4-only, in `GET /api/v1/chats/[id]`. The turn engine is correct; it was never given its inputs |
| **Defect site** | `app/api/v1/chats/[id]/handlers/get.ts` — the response object is built field by field and named neither `spokenThisCycleParticipantIds` nor `cycleOrderParticipantIds`. Secondary: `app/salon/[id]/hooks/useTurnManagement.ts` — `TurnActionResponse.state` declared only `queue`, so the rotation the turn route *does* send was dropped too |
| **Fix site** | the same two files — project both columns on the wire, and thread `state.cycleOrder` into the local turn state |
| **v5 status** | **Not yet assessed.** v5 asks the server for the turn (`salon-conversation.ts` drives a turn query) rather than recomputing locally, so it is unlikely to reproduce; but if the port ever adds a local projection it needs these two fields in its chat payload |
| **Index** | [bugs.md](../../bugs.md) |

---

## FIXED in v4 (2026-09-16)

Both columns now ride on the chat payload, as the JSON strings the turn
manager's parsers already expect:

```ts
spokenThisCycleParticipantIds: chatMetadata.spokenThisCycleParticipantIds ?? '[]',
cycleOrderParticipantIds: chatMetadata.cycleOrderParticipantIds ?? '[]',
```

`'[]'` rather than `undefined` for a legacy row, so "no rotation on file" stays
a *parsed empty rotation* and never reintroduces the undefined the client could
not distinguish from a fresh chat.

The secondary omission is closed the same way: `TurnActionResponse.state` now
declares the `cycleOrder` the route has always sent, and `applyServerResponse`
threads it into `turnState`, so the window between a turn action and the next
refetch is no longer blind either.

Deliberately unchanged: the client still recomputes locally rather than asking
the server on every render. That is what keeps the banner responsive, and with
its inputs restored it lands on the same seat the server did — which the suite
now asserts directly rather than assuming.

### Verification

**At runtime**, against the V4test dev server and a real row whose rotation is
`["409fb470…"]`:

| | `cycleOrderParticipantIds` | `spokenThisCycleParticipantIds` |
|---|---|---|
| before (route reverted) | `<<ABSENT>>` | `<<ABSENT>>` |
| after | `'["409fb470-1878-4a78-81d0-4f2c74114d2e"]'` | `'["b9368643…","3535167f…"]'` |

Both match the columns exactly.

**In the suite:**

- `__tests__/unit/app/api/v1/chats/[id]/handlers/get.test.ts` — two cases: the
  columns are projected when set, and default to `'[]'` when unset. These are
  the guard against the omission returning.
- `__tests__/unit/lib/chat/turn-manager/client-server-agreement.test.ts` — the
  reported room, with talkativeness loaded onto one LLM seat so the re-roll is
  deterministic. The server hands the floor to Charlie; the client agrees given
  the columns (and agrees while its copy of the row is still pre-post); **without
  them it returns `reason: 'weighted_selection'` and picks the LLM seat**, and a
  seat that has already spoken this cycle is re-seated. That last case is the bug,
  pinned.

`npx tsc` clean, `npm run lint` clean, full unit suite green.

---

## Symptom

Reported twice, the second time with [Bug 146](bug-146-banner-passes-the-composers-seat.md)'s
fix already running, in the operator's own words:

> 1. I impersonated Leilani
> 2. I answered as Leilani
> 3. It prompted me as Leilani
> 4. I skipped
> 5. It prompted me as Charlie (my standard, non-impersonated user-driven character)

Step 5 is the diagnosis. The banner became correct at exactly the moment the
client stopped guessing and used the server's answer — `applyServerResponse`,
which runs on the skip's response. Before that it had been guessing.

The server had it right all along, twice, seven minutes apart:

```
11:14:40.762  [TurnFairness] User post pauses for another user-driven seat
              poster: 2c91e03b (Leilani)  →  nextSpeakerId: f08a46e0 (Charlie)
11:21:01.832  … identical …
```

## Root cause

The Salon does not ask the server whose turn it is. It recomputes the answer
locally on every message change (`SalonView.tsx`, the turn-state effect), which
is what keeps the banner responsive:

```tsx
const newTurnState = calculateTurnStateFromHistory({
  messages: toTurnEvents(messages),
  spokenThisCycleParticipantIds: chat?.spokenThisCycleParticipantIds,
  cycleOrderParticipantIds: chat?.cycleOrderParticipantIds,
})
let result = selectNextSpeaker(participantsAsBase, charactersMap, newTurnState, userParticipantId)
```

Those two fields were never on the wire. `GET /api/v1/chats/[id]` assembles its
`chat` object field by field — `lastTurnParticipantId`, the impersonation
overlay, `isPaused`, and so on — and neither column appears anywhere in it.
Both read `undefined`, and `calculateTurnStateFromHistory` turns that into:

```ts
state.cycleOrder = parseCycleOrder(undefined)      // []
// spokenThisCycleParticipantIds falsy → spokenSinceUserTurn stays []
```

An empty rotation and an empty spoken-set are **exactly what a brand-new chat
looks like**, so `selectNextSpeaker` skipped step 2 — follow the rotation drawn
for this cycle — every single time, and fell through to step 3: a weighted
random pick over every seat except the last speaker. The rotation the server
had drawn and persisted specifically so that *"every reader gets the same answer
and nobody re-rolls a turn that was already decided"* (`cycle-order.ts`) was the
one thing the client could not see.

In the reported room that is four eligible seats, three of them LLMs, so most
rolls landed on an LLM. Then Bug 146's `resolveFloorSeatId` did the right thing
with a wrong input: the roll was not a user-driven seat, so it fell back to the
composer's seat — Leilani — and the banner read *"Speaking as Leilani — type, or
skip to let someone else take the floor."* Skip passed Leilani. Both reports are
that sentence, read as a prompt.

**The comment that encoded the false assumption** sits on the pause itself
(`orchestrator.service.ts`): *"The client's own recompute (from the freshly-saved
history) lands on the same seat; the event settles its streaming state and
refreshes the banner immediately."* The first half was not true and could not be:
history alone does not carry the rotation.

### The second, quieter symptom

`computePredictedTurnOrder` reads the same two values off `turnState`
(`turn-order.ts:137,146`). With both empty, the participant sidebar's "still to
come" ordering fell back to its pre-rotation talkativeness guess, and **no seat
was ever marked `spoken`** — the status exists and was unreachable. That had been
the case since the rotation was introduced, silently, because a plausible-looking
order is indistinguishable from the real one at a glance.

## Why it survived

Three things hid it.

**The types permitted it.** The client's `Chat` declares both fields *optional*
(`app/salon/[id]/types.ts:245,247`), so the route omitting them is not a type
error anywhere — the same shape of hole as bug 114's nullable-not-optional read.
Nothing connects the route's hand-built response to the type the client expects.

**The fallback is a plausible answer, not a failure.** Step 3 is the real
pre-rotation algorithm and returns a legitimate-looking seat, drawn from the
right weights. It is wrong only by *disagreeing* with a decision already made
elsewhere, and there is no assertion anywhere that the two agree.

**The disagreement is usually invisible.** Every path that actually *moves* the
conversation — the orchestrator's chain, `?action=turn`, the skip — is
server-side and used the real rotation. The client's answer only surfaces in the
banner and the sidebar, and only until the next round trip overwrites it. It
took a room where the human drives two seats for a wrong answer to cost
anything, and Bug 146's fix removing the older mislabelling for the local
answer to become the visible one.

## The fix

Send the two columns. They are the inputs to a computation the client already
performs; withholding them does not make it ask the server instead, it makes it
guess.

Send them as the stored JSON strings, not re-encoded arrays: the column *is* the
shape `parseCycleOrder` and `calculateTurnStateFromHistory` take, and a second
shape of the same fact on the wire is how the two drift. Default a missing
column to `'[]'`, never `undefined` — undefined is the state this bug was made
of.

Then close the same omission in `TurnActionResponse.state`, which declared only
`queue` and dropped the `cycleOrder` the turn route already sends.

## Verification

In a multi-character chat mid-cycle:

1. Read `cycleOrderParticipantIds` off the row, then `GET /api/v1/chats/<id>`.
   The field must be present and identical.
2. Post as one seat the human drives in a room where they drive two. The banner
   must name the *other* seat, matching `[TurnFairness]`'s `nextSpeakerId` in the
   log, and one Skip must hand the floor to an LLM.
3. The participant sidebar must mark the seats that have already spoken this
   cycle, and order the rest by the stored rotation rather than by talkativeness.

## Known residue

`turnState.queue` is still never seeded from the row on load:
`calculateTurnStateFromHistory` takes no queue argument, and the client learns
the queue only from a turn action's response. So a reload forgets a queued seat
until the next round trip, and the local projection ignores it — the same class
of blindness as this bug, narrower in effect (step 1 of `selectNextSpeaker`
rather than step 2) and not part of either report. Fixing it means giving the
reader a `turnQueue` parameter and projecting that column too.
