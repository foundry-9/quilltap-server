# Bug 252 — a new-account restore leaves every chat's outfit keyed by the old character ids

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-18, by reading `remapBackupData` beside the outfit-history remap |
| **Fixed** | 2026-10-18 |
| **Severity** | Medium. Nothing is lost from the archive, but after the restore no character is wearing anything in any restored chat. The outfit history comes back correctly, so the history and the live outfit disagree |
| **Who it bites** | anyone who restores a backup in new-account mode (fresh ids) and had characters dressed in chats |
| **Provenance** | Original to v4. The chat remap never handled the column |
| **Fix site** | `lib/backup/restore/uuid-remap.ts` (`remapEquippedOutfit`, called from the chat remap in `remapBackupData`) |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-18).** The chat remap now re-keys `equippedOutfit` by the remapped character id
and moves each slot's item ids through the same wardrobe item remap as the wear ledger and outfit history.
Covered by `__tests__/unit/lib/backup/uuid-remapper.test.ts` (`chat equipped outfit (bug 252)`).

## Symptom

Restore a backup in new-account mode. Open any restored chat whose characters were wearing something:
every character is undressed. The outfit history for the same chat and character still lists their outfit.

## Root cause

`chats.equippedOutfit` is a JSON object keyed by character id (`{ [characterId]: EquippedSlots }`).
In new-account mode, `remapBackupData` (`lib/backup/restore/uuid-remap.ts`) gives each character a new id
through the `UuidRemapper`. The chat remap (`remappedChats`) remaps the chat's scalar foreign keys,
participants, messages and turn-manager JSON, but it copied `equippedOutfit` through unchanged. So the
restored map still named the old character ids, and every reader looks a character up by its new id and
gets nothing.

The slot values had a related problem. A wardrobe item without a frontmatter id gets an id derived from
its mount point and path, and the mount point is remapped, so those item ids change too
(`buildWardrobeItemIdRemap`). The wear ledger and outfit history already followed that remap, but the live
outfit did not.

## Why it survived

The tests for `remapBackupData` covered the outfit history and the wear ledger, which are separate tables
with their own remaps. The `equippedOutfit` column is opaque JSON on the chat row, and nothing tested it
after a remap. Same-account restores keep the ids, so the outfit came back correctly in the common case.

## The fix

New `remapEquippedOutfit(value, remapper, itemIdRemap)` in `uuid-remap.ts`. It re-keys each entry with
`remapper.remap(characterId)` and maps every string in each slot array through
`itemIdRemap.get(id) ?? id`. An item id the backup carries no document for passes through, as it does for
the history. A non-array slot and a non-object outfit are kept as given; `normalizeEquippedSlots` already
repairs those on read. A null or missing outfit is not touched.

`equippedOutfit` is not patch-only (`ChatsRepository.patchOnlyFields` lists only the three Concierge
columns), and the restore writes the remapped chat through `chats.create`, so no further change is needed.
The legacy single-id slot shape is upgraded in `parseBackupZip` (`archive.ts`) before the remap runs.

## How to verify

`npx jest __tests__/unit/lib/backup/uuid-remapper.test.ts -t "equipped outfit"`: the keys are the new
character ids, frontmatter item ids are kept, mount-derived item ids follow the remapped mount, the outfit
matches the remapped history row, and a null outfit stays null. Three of the four tests fail against the
unfixed function. Live: back up an instance with a dressed character in a chat, restore it in new-account
mode, and check that the character is still wearing the outfit.
