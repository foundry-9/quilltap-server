---
url: /settings?tab=system
---

# The Command Line and the Logs

When the muse departs on the morning train and leaves behind naught but error messages, one reaches for the logs. Quilltap keeps them in a tidy directory, organised by severity and source, and the `quilltap logs` subcommand is the door that opens onto that directory without requiring one to remember its true path — a mercy, that, when instances can live in any corner of the filesystem one elects.

## The Subcommand

```text
quilltap logs [--instance <name>] [--stream <name>] [--tail N] [--follow] [--grep <pattern>]
```

- `--stream <name>` — which log to read. Default `combined`. Comma-separated values (e.g., `--stream error,stdout`) read multiple streams at once.
  - `combined` — all log entries
  - `error` — error-level entries only
  - `stdout` / `stderr` — captured stdout and stderr from the server process
  - `startup` — Electron desktop-shell startup records (may not exist)
- `--tail N` — last N lines (default 100). `--tail 0` means full file, no head trim.
- `--follow` / `-f` — stream new lines as they arrive, like `tail -F`. Handles file rotation automatically — when a log file exceeds its size limit and rotates to backup, the command reopens the active file and carries on.
- `--grep <pattern>` — filter lines by a JavaScript regex pattern. Applied before output.

## What the Logs Contain

Each log entry is a JSON object — one per line. The JSON objects contain:

- `timestamp` — RFC 3339 timestamp of the event
- `level` — log level: `error`, `warn`, `info`, `debug`, or `trace`
- `message` — human-readable summary
- `context` — structured data relevant to the event (request IDs, row counts, paths, etc.)
- Other fields as appropriate to the component that emitted the log

When viewing the logs in the command line, the lines are printed raw (as JSON) so you can pipe them to `jq` for programmatic inspection. The command applies light colorization when the output is a terminal:

- Timestamps are dimmed
- Error-level entries are red
- Warning-level entries are yellow
- Info-level entries are blue
- Debug-level entries are gray

Suppress all coloring if the output is not a terminal (e.g., piped to a file or another command).

## Common Workflows

### Print the last 100 lines of the combined log for the default instance

```bash
quilltap logs
```

### Print the last 50 error-level entries

```bash
quilltap logs --stream error --tail 50
```

### Print everything since this morning (or thereabouts)

```bash
quilltap logs --tail 0
```

### Follow new entries in real time across error and combined streams

```bash
quilltap logs --stream combined,error --follow
```

This is handy when running the server with `npm run dev` or in a background terminal, so you can watch for warnings or errors as you work.

### Find a specific message in the logs

```bash
quilltap logs --tail 0 --grep "error executing job"
```

The `--grep` pattern is a JavaScript regex, so you can use `(?i)` for case-insensitive matching (or pass multiple variants separated by `|`):

```bash
quilltap logs --tail 500 --grep "(?i)(error|warn)"
```

### Dump the log as JSON and filter with `jq`

```bash
quilltap logs --tail 1000 | jq 'select(.level == "error")'
```

## Log File Rotation

The active log files are auto-rotated when they exceed 10 MB. The rotated backups are named `combined.0.log` through `combined.9.log` (`.0` being the most recent). When you use `--follow`, file rotation is transparent — the command detects the changeover and reopens the active file.

If you run into a large log file and want to archive it, you can delete or move the rotated backups; the active files will carry on logging as usual.

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `-i, --instance <name>` | Use a registered instance (see `quilltap instances`) |
| `--passphrase <pass>` | Decrypt a peppered `.dbkey` file |
| `-h, --help` | Show help text |

## See Also

- `quilltap instances --help` — register and manage instance directories
- `quilltap db --help` — lower-level database inspection
- The running server logs to `<instance>/logs/combined.log` and appends to `<instance>/logs/error.log` for error-level entries.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`
