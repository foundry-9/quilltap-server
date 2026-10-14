# Bug 172 — in an autonomous room, the operator's persona is never introduced as absent

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-25)** |
| **Found** | 2026-09-25, live on `Friday`, tracing bug 171: the Host introduced an absent Aurora in "The Coat That Hasn't Spoken", but never Charlie, though the cast addressed him repeatedly |
| **Fixed** | 2026-09-25, v4.10-dev |
| **Severity** | Medium. In an autonomous room, the character the cast is most likely to talk to — the operator's own — is the one absent person the Host can never flag |
| **Who it bites** | any instance with exactly one user-controlled character, in every autonomous room where the cast mentions that character |
| **Provenance** | Original to v4. The name exclusion in the off-scene scan dates from `fab56c313` (4.3.0); autonomous rooms (4.6) inherited it unexamined |
| **Defect site** | `lib/chat/context-manager.ts:845` (off-scene candidates exclude `userCharacter.name`) fed by `lib/services/chat-message/user-identity-resolver.service.ts:68` (step 2: the sole user-controlled character, seated or not) |
| **Fix site** | `lib/chat/context-manager.ts:845`. `lib/schemas/chat.types.ts:120` (`operatorSpeaksWithoutSeat`). `lib/services/chat-message/user-identity-resolver.service.ts:108` (`isUserPersonaInRoom`) |
| **v5 status** | Unchecked. The v5 off-scene scan should apply the same chat-type gate |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-25).** The off-scene scan excludes the persona by name only where the operator
speaks without a seat. That is every chat type except `'autonomous'`, answered by
`operatorSpeaksWithoutSeat`. A seated persona is still excluded by `characterId`, as before. The new
`isUserPersonaInRoom(chat, identity)` answers the same question for callers holding a resolved identity;
the bug 171 continuation notice is the first. Pinned by `__tests__/unit/context-management.test.ts`
("unseated persona (bug 172)"), which fails when the gate is removed, and
`__tests__/unit/lib/services/chat-message/user-identity-resolver.test.ts`.

## Symptom

In an autonomous room, the cast talks to the operator's character, who is not seated there. The Host
introduces every other absent workspace character named in the conversation, but never this one.

## Root cause

`resolveUserIdentity` resolves the operator's identity in four steps. Step 2 applies when no seat is
user-driven: it picks the only user-controlled character in the whole system, if there is exactly one.
In a Salon chat that is right. The operator's messages are that persona's voice, so `{{user}}` names
them, and they are in the room without a seat.

The off-scene scan in `buildContext` (`lib/chat/context-manager.ts:845`) removes that persona from its
candidates by name, so the Host never introduces "you" as absent. In an autonomous room every seat is a
character and the operator only watches. The step-2 persona there is just a name for `{{user}}`, not
anyone present. The exclusion still applied, so the Host treated the persona as in the room when
nobody was voicing them.

## Why it survived

The exclusion was written for Salon chats, before autonomous rooms existed. Autonomous rooms reuse
`buildContext` unchanged, and no test put a non-seated persona into an autonomous room.

## Fix

- `operatorSpeaksWithoutSeat(chatType)`, beside the other chat-type predicates in
  `lib/schemas/chat.types.ts`, is false only for `'autonomous'`. The name exclusion applies only when it
  is true.
- `resolveUserIdentity` is unchanged, so `{{user}}` still names the persona in autonomous rooms.
  Friday's vaults use `{{user}}` widely, and changing that name would have rewritten every template in
  every room.

## How to verify

1. On an instance with one user-controlled character, start an autonomous room without that character.
2. Have the cast name them. For example, give a scenario that mentions them.
3. The Host posts "begs leave to introduce … not presently in the Salon" for that character.
4. In an ordinary Salon chat without that character seated, mention them. No introduction appears.
5. `npx jest __tests__/unit/context-management.test.ts -t "bug 172"`
