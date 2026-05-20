# Feature: CLI Tier 2 — Ergonomic follow-ups

**Status:** Proposal / Not Implemented
**Owner:** CLI surface (`packages/quilltap/`)
**Builds on:** Tier 1 (`db backup`, `db integrity`, `docs find` / `docs grep` / `docs status`, `docs reindex` / `docs embed`), Tier 1.5 (`memories` namespace), and the memory-graph repair work.

## Why

Tier 1 and 1.5 built the heavy machinery: new namespaces, search and grep across mounts and memories, online backups, integrity checks, and a repaired memory graph. Tier 2 is the loose ends — small ergonomic gaps that each cost the user real friction but didn't fit cleanly into the earlier batches. The items are mostly independent and can ship in any order.

Seven items, ranked by user-value-per-line-of-code:

1. Shell completion for the CLI (`quilltap completion bash|zsh|fish`).
2. Top-level `quilltap logs` verb to tail an instance's log files.
3. `docs ls --recursive` and `docs tree`.
4. `docs ls` sort flags (`--sort time|size|name`, `-r`).
5. `instances default <name>` and `instances rename <old> <new>`.
6. `migrations` namespace (`status`, `pending`, `run --dry-run`).
7. Semantic search (`docs grep --semantic`, `memories grep --semantic`).

Items 1–6 share no dependencies; pick them off in any order. Item 7 is the largest design surface and the only one with non-trivial implementation depth; treat it as a separate PR even if the others are batched.

## Project conventions to observe

Same rules as Tier 1 — Claude Code has been through this twice now, so the short version:

