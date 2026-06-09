# Implementation plan: scheduled retention & cleanup sweeps

**For:** Claude Code, in the `quilltap-server` repo.
**Goal (from Charlie):** Stop unbounded buildup of data that has no bearing on characters, stories, or memories. Specifically: (1) reap **completed** background jobs after 7 days and **dead** jobs after 30 days; (2) collapse a **stale chat's** generated story-backgrounds and chat-scoped avatar links down to just the currently-referenced ones, releasing the orphaned bytes through the existing hard-link GC; (3) add belt-and-suspenders sweeps for orphaned mount-index files and closed terminal (Ariel) PTY sessions (plus their transcript files); (4) investigate, but do not speculatively touch, Scriptorium render chunks.

All of this runs as **one parent-side daily maintenance tick** plus a manual CLI verb. This is a backend feature + small refactor task. The design questions have been settled with Charlie (see "Decisions" immediately below). Everything here was checked against the current code; file paths and line numbers are real as of this writing but **re-verify before editing** — the repo moves.

---

## 0. Decisions (settled with Charlie — do NOT re-litigate)

1. **One parent-side maintenance tick, NOT a forked-child job.** This is forced by the architecture, not a preference (see §1 "Why parent-side" and §3). There is **no new `ASSET_RETENTION` job type**, no child handler, no queue row. A single daily scheduler (new `lib/background-jobs/scheduled-maintenance.ts`) runs every sweep inline on the parent process — the only DB writer — exactly as the existing LLM-log cleanup scheduler does.
2. **Asset retention is gated on CHAT staleness, NOT per-asset age.** Do **not** walk a chat's backgrounds/avatars and unlink the ones older than N days. Instead: only when *the whole chat* has gone stale (no activity for **30 days**) do we collapse it — keeping **only what is "current"** (the `storyBackgroundImageId` it points at, and each `characterAvatars[].imageId` it currently references). Every other generated background/avatar link belonging to that stale chat is unlinked. An active chat is **never** touched, regardless of how many backgrounds it has accumulated.
3. **All stale chats collapse; there is no protective flag.** Chats have no `archived`/`pinned`/`favorite` column (verified). The only staleness signal is `lastMessageAt` (fallback `updatedAt`). A "precious but finished" chat looks identical to an abandoned one — and that's acceptable, because the collapse is **non-destructive to the story**: it removes only superseded background/avatar variants, never messages or memories. Do **not** add a new "exclude from cleanup" column/migration/UI for v1.
4. **Retention windows are hardcoded constants** — no settings, no `instance_settings`, no `chat_settings` field, no UI, no migration. Put them somewhere obvious and well-commented:
   - `COMPLETED_JOB_RETENTION_DAYS = 7`
   - `DEAD_JOB_RETENTION_DAYS = 30`
   - `STALE_CHAT_RETENTION_DAYS = 30`
   - `CLOSED_TERMINAL_RETENTION_DAYS = 30`
5. **Job retention windows:** `COMPLETED` → 7 days (keyed off `completedAt`); `DEAD` → 30 days (keyed off `completedAt`). Leave `PENDING`, `PROCESSING`, `FAILED`, and `PAUSED` **untouched** — `FAILED` is the transient between-retries state and must not be reaped on a timer.
6. **Terminal sessions:** reap rows whose `exitedAt` is non-null and older than 30 days, AND delete the session's transcript file at `<logsDir>/terminals/<id>.log` (best-effort; ignore if already gone). Never touch a session with `exitedAt IS NULL` (still running).
7. **Startup behavior:** 5-minute grace delay + recent-run short-circuit (copy `scheduled-housekeeping.ts`), so frequent `npm run dev` restarts don't re-sweep on every boot or pin the main thread during compile.
8. **Manual trigger = a lock-gated CLI verb** (`npx quilltap maintenance …`). No HTTP route, no UI for v1.
9. **Conversation-render chunks: investigate only.** The `UNIQUE(chatId, interchangeIndex)` constraint strongly implies renders upsert in place (no leak). Verify + run a Friday row-count check; add a reap **only** if a real leak is found. Do **not** speculatively delete render data.
10. **Never reap memories or vault/album/gallery content.** Memories are governed only by the existing `MEMORY_HOUSEKEEPING` cap system. A `keep_image` link in a character album or user gallery is an intentional save — the asset sweep only ever considers **generated** story-backgrounds and **chat-scoped** avatar links, never album/gallery/vault links.

