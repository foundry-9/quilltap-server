# Bug 162 — the CLI's raw-SQL connection has no `qt_text()`, so it cannot read a compressed column or write a message

**FIXED in v4 (2026-09-22)** — the bin's low-level `db` path now opens through
`openEncryptedDb` like every other connection the CLI makes. Its private
`require('better-sqlite3-multiple-ciphers')`, its `key` pragma and its
hand-rolled readability probe are gone; `readonly` follows `!writable` and
`friendlyName` follows the `--llm-logs` / `--mount-points` target. The larger
fix rather than the one-line `registerTextCodecFunction(db)`, because two
openers is how this happened: the next function registered in `db-helpers.js`
now reaches raw SQL and the REPL for free. `packages/quilltap/README.md` gains
the `qt_text()` note under **Low-level options**. Regression tests in
`__tests__/unit/packages/quilltap/db-raw-sql-qt-text.integration.test.js` drive
the bin itself — a decoded read through `qt_text()`, and a `--write` UPDATE
whose FTS trigger calls it — because the defect lived in the bin's opener and
not in `openEncryptedDb`, which had the registration all along.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-21, while tracing bug 161 on the `Friday` instance |
| **Fixed** | 2026-09-22 |
| **Severity** | **Low** for reads, **Medium** for writes. A read of `chat_messages.content` or `llm_logs.request` through `quilltap db "SELECT …"` or `--repl` answers `no such function: qt_text`, and a `--write` UPDATE of any `chat_messages` row fails the same way, because the search-index triggers call it. The failure is loud and immediate, so nothing drifts; but the one CLI path meant for ad-hoc repair cannot touch the transcript table at all |
| **Who it bites** | anyone using the low-level `db` surface — raw SQL, `--repl`, `--write` — against a 4.10 instance |
| **Provenance** | Original to v4, from the FTS5 + compression change (4.10-dev). `registerTextCodecFunction` was added to `openEncryptedDb`, the opener every *subcommand* uses; the raw-SQL / REPL / `--write` path in the bin predates it and opens its own connection |
| **Fix site** | `packages/quilltap/bin/quilltap.js:1024` — the `new Database(dbPath, …)` block that handles `sql`, `--repl`, `--tables` and `--count`; the registration it is missing is `registerTextCodecFunction` from `packages/quilltap/lib/text-codec.js:57` |
| **v5 status** | Not assessed (CLI is v4-only) |
| **Index** | [bugs.md](../../bugs.md) |

## Symptom

```
$ node packages/quilltap/bin/quilltap.js db --instance Friday \
    "SELECT substr(qt_text(content),1,40) FROM chat_messages LIMIT 1"
Error: no such function: qt_text
```

The same connection, opened with `--write`, refuses every `UPDATE chat_messages …` with the same
message, because the three FTS5 sync triggers call `qt_text()` to decode the new row.

Meanwhile every high-level subcommand works: `messages`, `message <id>`, `log <id>` and `logs`
decode the columns, and `db-helpers.js:206–215` carries a comment saying the function "lets raw SQL
and the repl read inside" compressed columns and "is also REQUIRED for any `--write` that touches
`chat_messages`".

## Root cause

`packages/quilltap/lib/db-helpers.js:179` `openEncryptedDb` registers the function on every
connection it opens. But the bin's `db` entry point only delegates to `db-commands.js` (and so to
that opener) for *subcommands*. When the invocation is raw SQL, `--repl`, `--tables` or `--count`,
`bin/quilltap.js:1017–1028` requires the driver and opens its own `new Database(dbPath, …)`, keys
it, and never registers anything. The comment in `db-helpers.js` describes the opener it sits in,
not the path the low-level options actually take.

## Why it survived

- The compression change was tested through the repositories and the subcommands. No test drives
  the bin's raw-SQL branch against a compressed column.
- The registration was placed where a reader of `db-helpers.js` would expect every connection to
  pass through. The bin's private opener is 800 lines away in a different file and looks like
  boilerplate.
- Loud failure. It is the *intended* behaviour for a connection that lacks the function to refuse
  a `chat_messages` write, so the error reads as the guard working rather than as the guard firing
  on the CLI's own connection.

## The fix

The bin's low-level path opens through `openEncryptedDb` (`readonly` follows
`!writable`, `friendlyName` from the `--llm-logs` / `--mount-points` target). Its private
driver-require, key pragma and readability probe are deleted. That is one opener for every
connection the CLI makes, and the next function registered there reaches the REPL for free.
The smaller fix — `registerTextCodecFunction(db)` after the key pragma — was available, but two
openers is how this happened.

The `fs.existsSync(dbPath)` check in the bin stays where it is, ahead of `loadDbKey`, so a missing
database is reported before anything prompts for a passphrase; `openEncryptedDb`'s own check is
then unreachable on this path.

Added under **Low-level options** in `packages/quilltap/README.md`:

> Compressed text columns (`chat_messages.content`, `llm_logs.request` / `response` and friends)
> are stored as BLOBs. Wrap them in `qt_text()` to read the text: `SELECT qt_text(content) …`.

`packages/quilltap`'s version is synced from the root by `scripts/update_version.sh` on commit
(it publishes at release; no manual `npm publish`).

## How to verify

```sh
node packages/quilltap/bin/quilltap.js db --instance V4test \
  "SELECT substr(qt_text(content),1,40) AS s FROM chat_messages LIMIT 1"
```

Must print text, not `no such function`. Then, with the server stopped:

```sh
node packages/quilltap/bin/quilltap.js db --instance V4test --write \
  "UPDATE chat_messages SET updatedAt = updatedAt WHERE id = (SELECT id FROM chat_messages LIMIT 1)"
```

Must report `Changes: 1`.

The regression test is
`__tests__/unit/packages/quilltap/db-raw-sql-qt-text.integration.test.js`. It drives the bin
itself — the defect was in the bin's opener, not in `openEncryptedDb`, so a test against the
helper would have passed throughout. Its fixture is an unencrypted database with one
brotli-compressed `chat_messages.content` row and an update trigger that calls `qt_text()`, and it
asserts a decoded read, a `--write` UPDATE reporting one change, and `--tables` / `--count` still
served from the same opener. Against the pre-fix bin the first and third fail with `no such
function: qt_text`.
