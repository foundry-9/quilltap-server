# Bug 143 — the avatar-roll collapse left duplicate `generationKey` rows it was not entitled to keep

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-15)** — as *not a defect*. The residue is the migration's deliberate protected branch, all ten groups of it. What was wrong was the census, not the collapse; the hardenings it asked for were built anyway, and one of them is what makes the diagnosis reproducible |
| **Found** | 2026-09-15 (v5 dogfood walk against a copy of the live instance, row C3 — found by census, not by symptom) |
| **Fixed** | 2026-09-15 |
| **Severity** | **None** — the ten duplicate groups are correct. The original filing's "Low" stands only for the accounting: the pass reported what it collapsed and never what it kept |
| **Who it bites** | nobody, then or now |
| **Provenance** | Faithful — v5 reproduces nothing here |
| **Defect site** | None in `run()`. The mis-diagnosis site is the walk's own reconstruction of the protected set; the *accounting* gaps fixed here are `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts` (the summary line and the absent census) |
| **v5 status** | Unaffected, as filed |
| **Index** | [bugs.md](../../bugs.md) |

---

## FIXED in v4 (2026-09-15)

**All ten groups are the protected branch working as written.** The three the
original filing could not explain — `058a0214…` (Kumar), `17bb35a0…` (Friday),
`59192685…` (Elara) — were protected when the migration ran on 2026-09-11 and
had stopped being protected by the time the walk measured them on 2026-09-15.

The protection is `characters.defaultImageId`, and it is **mutable**. The walk
rebuilt the protected set from a snapshot taken four days after the decisions it
was auditing, so it was not checking the migration's reasoning — it was checking
whether that reasoning still happened to hold. For three rows it no longer did:

| Group | Character | Why the walk missed the protection |
|---|---|---|
| `058a0214…` | Kumar | portrait repointed to `photos/avatar_Kumar_1786223703990.webp` at **2026-09-15T03:58:17Z** |
| `17bb35a0…` | Friday | portrait repointed to `photos/avatar_Friday_1788462620901.webp` at **2026-09-15T03:56:40Z** |
| `59192685…` | Elara | **the character no longer exists** — absent from all 48 rows of `characters`, archived or otherwise |

The two repoints landed *hours before the census on the morning of the walk
itself*. Verified on the live instance: each victim blob still carries the
`photos/…` link that `defaultImageId` named on 2026-09-11 — `1f82fe97…`
(Kumar), `83e7c719…` (Friday), `c337902f…` / `664de6f0…` (Elara) — and no
character row points at any of them today.

So of the filing's three candidates, **(2) was closest and still not right**:
not "a protection this walk did not model", but a protection that *lapsed*. The
victim loop's definition was never too narrow. Candidate (1), a per-row failure
in the delete step, is ruled out by construction: a victim that fails to delete
is never added to `survivors`, so it would survive **unkeyed**, and all three of
these carry their survivor's key. Candidate (3), a partial run, is ruled out the
same way.

### What was actually fixed

The diagnosis above cost a forensic walk that should not have been necessary,
and the reason it was necessary is the part worth keeping. Both hardenings the
filing asked for are built, one of them deliberately not in the shape it
proposed:

- **Count what was kept.** `keptClause` appends *"; kept N rolls still serving
  as character portraits"* to the summary. That line lands in `migrations_state`
  and outlives the logs, which is the record that was missing — the original run
  said *"Collapsed 1785 avatar rolls to 898 configurations"* and nothing at all
  about the ten it chose to double up. The `logger.info` summary gains
  `protectedKept` and `albumCopiesKept` alongside it.

- **Make the invariant checkable — in-pass, not afterwards.** The filing asked
  for "a post-pass assertion (or a startup census) that every non-unique
  `generationKey` group is fully explained by the protected set." Built as
  proposed, that check would have produced **exactly the three false positives
  this bug is made of**, every time a portrait moved. So
  `unexplainedDuplicateKeys` runs inside `run()`, against `protectedKept` — the
  set of rows *this pass decided to keep*, recorded at the moment of the
  decision — and never reconstructs the protected set from a later snapshot. It
  warns rather than throws: a surprise means the next pass has something to look
  at, not that the collapse just completed should be abandoned.

The lesson generalises past this migration: **an invariant that quantifies over
mutable state is only checkable at the instant it is established.** Auditing it
later answers a different question, and answers it wrongly in exactly the
direction that manufactures phantom defects.

### Verification

```sql
SELECT generationKey, COUNT(*) FROM files
 WHERE generationKey IS NOT NULL AND generationKey <> ''
 GROUP BY generationKey HAVING COUNT(*) > 1;
-- still 10 rows on the live instance, and all ten are correct
```

