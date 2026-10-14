# Bug 175 — a failed avatar-roll collapse stops the server, though the next boot would finish it

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-02)** |
| **Found** | 2026-10-01, by the v5 port (dogfood #134 and P4.134's boot-hardness survey), while matching v5's boot to what v4 does when the `collapse-duplicate-avatar-rolls-v1` migration fails |
| **Fixed** | 2026-10-02, v4.10-dev |
| **Severity** | Low. Nothing is lost: a failed pass leaves its rows and writes no ledger row, and the next boot that gets past the cause finishes the job. The cost is that the server will not start at all until someone fixes the cause by hand |
| **Who it bites** | any instance whose avatar-roll collapse fails part-way (a locked or damaged `files` table, a failing repoint, a delete that raises). The process exits with code 1 on every boot until the cause is repaired by hand, where carrying on would have retried the pass at the next boot |
| **Provenance** | Faithful → Converged. Arrived with the migration in `7fbf8a55b` (the avatar configuration cache). v5 first logged the failure and booted on; by the ruling of 2026-10-01 it now fails its boot too (v5 P4.135), so the two sides move together when this is fixed |
| **Defect site** | `migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts:642-659` (the catch returns `success: false`) → `migrations/index.ts:171-182` (the runner breaks on the first failure) → `instrumentation.ts:419-428` (`process.exit(1)`) |
| **Fix site** | `Migration.resumable` (`migrations/types.ts`), honoured by `deferResumable` in both failure arms of `MigrationRunner.runMigrations` (`migrations/index.ts`); set on `collapse-duplicate-avatar-rolls-v1` |
| **v5 status** | Diverged until v5 catches up: v5 still exits (P4.135); flip its arm back to log-and-continue |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-02).** `Migration` has an optional `resumable` flag. When a resumable
migration fails, by a failed result or a thrown exception, the runner logs `Migration failed` (or
`Migration threw an exception`) as before, then `Resumable migration deferred to the next boot;
continuing startup`. It writes no ledger row, does not add the id to `failed`, and continues with
the next migration. The run result carries the id in a new `deferred` list, so `success` stays true
and `instrumentation.ts` does not exit; `Migrations completed successfully` logs the `deferred`
list. A migration that `dependsOn` a deferred one is deferred with it, without running
(`Migration deferred to the next boot: a dependency did not complete`), so no dependant can run
against a half-done pass. `collapse-duplicate-avatar-rolls-v1` is the only migration marked
resumable; every other migration keeps the stop-on-failure rule. Pinned by
`__tests__/unit/migrations/runner-resumable.test.ts` (an ordinary failure stops the run; a resumable
failed result or throw is deferred and the run continues; only successes are ledgered; a dependant
of a deferred migration is deferred unrun; the collapse carries the flag). Verify steps 1–3 below
were not run against a live boot.

## Symptom

If the avatar-roll collapse throws anywhere in its pass, the server never starts. The log shows,
in order (all ERROR except the third):

1. `Failed to collapse duplicate avatar rolls` `{context: 'migration.collapse-duplicate-avatar-rolls', error: <message>}`
2. `Migration failed` `{context: 'migrations.runMigrations', migrationId: 'collapse-duplicate-avatar-rolls-v1', error: <message>, message: 'Failed to collapse duplicate avatar rolls'}`
3. INFO `Migration runner completed` `{context: 'migrations.runMigrations', success: false, migrationsRun, migrationsSkipped, failed: ['collapse-duplicate-avatar-rolls-v1'], totalDurationMs}`
4. `Migrations failed - cannot start server` `{context: 'instrumentation.register', failedMigrations: ['collapse-duplicate-avatar-rolls-v1'], error: undefined, migrationsRun, migrationsSkipped}`

and then the process exits with code 1. `Fatal error initializing services` is never logged:
`process.exit(1)` sits inside the outer `try` of `register()`, so its `catch` is never reached.
Every later boot does the same thing until the cause is repaired by hand.

## Root cause

The migration's own catch turns any error into a failed result
(`collapse-duplicate-avatar-rolls-v1.ts:642-659`):

```ts
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to collapse duplicate avatar rolls', {
        context: 'migration.collapse-duplicate-avatar-rolls',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to collapse duplicate avatar rolls',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
```

The runner treats every failed result as critical (`migrations/index.ts:171-182`):

```ts
        } else {
          failed.push(migration.id);
          logger.error('Migration failed', {
            context: 'migrations.runMigrations',
            migrationId: migration.id,
            error: result.error,
            message: result.message,
          });
          // Stop on first failure - critical migrations must succeed
          endMigration();
          break;
        }
```

and `instrumentation.ts:419-428` exits on any failed run:

