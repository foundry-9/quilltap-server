# Quilltap CLI (`npx quilltap`)

The Quilltap CLI is the primary way to inspect and repair a Quilltap instance. Databases are encrypted with SQLCipher, so the standard `sqlite3` binary **cannot** open them — use this CLI instead.

**Prefer the high-level subcommands over raw SQL.** They auto-pick the right database, resolve names to UUIDs, and avoid the schema trial-and-error loop.

## Inspecting data

### Schema lookup (instead of `PRAGMA table_info`)

- `npx quilltap db schema <table>` — columns, FKs, indexes, and a link back to [DDL.md](DDL.md).
- `npx quilltap db schema --grep <text>` — search tables/columns by substring.
- `npx quilltap db schema` (no args) — grouped overview.

SQLite columns are **camelCase**, mirroring the Zod/TypeScript types (`createdAt`, `updatedAt`, `chatType`, `messageCount`, `projectId`) — **not** `snake_case`. When in doubt, run `db schema <table>` or check [DDL.md](DDL.md).

### Find by name

- `npx quilltap db find character <name>` (also `find chat`, `find project`) — fuzzy substrings and aliases; returns the UUID.

### Drill-down (no hand-written JOINs)

- `npx quilltap db chats --character <name|id>` — chats containing a character
- `npx quilltap db chats --project <name|id>` — chats in a project
- `npx quilltap db messages --chat <name|id> --last N [--full]`
- `npx quilltap db logs --chat <name|id>` / `--message <id>` / `--character <name|id>` / `--tail N`
- `npx quilltap db memories --character <name|id> [--about <name|id>] [--source AUTO|MANUAL]`
- `npx quilltap db characters status [--id <name|id>] [--diverged] [--blocked]` — per-character vault readiness (vault present, files N/8, prompt/scenario/wardrobe counts, DB-vs-vault divergence)

### Single records

- `npx quilltap db message <id>` and `npx quilltap db log <id>` — full content/request/response.

## Maintenance + health

- `npx quilltap db optimize [target]` — VACUUM + ANALYZE + PRAGMA optimize. Refuses while the server holds the lock.
- `npx quilltap db backup [target] [--out <dir>]` — online encrypted snapshot. Safe alongside a running instance; the destination inherits the source's key. Default destination is `<dataDir>/backups/<timestamp>/`.
- `npx quilltap db integrity [target]` — `cipher_integrity_check` + `integrity_check`. Read-only. Exit 0/1/2.

## Document-store CLI (`npx quilltap docs`)

Read-only verbs: `list`, `show`, `files`, `ls`/`dir`, `tree` (ASCII folder hierarchy), `read`, `export`, `find` (substring on filename), `grep` (substring on extracted text), `status` (per-mount extraction + embedding rollup).

Server-required verbs: `scan`, `reindex` (re-extract + re-chunk), `embed` (enqueue embedding jobs — `--wait` polls to completion), and the write verbs (`write`/`delete`/`mkdir`/`move`/`copy`). `reindex` and `embed` are explicit triggers for the two background pipelines; they refuse to run when the server is unreachable.

## Memories CLI (`npx quilltap memories`)

Read-only namespace. Verbs: `ls`, `find` (substring on summary/content), `grep` (pattern search inside content with snippets), `show <id|prefix>` (full record + related-memory neighbors), `tree <id|prefix>` (ASCII walk of the bidirectional related-memory graph with cycle handling), `status` (per-holder rollup including AUTO/MANUAL split, about-distribution, embedding presence, graph stats, dangling-edge count), `validate` (read-only health check; exit 1 on any dangling edge — `--list` prints offending source IDs and dangling targets).

Shared filter flags: `--character` (default `all`), `--about` (with `self`/`none` shortcuts), `--source`, `--chat` (with `none` for manual entries), `--project`, `--since`/`--until`, `--min-importance`/`--min-reinforced`, `--has-embedding`/`--no-embedding`.

Sort flags on `ls`/`find`/`grep`: `--sort reinforced|importance|created|accessed|reinforcement-count|links`, `-r` to reverse. **Default sort is `reinforcedImportance DESC`** (what the recall path uses), not `createdAt DESC` like the legacy `db memories` verb. The legacy verb remains undisturbed.

## Logs CLI (`npx quilltap logs`)

