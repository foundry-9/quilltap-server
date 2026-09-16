# Bug 146 — the turn banner passes the composer's seat, not the seat holding the floor

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-15)** |
| **Found** | 2026-09-15 (Friday, chat `08b7635c` — *Sky-Ship at the Copper Quarter*; the operator reported "I took a turn as Helene, and then it immediately prompted me to take another turn as Helene") |
| **Fixed** | 2026-09-15 |
| **Severity** | Medium — no data loss, but the banner states something false about whose turn it is, costs the operator a wasted pass, and writes a Host turn-pass record for a seat that never held the floor. The false record then feeds the stall guard and every reader of the transcript, models included |
| **Who it bites** | anyone driving **two or more seats** in one room — their own character plus a summoned or impersonated one, or two owned characters. Exactly the configuration `[TurnFairness]` was built for |
| **Provenance** | v4-only, in the Salon client. The turn engine is correct throughout; nothing in `lib/chat/turn-manager/` computed a wrong speaker |
| **Defect site** | `app/salon/[id]/SalonView.tsx` — the Skip banner resolved its seat as `speakingSeat` (the composer's `activeTypingParticipantId`), and passed `seat.id` to `handleSkipUserTurn` |
| **Fix site** | `lib/chat/turn-manager/utils.ts` — new `resolveFloorSeatId`, the one predicate for "which seat is this banner about"; consumed by the banner in `SalonView.tsx` |
| **v5 status** | **Not yet assessed.** v5's `salon-conversation.ts` resolves `activeSpeakerId` (the speaking-as selection) with no coupling to the turn query — the same decoupling that produced this. If the port grows a pass affordance it must key it to the floor, not to the speaker selection |
| **Index** | [bugs.md](../../bugs.md) |

---

## FIXED in v4 (2026-09-15)

Applied as filed. The banner now asks `resolveFloorSeatId` which seat it is
about, instead of assuming the composer's:

```ts
const floorSeatId = resolveFloorSeatId(
  turnSelectionResult?.nextSpeakerId,
  participantsWithImpersonation.participantsAsBase,
  impersonation.impersonatingParticipantIds,
  speakingSeat?.id ?? null,
)
```

The rotation's seat wins whenever it is one the human drives; the composer's
seat is kept only when the floor belongs to nobody the human drives — an LLM is
next, or there is no selection yet — which is precisely bug 123's off-turn
affordance and is left intact. The must-speak guard and the Skip POST both
follow the same seat, so the client and the server now agree about *which* turn
is being passed as well as about whether it may be.

One wording case is new. When the floor is the human's but the composer is
pointed at a different seat of theirs, the banner says so rather than inviting
words that would post in the wrong voice:

> Charlie's turn — switch the speaker to them to type, or skip to let someone else respond.

That state is reachable two ways: a reload (the Bug 49 turn-follow is a
client-side default and is not persisted, so `activeTypingParticipantId`
restores the last *deliberate* choice) and a same-turn SpeakerSelector pick,
which Bug 49 deliberately lets win.

### Verification

`__tests__/unit/lib/chat/turn-manager/floor-seat.test.ts` — seven cases on the
new predicate, built on the room that produced the report (two user-driven
seats plus an LLM). The load-bearing one fails against the old behaviour:

| Floor | Composer | Banner acts on |
|---|---|---|
| Charlie (user) | Helene (user) | **Charlie** — was Helene |
| Wahno (LLM) | Helene | Helene — unchanged (bug 123) |
| none yet | Helene | Helene — unchanged |
| Lorian (impersonated) | Charlie | **Lorian** — the overlay, not `controlledBy` |
| a removed seat | Helene | Helene — stale ids fall back |

`npx tsc` clean; the six turn-manager suites (173 tests) pass unchanged.

---

## Original filing (2026-09-15)

## Symptom

In a six-seat room the operator drove two seats: their own **Charlie**, and
**Helene**, summoned mid-scene and added as a user-driven seat. They posted as
Helene. The Salon immediately asked them for another turn — apparently as
Helene again. They pressed Skip, and only then were they shown Charlie's turn,
which they also passed.

The transcript records both passes, two seconds apart:

```
23:19:36.456  USER      participantId d3031a6b   (Helene — the post)
03:23:59.063  host turn-pass  "Helene declining the floor"
03:24:01.075  host turn-pass  "Charlie declining the floor"
03:24:01.120  Selected responding character: Lost+Severed (Wahno)
```

The first of those records is false. Helene had just spoken; she was not
holding the floor and had nothing to decline.

## Root cause

The rotation was right. The server's own log, from the post:

```
23:17:45.808  [Chats v1] Participant added   Helene   controlledBy: "user"
23:19:36.470  [TurnFairness] User post pauses for another user-driven seat
              poster: d3031a6b (Helene)  →  nextSpeakerId: 35ff9c3f (Charlie)
```

`pauseForOtherUserDrivenSeat` (`lib/services/chat-message/orchestrator.service.ts`)
did exactly its job: with two seats the human drives, a human post does not
conscript an LLM to answer — the floor goes to the *other* seat the human
drives, and the chain pauses there. Charlie had not spoken this cycle; Helene
had joined at the back of the rotation. Helene → Charlie was correct, and
`lastTurnParticipantId` was persisted as Charlie.

The client then asked the wrong question. The banner resolved its subject as the
**composer's** seat:

```tsx
const seat = speakingSeat                        // = activeTypingParticipantId
const isSeatsTurn = turnSelectionResult?.nextSpeakerId === seat.id
...
onClick={() => turnManagement.handleSkipUserTurn(seat.id)}
```

`speakingSeat` is `findActiveUserParticipant(...)` over
`activeTypingParticipantId`, which the impersonate action had persisted as
Helene at 23:17:45 and which nothing has moved since — it is *still* Helene on
that row, hours and several turns later, because Bug 49's turn-follow sets only
React state by design. So:

- the banner never named Charlie, whose turn it actually was. At best it read
  *"Speaking as Helene — type, or skip to let someone else take the floor"*,
  which does not distinguish "your turn" from "not your turn";
- Skip passed **Helene**, a turn that was not outstanding. The server accepts
  that — bug 123 deliberately allows an off-turn pass — so it recorded the
  Host announcement, set Helene as `lastSpeakerId`, and picked the next speaker,
  which was Charlie again;
- the banner re-rendered on Charlie, the operator passed a second time, and
  Wahno finally spoke.

Two facts on the chat row make the divergence visible on its own:
`activeTypingParticipantId = d3031a6b` (Helene) beside
`lastTurnParticipantId = 35ff9c3f` (Charlie).

## Why it survived

The two ids agree in every room that has only one user-driven seat, which is
almost every room — and the whole banner predates multi-seat driving. It takes
all three of: a second user-driven seat, the rotation landing on the one the
composer is *not* pointed at, and the operator reaching for Skip rather than
switching the speaker by hand. Bugs 44, 46, 48 and 49 each worked on one facet
of the turn ↔ speaking-as decoupling; this is the facet where a *write* follows
the wrong one of the two, and passes are cheap enough to look like a rough edge
rather than a false record.

The bug 123 comment above the block is also a fair share of the cause: it
established that Skip is offered for the composer's seat *whether or not the
rotation has landed on it*, which is right as an affordance and wrong as an
identity. It left no place for "the rotation has landed on a different seat of
yours".

## The fix

One predicate, shared, so the two questions stop being conflated:

```ts
resolveFloorSeatId(nextSpeakerId, participants, impersonatingParticipantIds, speakingSeatId)
```

The floor wins when there is one the human drives; otherwise the composer's
seat, which preserves bug 123's off-turn pass. It must consult
`isUserDrivenSeat` rather than the bare `controlledBy` column, or an
impersonated seat's turn (durably `'llm'`, Bug 44) would fall through to the
composer and pass the wrong turn again.

Deliberately *not* changed:

- **the server's acceptance of an off-turn skip.** `?action=turn` with
  `skipUserTurn` validating only `isUserDrivenSeat` is bug 123's design; the
  client is what should be sending the right seat.
- **Bug 49's non-persistence.** That filing settled the turn-follow as a
  per-turn presentation default, not a write to the record. Keying the banner
  to the floor makes it correct *without* that write — which is the better fix,
  since it also holds on a fresh load before any follow has fired.

## Verification

In a room with two seats you drive (your own character plus an impersonated or
summoned one) and at least one LLM:

1. Post as seat A. The chain must pause for seat B — `[TurnFairness] User post
   pauses for another user-driven seat` in the log.
2. The banner must name **B**, not A.
3. Press Skip **once**. The Host must record *B* declining, and an LLM must take
   the floor. There must be no pass recorded against A, and no second prompt.

Then reload mid-turn with the composer restored to A: the banner must still name
B and offer to pass B's turn, with the wording that says to switch the speaker.
