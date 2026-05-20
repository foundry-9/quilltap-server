# Feature: CLI Tier 1 Completions (post-4.5-dev follow-ups)

**Status:** Proposal / Not Implemented
**Owner:** CLI surface (`packages/quilltap/`)
**Relates to:** 4.5-dev CLI work — `docs ls/dir`, `docs` write subcommands, `instances` registry, `db optimize`, `db` high-level subcommands.

## Why

The 4.5-dev cycle landed a large CLI expansion: a `docs` namespace that can read **and** mutate document mounts, a per-user `instances` registry, and a verb-based layer on top of the `db` flag CLI. Five gaps are the natural completions of that work — items where a near-identical sibling shipped and the obvious follow-up did not. This document describes those five as a single coordinated batch.

The five verbs:

1. `quilltap db backup` — online consistent snapshot of the encrypted databases.
2. `quilltap db integrity` — `cipher_integrity_check` + `integrity_check` across the databases.
3. `quilltap docs find` / `quilltap docs grep` — search file names and extracted text across one mount or all mounts.
4. `quilltap docs reindex` / `quilltap docs embed` — explicit triggers for the extraction and embedding pipelines.
5. `quilltap docs status` — instance-wide rollup of extraction and embedding queue state.

They can be implemented in parallel; nothing here depends on anything else here. The order below is the suggested rollout order, weighted by user value.

## Project conventions to observe

Before touching anything, internalize the project rules from `CLAUDE.md`:

- **API routes:** any new server-side endpoints must live under `/api/v1/` and use the action-dispatch middleware from `@/lib/api/middleware` with response helpers from `@/lib/api/responses`. The `mount-points` endpoint is at `/api/v1/mount-points/[id]` and already uses action dispatch.
- **Type checking:** run `npx tsc` (not `npm run build`) for TS errors.
- **Spelling:** the project is **Quilltap** ("quill" + "tap"), never "Quilttap". A lint rule enforces this; do not fight it.
- **Voice for user-facing docs (help files):** steampunk + Roaring '20s + Wodehouse + Lemony Snicket. The CLI help text (`bin/quilltap.js` `printDbHelp`, `lib/docs-commands.js` help printer) is terse American English — match the style already there.
- **Voice for the CHANGELOG:** terse, direct, American English. The CHANGELOG is the explicit exception to the steampunk voice.
- **Version bumps:** any change in `packages/quilltap/` bumps the patch (third) number of `packages/quilltap/package.json`. Do not run `npm publish`; that is the human's step.
- **Help file conventions:** any user-visible change must be reflected in `help/*.md`. Help files have a `url` field in their frontmatter and an "In-Chat Navigation" section with an exact `help_navigate` tool call. The CLI help page is `help/cli-docs.md` (mounts), `help/cli-db.md` if it exists or the "Database Protection" page otherwise. Check and update as appropriate.
- **Logging:** every new code path on the server side fires debug logs via the project's logging system. Read a recent backend feature in `lib/` to see the pattern.
- **Native modules:** these CLI verbs do not add native modules. If that ever changes, `next.config.js` and the standalone-tarball build need updates — out of scope here.
- **No stubs / no TODOs:** finish the work, end to end. If something has to be deferred, agree on it explicitly first.

The CLI lock policy is set in `lib/db-commands.js` `cmdOptimize` (refuses to run while a live instance holds the lock). `db backup` and `db integrity` follow the same pattern but with different rules — see each section below.

## 1. `quilltap db backup`

### Goal

Produce an online, consistent snapshot of one or all of the three encrypted Quilltap databases (`quilltap.db`, `quilltap-llm-logs.db`, `quilltap-mount-index.db`) **without requiring the server to be stopped**. Today the only safe way to back up an encrypted instance is to stop the server and copy files; this verb closes that gap.

### CLI surface

```text
quilltap db backup [target] [--out <path>] [--json]
```

