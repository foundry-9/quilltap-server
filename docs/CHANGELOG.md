# Quilltap Changelog

## Recent Changes

### 4.5-dev

#### `quilltap memories` — new read-only CLI namespace

New top-level subcommand with six read-only verbs (`ls`, `find`, `grep`, `show`, `tree`, `status`) for surveying the memories table. Mirrors the shape of `quilltap docs`: shared filter flags (`--character`, `--about` with `self`/`none` shortcuts, `--source`, `--chat` with `none` shortcut, `--project`, `--since`, `--until`, `--min-importance`, `--min-reinforced`, `--has-embedding` / `--no-embedding`), shared sort vocabulary (`--sort reinforced|importance|created|accessed|reinforcement-count|links`, `-r` to reverse), `--limit N`, `--json`. All verbs open `quilltap.db` read-only.

- `ls` — column listing modelled on `docs ls`. Defaults to `reinforcedImportance DESC` (what the recall path uses), not `createdAt DESC` like the legacy `db memories` verb. Shows holder + `imp` + `rein` + `src` + `about` + `chat` + `links` + `emb` + `summary`; holder column conditional on `--character all`.
- `find <pattern>` — substring match against `summary` (default), `content`, or `both` via `--in`. Relevance ranking when `--sort` is unset (summary-hit > content-only-hit, then reinforced + recency).
- `grep <pattern>` — pattern search inside `content` with snippet formatting. Same `-i` / `-l` / `--max` / `--context` semantics as `docs grep`.
- `show <id|prefix>` — long-form record with related-memory neighbors. `--depth N` (default 1, cap 4), `--no-related`, prefix-matching at ≥8 chars.
- `tree <id|prefix>` — ASCII walk of the bidirectional related-memory graph. Cycle handling via visited-set (renders as `↺ <id>`), dangling edges render as `✗ <id>  (deleted or missing)`. `--depth N` (default 2, cap 4), `--max-nodes N` (default 100, cap 1000).
- `status` — per-holder rollup: AUTO/MANUAL split, about-distribution (self / about-others / legacy-null), embedding presence, graph stats (with-links / isolated / avg degree / max degree / dangling edges). Top-5 by `reinforcedImportance`. Dangling-edge count surfaces stale UUIDs in `relatedMemoryIds` after deletions; logs offenders to stderr.

The legacy `quilltap db memories --character <name>` verb is unchanged. Implementation in `packages/quilltap/lib/memories-commands.js`; dispatcher branch added to `bin/quilltap.js`. Character / chat / project resolvers moved from `lib/db-commands.js` into `lib/db-helpers.js` so both namespaces share them. New migration `add-memories-reinforced-importance-index-v1` adds `idx_memories_reinforcedImportance` so the new default sort uses an index instead of a full-table sort on instances with tens of thousands of memories.

#### CLI: friendlier guidance when targeting the wrong instance

Two small UX fixes on the `quilltap docs` / `quilltap db` CLI surfaces:

1. **Default-instance hint.** When neither `--instance` nor `--data-dir` is passed (and `QUILLTAP_DATA_DIR` is unset), the CLI now writes a one-line stderr hint listing the registered instances and the data directory it ended up using, so it is obvious when a command silently fell back to the platform default. Fires at most once per process; set `QUILLTAP_QUIET_HINTS=1` to silence. Wired up in `bin/quilltap.js` (db subcommand), `lib/docs-commands.js` (every `docs` verb via `openDb`), and `lib/memory-diff-command.js`.

2. **Pre-flight mount-index schema check.** `docs` verbs now verify the `doc_mount_file_links` table exists before any `prepare()` runs, and exit with an explanatory error pointing at the offending database, the missing table, and what to do (boot the server against that data directory once to run migrations, or pass `--instance <name>`). Previously the read failed deep inside a prepared statement with `Error: no such table: doc_mount_file_links`. Implementation in `lib/docs-commands.js` (`assertDocsSchema`).

`resolveDataDirAndPassphrase` in `lib/db-helpers.js` now returns a `usedPlatformDefault` flag so the hint can tell explicit targeting (`--instance`, `--data-dir`, env var) from a silent fallback. New exported helper `printDefaultInstanceHint(resolved)` consumes it.

#### `quilltap db backup` — online encrypted snapshots

New CLI verb that produces a consistent snapshot of all three encrypted databases (or one named target) without requiring the server to be stopped. Default destination is `<dataDir>/backups/<ISO-timestamp>/`; override with `--out <dir>`. `--json` is supported.

