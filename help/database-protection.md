---
url: /settings?tab=system
---

# Database Protection

Quilltap automatically protects your databases against corruption and data loss. These protections run silently in the background — no configuration is needed.

## Encryption at Rest

Your databases are not merely tucked away in a drawer, as one might store a perfectly ordinary biscuit tin — they are *locked inside a vault*, the combination to which only Quilltap itself possesses. Every database file Quilltap creates is encrypted on disk using **SQLCipher**, an industry-standard encryption extension for SQLite that has been scrutinising secrets since before most current programming languages were born.

### What This Means for You

**The files are unreadable without the key.** Should some uninvited personage — a snooping sibling, an overcurious IT department, or the sort of fellow who goes through other people's filing cabinets at parties — gain access to your data directory, they would find nothing but a rather elegant arrangement of entirely meaningless bytes. The standard `sqlite3` command-line tool, which one might otherwise employ to peek at the raw data, cannot open these files; it simply throws up its hands in polite bewilderment.

**Backups are also encrypted.** The physical backup files Quilltap creates are byte-for-byte copies of the encrypted database. They are equally unreadable without the key. This is, on balance, rather the point.

### The Key File

The encryption key is stored in a file called **`.dbkey`** in the `data/` subdirectory of your data directory — for example, `~/Library/Application Support/Quilltap/data/.dbkey` on macOS. This file is managed entirely by Quilltap; you need not concern yourself with its contents under ordinary circumstances.

> **Back up your `.dbkey` file alongside your database.** If you copy your database to another machine without the `.dbkey` file, the database will be as useful as a very expensive paperweight. When backing up your data directory, ensure the `.dbkey` file travels with it.

### Locked Mode (Optional Passphrase Protection)

For those who require a second bolt on the door, Quilltap supports **locked mode**: the `.dbkey` file itself may be protected with a passphrase. When a passphrase is set, Quilltap cannot open the database at startup until the passphrase is supplied — the application will wait at the locked screen, like a very well-trained butler who knows better than to admit anyone without the password.

Locked mode is configured via environment variable. Consult the [Data & System settings](/settings?tab=system) for details.

### Changing or Removing Your Passphrase

Should you wish to rotate your passphrase — an exercise in security hygiene that the prudent practitioner undertakes with the same regularity as winding a pocket watch — you may do so from **Settings > Data & System > Encryption Passphrase**. This operation re-wraps the encryption key inside a fresh `.dbkey` file; it does *not* re-encrypt the database itself (there is no need, as the underlying key remains unchanged).

You may also *remove* a passphrase entirely, should you decide that the convenience of automatic unlocking outweighs the additional protection. Simply leave the "New Passphrase" field empty when changing. Conversely, you may *add* a passphrase where none existed before by leaving the "Current Passphrase" field empty and providing a new one.

After changing your passphrase, the new passphrase will be required the next time Quilltap starts.

### Accessing the Database Directly

Since the standard `sqlite3` CLI cannot open encrypted databases, Quilltap provides its own subcommand for direct database queries — useful for troubleshooting, migrations, and the occasional moment of diagnostic curiosity:

```bash
# List all tables
npx quilltap db --tables

# Run a query
npx quilltap db "SELECT COUNT(*) FROM characters;"

# Interactive REPL
npx quilltap db --repl

# Query the LLM logs database instead
npx quilltap db --llm-logs --tables

# Use a custom data directory
npx quilltap db --data-dir /path/to/data --tables
```

## Two-Database Architecture

Quilltap stores your data across two separate database files:

- **`quilltap.db`** — Your characters, chats, messages, memories, projects, settings, and all other core data
- **`quilltap-llm-logs.db`** — LLM request/response debug logs (the high-volume records that track every AI call)

This separation means that even if the debug logs database becomes corrupted, your characters, chats, and memories remain perfectly safe. If the logs database fails to open, Quilltap continues normally — you simply won't see LLM logs until the issue is resolved.

## What Runs Automatically

### Integrity Check on Startup

Every time Quilltap starts, it runs a quick integrity check on both databases. If corruption is detected in the main database, you'll see a warning in the application logs. The app will still start so you can access your data and restore from a backup if needed. If corruption is detected in the LLM logs database, it enters "degraded mode" — logging is silently disabled but everything else works normally.

### WAL Checkpoints

Quilltap uses SQLite's Write-Ahead Logging (WAL) mode for better performance. The WAL file accumulates changes that periodically need to be merged back into the main database file:

- **Every 5 minutes**: A passive checkpoint runs to keep the WAL file from growing too large
- **On shutdown**: A full checkpoint merges all remaining WAL data into the main database file
- **Before backups**: A checkpoint runs before creating a logical backup (via Backup & Restore) to ensure the backup captures the latest data

### Physical Database Backups

Quilltap creates a physical copy of both database files once per day. The check happens on startup — if the most recent backup is less than 24 hours old, the backup is skipped. These are stored in the `data/backups/` subdirectory of your data directory.

**Retention policy:**
- All backups from the last 7 days are kept
- 1 backup per week is kept for weeks 1 through 4
- 1 backup per month is kept for months 1 through 12
- 1 backup per year is kept indefinitely

Old backups are automatically cleaned up according to this schedule.

### Durable Writes

By default, Quilltap uses SQLite's `synchronous = FULL` mode, which ensures that all writes are fully flushed to disk before being acknowledged. This prevents data loss in the event of a power failure or system crash.

If you need better write performance and are willing to accept a small risk of data loss on crash, you can set the environment variable:

```
SQLITE_SYNCHRONOUS=normal
```

## Where Backups Are Stored

Physical backups are stored under your data directory:

| Platform | Path |
|----------|------|
| macOS (Electron) | `~/Library/Application Support/Quilltap/data/backups/` |
| Windows (Electron) | `%APPDATA%\Quilltap\data\backups\` |
| Linux | `~/.quilltap/data/backups/` |
| Docker | `/app/quilltap/data/backups/` |

Backup files are named with timestamps, for example:
- Main database: `quilltap-2026-02-19T143022.db`
- LLM logs database: `quilltap-llm-logs-2026-02-19T143022.db`

## Restoring from a Physical Backup

If your main database becomes corrupted:

1. Stop Quilltap
2. Navigate to the backups directory (see paths above)
3. Choose the most recent `quilltap-*.db` backup file that predates the corruption
4. Copy it over the main database file (`quilltap.db` in the `data/` directory)
5. Delete any `.db-wal` and `.db-shm` files next to `quilltap.db`
6. Start Quilltap

If only the LLM logs database is corrupted, you can either restore from a `quilltap-llm-logs-*.db` backup following the same steps (replacing `quilltap-llm-logs.db`), or simply delete the corrupted file — Quilltap will create a fresh one on next startup. You will lose historical LLM logs but no other data is affected.

## Physical Backups vs. Backup & Restore

Quilltap has two independent backup systems:

| Feature | Physical Backups | Backup & Restore |
|---------|-----------------|------------------|
| **What it backs up** | Raw database file (byte-level copy) | All entities exported as JSON + user files |
| **When it runs** | Automatically once per day (on startup) | Manually from The Foundry |
| **Includes files** | No (database only) | Yes (all uploaded files) |
| **Format** | `.db` file | `.zip` archive |
| **Best for** | Quick recovery from corruption | Full data portability and migration |
| **Location** | `data/backups/` | Downloaded to your computer |

For the most complete protection, use both: let physical backups run automatically, and periodically create a manual backup via Backup & Restore.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`
