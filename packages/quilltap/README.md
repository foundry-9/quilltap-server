# Quilltap

**Self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on.**

Run Quilltap as a local Node.js server with zero configuration.

## Quick Start

```bash
npm install -g quilltap
quilltap
```

Then open [http://localhost:3000](http://localhost:3000).

On first run, the CLI downloads the application files (~150-250 MB compressed) and caches them locally. Subsequent launches start instantly.

## Installation

### Install globally (recommended)

```bash
npm install -g quilltap
quilltap
```

### Run directly (no install)

```bash
npx quilltap
```

## Usage

```
quilltap [options]

Options:
  -p, --port <number>     Port to listen on (default: 3000)
  -d, --data-dir <path>   Data directory (default: platform-specific)
  -o, --open              Open browser after server starts
  -v, --version           Show version number
  --update                Force re-download of application files
  -h, --help              Show this help message
```

### Examples

```bash
# Start on default port 3000
quilltap

# Start on a custom port
quilltap --port 8080

# Use a custom data directory
quilltap --data-dir /mnt/data/quilltap

# Start and open browser automatically
quilltap --open

# Force re-download after a manual update
quilltap --update
```

## How It Works

The `quilltap` npm package is a lightweight CLI launcher (~10 KB). On first run, it downloads the pre-built application from [GitHub Releases](https://github.com/foundry-9/quilltap-server/releases) and caches it in a platform-specific directory. Native modules (`better-sqlite3`, `sharp`) are compiled for your platform when you install the npm package.

### Cache Locations

| Platform | Cache Directory |
| --- | --- |
| macOS | `~/Library/Caches/Quilltap/standalone/` |
| Linux | `~/.cache/quilltap/standalone/` |
| Windows | `%LOCALAPPDATA%\Quilltap\standalone\` |

When you upgrade to a new version (`npm update -g quilltap`), the next run detects the version mismatch and downloads the matching application files automatically.

## Data Directory

Quilltap stores its database, files, and logs in a platform-specific directory:

| Platform | Default Location |
| --- | --- |
| macOS | `~/Library/Application Support/Quilltap` |
| Linux | `~/.quilltap` |
| Windows | `%APPDATA%\Quilltap` |

Override with `--data-dir` or the `QUILLTAP_DATA_DIR` environment variable.

## Database Tool

The encrypted SQLite databases (main, LLM logs, mount index) can be queried directly via `quilltap db`. There are two modes: high-level subcommands that auto-pick the right database and resolve characters/chats/projects by name, and a low-level path for arbitrary SQL.

### Subcommands

```bash
quilltap db schema                          # Tables grouped by domain
quilltap db schema chat_messages            # Columns, indexes, DDL.md link
quilltap db schema --grep memory            # Find tables/columns by substring

quilltap db find character Friday           # Resolve a name to a UUID (fuzzy)
quilltap db find chat "physical prompts"
quilltap db find project "Quilltap"

quilltap db chats --character Friday        # All chats containing a character
quilltap db chats --project "Quilltap"      # All chats in a project
quilltap db messages --chat <id|title> --last 50 --full
quilltap db logs --chat <id|title>          # LLM logs for a chat
quilltap db logs --message <id>             # LLM logs for a single message
quilltap db logs --character Friday         # LLM logs by character
quilltap db logs --tail 20                  # Recent LLM logs

quilltap db message <id>                    # Full content of one message
quilltap db log <id> [--field request|response|both]
quilltap db memories --character Friday [--about Amy] [--source AUTO]
quilltap db characters status               # Per-character vault readiness (--id, --diverged, --blocked)
```

### Maintenance and Snapshots

```bash
quilltap db optimize                        # VACUUM + ANALYZE + PRAGMA optimize (all DBs)
quilltap db optimize main                   # one DB; refuses while server is running

quilltap db backup                          # online snapshot of all three DBs
quilltap db backup main --out /tmp/snap     # one DB to a chosen directory
quilltap db backup --json                   # parseable per-target sizes + durations

quilltap db integrity                       # cipher_integrity_check + integrity_check
quilltap db integrity llm-logs              # one DB; exit 0 ok, 1 issues, 2 open failure
```

`backup` and `integrity` are safe to run while the server is up; `optimize` refuses while a live lock is held. Backups default to `<dataDir>/backups/<timestamp>/` and inherit the source's encryption key transparently.

Most subcommands accept `--json` (for piping) and `--limit N`. Names are case-insensitive; aliases are searched alongside character names. Ambiguous matches print all candidates and exit non-zero.

### Low-level options

```bash
quilltap db --tables                                # List tables in active DB
quilltap db --count chat_messages                   # Row count
quilltap db "SELECT id FROM characters LIMIT 5"     # Raw SQL (read-only)
quilltap db --repl                                  # Interactive prompt (read-only)
quilltap db --write "UPDATE characters SET title = 'rival' WHERE id = '...'"
quilltap db --repl --write                          # Interactive, read-write
quilltap db --llm-logs --tables                     # Target the LLM logs DB
quilltap db --mount-points --tables                 # Target the mount index DB
```

The database is opened **read-only by default**. Add `--write` to make changes: it opens the database read-write, **claims the instance lock** (`<dataDir>/quilltap.lock`) for the duration, and releases it on exit. It **refuses — with no override — if a running server or another instance holds the lock**, so stop the server first. `--repl` is read-only unless combined with `--write`. Attempting a write without `--write` fails with a hint to re-run with the flag.

In the REPL, `.cols <table>` and `.find <text>` mirror the subcommand helpers.

## Document Stores (Scriptorium)

`quilltap docs` exposes the document-store machinery from the command line. Read-only verbs open the mount-index DB directly and work without the server; write and pipeline verbs talk to the running server via `/api/v1/mount-points/[id]`.

```bash
# Read
quilltap docs list                              # All mounts
quilltap docs show <mount>                      # One mount, with counts
quilltap docs ls <mount> [path] [--links]       # POSIX-flavoured listing (alias: dir)
quilltap docs tree <mount> [path]               # ASCII tree of a folder hierarchy (--depth, --max-nodes)
quilltap docs read [--rendered] <mount> <path>  # File contents → stdout
quilltap docs export <mount> <outputDir>        # Mount → directory
quilltap docs find <pattern>                    # Substring match on file names (--mount, --ext, --type, --limit)
quilltap docs grep <pattern>                    # Substring match on extracted text (--mount, --ignore-case, -l, --max, --context)
quilltap docs status                            # Per-mount extraction + embedding rollup (--mount, --top)

# Server-required
quilltap docs scan <mount>                                    # Trigger a rescan
quilltap docs reindex <mount> [path] [--force]                # Re-extract + re-chunk
quilltap docs embed <mount> [path] [--force] [--wait]         # Enqueue embedding jobs
quilltap docs write [--force] <mount> <path> [file]           # Stdin or file → mount
quilltap docs delete <mount> <path>                           # Idempotent delete
quilltap docs mkdir <mount> <path>                            # Idempotent folder create
quilltap docs move <srcMount> <srcPath> <dstMount> <dstPath>  # Move (hard-link when possible)
quilltap docs copy [--force] <srcMount> <srcPath> <dstMount> <dstPath>
```

Mount arguments accept the mount name (case-insensitive) or a UUID; ambiguous names print candidates and exit non-zero. `--json` is supported by every verb; `reindex` and `embed` refuse to run without a reachable server.

## Memories

`quilltap memories` exposes the same Commonplace Book that each character carries — searchable, sortable, graphable, but never writable. All verbs open the main encrypted DB read-only.

```bash
quilltap memories ls                                                   # All holders, default sort: reinforcedImportance DESC
quilltap memories ls --character Ariadne --sort created --limit 10     # One holder, newest first
quilltap memories find "concrete examples"                             # Substring match on summary (--in content|both)
quilltap memories grep -i --max 3 --context 1 "concrete examples"      # Pattern search inside content, with snippets
quilltap memories show <id|prefix> [--depth N] [--no-related]          # Full record + related-memory neighbourhood
quilltap memories tree <id|prefix> [--depth N] [--max-nodes N]         # ASCII walk of the bidirectional related-memory graph
quilltap memories status [--character <name|id>]                       # Per-holder rollup + dangling-edge check
```

Shared filter flags apply to `ls`, `find`, `grep`, and `status` where they make sense: `--character`, `--about` (with `self` / `none` shortcuts), `--source`, `--chat` (with `none` for manual entries), `--project`, `--since`, `--until`, `--min-importance`, `--min-reinforced`, `--has-embedding` / `--no-embedding`. Sort flags (`--sort reinforced|importance|created|accessed|reinforcement-count|links`, plus `-r` to reverse) apply to `ls`, `find`, and `grep`. Names accept fuzzy substrings; ambiguous names print candidates and exit 2. `--json` is supported by every verb. The legacy `quilltap db memories --character <name>` verb remains undisturbed.

## Maintenance & Cleanup

`quilltap maintenance` is the manual trigger for the retention sweeps that otherwise run on the server's daily maintenance tick. It reaps data with no bearing on characters, stories, or memories.

```bash
quilltap maintenance status                  # Read-only: last sweep time + dry-run counts of what would be reaped
quilltap maintenance status --instance Friday --json
quilltap maintenance run --instance Friday    # Run the sweeps once (lock-gated; refuses while the server is up)
```

`maintenance run` is a DB writer: it claims `<dataDir>/quilltap.lock` and **refuses while a running Quilltap server holds it** — stop the server first. Because it can only run with the server down, it performs the sweeps expressible as direct SQL/filesystem work: reaping finished background jobs (COMPLETED after 7 days, DEAD after 30, keyed off `completedAt`), closed terminal sessions older than 30 days plus their transcript files, and orphaned mount-index files. The **stale-chat asset collapse** (superseded story-backgrounds and wardrobe avatars) needs the server's file-storage machinery and runs only on the server's daily tick — `status` reports a stale-chat count so you can see the backlog. Retention windows mirror `lib/background-jobs/maintenance/retention-constants.ts`.

## Theme Management

The CLI includes theme management commands:

```bash
quilltap themes list                    # List all installed themes
quilltap themes install my.qtap-theme   # Install a .qtap-theme bundle
quilltap themes validate my.qtap-theme  # Validate a bundle
quilltap themes uninstall my-theme      # Uninstall a bundle theme
quilltap themes export earl-grey        # Export any theme as a bundle
quilltap themes create sunset           # Scaffold a new theme
quilltap themes search "dark"           # Search registries
quilltap themes update                  # Check for theme updates
quilltap themes registry list           # List configured registries
quilltap themes registry add <url>      # Add a registry source
```

## Shell Completion

Tab-completion for bash, zsh, and fish. Pick the block that matches your shell.

### Bash

Append the generated script to `~/.bashrc`:

```bash
quilltap completion bash >> ~/.bashrc
```

Or drop it into a system completion directory:

```bash
quilltap completion bash > /usr/local/etc/bash_completion.d/quilltap
# Linux with admin rights: /etc/bash_completion.d/quilltap
```

Restart the shell, or `source ~/.bashrc`.

### Zsh

Two reasonable ways to wire this up; pick one.

**Option A — one line in `.zshrc`** (simpler; adds noticeable shell-startup latency because `quilltap` runs every time you open a new shell):

```zsh
# In ~/.zshrc:
source <(quilltap completion zsh)
```

**Option B — canonical `fpath` setup** (faster; what zsh expects):

```zsh
# In ~/.zshrc, before compinit runs:
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

Then once, from any shell:

```zsh
mkdir -p ~/.zsh/completions
quilltap completion zsh > ~/.zsh/completions/_quilltap
```

The leading underscore on `_quilltap` is the zsh convention — it tells `compinit` this is a completion definition file rather than a regular autoloaded function.

**oh-my-zsh users:** the framework runs `compinit` for you, so either set the `fpath` line *before* the framework loads, or delete the cache (`rm -f ~/.zcompdump*`) after dropping the file in and start a new shell. The more idiomatic location under oh-my-zsh is:

```zsh
mkdir -p ~/.oh-my-zsh/custom/plugins/quilltap
quilltap completion zsh > ~/.oh-my-zsh/custom/plugins/quilltap/_quilltap
# then add `quilltap` to the plugins=(...) line in ~/.zshrc
```

### Fish

```fish
quilltap completion fish > ~/.config/fish/completions/quilltap.fish
```

Fish picks new completion files up automatically — no shell restart needed.

### What gets completed

- **Subcommands**: `quilltap d<TAB>` → `db docs`
- **Sub-verbs per namespace**: `quilltap db s<TAB>` → `schema show`
- **Instance names**: `quilltap --instance Fr<TAB>` → registered instances
- **Mount names**: `quilltap docs ls --mount Qu<TAB>` → mount points in the active instance

Dynamic completions shell out to `quilltap`'s own subcommands. If the active instance is encrypted and no passphrase is reachable, the completion silently returns nothing rather than prompting in the middle of a tab.

## Requirements

- Node.js 24 or later

## Other Ways to Run Quilltap

- **Electron desktop app** (macOS, Windows) - [Download](https://github.com/foundry-9/quilltap-server/releases)
- **Docker** - `docker run -d -p 3000:3000 -v /path/to/data:/app/quilltap foundry9/quilltap`

## Links

- **Website:** [quilltap.ai](https://quilltap.ai)
- **GitHub:** [github.com/foundry-9/quilltap-server](https://github.com/foundry-9/quilltap-server)
- **Issues:** [github.com/foundry-9/quilltap-server/issues](https://github.com/foundry-9/quilltap-server/issues)

## License

MIT
