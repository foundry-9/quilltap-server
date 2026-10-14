# Bug 131 — a character you drive yourself is weighted at the default in the speaking order, whatever its talkativeness says

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-09) |
| **Found** | 2026-09-09 |
| **Fixed** | 2026-09-09 |
| **Severity** | Low-Medium (nothing is lost or corrupted, and a per-chat talkativeness override on the seat still works — but a documented control silently does nothing, and the mis-weighting now governs a whole cycle's rotation rather than one pick) |
| **Who it bites** | Anyone in a multi-character chat who drives a character themselves — an owned seat or an impersonated one — and has set that character's talkativeness away from 0.5. Also anyone whose user-driven seat plays an archived character, which was never filtered out of the rotation |
| **Provenance** | Found 2026-09-09 by inspection, reviewing the call sites of the `resolveCycleOrder` chokepoint added the same day (86d59660c, "Draw a multi-character chat's speaking order once per cycle"). Not a regression from that work — the one-at-a-time `selectNextSpeaker` it replaced read the same map and had the same blind spot — but the cycle-order change is what made it worth chasing: the weights now decide a whole rotation at once instead of a single pick |
| **Defect site** | Six server paths each built their own `characterId → Character` map immediately before asking who speaks next, and four of them built it from `getActiveCharacterParticipants` (`lib/chat/turn-manager/utils.ts`) — which, despite the name, is a `@deprecated` alias for `getActiveLLMParticipants` and returns `controlledBy === 'llm'` seats only. The four: `lib/services/chat-message/turn-orchestrator.service.ts` (`shouldChainNext`), `lib/services/chat-message/message-finalizer.service.ts`, `app/api/v1/chats/[id]/actions/turn.ts`, `lib/background-jobs/handlers/autonomous-room-turn.ts`. A fifth, `lib/services/chat-message/participant-resolver.service.ts`, built its map from `llmCandidates` — correct for the pick it then makes, wrong for the room-wide draw it feeds first. Only `lib/services/chat-message/orchestrator.service.ts` built it over the whole room |
| **Fix site** | `loadRoomCharacters` (`lib/chat/turn-manager/room-characters.ts`) is now the one way a turn path builds that map. It reads `getPresentCharacterSeats` — every present character seat, whoever drives it — through a single batched `repos.characters.findByIds`. All six selection sites call it, as does `loadAllParticipantData` (`participant-resolver.service.ts`), which built the same map by hand for prompt construction |
| **v5 status** | Not investigated. **The shape applies** wherever a port keeps two accessors for "the characters in this room" that differ only in whether the human's own seats are included, and a deprecated one is named as though it were the general case. The port should carry the single accessor, not the pair |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-09).** One helper builds the room's character map, over
every present seat rather than the LLM-controlled ones, and every turn path
calls it. The batched read it uses is also fewer queries than the per-seat loops
it replaces, and degrades where they threw.

## Symptom

Set a character you drive yourself to a talkativeness of 0.9 and it comes up no
more often than one set to 0.1. The slider moves, the value is stored on the
character and shown in the UI, and the rotation ignores it. A per-chat
talkativeness override on the *participant* row still works, which is what makes
this easy to miss: the control appears to work in exactly the place someone
would first try it.

`help/chat-turn-manager.md` has always promised the opposite:

> Talkativeness applies to user characters too — a chatty user character will
> come up more often than a quiet one

Two smaller symptoms fall out of the same cause:

- An **archived** character on a user-driven seat is never dropped from the
  rotation. `cycleCandidates` and `selectNextSpeaker` both decide that from
  `characters.get(id)?.archivedAt`, and the seat is not in the map to be asked
  about.
- `GET /api/v1/chats/[id]?action=turn` answers `nextSpeakerName: null` and
  `participant.name: "Unknown"` whenever the rotation lands on a user-driven
  seat, because the route reads names out of that same map.

## Root cause

Both readers of the map take the character's talkativeness as a fallback behind
the per-chat override, and default when neither is present.
`drawCycleOrder` (`lib/chat/turn-manager/cycle-order.ts`):

```ts
const weightOf = (p: ChatParticipantBase) =>
  p.talkativeness ?? characters.get(p.characterId!)?.talkativeness ?? 0.5;
```

`pickWeighted` (`lib/chat/turn-manager/selection.ts`) is the same expression.
Neither is wrong. The map handed to them was.

`getActiveCharacterParticipants` reads as "the character participants that are
active", and its own docblock says otherwise:

```ts
/**
 * Gets all active character participants.
 * @deprecated Use getActiveLLMParticipants for proper controlledBy support
 */
export function getActiveCharacterParticipants(participants: ChatParticipantBase[]) {
  // For backwards compatibility, this now returns LLM-controlled participants
  return getActiveLLMParticipants(participants);
}
```

Four of the six paths that build the map looped that list and called
`repos.characters.findById` per seat. A user-driven seat is not in the list, so
its character is not in the map, so `characters.get(...)` misses and the
expression falls through to `?? 0.5`.

The seat is still *in the rotation* — `cycleCandidates` and `selectNextSpeaker`
both derive their candidates from the participants array, not from the map, and
`cycleCandidates` deliberately keeps a seat whose character is missing:

```ts
// An unknown character (not in the map) is kept: the map is built from a
// best-effort read, and dropping a seat over a failed lookup would silently
// shrink the room. Only a *known* archived character is excluded.
```

So the human's seat takes its turn as it always has. It is only ever weighted
wrong.

## Why it survived

The two questions were asked in two places. "Who is in this room?" was answered
by the participants array, correctly, at the point of selection. "How talkative
is each of them?" was answered by a map built a few lines earlier, by each call
site, from a narrower list — and nothing ever compared the two. A seat present
in one and absent from the other produces no error, no log line, and no missing
turn: it produces a slightly different probability, which is indistinguishable
from chance in any single conversation.

The naming did the rest. Four call sites reached for the function called
`getActiveCharacterParticipants` to answer "which character seats are active",
which is precisely what its name claims and not what it does. Its `@deprecated`
tag points at `getActiveLLMParticipants` — the *same* behaviour under an honest
name — so following the deprecation would not have surfaced anything either.

Six hand-rolled copies of the loop is the structural half. `cycleCandidates`
documented an assumption about its input ("the map is built from a best-effort
read"), but no single place was responsible for building the map to match it.

## The fix

`lib/chat/turn-manager/room-characters.ts`:

```ts
export async function loadRoomCharacters(
  repos: RoomCharacterRepos,
  participants: ReadonlyArray<ChatParticipantBase>,
  options?: LoadRoomCharactersOptions,
): Promise<Map<string, Character>>
```

Built over `getPresentCharacterSeats` — the existing one predicate for "who is
in the scene", which the rotation itself already uses — so the map and the
candidate list are drawn from the same source. `preloaded` seeds a character the
caller already holds (the finalizer's just-spoken character, the responding
character in `loadAllParticipantData`) over the batch read.

`cycle-order.ts`'s module docblock now names the helper and says why
`getActiveCharacterParticipants` is the wrong input, so the next path to ask
this question does not rebuild the narrow map.

Two things came free with the batching:

**It is fewer queries.** `repos.characters.findById` overlays one character's
vault through `loadVaultFileMaps([oneMountId])`
(`lib/database/repositories/vault-overlay/read-overlay.ts`), which issues nine
single-file queries plus two folder listings — about twelve queries per seat.
`findByIds` overlays the whole room in one pass: one `IN(...)` row query and one
batch of vault queries, whatever the seat count. A four-seat room goes from
roughly 48 queries per selection to 12, on a path that runs several times a turn.

**It degrades where the loops threw.** `applyDocumentStoreOverlayOne`, behind
`findById`, throws `CharacterVaultUnavailableError` when a character's vault is
unreadable; the batched `applyDocumentStoreOverlay`, behind `findByIds`, logs
and drops. The old loops therefore threw straight out of speaker selection — and
out of the read-only `?action=turn` request behind the participant sidebar — over
one shelved vault. Dropping is what `cycleCandidates` was already written for.

## How to verify

`__tests__/unit/lib/chat/turn-manager/room-characters.test.ts` pins the
behaviour. The load-bearing case is
`"counts a user seat's talkativeness in the rotation draw"`, and it has to
measure a **difference** rather than an absolute rate: against two LLM seats at
0.98, a user seat weighted at the 0.5 default already leads about a fifth of
cycles, which a single-run threshold would happily accept. So it draws 300
cycles with the user seat at 0.98 and 300 with it at 0.02 and requires the loud
run to lead at least five times more often than the quiet one. Under the old map
both runs are weighted 0.5 and come out the same.

Restoring the old behaviour — filtering `loadRoomCharacters`'s seats back down to
`controlledBy === 'llm'` — fails four of the eleven cases in that file, including
that one and `"excludes a user seat whose character is archived"`.

By hand, in a chat with two LLM characters and one you drive:

1. Set both LLM characters' talkativeness to 1.0 and your own character's to
   0.05.
2. Send a message and let several cycles wrap.
3. Your seat should now open a cycle only rarely. Before the fix it was drawn at
   0.5 against their 1.0 apiece and opened roughly a fifth of them — and did so
   identically whatever you set your character to.

`state.cycleOrder` in the `?action=turn` response shows the drawn rotation
directly, which is the quickest read on whether a weight took effect.
