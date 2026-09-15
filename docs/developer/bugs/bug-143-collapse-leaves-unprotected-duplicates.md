# Bug 143 — the avatar-roll collapse left duplicate `generationKey` rows it was not entitled to keep

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-09-15 (v5 dogfood walk against a copy of the live instance, row C3 — found by census, not by symptom) |
| **Severity** | **Low** — data hygiene only. No user-visible consequence: both apps' cache lookup sorts newest-first and then verifies the character tag and the blob's existence, so a duplicate key can never serve the wrong face or a dead image |
| **Who it bites** | nobody today. It costs disk (one orphaned WebP per group) and it makes `files.generationKey` non-unique, which any future code that assumes "one row per configuration" would inherit |
| **Provenance** | Faithful — v5 reproduces nothing here; this is v4's own migration's residue, measured on data v4 wrote |
| **Defect site** | `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts` (`run()`, the victim loop at ~`:265-288`) |
| **v5 status** | Unaffected. v5's `lookup_cached_avatar` carries v4's newest-first sort and both guards verbatim; its own boot heal honours v4's ledger row and writes nothing |
| **Index** | [bugs.md](../bugs.md) |

---

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

## Why it survived

Nothing surfaces it. The duplicates are invisible at every read: the lookup
sorts newest-first, checks `row.tags?.includes(characterId)`, and checks
`mountBlobExists` — so a hit is always correct even with two rows in play. The
migration's summary line counts what it *did* (`1785 → 898`), not what it left,
and `shouldRun` gates on `generationKey IS NULL`, so once every row carries a
key the pass never re-examines the instance. There is no assertion anywhere
that `generationKey` is unique, and no test covers a group whose non-newest row
is unprotected but undeletable for some other reason.

## The fix

The diagnosis is incomplete on purpose — the three unexplained groups need
v4-side knowledge this walk does not have. Three candidates, in order of
likelihood:

1. **A per-row failure inside the delete step** that leaves the `files` row
   behind while the surrounding pass reports success. If `dropVictimBytes` (or
   its callers) can throw for one victim without failing the run, the row
   survives keyed — exactly this shape. Worth a log check on the real run.
2. **A protection this walk did not model** — some other reference that made
   the row ineligible, in which case the seven-of-ten branch simply has a wider
   definition than `characters.defaultImageId` and the comment should say so.
3. **A partial run** (interrupted, then resumed by the ledger's completion
   stamp), which would also explain why the residue is small and old.

Whichever it is, two cheap hardenings stand on their own:

- **Count what was kept.** Have the summary report survivors-keyed-alongside
  and victims-skipped separately, so a future run says *"collapsed N, kept M
  protected, skipped K"* rather than leaving K invisible.
- **Make the invariant checkable.** A post-pass assertion (or a startup census)
  that every non-unique `generationKey` group is fully explained by the
  protected set would have caught these three at the moment they were created.

## Verification

```sql
-- must be 0 for groups NOT explained by the protected set
SELECT generationKey, COUNT(*) FROM files
 WHERE generationKey IS NOT NULL AND generationKey <> ''
 GROUP BY generationKey HAVING COUNT(*) > 1;
```

For each remaining group, resolve each non-newest row's `storageKey`
(`mount-blob:<mountPointId>:<blobId>`) and confirm the `blobId` is in the set
built from `characters.defaultImageId` → `doc_mount_file_links.id` →
`doc_mount_blobs.fileId`. Any group failing that is this bug.

## v5 coordination

None needed. v5 reproduces no part of this: its boot heal sees v4's ledger row
and writes nothing (verified on the same copy — 187 `migrations_state` rows
byte-identical across a boot), and its `lookup_cached_avatar` carries v4's
newest-first ordering and both guards. The v5 walk that found this also proved
the cache itself healthy: three `CHARACTER_AVATAR_GENERATION` jobs on a real
chat all answered *"Reused cached avatar for this configuration"* with `files`,
roll count and `IMAGE_GENERATION` rows all unmoved.
