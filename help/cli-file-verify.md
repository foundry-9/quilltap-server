---
url: /settings?tab=system
---

# The Command Line and the Cloud's Reluctant Tenants

There is a particular species of vanishing act that befalls a workspace kept in a cloud-synced folder. iCloud Drive, in its tireless campaign to reclaim a few megabytes, will quietly spirit a database up into the æther and leave behind only a placeholder — a calling card where the file used to be. The file appears present; its bytes are elsewhere. And when Quilltap reaches for that file at startup, before the cloud has seen fit to send it back down, the result is the unhelpful complaint that the file "is not a database," followed by a cascade of mishaps no one ordered: avatars that never arrive, backgrounds that never render, jobs that expire unfulfilled.

The `quilltap file-verify` subcommand is the polite but firm letter that summons those tenants home. It reads each evicted file from beginning to end — discarding every byte, for it wants nothing but the file's full presence — and that act of reading is precisely what compels the cloud to deliver the genuine article. When it is done, the databases are local, whole, and ready to be opened.

The server performs this same ritual automatically at every startup, before it so much as glances at the encryption key. This command is its hand-operated twin, for when you are working from the shell directly.

## The Subcommand

```text
quilltap file-verify [--instance <name>] [--all] [--stall-ms <ms>] [--json]
```

- `--instance <name>` / `-i` — operate on a registered instance.
- `--data-dir <path>` / `-d` — operate on a specific data directory (the instance root).
- `--all` — read *every* top-level file, not merely the evicted ones. Useful as a diagnostic or to warm a freshly-synced instance.
- `--stall-ms <ms>` — how long to wait, with no bytes arriving, before declaring a download stalled and moving on. This is a **per-chunk** patience, not a per-file deadline: a database that is steadily descending — however large, however slow the line — never trips it, because the timer resets each time a chunk lands. Only a genuinely wedged or offline fetch runs out the clock. Default 30000 (thirty seconds).
- `--json` — emit a machine-readable summary instead of the narrated progress.

## What It Touches

Only the **top-level files** of the data directory are considered. The `backups/` subdirectory — which may hold a great many large snapshots — is deliberately left undisturbed, lest a single command attempt to haul down gigabytes you did not ask for.

A file is judged "evicted" when it reports a real size but occupies no local storage — the signature of a dataless placeholder. Files that are already present are skipped (the command is safe to run as often as you like), and empty files are ignored (there is nothing to fetch). Detection is presently implemented for macOS; on other platforms the command is a harmless no-op pending support for their own placeholder schemes.

## Common Workflows

### Pull down whatever has drifted into the cloud for an instance

```bash
quilltap file-verify --instance Ignite
```

### Warm every top-level file before launching the server

```bash
quilltap file-verify --instance Ignite --all
```

### Be patient with a very large database on a slow connection

```bash
quilltap file-verify --instance Friday --stall-ms 120000
```

### Capture a summary for scripting

```bash
quilltap file-verify --instance Ignite --json
```

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `-i, --instance <name>` | Use a registered instance (see `quilltap instances`) |
| `--all` | Read every top-level file, not just the evicted ones |
| `--stall-ms <ms>` | Per-chunk stall threshold before abandoning a download (default 30000) |
| `--json` | Emit a JSON summary |
| `-h, --help` | Show help text |

## A Word of Caution About Cloud-Synced Instances

This command is a mitigation, not a cure. A live database kept in iCloud Drive (or any cloud-synced folder) can be evicted again the moment it sits idle, and the underlying friction — a large encrypted file the cloud keeps trying to reclaim — remains. For a workspace you use in earnest, the sturdier remedy is to keep its `data/` directory on local storage, or to disable "Optimize Mac Storage" so nothing is evicted at all.

## See Also

- `quilltap instances --help` — register and manage instance directories
- `quilltap logs --help` — read an instance's logs (where a startup eviction would announce itself as "file is not a database")

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`
