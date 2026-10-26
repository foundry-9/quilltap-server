# Bug 264 — in a multi-character chat, compressed history still rides verbatim beside its summary

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-26, while refactoring the context manager (code reading, not a user report) |
| **Fixed** | 2026-10-26 |
| **Severity** | Medium. Compression in a group chat saved nothing on history and added its summary on top, so the prompt grew; the model read the same events twice, once summarised and once verbatim |
| **Who it bites** | multi-character chats with context compression on, once the conversation is long enough for budget-driven compression to fire |
| **Provenance** | Compression was written for single-character chats: it cut `existingMessages` to the verbatim window. The multi-character path builds history from `messagesWithParticipants` (for attribution, history access and whisper filtering) and never applied the cut |
| **Fix site** | `lib/chat/context/turn-history.ts` (`turnHistoryRows` / `castHistory`), `lib/chat/context/turn-compression.ts` (`compressTurnHistory` returns `windowStart`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-26).** History compression now returns where the verbatim window starts
(`windowStart`, an index into `existingMessages`), and history selection applies it on both paths.
The multi-character rows are the same sequence as `existingMessages`, so the window is found by
the id of its first row (by index when the rows carry no ids). History access, whisper filtering
and attribution then run on the window.

Test: `__tests__/unit/lib/chat/context/turn-history.test.ts`, "cuts a multi-character history to
the same window". Not yet verified live.

## Symptom

In a group chat with compression on, once compression fires the prompt carries system block 3
("Conversation Context (Compressed Summary of Earlier Messages)") *and* as much verbatim history
as the budget allows, including the turns the summary covers. The token count does not drop when
compression applies; it rises by the summary's size.

## Root cause

`buildContext` (`lib/chat/context-manager.ts`) computed `effectiveMessages` — `existingMessages`
from the window start — when a summary was in force, and used it only in the single-character
branch. The multi-character branch mapped `messagesWithParticipants` whole. Both arrays are built
from the same filtered transcript in `buildConversationMessages`
(`lib/services/chat-message/context-builder.service.ts`), so the cut could always have been
applied; it simply was not.

## Why it survived

Nothing fails. The summary is present, the history is present, the model answers. Only the token
counts, or reading a multi-character prompt next to a single-character one, shows it.

## How to verify

1. In a multi-character chat with compression enabled and a small Max Context, chat until the log
   shows `Budget-driven compression enabled` and a compression result.
2. In the LLM log for the next turn, the messages after system block 3 begin at the compression
   window (the last *window size* messages), not at the start of the chat.
