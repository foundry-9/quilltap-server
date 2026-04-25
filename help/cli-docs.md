---
url: /scriptorium
---

# The Command Line and the Document Stores

Should you find yourself in possession of a terminal, a willingness to type, and a desire to interrogate your Scriptorium without going through the trouble of opening a browser, the `quilltap docs` subcommand is at your service. It exposes a parallel rear entrance to the same document stores you ordinarily curate through the Scriptorium settings page — convenient for backups, scripts, or simply for the satisfaction of confirming, with one's own eyes, that a particular file is precisely where one expects it to be.

A second arrival in the same release: the `quilltap db --mount-points` flag, which allows you to issue raw SQL against the encrypted mount-index database the way one already could with `--llm-logs`.

## Two Modes of Operation

The new commands operate in one of two modes, chosen automatically depending on what you ask for:

- **Direct database access** — Listing mount points, inspecting one in detail, enumerating files, reading a file's contents, and exporting a whole mount to a directory all open the encrypted `quilltap-mount-index.db` file directly. The Quilltap server need not be running, and indeed any number of these commands may be issued against an instance whose server is taking the afternoon off.
- **Through the running server** — Triggering a rescan requires the embedding pipeline, the watchers, and the rest of the apparatus, so `quilltap docs scan` makes a polite HTTP request to the server (defaulting to `http://localhost:3000`; pass `--port` for a non-default arrangement). If the server has not been started, the command will say so plainly.

Semantic search remains, for the moment, only available through the chat interface and the API. A future arrival may add `quilltap docs search` once the embedding pipeline is plumbed into the CLI; until then, ask a character to consult their commonplace book in the usual way.

## The Subcommands

```text
quilltap docs list                                  # All mount points (table)
quilltap docs show <id>                             # One mount, with live counts
quilltap docs files <id> [--folder <path>]          # Files in a mount
quilltap docs read <id> <relativePath>              # Raw bytes/text → stdout
quilltap docs read --rendered <id> <relativePath>   # Extracted plaintext → stdout
quilltap docs export <id> <outputDir>               # Whole mount → a directory
quilltap docs scan <id>                             # Rescan via the running server
```

### Raw vs. Rendered

`docs read` outputs whatever bytes are stored — a Markdown file produces its Markdown source, a PDF produces its binary header and all that follows. `docs read --rendered` instead outputs the plaintext that was extracted for embedding: for a PDF or DOCX, that is the text the chunker actually saw; for a Markdown or plain-text file, raw and rendered are the same.

When `read` would dump binary bytes to a TTY (rather than to a file or pipe), the command politely refuses and suggests redirecting the output. Pass `--force` to override this safety net if you really do enjoy looking at raw PDF bytes scrolling across your terminal.

### Examples

```bash
# List every mount point with file/chunk counts
quilltap docs list

# Same, but in JSON suitable for jq
quilltap docs list --json

# Inspect one mount in detail (live counts cross-checked against cache)
quilltap docs show 0123abcd-...

# All files in a particular folder of a mount
quilltap docs files 0123abcd-... --folder research/2026

# Read a Markdown file
quilltap docs read 0123abcd-... notes/today.md

# Read a PDF — must be redirected
quilltap docs read 0123abcd-... papers/foo.pdf > /tmp/foo.pdf

# Read the extracted text the LLM actually saw
quilltap docs read --rendered 0123abcd-... papers/foo.pdf

# Export the entire mount to a fresh directory
quilltap docs export 0123abcd-... ~/backups/quilltap-mount-2026-04-25

# Trigger a rescan (server must be running)
quilltap docs scan 0123abcd-...
```

## SQL Against the Mount-Index Database

For ad-hoc queries that go beyond what `docs` exposes, point the existing `db` subcommand at the mount-index database with `--mount-points`:

```bash
quilltap db --mount-points --tables
quilltap db --mount-points "SELECT id, name, fileCount FROM doc_mount_points"
quilltap db --mount-points --repl
```

The `--data-dir` and `--passphrase` flags work identically to the standard `db` invocation. `--llm-logs` and `--mount-points` are mutually exclusive — pick one database per session.

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `--passphrase <pass>` | Decrypt a peppered `.dbkey` file |
| `--port <number>` | Server port for `scan` (default 3000) |
| `--json` | Machine-readable output for `list`, `show`, `files`, `scan` |
| `--rendered` | For `read`: extracted plaintext instead of raw bytes |
| `--folder <path>` | For `files`: narrow to a folder prefix |
| `--force` | For `read`: dump binary to TTY anyway |
| `-h, --help` | Per-subcommand help text |

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/scriptorium")`
