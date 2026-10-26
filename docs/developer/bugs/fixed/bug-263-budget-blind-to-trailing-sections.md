# Bug 263 — the history budget cannot see the trailing sections, so a full context goes out over its own ceiling

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-26, while refactoring the context manager (code reading, not a user report) |
| **Fixed** | 2026-10-26 |
| **Severity** | Medium. The payload overshoots `safeInputLimit` by the size of everything trailing it — enough to trip the pre-send "Context may exceed" warning on a context packed exactly as instructed, and on a small window enough for a provider to reject the request or silently truncate it |
| **Who it bites** | anyone whose history is long enough that the remaining-budget term, not the recent-messages share, decides how much history rides: small windows (local models, 8–32k profiles), large characters, and turns with a bulky Core packet, knowledge recall, Inventory or referent ledger |
| **Provenance** | The budget was written when memories and the summary lived in the system prompt. As each of them moved to a trailing section on the new user message — recall and the scene state as the Commonplace Book's text, knowledge, Aurora's Core whisper, mail, progressions, the Inventory, the referent ledger and closing echo, the turn notes — none was added to the subtraction. The inform block was (bug 151's lesson), and was the only one |
| **Fix site** | `lib/chat/context-manager.ts` (`buildContext`: the whispers and trailing sections are built before history is packed, and measured) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-26).** `buildContext` now builds every part of the request before it packs
history: system blocks 1–3, the Host's timestamp line, and the whole trailing message — the new
user message with every trailing section — plus room for the chained-turn scene note. History gets
`safeInputLimit` less all of that and less the caller's `reservedOutgoingTokens`, so the assembled
payload lands under the ceiling the pre-send check holds it to. `tokenUsage.total` now counts
everything in `messages`.

Test: `__tests__/unit/context-management.test.ts`, "the history budget (bug 263)" — an 8k window,
120 rows of history and a bulky Inventory section; the payload is measured message by message and
must fit `safeInputLimit`, with fewer history rows than the same turn without the section. Not yet
verified live.

## Symptom

On a turn whose history is long enough to fill the window, the debug log shows `Context exceeds
model safe input limit, payload may be rejected` and the Salon shows "Context (~Nk tokens) may
exceed … limit", though nothing was added after the context was built. The overage is roughly the
size of the trailing sections: a Core whisper turn, a knowledge-heavy turn or a character carrying
a long Inventory overshoots further than a plain one.

## Root cause

`buildContext` computed the history allowance as

```
remaining = safeInputLimit − (system prompt + compressed history + recap + memories + inform)
            − reservedOutgoingTokens
```

and packed history into `min(remaining, recentMessagesBudget)`. The trailing message it then
assembled also carried the scene state, knowledge, the Core whisper, mail, progressions, the
Inventory, the referent ledger, the closing echo, the turn notes and the storyteller section — and
the new user message itself — none of which was in the subtraction. Neither was system block 2
(the identity reinforcement) or the Host's timestamp line. Most of those sections were built only
*after* history had been selected, so there was nothing to measure at that point.

## Why it survived

The recent-messages share (40–60% of the window) usually binds first, and the 10% safety margin
absorbs a small overshoot. The overshoot needs the remaining-budget term to bind, which takes a
small window or a large fixed load. When it does fire, the warning reads like a provider-size
problem, not a budgeting one.

## The fix

The phases were reordered so the Staff whispers and trailing sections are built before history
selection — none of them depends on which history rides, except the scene note, whose room is
reserved at its size over the whole history and which is then built for the window. Posting order
in the transcript is unchanged.

## How to verify

1. Use a connection profile with Max Context 8192 and a chat long enough to fill it.
2. Give the responding character a long Inventory section or enable the Core whisper.
3. Send a message. The log's `Context exceeds model safe input limit` warning no longer appears,
   and the debug panel's token total is at or under the safe input limit.
