# Database Protection

Quilltap automatically protects your database against corruption and data loss. These protections run silently in the background — no configuration is needed.

## What Runs Automatically

### Integrity Check on Startup

Every time Quilltap starts, it runs a quick integrity check on the database. If corruption is detected, you'll see a warning in the application logs. The app will still start so you can access your data and restore from a backup if needed.

### WAL Checkpoints

Quilltap uses SQLite's Write-Ahead Logging (WAL) mode for better performance. The WAL file accumulates changes that periodically need to be merged back into the main database file:

- **Every 5 minutes**: A passive checkpoint runs to keep the WAL file from growing too large
- **On shutdown**: A full checkpoint merges all remaining WAL data into the main database file
- **Before backups**: A checkpoint runs before creating a logical backup (via Backup & Restore) to ensure the backup captures the latest data

### Physical Database Backups

Each time Quilltap starts, it creates a physical copy of the database file. These are stored in the `data/backups/` subdirectory of your data directory.

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

Backup files are named with timestamps, for example: `quilltap-2026-02-19T143022.db`

## Restoring from a Physical Backup

If your database becomes corrupted:

1. Stop Quilltap
2. Navigate to the backups directory (see paths above)
3. Choose the most recent backup file that predates the corruption
4. Copy it over the main database file (`quilltap.db` in the `data/` directory)
5. Delete any `.db-wal` and `.db-shm` files next to `quilltap.db`
6. Start Quilltap

## Physical Backups vs. Backup & Restore

Quilltap has two independent backup systems:

| Feature | Physical Backups | Backup & Restore |
|---------|-----------------|------------------|
| **What it backs up** | Raw database file (byte-level copy) | All entities exported as JSON + user files |
| **When it runs** | Automatically on every startup | Manually from The Foundry |
| **Includes files** | No (database only) | Yes (all uploaded files) |
| **Format** | `.db` file | `.zip` archive |
| **Best for** | Quick recovery from corruption | Full data portability and migration |
| **Location** | `data/backups/` | Downloaded to your computer |

For the most complete protection, use both: let physical backups run automatically, and periodically create a manual backup via Backup & Restore.
