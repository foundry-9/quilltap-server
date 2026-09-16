# Bug 146 — the turn banner passes the composer's seat, not the seat holding the floor

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-15)** — but insufficient on its own; the recurrence it failed to stop is [Bug 147](bug-147-chat-get-omits-the-rotation.md). See *Addendum* |
| **Found** | 2026-09-15 (Friday, chat `08b7635c` — *Sky-Ship at the Copper Quarter*). **Seen again 2026-09-16** in chat `e59f8969` — *Breakfast at the Edge of the Weave* — twice in seven minutes, on an impersonated seat rather than a summoned one; see *Second sighting* |
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

## Addendum (2026-09-16) — this fix was necessary but not sufficient; see Bug 147

The fix above landed, shipped as 4.10.0-dev.40, and **the symptom recurred on
that build**: impersonate a seat, answer as it, be prompted for it again. The
filing's account of the banner is correct and the fix is kept — but it named the
wrong layer as the whole cause.

`resolveFloorSeatId` keys the banner to `turnSelectionResult.nextSpeakerId`, on
the stated assumption that the client's local recompute agrees with the server.
It did not. `GET /api/v1/chats/[id]` was not sending the Salon the two columns
its recompute reads, so `selectNextSpeaker` could never follow the drawn
rotation and re-rolled a weighted pick every time — usually landing on an LLM
seat, at which point `resolveFloorSeatId` correctly falls back to the composer's
seat and the banner names it again. Right rule, garbage input. Full account:
[Bug 147](bug-147-chat-get-omits-the-rotation.md).

What this filing still owns, and what it got wrong:

- **Owns:** when the client's answer *is* a seat the human drives, the banner
  and Skip must follow the floor rather than the composer. That was a real
  defect on its own, it is fixed, and it is what makes the corrected input
  produce a correct banner.
- **Wrong:** the claim that the two sightings were fully explained by the
  banner's seat resolution. The first (Helene) forensics could not reconcile
  "the client should compute Charlie" with the observed pass of Helene, and the
  filing let that stand as unresolved detail rather than treating it as the
  contradiction it was. It was the tell for Bug 147.

---

## Second sighting (2026-09-16) — chat `e59f8969`, *Breakfast at the Edge of the Weave*

Reported independently, the day after the filing and before the fix had reached
the instance: *"I turn on impersonate for Leilani, answered as her, then it
immediately prompted me for her again."* Same defect, different route in — the
first sighting was a **summoned** seat added with `controlledBy: 'user'`, this
one an existing **LLM** seat taken up by impersonation, whose `controlledBy`
stays `'llm'`. The two reach the banner by different halves of
`isUserDrivenSeat`, which is worth knowing: a fix that read the column alone
would have closed the first and left this one open.

This transcript is the cleaner record of the two — the first chat was rewound
afterwards, so its cycle columns no longer describe the moment. Here the floor
decision is logged twice, identically:

```
11:14:40.762  [TurnFairness] User post pauses for another user-driven seat
              poster: 2c91e03b (Leilani, impersonated)  →  nextSpeakerId: f08a46e0 (Charlie)
11:21:01.832  [TurnFairness] User post pauses for another user-driven seat
              poster: 2c91e03b (Leilani, impersonated)  →  nextSpeakerId: f08a46e0 (Charlie)
```

The first one cost the operator the full double pass, nine seconds apart:

```
11:14:40  USER            2c91e03b   (Leilani — the post)
11:14:49  host turn-pass  "Leilani declining the floor"
11:14:59  host turn-pass  "Charlie declining the floor"
11:15:16  ASSISTANT       788b657a   (Baraka)
```

The second they worked around instead of passing: at 11:23:26 they typed as
Charlie by hand — which is the seat the floor had been waiting on all along, and
is the manual version of what the fix now says out loud.

**What it adds to the diagnosis.** Nothing contradicts the filing; two things
confirm it. The owner seat and the impersonated seat are interchangeable in the
symptom, so the defect is in *which question the banner asks*, not in either
seat's provenance. And with an impersonation running, **every** turn of the
taken-up seat is followed by a turn of the owner seat — that is `[TurnFairness]`
working, not failing — so the mislabelling fired on every one of them rather
than being the one-off a summoned latecomer made it look like.

**Verified against the fix** (`resolveFloorSeatId(charlie, …, ['leilani'], leilani)`
→ `charlie`), and pinned as its own case in the suite so this route stays closed
alongside the first.

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