Implementation: SQLCipher's `sqlcipher_export` is not compiled into `better-sqlite3-multiple-ciphers`, and the SQLite online-backup API refuses cross-cipher copies, so the verb instead opens the source RW, runs `PRAGMA wal_checkpoint(TRUNCATE)`, takes a brief `BEGIN EXCLUSIVE` lock, copies the encrypted `.db` file byte-for-byte, and releases the lock. The destination inherits the source's encryption key transparently because the pages are already encrypted. Post-flight: each snapshot is re-opened with the same pepper and `PRAGMA quick_check` is asserted.

Lock policy: unlike `optimize`, does not refuse on a live lock — logs "Live instance detected (PID X) — taking online snapshot" and proceeds. The exclusive lock held during the file copy is short (~150 ms for 300 MB on local SSD) and falls within SQLite's busy_timeout. Implementation in `packages/quilltap/lib/db-commands.js` (`cmdBackup`, registered in `VERBS`). Help text in `bin/quilltap.js` `printDbHelp()` and the "Database Protection" help page.

#### `quilltap db integrity` — online cipher + structural health checks

New CLI verb that runs `PRAGMA cipher_integrity_check` plus `PRAGMA integrity_check` against the encrypted databases. Read-only; safe alongside a running instance. Exit codes: 0 on clean, 1 on any reported issue, 2 on open failure. `--json` is supported. Implementation in `lib/db-commands.js` (`cmdIntegrity`).

#### `quilltap docs find` / `docs grep` — substring search across mounts

Two read-only CLI verbs that fill the gap left by `docs ls` (which assumes you already know the path). `find <pattern>` matches `pattern` as a case-insensitive substring against `doc_mount_file_links.relativePath`; `grep <pattern>` matches against the extracted text of each file, reusing the same content-resolution decision tree as `docs read --rendered`.

- `find` flags: `--mount <name|id|all>`, `--type file|folder`, `--ext <ext>`, `--limit N` (default 100).
- `grep` flags: `--mount <name|id|all>`, `--ignore-case`, `-l` (paths-only), `--max N` per file (default 5), `--context N` lines (default 0).

Both default to all mounts when `--mount` is omitted (the mount-name column is included in output). Implementation: simple `LIKE` scans on the mount-index DB plus a JS substring search for `grep` — no FTS5 indexes added in v1. Documented as a known performance trade-off in `help/cli-docs.md` ("Searching" section). Implementation in `packages/quilltap/lib/docs-commands.js` (`handleFind`, `handleGrep`).

#### `quilltap docs reindex` / `docs embed` — explicit pipeline triggers

Two CLI verbs and two API actions that re-run extraction and embedding on demand. Both require the running server (the background-job queue and the embedding pipeline live in the parent Next.js process); the CLI refuses with a clear error if the server is unreachable rather than falling back to a partial state.

