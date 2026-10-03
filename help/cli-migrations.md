---
url: /settings?tab=system
---

# The Command Line and Migrations

As Quilltap evolves, the structure of its data does as well. Migrations are silent, automatic adjustments that run at startup—each time you open the server, it checks whether your instance's schema is up to date, and if something has drifted or lagged, it mends it. You won't usually notice them; the loading screen says "Bringing the records up to date" and gets on with it. But if you're curious what's pending, or what will run on the next startup, the migrations namespace lets you ask.

## What This Tool Is For

Three things:

- **Surveying.** To ask "what's been applied to this instance?" and see the list.
- **Planning.** To ask "what will the next startup do?" without actually restarting the server.
- **Checking the ledger.** To list pending migrations before an upgrade, or to confirm that a sticky migration eventually completed.

## The Subcommands

```text
quilltap migrations status      # Applied count, pending count, pending list
quilltap migrations pending     # Just the pending list
quilltap migrations run --dry-run  # What would run on next startup
```

All verbs accept:

| Flag | Meaning |
| --- | --- |
| `-d, --data-dir <path>` | Use a specific data directory. |
| `--instance <name>` | Use a named instance (from the registry). |
| `--passphrase <pass>` | Provide the passphrase (prompts if needed). |
| `--json` | Output as JSON for piping. |
| `-h, --help` | Show help text. |

## Examples

### Seeing what's applied

```text
$ quilltap migrations status
Migrations: 278/278 applied
Most recent: add-memories-reinforced-importance-index-v1 at 2026-01-15T14:32:18.455Z
Pending: 0
```

### Checking a specific instance

```text
$ quilltap migrations status --instance Friday
Migrations: 277/278 applied
Most recent: repair-dangling-related-memory-edges-v1 at 2026-01-14T09:22:10.100Z
Pending: 1

  add-memories-reinforced-importance-index-v1  Adding reinforcedImportance index on memories
```

### Dry-running the next startup

```text
$ quilltap migrations run --dry-run
Dry run: 1 migrations would run on next startup

  add-memories-reinforced-importance-index-v1  Adding reinforcedImportance index on memories

Note: shouldRun() predicate is evaluated at startup.
Inspect the migration source in migrations/scripts/ for conditional logic.
```

## A Word on Actual Migration Execution

The actual running of migrations happens at server startup, where the loading screen and progress reporting are both available. The CLI is read-only; there is no `quilltap migrations run` without `--dry-run`. If you want to apply pending migrations, start (or restart) the server, and let the startup sequence handle it.

## When a Migration Stumbles

Most migrations are load-bearing walls: if one fails, the server declines to open its doors rather than let you wander about on a half-built floor, and the logs say why. A few are merely tidying passes over records that are already perfectly sound—the collapsing of duplicate avatar rolls is the chief example. Should one of those trip on the stair, the server notes the mishap in the log, leaves the ledger unsigned, and opens anyway. The next startup notices the unfinished work and quietly picks up where the last one left off, which is rather more than can be said for most house guests.

## When a Table Has Been Tampered With

A migration, once signed into the ledger, is never asked again—so a document-store table damaged *afterwards* (by a hand-edited column, say, or a restore that went sideways) used to go unremarked, and the Scriptorium simply came up empty without a word of explanation. Now, at every startup, Quilltap inspects the tables behind the document stores, the LLM logs and the help index, and checks that each is still a proper table with all its expected columns. If one is not, the server still starts (so that you may restore a backup), but the log names the culprit at ERROR, and the health check at `/api/health` reports a `structure` entry as **degraded**, listing each problem. Until the table is repaired, reads through it come back empty; restoring from a recent backup is the usual cure.

## In-Chat Navigation

- **Help navigate** to settings: `help_navigate(url: "/settings?tab=system")`
