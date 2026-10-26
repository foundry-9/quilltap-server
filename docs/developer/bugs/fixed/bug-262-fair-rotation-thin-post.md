# Bug 262 — a post that hands the floor to another user-driven seat is recorded without its tool results, dice or Pascal triggers

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-25, while refactoring the Salon turn pipeline (code reading, not a user report) |
| **Fixed** | 2026-10-25 |
| **Severity** | Medium. Staged tool results are lost outright; dice the operator typed are never rolled; Pascal's trigger phrases and the Librarian's note of image uploads never fire. Only in one kind of room, but silently |
| **Who it bites** | an operator who drives two or more seats in one chat (a persona plus an impersonated or user-controlled character) and posts when the rotation's next speaker is another of their own seats |
| **Provenance** | The fair-rotation pause (bug 50) persisted the operator's message with its own hand-rolled `addMessage`, written beside the main path rather than through it. Each feature added to the main path's post handling since — staged tool results, auto-detected dice, Pascal trigger phrases, the Librarian upload note — went into the main path only |
| **Fix site** | `lib/services/chat-message/operator-post.service.ts` (`recordOperatorPost`, new), `lib/services/chat-message/turn-holds.service.ts` (`maybePauseForUserSeatTurn`, moved from `orchestrator.service.ts`), `lib/services/chat-message/context-builder.service.ts` (`findAttachedFiles`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-25).** Every path that records an operator's post now goes through one
function, `recordOperatorPost` (`lib/services/chat-message/operator-post.service.ts`): a turn about
to be answered, a paused chat holding the post, a storyteller round, and the fair-rotation pause.
It writes, in transcript order, the staged tool results, the auto-rolled dice, the USER row with its
attachment links, the Librarian's upload note and the Concierge's danger flags, then Pascal's
trigger-phrase outcomes and any inline Carina query. The fair-rotation pause (now in
`turn-holds.service.ts`) calls it with the poster's seat and no turn context, since nobody answers
the post this turn. It flips the submission ledger as each write lands, so an error frame reports
staged tool results as saved.

Tests: `__tests__/unit/lib/services/chat-message/operator-post.test.ts` (order, ledger, context
splice) and `__tests__/unit/lib/services/chat-message/turn-holds.test.ts` (the fair-rotation pause
hands the recorder the staged tool results, the attachments and the chat settings). Not yet
verified live.

## Symptom

In a room where the operator drives two seats — say a persona and an impersonated character — the
operator types `I roll 1d20 to pick the lock` with a staged tool result in the composer, and the
rotation's next speaker is the operator's other seat. The message appears and the other seat's turn
banner comes up, but:

- the staged tool result is gone (the composer cleared it on send, and no TOOL row was written);
- no dice roll appears, though the same message posted when an LLM is up next rolls one;
- a custom tool whose trigger phrase the message contains does not run;
- an uploaded image gets no Librarian note, so a later `keep_image` / `attach_image` has no id.

## Root cause

`processMessage` (`lib/services/chat-message/orchestrator.service.ts`) asked the fair-rotation
guard `maybePauseForUserSeatTurn` before it resolved a responder. When the next seat was another
user-driven seat, that function wrote the USER row itself with `repos.chats.addMessage`, linked the
files, ran Carina, and returned. Everything else the main path did for the same post —
`pendingToolResults` as TOOL rows, `detectAndConvertRngPatterns`, `runUserMessageTriggers`,
`postLibrarianUploadAnnouncement` — lived further down `processMessage`, after the point where the
guard had already returned. The main path's comment even noted that the guard "would persist a
thinner copy of the same message", and kept paused chats away from it for that reason.

## Why it survived

The guard only fires in rooms with two or more user-driven seats, and only when the rotation lands
on one of them, so ordinary testing never reached it. The missing writes leave no trace: there is
no error, and the operator sees their message posted.

## The fix

The post handling moved out of `processMessage` into `recordOperatorPost`, and both paths call it.
Danger flags are the one thing the fair-rotation pause still does not attach: the Concierge's
pre-screen classifies against the responder's profile, and this post has no responder.

## How to verify

1. In a chat with an LLM character and two seats the operator drives, set the rotation so the next
   speaker after the operator's persona is the other user seat.
2. Stage a tool result in the composer, attach an image, and send `I roll 1d6` from the persona.
3. The transcript shows the staged TOOL row, the dice roll, the USER message, and the Librarian's
   upload note; the other seat's banner comes up and no LLM answers.