- `target` — `main`, `llm-logs`, `mount-points`, or `all` (default: `all`). Matches the target vocabulary that `db optimize` already uses.
- `--out <path>` — destination directory for the snapshot. Defaults to `<dataDir>/backups/<ISO-timestamp>/`. Created if it does not exist. Per-database files inside use the source filename (e.g. `quilltap.db`), not a renamed copy.
- `--json` — emit one JSON object per target with `{ target, source, sourceSize, dest, destSize, durationMs, ok, error? }` plus a final summary.

Standard text output: per-database rows showing source path, source size, dest path, dest size, duration, plus a total-bytes summary. Mirror the look-and-feel of `db optimize`.

### Lock policy

Unlike `optimize`, backup is **safe while the server is running**, because `better-sqlite3`'s `db.backup(destPath)` uses SQLite's online backup API and copies pages with proper transaction semantics. Do not refuse on a live lock — log "Live instance detected (PID X) — taking online snapshot" and proceed.

For SQLCipher specifically: the destination file inherits the source's encryption key transparently, because the backup is a page-level copy and the pages themselves are already encrypted. The destination file does **not** need a separate `PRAGMA key`. Verify this with a smoke test (open the backup with the same `.dbkey`, run `SELECT 1`).

### Implementation hints

- Add `cmdBackup` to `packages/quilltap/lib/db-commands.js`, wire into `VERBS`.
- Reuse `openMainDb` / `openLlmLogsDb` / `openMountIndexDb` from `db-helpers.js` to open each source DB.
- Call `db.backup(destPath)` (returns a Promise; the API handles in-flight transactions).
- Pre-flight: refuse if the destination directory is not writable or would overwrite an existing file without the user opting in. Add `--force` if overwrite is a likely need; otherwise just timestamp the directory and never collide.
- Post-flight: open each destination with the same key and run `PRAGMA integrity_check` (cheap version) to confirm the snapshot is readable. Fail loudly if not.
- Help text update in `printDbHelp()` of `bin/quilltap.js`.
- Update `packages/quilltap/README.md` "Database Tool" section.

### Acceptance criteria

- `quilltap db backup` with no args snapshots all three databases to a timestamped directory under `<dataDir>/backups/`.
- `quilltap db backup main --out /tmp/qtap-snap` snapshots only the main DB to that directory.
- Running it against a live instance (with `npm run dev` going) succeeds and the snapshot opens correctly.
- `--json` output is parseable and includes all sizes and durations.
- The CHANGELOG entry under `4.5-dev` describes the verb, lock policy, and SQLCipher behavior.

## 2. `quilltap db integrity`

### Goal

Quick, read-only health check across the three databases. Catches silent corruption that `optimize` does not.

### CLI surface

```text
quilltap db integrity [target] [--json]
```

- `target` — `main`, `llm-logs`, `mount-points`, or `all` (default: `all`).
- `--json` — emit `{ target, ok, integrityCheck, cipherIntegrityCheck, durationMs, issues[] }` per target.

Standard output: per-database `OK` or a tabulated list of issues, plus an aggregate summary line. Exit code 0 if all clean, 1 if any DB reports issues, 2 if a database could not be opened.

### Lock policy

Read-only — runs alongside a live instance with no fuss. Same "live instance detected, proceeding" log line as backup.

### Implementation hints

- Add `cmdIntegrity` to `lib/db-commands.js`, wire into `VERBS`.
- Open each source DB read-only via the existing helpers.
- Run `PRAGMA cipher_integrity_check` (SQLCipher-specific; returns "ok" on success or a list of issues) and `PRAGMA integrity_check` (SQLite standard).
- Parse and surface both results. The former catches HMAC failures; the latter catches structural issues.
- Same help-text and README updates as `db backup`.

### Acceptance criteria

- `quilltap db integrity` runs on all three DBs and exits 0 with a clean instance.
- Output makes it obvious which DB has issues and which pragma flagged them.
- `--json` is parseable and stable.

