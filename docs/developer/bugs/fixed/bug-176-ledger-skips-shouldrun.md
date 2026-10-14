# Bug 176 — a damaged mount-index or help-chunks table is never repaired once its migration is in the ledger

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-02)** |
| **Found** | 2026-10-01, by the v5 port (P4.134's boot-hardness survey and its review), while deciding which v4 boot steps are fatal |
| **Fixed** | 2026-10-02, v4.10-dev |
| **Severity** | Medium. Every document-store read comes back empty, for good, while `/api/health` reports healthy. No data is lost: the rows are still on disk, and the next boot does not try to repair them |
| **Who it bites** | any provisioned instance whose mount-index tables or `help_doc_chunks` table is damaged after the migration that created it has run (a column renamed by hand or by a bad restore, a table swapped for a view). The Scriptorium lists nothing, every character vault and project store reads empty, and nothing at boot says why |
| **Provenance** | Pinned (v5 side only; no v4 oracle). v5 re-runs its structural ensures on every boot: the DDL class fails the boot, and the lazy-home repairs log one line on every boot and carry on, where v4 logs only on access; v5's boot-hardness tests pin that cadence. No v4 test drives `instrumentation.ts`, so nothing on the v5 side trips when this is fixed |
| **Defect site** | `migrations/index.ts:125-129` (a migration already in `migrations_state` is skipped before its `shouldRun`), `lib/database/repositories/dedicated-db.repository.ts:134-152` (the lazy `ensureTable` logs and rethrows per access, then the caller answers its empty fallback), `app/api/health/route.ts:188-200` (health reads neither the mount index nor `help_doc_chunks`) |
| **Fix site** | `lib/startup/verify-structural-tables.ts` (boot pass, Phase 3.1 in `instrumentation.ts`), `verifyStructure()` on `AbstractDedicatedDbRepository` and `HelpDocChunksRepository`, the shape check in `lib/database/table-shape.ts`, and a `structure` entry in `app/api/health/route.ts` |
| **v5 status** | Pinned: v5 re-ensures every structural table at boot (`crates/quilltap-host/src/host.rs`'s per-boot ensures). The DDL class fails the boot; the lazy-home repairs log one line per boot and continue; P4.134 / P4.135 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-02).** Part 1 of the fix below, with the "report it" option. After file
storage is up (Phase 3.1 in `instrumentation.ts`), `verifyStructuralTables` asks every repository
that owns its table's DDL to `verifyStructure()`: the ten dedicated mount-index and LLM-logs
repositories and `HelpDocChunksRepository`. Each runs its ensure with no fallback, then
`findTableShapeProblem` (`lib/database/table-shape.ts`) checks that the name is a table (not a view)
and that every schema column is present. That second check is needed because the generated DDL is
`CREATE TABLE IF NOT EXISTS`, which walks past a column renamed in place unless an index names it.
An unavailable dedicated database (degraded or not opened) is reported too. Each problem is logged
once at ERROR (`Structural table check failed; reads through this repository will come back empty`)
and recorded on `startupState`; `GET /api/health` then reports a `structure` service as `degraded`
with the problem list, so the overall status is `degraded` (503). The boot is not stopped, so an
instance with a damaged store stays reachable for a restore. Part 2 (re-asking ledgered structural
migrations) was not done; part 1 also covers the missing-table cases. The column check was run
against every table on `Friday` and `V4test` with no false positives. Pinned by
`__tests__/unit/startup/verify-structural-tables.test.ts` (renamed column, view, missing table,
extra columns allowed; `verifyStructure` creates a missing table, reports a renamed column, and
reports an unavailable database without throwing; the pass records each problem once and clears a
stale record). The live damage walk-through below was not run.

## Symptom

On an instance where `doc_mount_file_links.relativePath` has been renamed (or any similar damage to
a mount-index table), the server boots normally and `/api/health` answers 200. Every request that
reads the document stores then logs a pair of ERROR lines and gets an empty answer:

```
Failed to ensure doc_mount_file_links table in mount index database {error: 'no such column: relativePath'}
Error querying joined file links  (or the caller's own fallback line)
```

This repeats on every read, on every boot, for as long as the instance runs. The Scriptorium is
empty, vault reads are empty, and the runner never tries to fix the table.

## Root cause

The runner checks the ledger before it asks a migration whether it needs to run
(`migrations/index.ts:125-129`):

```ts
      // Check if already completed
      if (isMigrationCompleted(state, migration.id)) {
        migrationsSkipped++;
        continue;
      }
```

`isMigrationCompleted` searches the in-memory state that `loadMigrationState` read from
`migrations_state` (`migrations/state.ts:210-212`). A row there
is written once, by `recordCompletedMigration`, on the migration's first success
(`migrations/state.ts:217-238`, called from `migrations/index.ts:162-163`). After that the
migration's own `shouldRun` is never called again.

For a data pass that is the right guard. For the structural migrations it means nothing at boot
ever looks at those tables again. Their `shouldRun` bodies are the nearest thing v4 has to a
boot-time check, and the ledger skips even those:

| Migration | Its `shouldRun` checks | Once ledgered, v4 reaches the table only through |
|---|---|---|
| `create-help-doc-chunks-table-v1` (`migrations/scripts/create-help-doc-chunks-table.ts:28`) | `!sqliteTableExists('help_doc_chunks')` (`:33-38`) | `HelpDocChunksRepository`'s lazy collection ensure, whose failure rethrows into each read's `safeQuery` |
| `add-doc-mount-link-groups-v1` (`migrations/scripts/add-doc-mount-link-groups.ts`) | `doc_mount_file_links` lacks `linkGroupId`, or unlinked `doc_mount_files` rows remain (`:46-62`) | the file-links repository's lazy `onTableEnsured` |
| `provision-general-mount-v1`, `provision-user-uploads-mount-v1`, `provision-lantern-backgrounds-mount-v1` | the store pointer in `instance_settings` is unset or names no mount point; the check itself runs `ensureMountIndexTables` and answers true if that throws (`provision-general-mount.ts:150-176`) | the mount-index repositories' lazy `ensureTable` |
| `add-doc-mount-file-links-v1` (`migrations/scripts/add-doc-mount-file-links.ts`) | the pre-refactor shape is still there (`doc_mount_files.mountPointId`, or chunks keyed by `fileId`) (`:124-140`) | the same lazy `ensureTable` |

On a fresh instance the two `add-doc-mount-*` migrations are never ledgered at all: their
`shouldRun` answers false on the post-refactor shape, so the runner asks it again on every boot.
The last column applies to them either way.

None of these checks would notice a renamed column such as `relativePath`. A missing table, a
missing `linkGroupId`, or a mount-index table that `ensureMountIndexTables` can no longer index
would be caught if `shouldRun` were still asked; a column renamed in place would not.

The lazy path is `AbstractDedicatedDbRepository.ensureTable`
(`lib/database/repositories/dedicated-db.repository.ts:134-152`):

```ts
  private async ensureTable(db: DatabaseType): Promise<void> {
    if (this.tableEnsured) return;

    try {
      const ddlStatements = generateDDL(this.collectionName, this.schema);
      for (const sql of ddlStatements) {
        db.exec(sql);
      }
      this.onTableEnsured(db);
      this.tableEnsured = true;
    } catch (error) {
      logger.error(`Failed to ensure ${this.collectionName} table in ${DB_LABELS[this.dbTarget]} database`, {
        error: extractErrorMessage(error),
      });
      throw error;
    }

    await this.afterTableReady(db);
  }
```

`tableEnsured` is set only on success, so a damaged table fails and logs again on every access. The
rethrow lands in `withRawDb` (`:198-226`), whose default `'fallback'` mode turns it into the
caller's empty answer through `safeQuery`. Nothing reaches the boot.

The health route checks only the JSON store and file storage once startup is past `file-storage`
(`app/api/health/route.ts:196-200`):

```ts
    // Check JSON store (always available as fallback)
    await checkJsonStoreHealth(services, serviceStatuses);

    // Check file storage
    await checkFileStorageHealth(services, serviceStatuses);
```

so the instance reports healthy throughout.

## Why it survived

The ledger-first order is right for data passes, which must run once, and every structural
migration was written as if it would only ever meet a table that is missing, never one that exists
in the wrong shape. The lazy `ensureTable` was meant as a safety net, but its fallback mode turns a
failure into an empty result, so the net hides the damage. No test boots an instance twice with
damage in between: `register()` calls `process.exit`, and no test drives it.

## The fix

Two parts, the second doing most of the work.

1. **Check the shape at boot.** After the migrations, run each dedicated repository's `ensureTable`
   (the mount-index repositories, and the help-chunks collection ensure) once, with the fallback
   off. That is the same DDL and `onTableEnsured` work a first read does today, so a healthy
   instance pays nothing new. On failure, either stop the boot the way a failed migration does, or
   carry on and report the table as unhealthy in `/api/health`, so the damage is visible instead of
   showing up as empty reads.
2. **Optionally, re-ask the structural migrations.** Have the runner call `shouldRun` for
   structural migrations even when the ledger lists them, via a flag on the `Migration` type (for
   example `structural: true`). A ledgered structural migration whose `shouldRun` answers true runs
   again and is re-stamped. The `shouldRun` bodies above are already safe to re-run. This repairs a
   missing table or column; it does nothing for a column renamed in place, which is why part 1 is
   needed.

## How to verify

1. Boot a fresh instance on v4 once and stop it. `migrations_state` now holds the provisioning
   migrations, such as `provision-general-mount-v1`. The two `add-doc-mount-*` migrations are not
   there: on a fresh instance their `shouldRun` answers false, so they are never stamped. That
   changes nothing below, because neither check notices a renamed column.
2. On a copy of the mount-index database, opened with any SQLite3MultipleCiphers client keyed with
   the instance pepper, run:

   ```sql
   ALTER TABLE doc_mount_file_links RENAME COLUMN relativePath TO relativePath_x;
   ```
3. Boot v4 again. Today the runner logs `Migration runner completed` with `success: true,
   migrationsRun: 0` and every migration counted in `migrationsSkipped`. Startup reaches
   `All services initialized successfully`. The boot-time reads that touch the links table (the
   phase 3.3b orphan reap, the general Scenarios folder and `state.json` ensures) each log
   `Failed to ensure doc_mount_file_links table in mount index database` with `no such column:
   relativePath`, followed by the caller's own error line, and startup continues.
4. `GET /api/health` answers 200.
5. Open the Scriptorium, or read any character vault. Each read logs the same pair of lines and
   answers empty, and keeps doing so after every restart.

With the fix, step 3 either stops the boot with a clear error or reports the table in
`/api/health`, and step 5 never happens silently. Repeat with `help_doc_chunks` replaced by a view
(`ALTER TABLE help_doc_chunks RENAME TO help_doc_chunks_x; CREATE VIEW help_doc_chunks AS SELECT *
FROM help_doc_chunks_x;`) for the main-database case.

v5 coordination: v5 re-runs its structural ensures on every boot, so the same damage fails v5's
boot (or, for the five lazy-home repairs, logs v4's line at every boot and continues).
`crates/quilltap-host/tests/host_boot_hardness.rs` pins this, and its
`the_134_plant_is_re_ensured_and_re_logged_on_every_boot` boots the renamed-column instance twice
and sees the line both times. v5 keeps that behaviour. When v4 fixes this, nothing on the v5 side
needs to change except retiring the recorded divergence.