- Version bump `packages/quilltap/package.json` patch number per landed item (or once per batch — Charlie's call).
- `npx tsc` must be clean.
- Steampunk-Wodehouse voice for `help/*.md`; terse American English for the CHANGELOG.
- Every user-visible change reflected in a help file with the `url` frontmatter and an "In-Chat Navigation" `help_navigate` block.
- `--instance` flag works on every new verb that touches an instance's data directory.
- No stubs; no TODOs without prior agreement.
- Debug logging on new code paths via the project logger.

## 1. Shell completion

### Goal

`quilltap completion bash|zsh|fish` emits a completion script for the given shell. Sourcing it gives tab-completion for verbs, subcommands, and the most useful flag values.

### CLI surface

```text
quilltap completion bash      > ~/.quilltap-completion.bash    # source from .bashrc
quilltap completion zsh       > "${fpath[1]}/_quilltap"        # zsh completion dir
quilltap completion fish      > ~/.config/fish/completions/quilltap.fish
```

### What it should complete

- Top-level verbs: `db`, `docs`, `themes`, `instances`, `memories`, `memory-diff`, `completion`, plus the start-the-server flags (`--port`, `--data-dir`, `--instance`, `--open`, `--version`, `--update`, `--help`).
- Second-level verbs per namespace: `db schema|find|chats|messages|logs|message|log|memories|optimize|backup|integrity`; `docs ls|find|grep|show|status|reindex|embed|read|export|write|delete|mkdir|move|copy|files`; etc.
- Shared flags: `--instance` completes against the names in `instances.json`. `--character`, `--about`, `--chat`, `--project`, `--mount` complete against the actual entities in the active instance (best-effort — read from the DB if available, fall back to no completion if not).
- File paths after `docs read`, `docs write`, etc.

### Implementation hints

- Generate the scripts via templates in `packages/quilltap/lib/completion/{bash,zsh,fish}.template`. Keep them in the repo as plain files so they're reviewable, not generated as one-line strings from JS.
- Dynamic completions (for `--instance` names, `--character` resolution, etc.) shell out to `quilltap` itself with a hidden flag that dumps a newline-separated list — e.g., `quilltap instances list --names-only`. Add that hidden flag where needed.
- For zsh: use `_arguments` and `_values`. For bash: use `complete -F` with a dispatcher function. For fish: `complete -c quilltap -n` clauses per verb.
- Test on each shell by sourcing the output and verifying tab-completion works for at least: a top-level verb, a second-level verb, `--instance Fr<TAB>`, and `--character Fri<TAB>` (which should hit the instance's DB).

### Acceptance criteria

- `quilltap completion bash` emits a non-empty bash completion script. Sourcing it makes `quilltap d<TAB>` offer `db docs`.
- `--instance` completion suggests names from `instances.json`.
- The dynamic-entity completions (`--character`, `--mount`) work against the user's default or `--instance`-specified data dir, and silently no-op when no DB is reachable.
- README updated with installation instructions per shell.

## 2. `quilltap logs`

### Goal

Tail or print an instance's log files without having to remember where they live. Especially valuable now that `--instance` resolves to many possible paths.

### CLI surface

```text
quilltap logs [--instance <name>] [--stream combined|error|stdout|stderr|startup] [--tail N] [--follow] [--grep <pattern>]
```

- `--stream` — which log to read. Default `combined`. Multi-value (comma-separated) lets you tail multiple at once with stream-prefixed lines.
- `--tail N` — last N lines. Default 100. `--tail 0` means "no head trim" (full file).
- `--follow` / `-f` — stream as new lines arrive. Standard `tail -F` semantics (handles file rotation).
- `--grep <pattern>` — server-side line filter applied before output. Use ripgrep if available, else a JS regex.
- Resolves the logs directory via the same `resolveInstance` / `resolveDataDir` helpers the rest of the CLI uses. Logs live at `<instance>/logs/`.

### Implementation hints

- Add `packages/quilltap/lib/logs-commands.js` and wire into `bin/quilltap.js` alongside the existing dispatchers.
- File rotation matters: `combined.log` and `error.log` are auto-rolled every 2–3 MB per `CLAUDE.md`. `--follow` needs to detect file replacement (inode change) and reopen, not just `fs.watchFile`. Use a small dependency or hand-roll it; `tail -F` semantics are what we want.
- `--grep` runs in the CLI process, not via shelling out to `rg`, so there's no platform dependency.
- Color: dim timestamps, normal log message, red for `error`, yellow for `warn`, blue for `info`, gray for `debug`. Auto-suppress when stdout isn't a TTY.
- For `--stream startup`, also surface the Electron-side `startup.log` if present (per `CLAUDE.md`'s instance log conventions).

### Acceptance criteria

- `quilltap logs --instance Friday` prints the last 100 lines of `combined.log` for Friday.
- `quilltap logs -f` follows new lines, including across file rotation.
- `--grep ERROR` filters correctly.
- Multi-stream output (`--stream combined,error`) prefixes lines so the source is obvious.

## 3. `docs ls --recursive` and `docs tree`

### Goal

The current `docs ls` lists one folder. There's no way to see an entire mount at once or render it as a tree. Both are obvious POSIX-shaped follow-ups.

### CLI surface

```text
quilltap docs ls <mount> [path] [--recursive] [-R]            # `--recursive` and `-R` are aliases
quilltap docs tree <mount> [path] [--depth N] [--max-nodes N]
```

- `docs ls -R <mount>` lists every file recursively. Per-folder grouping in the output (folder header line followed by its files), so it's still readable on a big mount.
- `docs tree` produces ASCII tree output with the same icons and markers as `ls` (`text` / `emb` columns optional via `--long`). Default `--depth` unlimited; `--max-nodes` caps the output at 1000 by default with a clear truncation message at the end.

### Implementation hints

- Both verbs are read-only; they extend `lib/docs-commands.js`'s `handleLs` (for `-R`) and add `handleTree`.
- Membership filtering by path prefix on `relativePath` is already the pattern in `ls` (per the 4.5-dev `folderId`-drift fix). Reuse it.
- Tree rendering: same ASCII box-drawing style as `memories tree` from Tier 1.5, so the two visual conventions match.
- `--json` on `tree` returns a nested-object tree.

### Acceptance criteria

- `quilltap docs ls -R "Quilltap General"` prints every file in the mount, grouped by folder.
- `quilltap docs tree "Quilltap General" Knowledge` shows the Knowledge subtree.
- `--max-nodes` truncation message is clear about being incomplete.

## 4. `docs ls` sort flags

### Goal

The current `docs ls` sorts case-insensitively by name. POSIX `ls` accepts `-t` (mtime), `-S` (size), and `-r` (reverse). The columns are already in the output.

### CLI surface

```text
quilltap docs ls <mount> [path] [--sort name|time|size|links] [-r]
```

- `--sort name` (default) — case-insensitive alphabetic.
- `--sort time` — by `modified` descending.
- `--sort size` — by file size descending.
- `--sort links` — by `linkCount` (hard-link sibling count) descending. Useful for finding the most-shared content.
- `-r` / `--reverse` — flip the order.

POSIX short-flag aliases (`-t`, `-S`) are nice-to-have but optional; `--sort` is the canonical surface.

### Implementation hints

- Trivial extension to `handleLs` in `lib/docs-commands.js`. The data is already there; the sort is applied after the query before rendering.
- Folders still group before files within each sort.

### Acceptance criteria

- `docs ls --sort time` lists most-recently-modified first.
- `docs ls --sort size -r` lists smallest first.
- Sort flags work alongside `--recursive` (item 3).

## 5. `instances default <name>` and `instances rename <old> <new>`

### Goal

Two small ergonomic gaps in the `instances` registry shipped in 4.5-dev:

- No way to mark a default instance — so `quilltap` without flags falls back to the OS platform default rather than (for example) Friday.
- No way to rename a registered instance without removing and re-adding it, which loses the stored passphrase verification.

### CLI surface

```text
quilltap instances default <name>           # mark as default
quilltap instances default --clear          # remove default; fall back to OS platform default
quilltap instances default                  # print current default (no args)
quilltap instances rename <old> <new>       # rename in place; preserves passphrase
```

### Implementation hints

- Extend `packages/quilltap/lib/instances.js` to store a top-level `defaultInstance: string | null` field in `instances.json` alongside the existing instances map.
- `resolveDataDirAndPassphrase()` in `db-helpers.js` consults `defaultInstance` when neither `--instance` nor `--data-dir` is given. Order of precedence: `--data-dir` > `--instance` > registered default > OS platform default. Document this in the help text.
- `rename` updates the key in the JSON map; the rest of the record (path, passphrase) is unchanged.
- `instances list` shows a `*` next to the default in the table.
- Permission and atomicity rules from 4.5-dev still apply: the registry is written via temp-file-then-rename with `0o600` and refuses to load if the file has looser bits.

### Acceptance criteria

- `quilltap instances default Friday` writes the default and subsequent `quilltap` invocations use Friday.
- `quilltap` (no flags) starts the server pointed at Friday's data directory; the banner shows the resolved path.
- `quilltap instances default --clear` reverts to the OS default.
- `quilltap instances rename Friday FridayDev` keeps the stored passphrase and updates the `*` marker on the next `list`.

## 6. `migrations` namespace

### Goal

Surface the migration system as a queryable CLI. Currently migrations run silently at startup; there's no way to ask "what's pending?" or "what would the next startup do?" without reading the source. With migrations growing — the 4.5-dev `folderId` repair plus the memory-graph repair — this matters more.

### CLI surface

```text
quilltap migrations status                    # what's been applied; what's pending
quilltap migrations pending                   # just the pending list
quilltap migrations run --dry-run             # what would run on next startup, with shouldRun() evaluated
```

### Implementation hints

- Add `packages/quilltap/lib/migrations-commands.js` and wire into `bin/quilltap.js`.
- Read the applied-migrations table (`migrations` or whatever it's named — check `lib/database/migrations/` or `migrations/scripts/index.ts` to confirm) directly from the encrypted main DB. Read-only.
- Cross-reference against the in-source migration list at `migrations/scripts/index.ts`. Pending = in source list but not in applied table.
- `--dry-run` calls each pending migration's `shouldRun()` predicate (which is read-only by contract) and reports whether each would actually do work.
- `--json` for all three verbs.

Critically: **no `migrations run` without `--dry-run` is in scope here.** Actually applying migrations from the CLI is a write-path with serious blast radius; that wants its own design pass and is out of scope. The migration runner stays where it is — at startup, where the loading screen and progress reporting already exist.

### Acceptance criteria

- `quilltap migrations status` prints applied count, pending count, and the pending list.
- `quilltap migrations run --dry-run` says what `shouldRun()` returns for each pending migration. Reports useful info like "would scan 47,392 rows" when the migration's `shouldRun()` returns a row count.
- Refuses to run any actual migration without `--dry-run`.

## 7. Semantic search (`docs grep --semantic`, `memories grep --semantic`)

### Goal

Literal `grep` (Tier 1) and `memories grep` (Tier 1.5) are now in active use. The next step is semantic search against the embeddings — both for documents (chunk embeddings in the mount-index DB) and for memories (the per-row `embedding` BLOB on the `memories` table). Both data sets are already embedded; what's missing is the query side.

This is the only Tier 2 item with non-trivial design surface. Read this section carefully before starting.

### CLI surface

```text
quilltap docs grep --semantic [--mount <name|id|all>] [--top N] [--threshold <0..1>] [--json] <query>
quilltap memories grep --semantic [filters from Tier 1.5] [--top N] [--threshold <0..1>] [--json] <query>
```

- `--top N` — return the top N matches by cosine similarity. Default 20.
- `--threshold <0..1>` — minimum similarity. Default 0.5. Returns nothing below that.
- All Tier 1.5 memory filters (`--character`, `--about`, `--source`, etc.) still apply on `memories grep --semantic`.

### The design problem

Semantic search needs an embedding of the query. The CLI doesn't currently embed anything — that's a server-side job. Three choices:

1. **CLI talks to the running server**, posting the query to a new `/api/v1/embeddings?action=embed` endpoint that uses the instance's configured embedding provider. Returns the vector, which the CLI then matches against the local data. Pro: uses the same provider the data was embedded with (essential for cosine similarity to be meaningful). Con: requires the server running.
2. **CLI embeds locally via a hard-coded model** (e.g., a small bundled ONNX model). Pro: works offline. Con: the bundled model won't match what the data was embedded with, and cosine similarity across models is gibberish.
3. **CLI requires the server running and posts the whole search request** — server returns the matches. Pro: trivial implementation, same provider used for query and corpus. Con: shifts the bottleneck to the server's existing job system.

**Recommendation: option 3.** Add `POST /api/v1/mount-points?action=semantic-search` and `POST /api/v1/memories?action=semantic-search`. The server embeds the query, runs the cosine-similarity search against the existing chunk/memory embeddings (efficient because the embeddings are already loaded), returns ranked results. The CLI is a thin client.

This matches how `docs reindex` and `docs embed` already work (Tier 1) — CLI talks to server when reachable, errors out clearly when the server is down. Same UX pattern.

### What the server does

- For `docs`: walk `doc_mount_file_chunks` joined to `doc_mount_file_links`, compute cosine similarity between query vector and each chunk's embedding (in-memory; the chunks are loaded), return ranked file paths with the matched chunk's snippet.
- For `memories`: same shape over the `memories` table's embedding column, returning matched memories with similarity score and snippet.
- Filtering by mount, character, about, source, chat, project happens in SQL before the similarity walk — narrows the candidate set first, scores second.

### Provider mismatch handling

If the instance has had its embedding provider changed since indexing, the dimensions of the corpus embeddings will not match the query embedding. Detect this server-side by comparing the query vector's dimension against the first row's dimension; return a clear `EMBEDDING_DIMENSION_MISMATCH` error with the offending pair. The user can then either reindex/re-embed (the existing Tier 1 verbs) or switch the provider back.

### CLI failure modes

- Server unreachable: clear error, exit 1. (Same as `docs reindex`.)
- Provider not configured: clear error with pointer to settings page.
- Dimension mismatch: clear error with the two dimensions and a suggestion to reindex.

### Acceptance criteria

- `quilltap docs grep --semantic "five-point Calvinist"` returns ranked file paths with snippets across all mounts.
- `quilltap memories grep --semantic --character Ariadne "Charlie's preferences for writing style"` returns ranked memories.
- `--threshold 0.7` is respected.
- Provider-mismatch errors are clear and actionable.

### Why this is last

The earlier items are local-only and ship in a day each. This one adds two API endpoints, a server-side similarity walk, and provider-mismatch handling. Worth doing — semantic search is the thing the embedding infrastructure was always *for* — but do it last so the simpler ergonomic wins land first.

## Project hygiene checklist

For each landed item:

1. **Version bump:** `packages/quilltap/package.json` patch. One bump per item is cleanest if they ship separately; one bump for the batch if items 1–6 ship together.
2. **Type check:** `npx tsc` clean.
3. **Help text:**
   - `--help` for each affected namespace reflects the new verbs and flags.
   - `help/*.md` updated in the steampunk voice with `help_navigate` blocks. New help file `help/cli-logs.md` for the `quilltap logs` verb; new `help/cli-completion.md` for shell completion; new `help/cli-migrations.md` for the migrations namespace.
4. **CHANGELOG:** one entry per item under the current dev tag, terse American English, matching the style of prior 4.5-dev entries.
5. **README:** `packages/quilltap/README.md` gets new subsections as appropriate. Shell completion installation gets a clear "how to install" block per shell.
6. **DDL doc:** no schema changes anticipated. The migrations namespace reads existing tables; semantic search reads existing embedding columns. Only update if an index is added (item 7 might want one for the candidate-set prefiltering — check the query plan on a populated instance).
7. **CLAUDE.md:** add notes for any conventions worth preserving (default-instance resolution order; `quilltap logs` as the preferred way to read instance logs; the semantic-search API endpoint).
8. **Tests:**
   - Unit tests on the dispatcher and flag parsing for each new verb.
   - For shell completion, smoke-test the output by sourcing it in a subshell and asserting tab-completion behaviour (zsh in particular is fiddly enough to deserve a real test).
   - For `quilltap logs --follow`, a test that writes to the watched file, rotates it, writes again, and verifies the follower reopened.
   - For `instances default`, integration test of the resolution precedence chain.
   - For `migrations status`, a fixture with known-applied and known-pending migrations.
   - For semantic search, an integration test with a small embedded corpus and a known query.

## Rollout order

Items 1–6 are independent; pick them off in any order. The suggested order is by user value:

1. **Shell completion.** Affects every CLI use. Single afternoon.
2. **`quilltap logs`.** Daily friction reduction for Charlie's debugging workflow.
3. **`docs ls --recursive` and `docs tree`.** Major gap in mount exploration.
4. **`docs ls` sort flags.** Trivial extension; finishes the POSIX surface.
5. **`instances default` and `instances rename`.** Small ergonomic wins on the new registry.
6. **`migrations` namespace.** Diagnostic; lower frequency but high value when needed.
7. **Semantic search.** Last because the design surface is larger and the value proposition gets the literal versions exercised first.

Items 1–6 can be parallelised across Haiku agents per the project's delegation guideline. Item 7 wants a single coherent PR (CLI + API + tests together).

## Out of scope (Tier 3 candidates or "needs separate design pass")

These are tempting but deliberately left out:

- **Memory mutation verbs** (`memories rm <id>`, `memories merge <a> <b>`, `memories reinforce <id>`). Cross into write territory; the memory write path goes through the gate; needs its own design pass. Flagged in Tier 1.5 as out of scope; still is.
- **Top-level `quilltap lock` namespace promotion** (moving `db --lock-status` etc. out of `db`). Pure rename for cleaner semantics; low value relative to engineering cost; still a Tier 3 niggle.
- **Actually running migrations from the CLI** (`migrations run` without `--dry-run`). Write-path with real blast radius. Stays at startup.
- **`docs ls --short-paths` / `docs ls --long-paths`**. Minor cosmetic; not worth a flag.
- **Self-symmetry checks in `memories validate`** (does every A→B have a matching B→A?). The bidirectional creation path should guarantee this; if it ever doesn't, that's the bug to chase. Not a CLI feature.
- **A connector for memories to be exported / imported as a portable file format.** Adjacent to `.qtap` export; should align with that rather than diverge.
- **Visualizing the memory graph in the UI.** Web-side concern, not CLI.

## Context: where we are now

Tier 1 shipped: `db backup`, `db integrity`, `docs find` / `docs grep` / `docs status`, `docs reindex` / `docs embed`. Tier 1.5 shipped: the `memories` namespace with `ls`, `find`, `grep`, `show`, `tree`, `status`, `validate`. The memory-graph repair landed alongside Tier 1.5, dropping Friday's dangling-edge count from 9,390 to (expected) zero, with `deleteMemoryWithUnlink` and `deleteMemoriesWithUnlinkBatch` now the single chokepoints for memory deletion.

Tier 2 finishes the ergonomic story around all of that. After it lands, the CLI surface is mature enough that further work moves into more specialised territory — mutation verbs, semantic-augmented workflows, plugin integration — that wants its own design conversations rather than incremental tier work.