## 3. `quilltap docs find` and `quilltap docs grep`

### Goal

Find files by name (`find`) or by extracted-text content (`grep`) across one mount or every mount. Today `docs ls`, `read`, `show`, `files`, and `export` all assume the user already knows the path; nothing helps locate it.

### CLI surface

```text
quilltap docs find  [--mount <name|id|all>] [--type file|folder] [--ext <ext>] [--limit N] [--json] <pattern>
quilltap docs grep  [--mount <name|id|all>] [-i] [-l] [--max N] [--context N] [--json] <pattern>
```

- `find`'s `<pattern>` matches against `relativePath`. Default to **substring** match, case-insensitive. Support glob if it falls out cheaply (`*.md`, `Knowledge/**`), otherwise document as substring-only for v1.
- `find` flags:
  - `--type file|folder` — restrict to one or the other.
  - `--ext <ext>` — restrict by file extension (e.g. `--ext md`).
  - `--limit N` — default 100.
- `grep`'s `<pattern>` is searched inside extracted text. Default literal, case-sensitive. `-i` for case-insensitive.
- `grep` flags:
  - `-l` — file paths only (no snippets).
  - `--max N` — max matches per file (default 5).
  - `--context N` — lines of context around each match (default 0).

Both default to **all mounts** when `--mount` is omitted (`--mount all` is the same), with the mount name shown in the first output column. When `--mount <one>` is given, omit the column.

Output columns for `find`: `mount  relativePath  size  modified`. For `grep` without `-l`: `mount  relativePath:line: <snippet>`. `--json` emits the natural object shape.

### Lock policy

Read-only. Opens the mount-index DB directly, like `docs ls`.

### Implementation hints

- Add `handleFind` and `handleGrep` to `packages/quilltap/lib/docs-commands.js`, wire into the verb dispatch.
- For `find`: query `doc_mount_file_links` joined to `doc_mount_files` with `relativePath LIKE ?` (substring → `%pattern%`). Apply ext / type filters in SQL where cheap, in JS otherwise.
- For `grep`: extracted text lives in `doc_mount_file_links.extractedText` for non-text-native files (post the link-table migration described in 4.5-dev) and in `doc_mount_documents.content` for text-native files. Both paths need to be searched; reuse the same content-resolution logic that `docs read` already has.
- Check whether FTS5 indexes already exist on those tables. If yes, prefer them. If no, a `LIKE` scan is acceptable for v1 — document the performance characteristic in the help page and move on.
- Path-prefix filtering for `--mount <name>`: resolve to mount UUID via the existing `requireMount` helper (which already accepts name or UUID and prints candidates on ambiguity).
- Help: extend `help/cli-docs.md` with a "Searching" section in the steampunk voice.

### Non-goals

- No semantic search via embeddings in v1. The embeddings are there but the cost/benefit of wiring them in is higher; do it as a follow-up if find/grep are not enough.
- No regex engines beyond what SQLite's `LIKE` and JavaScript's `String.includes` / `RegExp` give you. If the implementer wants to add `--regex` cheaply, fine; otherwise leave it.

### Acceptance criteria

- `quilltap docs find Manifesto` returns every Manifesto.md across every mount.
- `quilltap docs find --mount "Quilltap General" --ext md Knowledge` returns the `Knowledge/*.md` files in that mount.
- `quilltap docs grep --mount "Quilltap General" "five-point Calvinist"` returns matching files with snippets.
- `-l` produces a clean filename-only list suitable for piping.
- Works with the server running and with the server stopped (read-only path).

## 4. `quilltap docs reindex` and `quilltap docs embed`

### Goal

Explicit triggers for the two background pipelines: text extraction and chunk embedding. Today these run as side effects of `docs write` / `docs move` / `docs copy` when the server is reachable, but there is no way to **re-run** them on existing content — e.g. a file whose extraction failed (`!` in the `text` column of `ls`) or a file whose chunks are only partially embedded (`~` in the `emb` column).