---

## 1. What exists today (grounding)

### Scheduler infrastructure (proven, copy it)
- Background schedulers start in **`instrumentation.ts`**, Phase 3.5 (~lines 717–767), inside `register()`. Today: `scheduleCleanup()` (LLM logs), `scheduleHousekeeping()` (memory), `scheduleDangerScan()`, `scheduleAutonomousRooms()`, then the watchers. All wrapped in one try/catch that logs and continues ("non-critical").
- Canonical scheduler shape = **`lib/background-jobs/scheduled-cleanup.ts`** and **`lib/background-jobs/scheduled-housekeeping.ts`**: a module-level `setInterval` handle + a `…Running` boolean guard, `DEFAULT_…_INTERVAL_MS = 24 * 60 * 60 * 1000`, a `schedule…()` starter, a `stop…Scheduler()`, an `is…SchedulerRunning()`, and a `runScheduled…()` doing the work and returning a summary object.
- **`scheduled-housekeeping.ts` has the dev-restart-friendly startup pattern to copy:** `STARTUP_GRACE_MS = 5 * 60 * 1000`, a `setTimeout` first tick, and `runStartupHousekeepingTick()` that short-circuits when a successful scheduled run completed within `RECENT_RUN_WINDOW_MS = 20h` (it peeks recent rows via `repos.backgroundJobs.findRecentByType`). We have no job rows for the maintenance tick (decision 1), so adapt the recent-run check to a **persisted "last maintenance run" timestamp** instead — simplest is a row in `instance_settings` or `quilltap_meta` (e.g. `lastMaintenanceSweepAt`). Read it at startup; skip the startup tick if it's within 20h. The 24h interval fires regardless.
- These are **in-process `setInterval` timers, not durable cron.** They run only while the server is up; "daily" means "24h after process start." Acceptable for self-hosted single-user. Do not add a cron dependency.
- `lib/background-jobs/index.ts` re-exports the scheduler surface — add the new exports there.

### Why parent-side (the architecture constraint behind decision 1)
- Per CLAUDE.md, the parent (Next.js HTTP) process is the **only DB writer**. Job handlers run in a forked child against a **readonly** SQLCipher connection and buffer writes back over IPC for the parent to apply.
- The child-repository proxy (`lib/background-jobs/child/child-repositories-proxy.ts`) classifies each repo method as **read** (pass-through), **write** (buffered), or **unknown** (throws). Its override block (lines ~205–250) documents that the raw-mount-index writers (`docMountFileLinks.linkDocumentContent`, `linkBlobContent`) only work in the child because their callers **discard the return value** — and `CHILD_UNSUPPORTED_METHODS` explicitly carves out `linkFilesystemFile` because a caller that **consumes** the method's result cannot run in the child.
- **`docMountFileLinks.deleteWithGC` is exactly that forbidden shape.** It opens a transaction on `getRawMountIndexDatabase()`, deletes the link, **reads** the remaining-link count, and conditionally deletes the file row — then returns `{ fileId, fileGC }` that the asset collapse must act on. It is not classifiable as a simple buffered write, and the child DB is readonly. **Therefore the asset collapse must run on the parent.** Don't try to make it a child job; the proxy will (correctly) throw.