Tail or print an instance's log files without remembering where they live. Flags: `--stream combined|error|stdout|stderr|startup` (comma-separated for multi-stream output with `[stream]` prefixes), `--tail N` (default 100; `0` = full file), `--follow`/`-f` (survives `combined.0.log`-style rotation), `--grep <pattern>` (JS regex). Resolves the logs directory via the same `--instance` / `--data-dir` plumbing the rest of the CLI uses. **Use this rather than `tail -f` on `<instance>/logs/combined.log`** — it follows across rotations and prefixes multi-stream output.

## Migrations CLI (`npx quilltap migrations`)

Read-only verbs: `status` (in-source count vs recorded-applied count vs not-yet-recorded, with retired-from-active counter), `pending` (just the not-yet-recorded list), `run --dry-run` (lists pending; refuses without `--dry-run` because the actual runner stays at startup where the loading screen lives). `--json` on all three.

Note: "not yet recorded" includes migrations whose `shouldRun()` returns `false` on this instance — the CLI does not invoke the predicate, so it cannot distinguish "would skip" from "would run."

## Instances and resolution

### Named instances

Register an instance once with `npx quilltap instances add <name> <path>` (and optionally a passphrase, prompted hidden and verified against the `.dbkey` before saving); then every subcommand accepts `--instance <name>` in place of `--data-dir`. The registry lives at `~/Library/Application Support/Quilltap/instances.json` (mode 0600 enforced). See `npx quilltap instances --help`.

### Default instance

- `npx quilltap instances default <name>` — marks a registered instance as the fall-through target so flag-free `quilltap` invocations use it.
- `instances default --clear` — reverts to the OS platform default.
- `instances rename <old> <new>` — preserves the stored passphrase and updates the `*` marker.

**Resolution precedence:** `--data-dir` > `--instance` > registered default > `QUILLTAP_DATA_DIR` env > OS platform default. The default-instance hint only fires when truly falling back to the OS default (not when the registered default is honored).

### Custom data dir

`npx quilltap db --data-dir ~/iCloud/Quilltap/Friday <subcommand-or-sql>` — pass the **instance root**, not the `data/` subdirectory. The CLI appends `data/quilltap.db` itself, so `--data-dir ~/iCloud/Quilltap/Friday/data` will fail looking for `data/data/quilltap.db`.

## Read-only by default; `--write` makes changes (lock-gated)

The `db` command opens the database **read-only** unless you pass `--write`. So if you need to fix data with an `UPDATE`/`INSERT`/`DELETE`, the move is **`npx quilltap db --write "UPDATE ..."`** — *not* "the CLI can't write." A bare write fails with a hint pointing at `--write`.

`--write` opens the database read-write **only if the instance lock is free**: it claims `<dataDir>/quilltap.lock` (the same lockfile the server uses) for the duration and releases it on exit. It **refuses with no override** if a running server or another instance holds the lock — stop the server first (`npm run dev` holds the lock while it runs). `--repl` is likewise read-only unless combined with `--write` (`npx quilltap db --repl --write`).

**Never reach for `--lock-override` to work around this; it defeats the protection.**

## Low-level (still supported)

- List tables: `npx quilltap db --tables`
- Raw SQL (read-only): `npx quilltap db "SELECT COUNT(*) FROM characters;"`
- Write a change (lock-gated): `npx quilltap db --write "UPDATE characters SET title = 'rival' WHERE id = '...';"`
- Interactive REPL: `npx quilltap db --repl` (read-only; add `--write` for read-write) (plus `.cols <table>` and `.find <text>` shortcuts)
- LLM logs DB: `npx quilltap db --llm-logs --tables`
- Mount-index DB: `npx quilltap db --mount-points --tables`

## Global flags and shell completion

- All subcommands accept `--json` for piping and `--limit N` (default 50). Names are case-insensitive; ambiguous matches print all candidates and exit non-zero.
- `npx quilltap completion bash|zsh|fish` emits a completion script. Dynamic completions for `--instance` shell out to `quilltap instances list --names-only`; mount/character completions similarly use hidden `--names-only` flags. See `packages/quilltap/README.md` for per-shell install instructions.

## See also

- [DDL.md](DDL.md) — full database schema and how to query it.
- [DATABASE_ENCRYPTION.md](DATABASE_ENCRYPTION.md) — SQLCipher key handling.
