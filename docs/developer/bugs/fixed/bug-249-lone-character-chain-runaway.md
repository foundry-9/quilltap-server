# Bug 249 — A one-character chat with no persona chains the character to the depth cap on every message

| | |
|---|---|
| **Status** | Fixed 2026-10-15 |
| **Found** | 2026-10-15, live on `V4test` while verifying Pascal wardrobe effects |
| **Fixed** | 2026-10-15 |
| **Severity** | Medium — every operator message in such a chat spends about twenty LLM calls (the chain's `maxChainDepth`), and the character carries on a monologue nobody asked for, filling the transcript and the memory pipeline |
| **Who it bites** | any Salon chat with exactly one present CHARACTER seat, LLM-controlled, and no user-controlled seat (the operator speaking as themselves, with no persona). A chat with a persona seat alternates normally |
| **Provenance** | Original to v4. Introduced by `83f4368a8` (2026-05-24, "user-controlled characters take turns in the rotation (Phase 2)"), which rewrote `selectNextSpeaker`'s lone-character branch and dropped its "the only character just spoke and a human is present → user's turn" case |
| **Defect site** | `lib/services/chat-message/turn-orchestrator.service.ts` `shouldChainNext` (took the selector's `only_character` answer as a reason to chain); with `lib/chat/turn-manager/selection.ts:75-81` (lone character returned unconditionally) and `lib/chat/turn-manager/utils.ts:204-208` (`isMultiCharacterChat` is true for any chat with one LLM seat, so the chain loop runs) |
| **Fix site** | `lib/services/chat-message/turn-orchestrator.service.ts` `shouldChainNext` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-15).** `shouldChainNext` now stops with `user_turn` when the selector's answer is
`only_character`, that character is the last speaker, a human is present (not `effectiveAllLLM`), and
the chain is not an autonomous room's (`neverPauseForUser`). The selector is unchanged: "the lone
character could speak next" is still its answer, which the sidebar and the Continue button rely on
and which a genuinely all-LLM chat's monologue keeps using (the all-LLM pause still governs that).
A queued or nudged turn still runs, since the queue is consulted before the selector. Tests:
`__tests__/unit/lib/services/chat-message/turn-orchestrator.test.ts` → `a lone character (bug 249)`.

## Symptom

In `V4test` chat `1497d1b4…` ("The Abracadabra Test": Riya, LLM-controlled, and no persona seat), one
operator message produced twenty consecutive replies from Riya, about ten to fifteen seconds apart,
each answering her own last line, until the log read `chainDepth: 19` and the chain stopped at the
cap. The log shows `[TurnOrchestrator] Chain decision: continue … selectionReason: "only_character"`
at every depth from 0 to 19. It happened twice that day (21:10–21:14 and 21:41–21:45 UTC).

## Root cause

Three things combine:

1. `isMultiCharacterChat` (`lib/chat/turn-manager/utils.ts:204-208`) is
   `userControlled >= 2 || llmControlled >= 1`, so a chat with a single LLM seat counts as
   multi-character and `executeTurnChain` runs its loop after the first reply.
2. `selectNextSpeaker` (`lib/chat/turn-manager/selection.ts:75-81`) returns the lone character every
   time ("monologue / single-speaker chat"), regardless of who just spoke or whether a human is
   present. Before `83f4368a8` it returned `user_turn` when that character had just spoken and a
   user participant id was set; the rewrite removed the case, and the tests were updated to pin
   the new behaviour as deliberate.
3. `shouldChainNext` treated any LLM-controlled answer as "continue". The all-LLM pause cannot help:
   the persona-less operator chains as `'__user__'`, so `hasUserPresence` is true and the chat is
   not counted as all-LLM.

## Why it survived

Most chats have a persona seat. With two CHARACTER seats the selector excludes the last speaker, lands
on the persona (user-driven) and the chain stops. The selector's tests pin the monologue as
intended, and no orchestrator test covered a lone character with a human present.

## The fix

The decision belongs to the chain, not the selector: the selector answers "who could speak next",
the chain answers "should we keep going without the human". See the FIXED paragraph above.

## How to verify

1. `npx jest __tests__/unit/lib/services/chat-message/turn-orchestrator.test.ts`.
2. Live: in a chat with one LLM character and no persona, send one message. The character replies
   once, the log shows `Lone character has answered; floor returns to the operator`, and no
   `Chain decision: continue` follows.
