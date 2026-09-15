# Bug 145 — collapsing a duplicate avatar roll deletes the album photo the operator kept from it

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-15)** |
| **Found** | 2026-09-15, while diagnosing [bug 143](bug-143-collapse-leaves-unprotected-duplicates.md) — the walk that filed 143 surveyed only the rows the collapse *left*, so it could not see what the deletions took |
| **Fixed** | 2026-09-15 |
| **Severity** | **High** (silent, irreversible loss of content the operator deliberately kept) — mitigated to *latent* only by the accident that 4.10.0 is unreleased: the migration has run on nobody's instance but the author's |
| **Who it bites** | Anybody upgrading to 4.10.0 who has ever pressed *keep* on an avatar roll. Copying a roll into a character's photo album is the one gesture that says "this one matters", and it is precisely what marked the bytes for deletion |
| **Provenance** | v4's own. v5 has no equivalent pass |
| **Defect site** | `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts` — `deleteVictimBlob()`, `DELETE FROM doc_mount_file_links WHERE fileId = ?` |
| **v5 status** | **Does not reproduce.** v5 runs no collapse of its own; it honours v4's ledger row and writes nothing |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

None visible, which is the whole problem. A character's photo album quietly has
fewer photos in it than the operator put there, with no message, no orphaned
row, and nothing in the main database that ever recorded the photo's existence
to notice missing.

## Root cause

An avatar roll copied into a character's album is **two links over one set of
bytes**: the roll's own link under `character-avatars/…` (or `images/history/…`
for post-vault rolls), and the album's link under `photos/…` in the character's
own vault. That is the deliberate design — the album keeps bytes, not a second
copy of them.

`deleteVictimBlob` deleted by **`fileId`**:

```ts
mountDb.prepare('DELETE FROM doc_mount_file_links WHERE fileId = ?').run(blob.fileId);
mountDb.prepare('DELETE FROM doc_mount_documents   WHERE fileId = ?').run(blob.fileId);
mountDb.prepare('DELETE FROM doc_mount_blobs       WHERE fileId = ?').run(blob.fileId);
mountDb.prepare('DELETE FROM doc_mount_files       WHERE id     = ?').run(blob.fileId);
```

Every link to the file, unconditionally, then the bytes. So collapsing a
duplicate roll took the album copy with it — and took it *because* the operator
had kept it, since keeping is what put a second link on those bytes.

The header comment names the mistake outright, and defends it:

> *mirroring `deleteMountBlob`: the storageKey was the user-visible handle for
> "the file", so every link to that file goes with it.*

That is the right verb for deleting *a file*. It is the wrong verb for
collapsing *a duplicate*, where the entire point is that another consumer of
those bytes is legitimate and staying.

## Why it survived

Three independent misses, and the middle one is the instructive one.

1. **The rule was written down one day too late.** `deleteAvatarRoll`
   (`lib/photos/avatar-rolls-service.ts`, landed `4dcbe0d21`, 2026-09-12)
   states it in the module header, in so many words:

   > *Deleting a roll never takes an album photo with it. `deleteMountBlob`
   > drops every link to a blob's file, **which is the wrong verb here** — a
   > roll the operator has already kept is two links over one set of bytes, and
   > only the roll's own link is ours.*

   The migration landed `7fbf8a55b`, **2026-09-11** — one day earlier. The
   runtime path was written correctly, by an author who had clearly just been
   bitten by the same question, and nobody went back to the migration that had
   already shipped the wrong answer.

2. **Every test seeded a roll with exactly one link.** `seedRoll` created one
   `doc_mount_file_links` row per roll and nothing else, so *"takes the deleted
   roll's chunks, link, blob and content row with it"* passed against a world
   where deleting by `fileId` and deleting by `linkId` are indistinguishable.
   The suite was thorough about the collapse — survivor selection, three kinds
   of repoint, the Lantern's inline uuid, re-runnability — and modelled the one
   shape that would have failed nowhere.