The ten groups stay. Nothing repairs them, because there is nothing wrong with
them: each is a portrait the operator's character named at collapse time, keyed
alongside its survivor on purpose, and `lookupCachedAvatar` sorts newest-first
before its guards so the survivor wins every lookup regardless.

Tests: `__tests__/unit/migrations/collapse-duplicate-avatar-rolls.test.ts` gains
*reports the rolls it kept, not only the ones it collapsed* and the
`the duplicate-key census` pair — one proving the census stays silent on a
deliberate keep, one proving it names a duplicate the pass did not choose.

**The walk that filed this also turned up a real defect in the same victim
loop, which the census could not see because it only ever surveyed survivors:
see [bug 145](bug-145-collapse-takes-album-photos.md).**

---

## Original filing (2026-09-15)

## Symptom

On the live instance, **10 groups of `files` rows share a `generationKey`** —
20 rows in total. Measured 2026-09-15 on a copy taken that morning:

```sql
SELECT generationKey, COUNT(*) FROM files
 WHERE generationKey IS NOT NULL AND generationKey <> ''
 GROUP BY generationKey HAVING COUNT(*) > 1;
-- 10 rows, every one COUNT(*) = 2
```

Every group is **same-character** (identical `tags`) and **byte-identical in
`(generationModel, generationPrompt)`** — so every pair lands in the same
legacy bucket and is, by the migration's own definition, one configuration.

All 20 rows **predate** the migration's own run
(`collapse-duplicate-avatar-rolls-v1`, completed `2026-09-11T17:45:57.477Z`,
`4.10.0-dev.27`, *"Collapsed 1785 avatar rolls to 898 configurations (887
images freed; repointed 262 chats, 24 characters, 977 messages)"*). The newest
is 2026-09-07, four days before. **Nothing has duplicated since**, so this is
residue of that pass, not ongoing drift.

## Root cause — partly by design, and that is the useful half

**Seven of the ten are deliberate.** The victim loop keeps a row whose blob is
still a character's portrait and *keys it alongside the survivor on purpose*:

```ts
const blobId = blobIdFromStorageKey(victim.storageKey);
if (blobId && protectedIds.has(blobId)) {
  survivors.push({ id: victim.id, key });
  logger.info('Keeping avatar roll still serving as a character portrait', …);
  continue;
}
```

Resolving `characters.defaultImageId` → link → file → blob gives 43 protected
blob ids, and **7 of the 10 groups have their non-newest row in that set**.
Those are working exactly as written, and the comment's justification holds:
`lookupCachedAvatar` sorts `createdAt` descending before its guards, so the
newest holder wins.

**Three are not.** Groups `058a0214…` (Kumar), `17bb35a0…` (Friday) and
`59192685…` (Elara) each have an older row that:

- matches `selectAvatarRows` exactly — `originalFilename LIKE 'avatar\_%'`,
  `category = 'IMAGE'`, non-empty `generationPrompt`;
- is **not** in the protected-blob set;
- is referenced by **no** chat's `characterAvatars` (checked: 0 rows);
- still has a **live blob** in the mount index.

By the loop's own logic each should have been added to `remap`, repointed, and
deleted. All three survived instead, keyed identically to their survivor.

> **Resolved above:** each *was* in the protected set on 2026-09-11. The set was
> rebuilt on 2026-09-15 from a column two of the three characters had since
> repointed and the third no longer has.

## Why it survived

Nothing surfaces it. The duplicates are invisible at every read: the lookup
sorts newest-first, checks `row.tags?.includes(characterId)`, and checks
`mountBlobExists` — so a hit is always correct even with two rows in play. The
migration's summary line counts what it *did* (`1785 → 898`), not what it left,
and `shouldRun` gates on `generationKey IS NULL`, so once every row carries a
key the pass never re-examines the instance. There is no assertion anywhere
that `generationKey` is unique, and no test covers a group whose non-newest row
is unprotected but undeletable for some other reason.

## v5 coordination

None needed. v5 reproduces no part of this: its boot heal sees v4's ledger row
and writes nothing (verified on the same copy — 187 `migrations_state` rows
byte-identical across a boot), and its `lookup_cached_avatar` carries v4's
newest-first ordering and both guards. The v5 walk that found this also proved
the cache itself healthy: three `CHARACTER_AVATAR_GENERATION` jobs on a real
chat all answered *"Reused cached avatar for this configuration"* with `files`,
roll count and `IMAGE_GENERATION` rows all unmoved.