### Job cleanup (half-built — wire it up)
- **`lib/background-jobs/queue-service.ts:1158-1165`**: `cleanupOldJobs(daysOld = 7)` → `repos.backgroundJobs.cleanupOldJobs(olderThan)`.
- **`lib/database/repositories/background-jobs.repository.ts:510-528`**: `deleteMany({ status: { $in: ['COMPLETED','DEAD'] }, completedAt: { $lt: olderThan.toISOString() } })`. **Single window — must be split** for 7-day/30-day.
- **Nothing in production calls it** — only `__tests__/unit/background-jobs/queue-service.test.ts`. Completed jobs accumulate forever. Easy win.
- Status enum: `lib/schemas/job.types.ts` → `['PENDING','PROCESSING','COMPLETED','FAILED','DEAD','PAUSED']`. Retry-exhausted = `DEAD`; `FAILED` = transient.

### The hard-link asset model (Charlie's "delete the link, GC if last")
- Generated story backgrounds → **`files`** rows (`category:'IMAGE'`, `source:'GENERATED'`) hard-linked into a `story-backgrounds` folder. See **`lib/background-jobs/handlers/story-background.ts`** (~870–939): creates the `files` row, then `chats.update(chatId, { storyBackgroundImageId: fileId, lastBackgroundGeneratedAt })`.
- Current background = **`chats.storyBackgroundImageId`** (`lib/schemas/chat.types.ts:621`, `:927`).
- Chat-scoped avatars = **`chats.characterAvatars[].imageId`**, holding **`doc_mount_file_links.id`** values (post-Phase-3). Character-level (`characters.defaultImageId`, `avatarOverrides[].imageId`) also hold link ids. **`lib/photos/resolve-character-avatar.ts`** resolves both vault-link ids AND legacy `files.id` ids (imports can land legacy ids). Tolerate both; skip the unresolvable.
- **Unlink chokepoint = `repos.docMountFileLinks.deleteWithGC(linkId)`** (`doc-mount-file-links.repository.ts:396-432`): deletes one link, counts remaining links to the same `fileId`, drops `doc_mount_files` (documents/blobs/chunks cascade) only when it was the **last** link. Returns `{ fileId, fileGC }`. **Never delete bytes directly.**
- Reverse index image→links = **`lib/photos/photo-link-summary.ts`** (`getPhotoLinkSummaryBySha256` / `…ByFileId`); `isPhotoAlbum` (`isPhotosRelativePath`) + `mountStoreType` distinguish album/vault links (keep) from `documents`-store links.
- **Orphan safety net exists:** `repos.docMountFileLinks.sweepOrphanedFiles()` (`doc-mount-file-links.repository.ts:905-923`) deletes any `doc_mount_files` with no surviving link. Nothing schedules it.

### Chat staleness signal
- **`chats.lastMessageAt`** (`chat.types.ts:504`), **`chats.messageCount`** (`:503`), `updatedAt`. Use `lastMessageAt`, fallback `updatedAt`. **No `archived`/`pinned`/`favorite` column exists** (verified) — all stale chats are in scope.

### Cascade-bound tables (only leak while a chat is LIVE)
- **`terminal_sessions`** (DDL.md:521) — Ariel PTY rows, `ON DELETE CASCADE` off `chats`. Columns: `startedAt`, `exitedAt` (null while running), `exitCode`, `transcriptPath`. Repo: `lib/database/repositories/terminal-sessions.repository.ts`. **Transcript files** live at `<logsDir>/terminals/<id>.log` (see `lib/terminal/pty-manager.ts:170-171`, `getLogsDir()`), NOT under `files/` — so the user-content watcher ignores them and nothing else cleans them.
- **`conversation_chunks`** (DDL.md:583) + **`conversation_annotations`** (DDL.md:553) — Scriptorium renders, `ON DELETE CASCADE` off `chats`. **`conversation_chunks` has `UNIQUE(chatId, interchangeIndex)`** ⇒ likely upsert-in-place, likely no leak. Treat as investigate-only (Phase 4).

