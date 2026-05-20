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
quilltap db "SELECT id FROM characters LIMIT 5"     # Raw SQL
quilltap db --repl                                  # Interactive prompt
quilltap db --llm-logs --tables                     # Target the LLM logs DB
quilltap db --mount-points --tables                 # Target the mount index DB
```

In the REPL, `.cols <table>` and `.find <text>` mirror the subcommand helpers.

## Document Stores (Scriptorium)

`quilltap docs` exposes the document-store machinery from the command line. Read-only verbs open the mount-index DB directly and work without the server; write and pipeline verbs talk to the running server via `/api/v1/mount-points/[id]`.

```bash
# Read
quilltap docs list                              # All mounts
quilltap docs show <mount>                      # One mount, with counts
quilltap docs ls <mount> [path] [--links]       # POSIX-flavoured listing (alias: dir)
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

## Requirements

- Node.js 18 or later

## Other Ways to Run Quilltap

- **Electron desktop app** (macOS, Windows) - [Download](https://github.com/foundry-9/quilltap-server/releases)
- **Docker** - `docker run -d -p 3000:3000 -v /path/to/data:/app/quilltap foundry9/quilltap`

## Links

- **Website:** [quilltap.ai](https://quilltap.ai)
- **GitHub:** [github.com/foundry-9/quilltap-server](https://github.com/foundry-9/quilltap-server)
- **Issues:** [github.com/foundry-9/quilltap-server/issues](https://github.com/foundry-9/quilltap-server/issues)

## License

MIT