### CLI surface

```text
quilltap docs reindex <mount> [path] [--force] [--wait] [--json]
quilltap docs embed   <mount> [path] [--force] [--wait] [--json]
```

- `<mount>` — required. Name or UUID via the existing resolver.
- `[path]` — optional. If given, only that file or that folder subtree is requeued. If omitted, the whole mount is requeued.
- `--force` — requeue even items already in `converted` / `fullyEmbedded` state. Without it, only items in `pending` / `failed` / `partial` states are touched.
- `--wait` — block until the resulting jobs complete, printing periodic progress. Without it, print the job IDs and return.
- `--json` — emit `{ mount, path?, jobs: [{ id, kind, status }], queued, skipped }` on completion.

### Server-side: required API endpoints

Both verbs talk to the running server (these are job-queue operations; the queue is owned by the parent Next.js process). Add two new actions on `POST /api/v1/mount-points/[id]`:

```text
POST /api/v1/mount-points/[id]?action=reindex
POST /api/v1/mount-points/[id]?action=embed
```

Body: `{ path?: string, force?: boolean }`. Response: `{ jobs: [{ id, kind: 'extract' | 'embed', status: 'queued' }] }` plus aggregate counts.

Implementation lives in `lib/mount-index/` alongside the existing scanner / extractor / embedder. Reuse the existing job-handler functions; the action handler is a thin wrapper that resolves `path` to the affected `doc_mount_file_links` rows and enqueues. Remember: handlers run in the forked child process (see `docs/developer/BACKGROUND_JOBS_CHILD.md`), so any repository write goes through the `getRepositories()` proxy.

Debug-log every step using the project logger.

### CLI failure modes

- Server not reachable: error with a clear message and a non-zero exit. **Do not** silently fall back to a direct DB write — these operations cannot happen without the background job system running.
- Mount not found: candidates printed, exit 2 (matches the rest of `docs`).
- Path not found in mount: print clearly, exit 2.

### Help and docs

- Extend `help/cli-docs.md` with a "Reindexing and Embedding" section in the steampunk voice.
- Update `printDocsHelp` in `lib/docs-commands.js`.
- Note in `CLAUDE.md` (under the "Quilltap conventions" or the docs CLI section) that reindex/embed are explicit verbs now.

### Acceptance criteria

- `quilltap docs reindex "Quilltap General"` queues extraction for every file in that mount and prints job IDs.
- `quilltap docs reindex "Quilltap General" Knowledge --force` requeues every file under `Knowledge/`, including ones already extracted.
- `quilltap docs embed "Quilltap General" --wait` blocks until embedding completes.
- Running with the server stopped produces a clear error, not a partial state.

## 5. `quilltap docs status`

### Goal

Instance-wide rollup of the extraction and embedding queues. Per-file marks in `ls` (`=` / `T` / `~` / `!` / `-` and `Y` / `~` / `-`) are useful for one folder; this verb gives you the same information aggregated across an entire mount or the whole instance.

### CLI surface

```text
quilltap docs status [--mount <name|id>] [--top N] [--json]
```

- `--mount <name|id>` — restrict to one mount. Default: all mounts.
- `--top N` — show the N oldest pending or failed items per category (default 5, 0 to disable).
- `--json` — full structured output.

Default text output shape (one block per mount or one combined block):

```text
Mount: Quilltap General  (mount-id)
  Files
    text-native:        412
    extracted:           93
    extraction-pending:  11
    extraction-failed:    2
  Chunks
    total:             5,217
    embedded:          5,103
    embedding-pending:   114
    embedding-failed:     0
  Oldest pending extractions:
    Knowledge/foo.pdf            queued 2026-05-12 14:32
    Knowledge/bar.docx           queued 2026-05-12 14:32
  Oldest failed extractions:
    Wardrobe/broken.docx         failed 2026-05-10 09:18  ("unsupported format")
```