---

## 2. Proposed implementation phases

All sweeps live in **one new parent-side scheduler**, `lib/background-jobs/scheduled-maintenance.ts`, started from `instrumentation.ts` Phase 3.5. `runScheduledMaintenance()` calls each sweep in order, each independently try/caught so one failure doesn't abort the rest, and writes `lastMaintenanceSweepAt` on success.

### Phase 1 — Split job-retention windows
1. In **`background-jobs.repository.ts`**, add `cleanupOldJobsByStatus(completedOlderThan: Date, deadOlderThan: Date): Promise<{ completed: number; dead: number }>` running two `deleteMany` calls (`COMPLETED` w/ `completedAt < completedOlderThan`; `DEAD` w/ `completedAt < deadOlderThan`). Keep the old single-window `cleanupOldJobs` as a deprecated shim so the existing test compiles; production uses the new method.
2. In **`queue-service.ts`**, add a wrapper computing both cutoffs from the constants.
3. `info`-log deleted counts per status + cutoffs; `debug` entry/exit.

### Phase 2 — Stale-chat asset collapse (runs inline on the parent)
A function (e.g. `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`) called by the maintenance tick:
1. Find stale chats: `lastMessageAt` (fallback `updatedAt`) older than `STALE_CHAT_RETENTION_DAYS` (30). Page through the chats repository; `info`-log the batch sizes.
2. Per stale chat, build the **keep set**: `{ storyBackgroundImageId }` ∪ `{ each characterAvatars[].imageId }`, resolved through the link table / `resolveCharacterAvatar` so legacy ids are tolerated.
3. Enumerate the chat's **generated** background links + **chat-scoped** avatar links NOT in the keep set. **Critical guards:** consider only `documents`-store / `story-backgrounds` / chat-scoped-avatar links; **never** `isPhotoAlbum`, never vault/album/gallery links. When unsure, **skip** — leaving an asset is fine; nuking an album image is not.
4. Unlink each via `repos.docMountFileLinks.deleteWithGC(linkId)`. Bytes survive automatically if any live chat or album still links them. `debug`-log each unlink; `info`-log a per-chat summary `{ chatId, unlinked, bytesGCd }` from the `fileGC` returns.
5. Idempotent: re-running over an already-collapsed chat is a no-op.

### Phase 3 — Job cleanup + orphan sweep + terminal retention (all inline on the parent)
The maintenance tick also:
1. Calls the Phase-1 split job cleanup.
2. Calls `repos.docMountFileLinks.sweepOrphanedFiles()` (run **after** the asset collapse so it mops up anything missed); log the swept count.
3. **Terminal sessions:** add `cleanupClosedSessions(olderThan: Date): Promise<{ rows: number; transcripts: number }>` to `terminal-sessions.repository.ts`. Select closed sessions (`exitedAt IS NOT NULL AND exitedAt < ?`), capture their `transcriptPath`/derive `<logsDir>/terminals/<id>.log`, delete the rows, then best-effort `fs.unlink` each transcript file (swallow ENOENT). Never select `exitedAt IS NULL`. `info`-log both counts.

