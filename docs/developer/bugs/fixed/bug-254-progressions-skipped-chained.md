# Bug 254 — progressions are never reported on a turn without a new user message

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-18, following up bug 253, which had copied this section's guard |
| **Fixed** | 2026-10-18 |
| **Severity** | Medium. Nothing is stored wrongly, but a character carrying a progression hears about it only on turns that answer a user message. Every chained speaker after the first, every nudge, and every autonomous-room turn runs without the report, so a `turn`-cadence weapon is silent through a whole autonomous run |
| **Who it bites** | characters with progressions in multi-character chats (chained turns), nudged characters, and every autonomous room |
| **Provenance** | Original to the progressions feature (4.10-dev). The design of record wanted the report on chained turns, nudges and autonomous rooms, but also said "skip on `isContinueMode` — the model is finishing its own sentence", and continue mode is exactly those turns |
| **Fix site** | `lib/chat/context-manager.ts` (`buildContext`: `buildProgressionsSection` is called on every turn) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-18).** `buildContext` now builds the progressions section on every turn,
continue mode included. Each progression's own cadence still decides whether a turn mentions it.
Covered by `__tests__/unit/context-management.test.ts` (*reports progressions on a continue-mode turn
(bug 254)*), which fails against the old guard.

## Symptom

Give a character a `turn`-cadence progression and seat them in a two-character chat. When they answer
the user, the request carries the progression report. When they speak second in a chain, or are
nudged, or take any turn in an autonomous room, it does not. The `[Progressions]` debug lines for those
turns never appear.

## Root cause

`buildContext` (`lib/chat/context-manager.ts`) wrapped `buildProgressionsSection` in
`if (!isContinueMode)`, with a comment saying "the model is finishing its own sentence". Nothing in
Quilltap finishes a sentence. `continueMode: true` is how every turn without a new user message is
sent: the turn chain's `processChainedMessage` (`turn-orchestrator.service.ts`), the Salon's Continue
and Nudge (`useSSEStreaming.ts`, `buildContinueMessageOptions`), and the autonomous-room turn handler.
The design of record (`features/complete/character-progressions.md`) listed "no new user message
(chained autonomous turns, nudges)" and "autonomous rooms" as places the section goes, then listed
continue mode as a place it skips. The second rule silently cancelled the first two.

## Why it survived

The trailing-section tests ran turns with and without a new user message, but never set
`isContinueMode`, so they exercised a combination the app does not produce. The live verification
step that checks an autonomous room was not run against the guard.

## The fix

Drop the guard. The section is a pure read; a character with no progressions still costs no history
read, because the event list is passed as a thunk.

The Aurora Core whisper keeps its own continue-mode skip. Unlike this section's, that one is
deliberate: `isContinueMode`'s doc said from the start that it covers nudges and chained autonomous
turns and exists so the Core whisper can skip them. The doc comment is reworded to say plainly what
continue mode is.

## How to verify

Give a character a progression with `reportFrequency: "turn"` in an autonomous room (or a
two-character chat, letting the chain run). Every `CHAT_MESSAGE` request for that character carries
the report:

```sql
SELECT createdAt, instr(qt_text(request), '<progression name>') > 0
FROM llm_logs WHERE chatId = '<chat>' AND type = 'CHAT_MESSAGE' ORDER BY createdAt;
```