### Lock policy

Read-only. Opens the mount-index DB directly.

### Implementation hints

- Add `handleStatus` to `lib/docs-commands.js`.
- Single mount-index DB read per invocation. Aggregate with `GROUP BY extractionStatus` on `doc_mount_file_links` for the extraction counts. Chunk counts come from the chunks table joined on `linkId`.
- "Oldest pending / failed" lists: order by the relevant timestamp column on the link row (whichever the extractor uses to mark queue entries — verify in the current scanner code).
- Output format should be human-scannable first, JSON-parseable second.

### Acceptance criteria

- `quilltap docs status` shows every mount with counts.
- `quilltap docs status --mount "Quilltap General"` shows just that mount, including the "Oldest pending" sample.
- `--json` is stable and parseable.
- Numbers reconcile with what `docs ls --recursive` would show file-by-file. (Spot-check on a real instance — Friday has enough variety to be a good test case.)

## Project hygiene checklist

For each of the five (or in one consolidated PR if that fits how Claude Code likes to batch), the work is not done until:

1. **Version bump:** `packages/quilltap/package.json` patch number is incremented. One bump per landed verb is fine; one bump for the whole batch is also fine.
2. **Type check:** `npx tsc` is clean.
3. **Help text:**
   - CLI `--help` for the affected subcommand reflects the new verbs.
   - The relevant `help/*.md` file is updated in the steampunk voice with an "In-Chat Navigation" block that matches its `url` frontmatter.
4. **CHANGELOG:** one entry per verb (or one combined entry — Charlie's call), in terse American English under `4.5-dev`. Match the level of detail in the existing `docs ls`, `docs write`, and `db optimize` entries.
5. **README:** `packages/quilltap/README.md` "Database Tool" and the docs CLI section reflect the new verbs.
6. **DDL doc:** `docs/developer/DDL.md` — only relevant if new tables or indexes were added (the find / grep work might tempt the implementer to add FTS5 indexes; if so, update DDL.md).
7. **CLAUDE.md:** if any new conventions or commonly-needed verbs land, add them to the relevant section so future Claude Code sessions discover them automatically.
8. **Tests / verification:**
   - At minimum, smoke-test every new verb manually against the implementer's dev instance.
   - For server-side endpoints (reindex / embed), add Jest coverage on the action handler.
   - For `db backup`, the smoke test should include opening the backup with the same `.dbkey` and reading at least one table.
   - For `db integrity`, induce a controllable failure (a corrupted test fixture, not a real DB) and confirm the verb reports it correctly.

## Suggested rollout order

1. **`db backup`** — highest-impact, lowest-risk, no new server endpoints.
2. **`db integrity`** — trivial after backup; same scaffolding.
3. **`docs status`** — read-only, no API surface, makes the next two verbs easier to validate.
4. **`docs find` / `docs grep`** — read-only; no server dependency; users will feel this every day.
5. **`docs reindex` / `docs embed`** — last because it adds API surface and depends on the job-system path; pair with `--wait` validated against a stuck queue.

Items 1–4 can be parallelized across Haiku agents per the project's "delegate to agents" guideline. Item 5 should be done as a single coherent piece because the CLI and API land together.

## Out of scope

These were considered and intentionally left out of Tier 1; flag them as Tier 2 candidates if the appetite is there:

- `docs ls --recursive` / `docs tree`.
- `docs ls --sort time|size` and `-r`.
- `instances default <name>` and `instances rename`.
- A top-level `quilltap logs` verb that reads `<instance>/logs/combined.log`.
- Shell completion (`quilltap completion bash|zsh|fish`).
- Promoting the lock verbs out of `db` into a top-level `quilltap lock` namespace.
- A `migrations` namespace (`status`, `run --dry-run`).
- Semantic search inside `docs grep` using the existing embeddings.