- `docs reindex <mount> [path] [--force]` — synchronous. Resolves `path` to either one file or every link under a folder prefix, then re-extracts plaintext via `convertBufferToPlainText`, re-chunks via `chunkDocument`, replaces the existing chunk set, and updates the link's `extractionStatus` / `extractedText` / `extractedTextSha256` / `chunkCount`. Without `--force`, only PDFs/DOCX in `none|pending|failed|skipped` (and text-native files with no chunks yet) are touched; with `--force`, every link in scope.
- `docs embed <mount> [path] [--force] [--wait]` — enqueues `EMBEDDING_GENERATE` jobs for chunks under the path scope. Without `--force`, only `embedding IS NULL` chunks; with `--force`, every chunk in scope (though the queue's existing dedup avoids double-enqueue). `--wait` polls `GET /api/v1/system/jobs/[id]` until each job reaches a terminal state.

New helper `lib/mount-index/reindex.ts` exports `reindexLinks(mountPoint, opts)` and `enqueueEmbeddingJobsScoped(mountPoint, opts)`. Two new actions on `POST /api/v1/mount-points/[id]`: `reindex` and `embed`, registered in the existing `withActionDispatch` map. CLI handlers in `packages/quilltap/lib/docs-commands.js` (`handleReindex`, `handleEmbed`, `callMountAction`, `pollJob`).

#### `quilltap docs status` — instance-wide extraction + embedding rollup

New read-only CLI verb that aggregates `doc_mount_file_links` and `doc_mount_chunks` counts per mount and prints the result as a human-scannable block per mount. Reports text-native vs. extracted vs. extraction-pending vs. extraction-failed file counts, total vs. embedded chunk counts, and the oldest pending / failed extractions (sample list size controlled by `--top N`, default 5; `0` disables). `--mount` narrows to one mount; `--json` emits the full structured object. Implementation in `lib/docs-commands.js` (`handleStatus`).

#### `doc_mount_file_links.folderId` drift — auto-derive on write + repair migration

The three `link*` methods on `DocMountFileLinksRepository` (`linkBlobContent`, `linkDocumentContent`, `linkFilesystemFile`) now derive `folderId` from `relativePath` inside their existing transaction, creating any missing `doc_mount_folders` rows along the way. The caller-supplied `folderId` field is treated as informational and ignored; the repository logs a `warn` when the caller's value disagrees with the derived one so we can find the broken writer.

The root cause was the scanner (`lib/mount-index/scanner.ts:193`) calling `linkFilesystemFile` without passing `folderId` at all — every filesystem-scanned row landed at `folderId = NULL` regardless of subfolder. Surface symptom: `quilltap docs ls` filtering by `folderId` returned partial results, and any UI / API path that joined through `folderId` produced the same wrong answer.

<!-- cspell:ignore folderids -->
New migration `repair-doc-mount-file-link-folderids-v1` walks every `doc_mount_file_links` row, computes the canonical `folderId` from `(mountPointId, relativePath)`, creates any missing folder rows, and `UPDATE`s on drift. Idempotent; `shouldRun()` short-circuits when no `folderId IS NULL AND relativePath LIKE '%/%'` row exists. Pretty-label and `reportProgress(...)` wired up per the migration rules.

#### `quilltap docs ls` / `dir` — POSIX-style folder listing with hard-link counts

New read subcommand that lists one folder (or one file) in `ls -l` style:

```text
T  links     size  modified          text  emb  name
d      -        -  2026-04-18 11:49     -    -  Wardrobe/
-      2   3.4 KB  2026-05-11 13:47     =    Y  Manifesto.md
-     20      0 B  2026-05-18 10:04     =    -  example-dialogues.md
-      2  71.7 KB  2026-05-15 13:30     T    Y  2026-03-24T06-24-23.319Z-kept.webp
```

- `<mount> [path]`: path defaults to the mount root; `/` and `.` are treated as root. A path that resolves to a single file shows just that file.
- The `links` column reports how many `doc_mount_file_links` rows share the same `fileId` — i.e., how many hard-linked siblings the underlying content row has across the entire mount-index DB. Folders show `-`.
- The `text` column is a single-character marker for the file's textual representation: `=` raw bytes are already textual (markdown/txt/json/jsonl); `T` separately-extracted plaintext is stored on the link row (`extractionStatus = 'converted'`); `~` extraction is pending; `!` extraction failed; `-` no extracted text and the file is not text-native.
- The `emb` column is a single-character marker for chunk embeddings: `Y` every chunk has an embedding; `~` chunks exist but only some / none are embedded yet; `-` no chunks at all.
- `--links` expands each file with `linkCount > 1` to print the sibling list as indented arrows. Same-mount siblings are shown as bare paths; cross-mount siblings are prefixed with `mountName:`.
- `--json` always emits the full `links` array (mount UUID, mount name, relative path) regardless of `--links` — there is no display-noise advantage to omitting the current mount in machine output. JSON also includes `textRepresentation` (`kind`, `extractionStatus`, `hasExtractedText`) and `embedding` (`chunkCount`, `embeddedChunkCount`, `fullyEmbedded`) objects per file.
- Folders are listed before files; within each group, ordering is case-insensitive by name.
- `dir` is an alias for `ls`.

Membership filtering uses path-prefix matching on `relativePath` / `path` rather than `folderId` / `parentId`, because `doc_mount_file_links.folderId` is observed to drift to NULL on existing instances — multiple `Knowledge/*.md` files in Friday's "Quilltap General" mount had `folderId = NULL`, which made the folderId-based query return only the one row that still carried the correct pointer. Path-prefix matching produces the same answer `docs files --folder` already gives and is unaffected by that drift. Single-file lookups go by exact `relativePath` match. An implicit-folder fallback (no `doc_mount_folders` row but children exist under the prefix) keeps a path like `quilltap docs ls <mount> Knowledge` working even on instances where the folder row itself is missing.

Read-only — opens the mount-index DB directly, so it works with or without the server running.

#### `quilltap docs` — accept global flags before the verb

`quilltap docs --instance Friday read <mount> <path>` (and other docs invocations with `--instance`, `--data-dir`, `--passphrase`, `--port`, `--json`, etc. placed before the subcommand) failed with `Unknown docs subcommand: --instance`. The dispatcher took `args[0]` as the verb before parsing flags, so any flag in front of the verb was treated as the subcommand. Fixed by parsing flags across the entire arg list first, then shifting the first positional as the verb — matching how `db`, `themes`, and `memory-diff` already behave.

#### `quilltap docs` read subcommands — fix queries against post-link-table schema

`docs show`, `docs files`, `docs read`, and `docs export` were still issuing the pre-`doc_mount_file_links` queries (`SELECT … FROM doc_mount_files WHERE mountPointId = ? AND relativePath = ?` and similar against `doc_mount_blobs`/`doc_mount_documents`), so every invocation failed with `Error: no such column: mountPointId` once a database had been through the link-table migration. Reissued every query through the new schema:

- File lookups join `doc_mount_file_links` (`mountPointId`, `relativePath`) to `doc_mount_files` (`fileId` → content row).
- Content lookups in `doc_mount_documents` and `doc_mount_blobs` go by `fileId` directly (both are 1:1 with `doc_mount_files.id`).
- Chunks read by `linkId` instead of `fileId`.
- `docs show` blob/doc counts join through `doc_mount_file_links` to scope per-mount counts under the new content-addressable layout.
- `docs read --rendered` reads `extractedText` from `doc_mount_file_links` (the field moved off `doc_mount_blobs` in the migration).
- Dropped the legacy "defensive" pass in `docs export` that scanned `doc_mount_blobs` directly for rows without a `doc_mount_files` entry — link rows are now the authoritative membership signal.

#### `quilltap docs` — write subcommands (write/delete/mkdir/move/copy)

New CLI verbs that mutate document mounts in addition to the existing read-only set. Mount arguments accept either the mount name (case-insensitive) or its UUID; ambiguous names print candidates and exit non-zero.

- `write [--force] <mount> <path> [file]` — write bytes from a local file or stdin; refuses to overwrite without `--force`.
- `delete <mount> <path>` — idempotent (no-op if the path is already gone).
- `mkdir <mount> <path>` — idempotent; creates parent folders as needed.
- `move <srcMount> <srcPath> <dstMount> <dstPath>` — hard-links where the storage layout allows (DB↔DB shares a content row by `fileId`; FS↔FS on the same device uses `fs.rename`); falls back to a byte copy across storage types or devices.
- `copy [--force] <srcMount> <srcPath> <dstMount> <dstPath>` — same hard-link semantics. `--force` overwrites and skips the hard-link path for a real byte copy (FS↔FS only; DB content is sha-deduplicated regardless).

Every write computes a SHA-256 on both ends and refuses to declare success unless the digests match. The CLI talks to the running server when reachable (so reindex/embed kicks off automatically); when the server is down it falls back to direct filesystem writes for filesystem-backed mounts, and errors out for database-backed mounts.

Implementation:

- New server-side helper `lib/mount-index/file-ops.ts` with `moveFile`, `copyFile`, `writeFile`, and `deleteFile`. Centralizes the four storage-type combinations (FS→FS, DB→DB, and the two cross-storage directions), hard-link primitives, byte-copy fallbacks, and pre/post sha verification. Exposes `FileOpError` with structured codes (`SOURCE_NOT_FOUND`, `DEST_EXISTS`, `INVALID_PATH`, `VERIFY_FAILED`, etc.).
- New actions on `POST /api/v1/mount-points/[id]`: `move-file`, `copy-file`, `write-file`, `delete-file`.
- CLI changes in `packages/quilltap/lib/docs-commands.js`: `handleWrite`, `handleDelete`, `handleMkdir`, and `handleFileOp` (shared by move/copy). `requireMount` now resolves either a name or a UUID; existing read subcommands inherit that.
- Help: `help/cli-docs.md` describes the new subcommands, hard-link semantics, and verification policy.

#### `quilltap instances` — named-instance registry for the CLI

New CLI subcommand and `--instance <name>` flag. The CLI now stores a per-user registry of named Quilltap instances (path + optional database passphrase) at `~/Library/Application Support/Quilltap/instances.json` on macOS (`~/.quilltap/instances.json` on Linux, `%APPDATA%\Quilltap\instances.json` on Windows). Once an instance is registered, every subcommand that accepts `--data-dir` will also accept `--instance Friday` — the CLI translates it to the correct data directory and supplies the stored passphrase if one is set.

Verbs:

- `quilltap instances list` (default) — table of registered instances with path and whether a passphrase is stored
- `quilltap instances add <name> [<path>]` — register an instance; prompts (hidden, with confirmation) for an optional passphrase and verifies it against the instance's `.dbkey` before saving
- `quilltap instances remove <name>` — forget an instance
- `quilltap instances set-passphrase <name>` — change or clear the stored passphrase; same verification as add
- `quilltap instances show <name>` — print path + whether a passphrase is set + presence of `data/`, `.dbkey`, `quilltap.db`
- `quilltap instances path` — print the path to `instances.json`

The file contains plaintext passphrases, so the read path refuses to load it unless it is owned by the current user and has POSIX permissions with no group/other bits set (mode `0o600` or stricter). Failure prints the exact `chmod 600 <path>` to run. Writes go through a temp-file-then-rename with mode `0o600` from creation so the file never exists with looser bits. The check is skipped on Windows.

`--instance` works with the server launcher (`quilltap --instance Friday` to start the server pointed at Friday's data directory) and the `db`, `docs`, `themes`, and `memory-diff` subcommands. `--instance` and `--data-dir` are mutually exclusive — supplying both errors out. The passphrase resolution chain is now: explicit `--passphrase` > stored passphrase from `--instance` > `QUILLTAP_DB_PASSPHRASE` env var > interactive hidden prompt.

Implementation: `packages/quilltap/lib/instances.js` (registry I/O, permission check, passphrase verification), `packages/quilltap/lib/instances-commands.js` (CLI surface), `resolveDataDirAndPassphrase()` added to `packages/quilltap/lib/db-helpers.js`, and `--instance` wiring in `bin/quilltap.js`, `lib/docs-commands.js`, `lib/theme-commands.js`, and `lib/memory-diff-command.js`.

#### `quilltap db optimize` — basic database maintenance

New CLI verb that runs `VACUUM`, `ANALYZE`, and `PRAGMA optimize` against the encrypted SQLite databases. Reclaims free pages and refreshes query-planner stats.

Usage: `quilltap db optimize` (all three databases) or `quilltap db optimize <main|llm-logs|mount-points>` (one). Default with no positional argument hits all three. `--json` is supported. Per-database output shows before/after file size and per-step timing, plus a total-reclaimed summary across all targets.

Refuses to run while the instance lock is actively held (live PID on this host, or a fresh VM heartbeat). Proceeds when the lock is absent or stale. Lock state is inspected via the new shared helper `packages/quilltap/lib/lock-helpers.js` (`getLockStatus(dataDir)`), which encapsulates the PID/`verifyPidIsNode`/heartbeat logic previously inlined in `bin/quilltap.js`.

Implementation lives in `packages/quilltap/lib/db-commands.js` (`cmdOptimize`, wired into the `VERBS` table; `pepper` is now exposed on the verb-dispatch ctx so optimize can open writable handles via the existing `openMainDb` / `openLlmLogsDb` / `openMountIndexDb` helpers). Help text in `bin/quilltap.js` `printDbHelp()` and the "Database Protection" help page describe the new verb.

#### `quilltap db` high-level subcommands

`packages/quilltap` gains a verb-based layer on top of the existing flag/SQL CLI so common drill-downs no longer require hand-written SQL. New file `packages/quilltap/lib/db-commands.js`; `bin/quilltap.js` dispatches to it when `args[0]` matches a known verb, otherwise the legacy flag path runs unchanged.

Verbs:

- `schema [table]` — column list with FKs and indexes; `schema` alone prints tables grouped by domain; `schema --grep <text>` searches tables/columns. Single-table output ends with `→ docs/developer/DDL.md#<table>` so the canonical reference is one click away.
- `find character|chat|project [query]` — fuzzy name → UUID (character lookup also searches `aliases`).
- `chats --character <name|id>` (uses `participants LIKE`), `chats --project <name|id>`.
- `messages --chat <id|title>` with `--last N`, `--full`, `--from`, `--type`.
- `logs --chat|--message|--character|--tail` — auto-resolves name→UUID across the main/llm-logs DB boundary.
- `message <id>` and `log <id>` — full single-record body (log accepts `--field request|response|both`).
- `memories --character <id|name>` with `--about` and `--source` filters.

All verbs accept `--json` and `--limit N`. Ambiguous name resolution prints all candidates and exits with code 2.

REPL gains `.cols <table>` (alias for `PRAGMA table_info`) and `.find <text>` (tables/columns substring search). Existing `.tables` and `.schema` are unchanged.

`packages/quilltap/lib/db-helpers.js` factored out `openEncryptedDb(dbPath, pepper, opts)` and added `openMainDb` / `openLlmLogsDb` alongside the existing `openMountIndexDb`, so all three databases open through the same code path.

Docs updated: `packages/quilltap/README.md` (new "Database Tool" section), `docs/developer/DDL.md` ("How to Query" split into high-level and low-level), `CLAUDE.md` (claude-specific instructions point at the subcommands first).