### Phase 4 — Conversation-render investigation (guarded; likely no-op)
1. **Verify** whether `CONVERSATION_RENDER` upserts `conversation_chunks` in place (the `UNIQUE(chatId, interchangeIndex)` suggests yes). Inspect the render handler + chunks repo write path. On Friday: `npx quilltap db --instance Friday "SELECT chatId, COUNT(*) FROM conversation_chunks GROUP BY chatId ORDER BY 2 DESC LIMIT 10;"` vs actual interchange counts.
2. **If it upserts/supersedes**, do nothing but record the finding in §6 "Resolved." **If it appends stale chunks**, add a reap (chunks whose `interchangeIndex` exceeds the chat's current count, or whose `messageIds` reference deleted messages) — only after confirming the leak. Do **not** speculatively delete render data.

### Phase 5 — Manual CLI verb
Add `npx quilltap maintenance` (see `packages/quilltap`). Verbs:
- `maintenance run` — runs `runScheduledMaintenance()` once. **Lock-gated and a DB writer**, so it must claim `<dataDir>/quilltap.lock` like `db --write` does and **refuse when the server holds the lock** (don't fight the running dev server). Reuse the existing lock-acquire plumbing.
- `maintenance status` (optional, read-only) — prints `lastMaintenanceSweepAt` and counts of what *would* be reaped (stale chats, reapable job rows, closed terminal sessions) without deleting. Nice for a dry-run feel.
- Standard `--instance` / `--data-dir` / `--json` plumbing.

---

## 3. Constraints / gotchas to honor
- **Everything runs on the parent.** Do not route any of this through the forked-child job runner; `deleteWithGC` and the raw-mount-index transaction are not child-safe (see §1 "Why parent-side"). The maintenance scheduler executes inline in the parent process like `scheduled-cleanup.ts`.
- **Never bypass `deleteWithGC`.** Direct `doc_mount_files`/`files` deletion orphans or nukes shared bytes.
- **Never reap an album/gallery/vault link, a memory, or a still-current asset.** Asset sweep allowlist = generated story-backgrounds + chat-scoped avatar links of a stale chat, minus the keep set. Else out of scope.
- **Legacy id shapes.** `storyBackgroundImageId` / `characterAvatars[].imageId` may be vault-link ids OR legacy `files.id`. Resolve via the link table / `resolveCharacterAvatar`; skip unresolvable ids.
- **Transcript files are under `<logsDir>/terminals/`, not `files/`.** Use `getLogsDir()` (`lib/terminal/pty-manager.ts`), unlink best-effort, swallow ENOENT.
- **Dev-restart thrashing.** 5-min grace + `lastMaintenanceSweepAt` recent-run skip (20h window). The 24h interval fires regardless.
- **Lock discipline.** The CLI verb is a writer — claim `quilltap.lock`, refuse if the server holds it, never `--lock-override`.
- **Logging.** CLAUDE.md: debug for everything touched, info for per-sweep summaries (counts + cutoffs).
- **No new API routes.**

---

## 4. Testing
- **Unit:** `cleanupOldJobsByStatus` deletes the right statuses at the right cutoffs; leaves `PENDING`/`PROCESSING`/`FAILED`/`PAUSED` alone (extend `queue-service.test.ts`).
- **Unit:** stale-chat collapse — stale chat w/ current bg + 3 old generated bgs → collapses to 1; **active** chat with same → untouched; album-linked image never unlinked; bytes shared with a live chat survive (`fileGC:false`); legacy-`files.id` keep-set ids resolved correctly.
- **Unit:** `cleanupClosedSessions` skips `exitedAt IS NULL`; unlinks the right transcript path; tolerates a missing file.
- **Integration:** run the maintenance tick against a seeded DB; assert `doc_mount_files` counts drop only for truly-orphaned bytes; assert `lastMaintenanceSweepAt` is written.
- **CLI:** `maintenance run` refuses while the lock is held; `maintenance status` is read-only and prints sane counts.
- **Manual on Friday (read-only first):** counts of `background_jobs` by status, closed `terminal_sessions`, stale-chat background links, and the Phase-4 chunk-count check. `npx quilltap db --instance Friday …` is read-only by default.

---

## 5. Docs & bookkeeping (per CLAUDE.md)
- Backend-only, no UI ⇒ a `help/*.md` file is likely **not** required. If any sweep becomes user-visible (a "last cleaned" timestamp, a Host/Librarian announcement on reap), that **does** need a help file in the steampunk/Wodehouse voice with correct `url` frontmatter + In-Chat Navigation block.
- **`docs/CHANGELOG.md`**: terse plain-English entry (the documented exception to project voice).
- **`docs/developer/DDL.md`**: no schema change in v1 (constants only; `lastMaintenanceSweepAt` lives in existing `instance_settings`/`quilltap_meta` — if you add a column for it, update DDL.md and check `.qtap`/SillyTavern export + backup + migration implications).
- **No migration** needed. A future settings-ification would need a migration **with** a `PRETTY_LABELS` entry in `lib/startup/prettify.ts` and `reportProgress` if it loops.
- **No new job type** ⇒ the tool-definition snapshot test and job-type exhaustiveness checks are unaffected — but double-check nothing switch-exhausts `BackgroundJobType` expecting a maintenance entry.
- Update `lib/background-jobs/index.ts` re-exports for new public functions. Document the CLI verb in `packages/quilltap/README.md` and the `update-documentation` command file if it tracks CLI verbs.

---

## 6. Suggested commit slicing
1. Phase 1 (job-retention split) + the new `scheduled-maintenance.ts` skeleton wired into `instrumentation.ts`, calling only the job cleanup. Shippable alone.
2. Phase 3 (orphan sweep + terminal retention + transcript unlink) folded into the tick.
3. Phase 2 (stale-chat asset collapse) — the largest piece.
4. Phase 5 (CLI verb).
5. Phase 4 (render-chunk finding/fix) — likely a docs-only "verified self-cleaning" commit.

Per CLAUDE.md: plan in Opus, delegate the build to Haiku agents with specific per-phase instructions; no git stash/worktrees with agents. Check types with `npx tsc`, not `npm run build`.

---

## Resolved (fill in as you go)
- **Phase 4 finding: `conversation_chunks` (and `conversation_annotations`) are self-cleaning — no reap added.** The `CONVERSATION_RENDER` handler (`lib/background-jobs/handlers/conversation-render.ts`) calls `repos.conversationChunks.upsert(...)` per interchange. `conversation-chunks.repository.ts` `upsert()` looks up the existing row by `(chatId, interchangeIndex)` and **updates it in place** (preserving id/createdAt/embedding) instead of inserting a duplicate; `conversation-annotations.repository.ts` does the same keyed by `(chatId, messageIndex, characterName)`. The `UNIQUE(chatId, interchangeIndex)` / `UNIQUE(chatId, messageIndex, characterName)` constraints guarantee one row per key, and both tables `ON DELETE CASCADE` off `chats`. There is no unbounded append, so no reap was added (per the spec's "do not speculatively delete render data"). The only residual edge — a chat that *shrinks* (messages deleted, then re-rendered) could leave a few high-`interchangeIndex` rows — is bounded by the chat's historical max interchange count and cascades away with the chat; not a leak worth a timer. (Friday row-count spot check is left for the developer to run locally; the code path is conclusive.)
- **Key data-model correction (Phase 2): the chat fields hold `files.id`, not `doc_mount_file_links.id`.** `story-background.ts:815/909/926` and `character-avatar.ts:414/512/535` mint a fresh `crypto.randomUUID()`, use it as the `files`-row PK, and store *that* in `storyBackgroundImageId` / `characterAvatars[].imageId` (the vault bridge's returned `linkId` is discarded). So the implementation enumerates via `files.findByLinkedTo` and deletes through the exported, GC-safe `deleteFileCompletely` chokepoint (which internally routes `mount-blob:` storage keys → `deleteWithGC`), rather than calling `deleteWithGC(linkId)` on the chat fields directly. The keep-set is matched on both id and resolved sha256 so a future migration to link ids stays safe.
- **CLI scope (Phase 5): `maintenance run` does jobs + terminals + orphans only; asset collapse is server-tick-only.** The CLI is plain Node and can't reach the app's `fileStorageManager`/`deleteWithGC`, and it's lock-gated to refuse while the server is up — so the asset collapse (which needs that machinery) runs only on the server's daily tick. `maintenance status` reports a stale-chat count for visibility.