```ts
      if (!migrationResult.success) {
        logger.error('Migrations failed - cannot start server', {
          context: 'instrumentation.register',
          failedMigrations: migrationResult.failed,
          error: migrationResult.error,
          migrationsRun: migrationResult.migrationsRun,
          migrationsSkipped: migrationResult.migrationsSkipped,
        });
        // Exit with code 1 to prevent container from starting with incompatible data
        process.exit(1);
      }
```

`migrationResult.error` is `undefined` here: the runner sets `error` only when the database never
became ready (`migrations/index.ts:103-121`), not for a failed migration.

"Critical migrations must succeed" is right for a schema migration, where the code that follows
assumes the new shape. It is wrong for this one. The collapse is a data pass over rows that are
already valid, and its own header says it can be interrupted
(`collapse-duplicate-avatar-rolls-v1.ts:46-48`):

```ts
 * Resumable rather than transactional: grouping reads every avatar row
 * regardless of whether it is already keyed, so a re-run after an interrupted
 * pass picks the same survivor and finishes the work that remains.
```

That claim holds, and it holds because of where the keying happens. The pass keys each group's
survivor, plus any victim that is still a character's portrait (`:398-409`, which is kept), before
it repoints anything. Every ordinary victim goes to `victims` (`:411-412`) and stays unkeyed until
`deleteFileRow` removes it (`:569`, `:607`). So a failure anywhere in the pass leaves every
not-yet-deleted victim with `generationKey IS NULL`, which is exactly what `shouldRun` looks for
(`:337-345`). No ledger row is written, because the stamp is the runner's
`recordCompletedMigration` and the runner calls it only on success (`migrations/index.ts:162-163`).
The next boot finds the unkeyed rows, regroups them with their already-keyed survivor under the same
v0 key, picks the same survivor, and finishes.

So the exit buys nothing. The data is intact, the pass would resume, and the instance stays down.

## Why it survived

A migration failure has always meant "stop", and for schema migrations it should. The collapse is
the first destructive data pass that is built to be resumed, and nothing in the `Migration` type
lets a migration say so. The pass already continues past a per-row blob failure (`:593-604`), but a
failure of the pass as a whole goes through the runner like any schema migration's.
`__tests__/unit/migrations/collapse-duplicate-avatar-rolls.test.ts` covers the success paths,
idempotence and `shouldRun`; none of its cases fails the pass, and no test drives
`instrumentation.ts`, because `register()` calls `process.exit`.

## The fix

Give `Migration` an optional flag, for example `resumable: true` (or `nonFatal: true`), and have the
runner honour it in both failure arms (the failed result at `:171-182` and the thrown exception at
`:183-205`): log the failure as now, record no ledger row, do not add the id to `failed`, and
`continue` to the next migration instead of `break`. Set the flag on
`collapse-duplicate-avatar-rolls-v1`. Every other migration keeps today's stop-on-failure rule.

A migration that another migration `dependsOn` should not be marked resumable, since its dependants
would then run against a half-done pass. Nothing depends on the collapse.

## How to verify

1. On a copy of an instance with at least two unkeyed avatar rolls of one configuration (same
   prompt and model, `generationKey IS NULL`) and no `collapse-duplicate-avatar-rolls-v1` row in
   `migrations_state`, plant a failure on the pass's first write:

   ```sql
   CREATE TRIGGER qt_plant_collapse BEFORE UPDATE OF generationKey ON files
   BEGIN SELECT RAISE(ABORT, 'planted collapse failure'); END;
   ```

   Today the boot logs the four lines above and exits 1. With the fix it logs the migration's line
   and the runner's `Migration failed`, continues, and `/api/health` answers 200. Both rolls are
   still present and unkeyed, and there is no ledger row.
2. Drop the trigger and boot again. The pass runs, one roll per configuration remains, keyed, and
   the ledger row is written.
3. To check the resume itself, plant `BEFORE DELETE ON files` with the same `RAISE(ABORT, …)`
   instead. The first boot keys the survivor and then fails on the victim's delete, leaving the
   victim unkeyed. Drop the trigger and the next boot deletes the victim and stamps the row.
4. A migration without the flag that fails must still stop the boot.

v5 coordination: v5 measured steps 1 and 3 on its own boot (`crates/quilltap-host/tests/
host_boot_hardness.rs`, `a_failed_avatar_roll_collapse_fails_the_boot` and
`a_collapse_failed_mid_delete_resumes_on_the_next_boot`, whose second boot is step 3's resume).
v5 now fails its boot here, to match v4. A failing `shouldRun` read stays v4's logged skip on both
sides (`a_failed_collapse_should_run_read_is_v4s_logged_skip`).
When v4 takes the fix, v5 flips that arm back to log-and-continue in the same drift catch-up.
