# Bug 252 — a new-account restore leaves every chat's outfit keyed by the old character ids

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-18, by reading `remapBackupData` beside the outfit-history remap |
| **Fixed** | 2026-10-18 |
| **Severity** | Medium. Nothing is lost from the archive, but after the restore no character is wearing anything in any restored chat, per-chat outfit avatars are gone, and Courier delta checkpoints are lost. The outfit history comes back correctly, so the history and the live outfit disagree |
| **Who it bites** | anyone who restores a backup in new-account mode (fresh ids), or imports a `.qtap` bundle whose characters land under different ids (an existing match, the `duplicate` strategy, or any import without `preserveIds`), and had characters dressed in chats |
| **Provenance** | Original to v4. Neither the restore's chat remap nor the import's chat reconcile handled these columns |
| **Fix site** | `lib/chat/character-keyed-fields.ts` (`remapCharacterKeyedChatFields`), called from `lib/backup/restore/uuid-remap.ts` (`remapBackupData`) and `lib/import/quilltap-import/reconcile.ts` (`reconcileRelationships`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-18).** One pure pass, `remapCharacterKeyedChatFields`, carries every chat
column keyed by character id across an id change: `equippedOutfit` (slot item ids follow the wardrobe
item remap), `characterAvatars` (`imageId` follows the file remap), `courierCheckpoints`
(`lastResolvedMessageId` follows the message remap) and `pendingOutfitNotifications` (keys only).
New-account restore and `.qtap` import both call it. Covered by
`__tests__/unit/lib/chat/character-keyed-fields.test.ts`,
`__tests__/unit/lib/backup/uuid-remapper.test.ts` (`bug 252`) and
`__tests__/unit/lib/import/quilltap-import/reconcile-character-keyed-fields.test.ts`.

## Symptom

Restore a backup in new-account mode. Open any restored chat whose characters were wearing something:
every character is undressed, and the per-chat outfit avatar is gone. The outfit history for the same
chat and character still lists their outfit. A character on a Courier profile with delta mode sends full
context on its next turn. A `.qtap` import of a chat whose character landed under another id shows the
same thing.

## Root cause

Four chat-row JSON columns are keyed by character id:

| Column | Shape | Inner ids |
|---|---|---|
| `equippedOutfit` | `{ [characterId]: { top, bottom, footwear, accessories, hair } }` | wardrobe item ids |
| `characterAvatars` | `{ [characterId]: { imageId, generatedAt, afterMessageCount } }` | file id |
| `courierCheckpoints` | `{ [characterId]: { lastResolvedMessageId, resolvedAt } }` | message id |
| `pendingOutfitNotifications` | `{ [characterId]: … }` (legacy) | none |

In new-account mode, `remapBackupData` (`lib/backup/restore/uuid-remap.ts`) gives each character, file
and message a new id through the `UuidRemapper`. The chat remap (`remappedChats`) remapped the chat's
scalar foreign keys, participants, messages and turn-manager JSON, but copied these four columns through
unchanged. So the restored maps named the old character ids, and every reader looks a character up by its
new id and gets nothing.

The slot values had a related problem. A wardrobe item without a frontmatter id gets an id derived from
its mount point and path, and the mount point is remapped, so those item ids change too
(`buildWardrobeItemIdRemap`). The wear ledger and outfit history already followed that remap, but the live
outfit did not.

The `.qtap` import had the same gap. `importChats` passes the columns straight into `chats.create`, and
`reconcileRelationships` remapped participants but not these columns. `idMaps.characters` can map a
bundled character to an existing row or a fresh id, so the chat kept keys that named nobody. Message ids
in `courierCheckpoints` were already reminted at create time (`remintChatMessageIds`); only the keys were
stale.

Two other keyed columns are deliberately left alone: `compiledIdentityStacks` (keyed by participant,
rebuilt on a miss) and `commonplaceSceneCache` (a stale key only re-emits the scene block).

## Why it survived

The tests for `remapBackupData` covered the outfit history and the wear ledger, which are separate tables
with their own remaps. The keyed columns are opaque JSON on the chat row, and nothing tested them after a
remap. Same-account restores and `preserveIds` imports keep the ids, so the common case worked.

## The fix

New `lib/chat/character-keyed-fields.ts`: `CHARACTER_KEYED_CHAT_FIELDS` names the four columns, and
`remapCharacterKeyedChatFields(chat, remaps)` returns a patch for those present. The caller supplies four
remaps (character, wardrobe item, file, message). A character remap returning `null` drops that entry.
A column stored as a JSON string is parsed; one that still is not an object is left alone and reported
in `unreadable`, which both callers log at `warn`. Both log the rewritten columns at `debug`.
An outfit is normalised with `normalizeEquippedSlots` and rebuilt with `bySlot`, the same shape the
outfit-history remap produces, so a pre-hair four-slot bag comes back with all five slots.

- **Restore** (`remapBackupData`): characters, files and messages through `remapper.remap`, wardrobe
  items through `wardrobeItemIdRemap.get(id) ?? id`. An entry for a character the backup does not carry
  (one deleted before the backup whose entry lingered) is dropped: `remapper.remap` would mint an id
  that names nobody, and nothing would ever clean it up.
- **Import** (`reconcileRelationships`): characters through `idMaps.characters.get(id) ?? id` (an
  unmapped character keeps its id, as a participant does), wardrobe items through
  `buildImportedWardrobeItemIdMap` (passed in from `execute.ts`), pictures through
  `idMaps.docMountFileLinks` (as a character's avatar is), messages unchanged.

None of the columns is patch-only (`ChatsRepository.patchOnlyFields` lists only the three Concierge
columns), so both `chats.create` (restore) and `chats.update` (import reconcile) write them. The legacy
single-id slot shape is upgraded in `parseBackupZip` (`archive.ts`) before the remap runs.

## How to verify

`npx jest __tests__/unit/lib/chat/character-keyed-fields.test.ts __tests__/unit/lib/backup/uuid-remapper.test.ts __tests__/unit/lib/import/quilltap-import/reconcile-character-keyed-fields.test.ts`.
Live: back up an instance with a dressed character in a chat, restore it in new-account mode, and check
that the character is still wearing the outfit and the chat's outfit avatar is shown. Repeat with a
`.qtap` export imported using the `duplicate` strategy.
