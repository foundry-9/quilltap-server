# Bug 253 — the carried-objects section is left out of every turn without a new user message

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-18, dogfooding the Inventory against `V4test` and reading the chat's LLM logs |
| **Fixed** | 2026-10-18 |
| **Severity** | Medium. Nothing is stored wrongly, but a character is told what they carry only on the one turn that answers a user message. Every later speaker in a chain, every Nudge, and every autonomous-room turn runs without the section, so the model has no idea what anyone carries for most of a multi-character scene |
| **Who it bites** | anyone with Inventory objects carried in a multi-character chat (chained turns), anyone who nudges a character, and every autonomous room |
| **Provenance** | New with the Inventory (4.11-dev). The section's guard copied the progressions section's `!isContinueMode`, whose comment reads continue mode as "the model is finishing its own sentence" |
| **Fix site** | `lib/chat/context-manager.ts` (`buildContext`: `buildInventorySection` is called on every turn) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-18).** `buildContext` now builds the carried-objects section on every turn,
continue mode included. The section is a pure read with no cadence, so nothing argues for skipping it.
Covered by `__tests__/unit/context-management.test.ts` (*carries the Inventory on a continue-mode
turn*), which fails against the old guard.

## Symptom

In a two-character chat, give one character a described object and send a message. The first
responder's request ends with `## Carried and equipped` and the object's description. The second
character, chained after it, gets no such section, and nor does any later turn in the chain. A Nudge
does not get it either. In `V4test`, chat `6999f829…`: the section is present in the six requests of
Lorian's first (tool-loop) turn and absent from all seven chained requests after it, though both
characters carried a described coin purse throughout. The `[InventorySection] Built the
carried-objects section` debug line never fires for those turns.

## Root cause

`buildContext` (`lib/chat/context-manager.ts`) wrapped the call in `if (!isContinueMode)`, with a
comment saying the section was "skipped in continue mode with the progressions, for the same reason".
The progressions comment gives that reason as the model "finishing its own sentence". But
`continueMode: true` is what every turn without a new user message is sent with: the turn chain's
`processChainedMessage` (`turn-orchestrator.service.ts`), the Salon's Nudge
(`useSSEStreaming.ts`), and the autonomous-room turn handler. So "continue mode" covered most of the
turns where the section matters.

## Why it survived

The unit tests built the section on a turn with a new user message and checked the order of the
trailing sections on a turn without one, but no test set `isContinueMode`. A live single-character
chat, where every turn answers the user, never shows the gap.

## The fix

Drop the guard: `buildInventorySection` runs on every turn. It still returns nothing (and costs no
pool read) when the character carries nothing, so a turn with empty pockets is unchanged.

The progressions section had the same guard, and the same defect; it is bug 254, fixed the same day.

## How to verify

Seat two characters with described carried objects, send one message, and let the chain run. Every
`CHAT_MESSAGE` request in the LLM logs for the chat contains `## Carried and equipped`:

```sql
SELECT createdAt, instr(qt_text(request), '## Carried and equipped') > 0
FROM llm_logs WHERE chatId = '<chat>' AND type = 'CHAT_MESSAGE' ORDER BY createdAt;
```