3. **The loss leaves no evidence.** An album link is recorded only in the
   mount-index database. Nothing in `files`, nothing in `chats`, nothing in a
   message. Delete it and there is no dangling reference to trip over later —
   which is also why no census can measure the damage after the fact.

## Scale

On the author's live instance, **199 of 1066 surviving avatar-roll links (19%)
share their content row with a non-avatar link**, and **187 of those 199
predate the migration's run**. Every one of those was one collapse away from
taking an album photo; they survived only because each happened to be the
newest roll of its configuration and so was picked as a survivor rather than a
victim. There was no guard — only luck, at a 19% base rate, across 887
deletions.

Whether any album photo was actually lost on that instance is **not measurable
after the fact**, for the reason in *Why it survived* (3).

## The fix

`deleteVictimBlob` → `dropVictimRollLink`, which takes the roll's own link and
nothing else, then collects the bytes only if that was the last one:

```ts
const rollLink = links.find(l =>
  !isPhotosRelativePath(l.relativePath) &&
  (!rollMountPointId || l.mountPointId === rollMountPointId)
) ?? null;

if (rollLink) {
  mountDb.prepare('DELETE FROM doc_mount_chunks     WHERE linkId = ?').run(rollLink.id);
  mountDb.prepare('DELETE FROM doc_mount_file_links WHERE id     = ?').run(rollLink.id);
}
const collected = gcOrphanedFileRow(mountDb, blob.fileId);   // no-op while the album holds a copy
```

Three existing chokepoints do the work, so this is now one more caller of each
rather than a fourth opinion:

- **`isPhotosRelativePath`** (`lib/photos/photos-paths.ts`) — the single
  predicate for "this link is album material", already shared by the gallery,
  the doc-edit photo handlers and the character-detail stats.
- **`gcOrphanedFileRow`** (`lib/mount-index/orphan-store-reaper.ts`) — the same
  GC the link repository's `deleteWithGC` uses, so the migration, the write
  path and the store cascade all collect content identically.
- The roll-vs-album discrimination mirrors `classifyRollLinks` in
  `lib/photos/avatar-rolls-service.ts`, including its use of the storage key's
  mount point to pick the roll's own link.

A victim whose only surviving link is the album copy now drops no link and
keeps its bytes, while its `files` row still goes — exactly what
`deleteAvatarRoll` does with a null `rollLink`.

The summary distinguishes the two outcomes: `blobsDeleted` counts only bytes
actually freed, and a new `albumCopiesKept` counts victims whose bytes stayed
because the operator had kept them.

## Verification

`__tests__/unit/migrations/collapse-duplicate-avatar-rolls.test.ts`:

- `doc_mount_file_links` gains the `relativePath` column it has in the real
  schema, and `keepInAlbum(id)` seeds the second link — the shape no test had.
- **an album copy is never collateral** — three cases: the album link and its
  bytes survive a collapse of the roll they came from; a roll nobody kept still
  has its bytes freed (and is the only one counted as *images freed*); a victim
  whose roll link is already gone loses its `files` row and keeps the album's.

All three fail against the old `deleteVictimBlob` and pass against the new one
— confirmed by reverting the verb in place and re-running:

```
● an album copy is never collateral › keeps the album photo and its bytes when the roll it came from is collapsed
● an album copy is never collateral › still frees the bytes of a roll nobody kept
● an album copy is never collateral › drops the files row of a roll whose only surviving link is the album copy
Tests: 3 failed, 16 passed, 19 total
```

19/19 pass with the fix; 414/414 across `migrations/`, `lib/photos/` and
`lib/wardrobe/`.

## No repair pass

Deliberately none. On instances where this fired the bytes are gone and
unrecoverable, and 4.10.0 has never been tagged — so the only instances that
ever ran the old verb are the author's own, and every instance that upgrades
from here runs the fixed one.
