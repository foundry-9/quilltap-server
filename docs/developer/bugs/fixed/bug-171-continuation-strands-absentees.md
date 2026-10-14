# Bug 171 — Continue Elsewhere leaves the cast talking to people who stayed behind

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-25)** |
| **Found** | 2026-09-25, live on `Friday`: the autonomous room "The Coat That Hasn't Spoken", continued from "The Cottage Answers First", spent 16 of its turns addressing Charlie, who was seated in the source chat and not in the room |
| **Fixed** | 2026-09-25, v4.10-dev |
| **Severity** | Medium. A whole run can go to waiting on someone who cannot answer. The cast reads the silence as a character choice ("you're the only one in this room who hasn't answered anything for an hour") and builds the scene around it |
| **Who it bites** | anyone who uses **Continue Elsewhere** without bringing the whole cast, most often when handing a Salon chat off to an autonomous room, which requires dropping the operator's own character |
| **Provenance** | Original to v4. The carryover has dropped absentees' lines since Continue Elsewhere shipped (`134871df2`, 2026-05-05). Nothing ever said who was missing |
| **Defect site** | `lib/chat/apply-chat-continuation.ts:187` (`projectMessageForNewChat` drops the absentee's lines) together with `applyChatContinuation`, which posted no notice |
| **Fix site** | `lib/chat/apply-chat-continuation.ts:101` (`findLeftBehindCharacters`) and `:385` (the notice). `lib/services/host-notifications/writer.ts` (`OffSceneIntroductionReason`, `'left-behind'` wording) |
| **v5 status** | Unchecked. The v5 continuation should name left-behind participants the same way |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-25).** After replaying the carryover, `applyChatContinuation` finds every
source-chat participant (any status but `removed`) whose character is not seated in the new chat. It
posts one Host notice naming them as having remained behind: not in the room, unable to hear, unable to
answer. The notice goes through `postHostOffSceneCharactersAnnouncement` with `reason: 'left-behind'`.
It uses the `off-scene-characters` kind and stamps `introducedCharacterIds`, so the per-turn off-scene
scan does not introduce the same people again. Pinned by
`__tests__/unit/lib/chat/apply-chat-continuation.test.ts`.

## Symptom

Continue a chat elsewhere and leave one character out of the new cast. In the new chat, the others keep
talking to the missing character as if they were in the room and had gone quiet. In the `Friday` case the
first character turn put Charlie "in his tailcoat" in the new room. Later turns scolded him for not
answering.

## Root cause

`projectMessageForNewChat` (`lib/chat/apply-chat-continuation.ts:187`) drops any carried message written
by a participant whose character is not in the new chat. It keeps every other message, including the
Librarian summary and the remaining cast's lines addressed to that character. So the new chat's history
shows someone being spoken to who never replies. The only Host message about the move said "The thread
that brought us here is preserved below. Carry on."

The per-turn off-scene introduction could not help:

- It skips anyone seated in the chat, and the absentee was not seated in the new chat, so that check
  would have allowed them.
- But when the absentee was the operator's persona, the introduction also skipped them by name. That is
  bug 172.
- Even for anyone else, the introduction only says "spoken of … not presently in the Salon". It does not
  explain why the transcript shows them there.

## Why it survived

Continue Elsewhere was designed for moving the *whole* company, and its tests covered the
remapping of turn state and participant IDs. Dropping the absentee's lines was the deliberate, correct
choice. The consequence of keeping everyone else's remarks to them was never considered.

## Fix

- `findLeftBehindCharacters` compares the two casts by `characterId` and loads each absentee's card.
  - A vault that cannot be read is skipped with a warning.
  - It skips the operator's persona when `isUserPersonaInRoom` says the persona is still in the new room,
    i.e. a Salon chat, where the unseated persona voices the operator's messages.
- The notice is posted after the carryover, so it is the last thing the cast reads before the new scene.
- `buildOffSceneCharactersContent` / `…OpaqueContent` take a `reason` argument, default `'mentioned'`.
  The left-behind wording says plainly that the person cannot hear or answer.

## How to verify

1. In a chat with three characters, press **Continue Elsewhere** and drop one of them.
2. The new chat shows a Host notice after the carried messages, naming the dropped character as having
   remained behind.
3. Mention the dropped character in the new chat. No second "begs leave to introduce" card appears.
4. `npx jest __tests__/unit/lib/chat/apply-chat-continuation.test.ts __tests__/unit/lib/services/host-notifications-phase-c.test.ts`
