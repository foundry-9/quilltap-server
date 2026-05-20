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

## In-Chat Navigation

- **Help navigate** to settings: `help_navigate(url: "/settings?tab=system")`
