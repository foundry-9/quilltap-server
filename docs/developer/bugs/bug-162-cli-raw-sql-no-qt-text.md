# Bug 162 — the CLI's raw-SQL connection has no `qt_text()`, so it cannot read a compressed column or write a message

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-09-21, while tracing bug 161 on the `Friday` instance |
| **Fixed** | — |
| **Severity** | **Low** for reads, **Medium** for writes. A read of `chat_messages.content` or `llm_logs.request` through `quilltap db "SELECT …"` or `--repl` answers `no such function: qt_text`, and a `--write` UPDATE of any `chat_messages` row fails the same way, because the search-index triggers call it. The failure is loud and immediate, so nothing drifts; but the one CLI path meant for ad-hoc repair cannot touch the transcript table at all |
| **Who it bites** | anyone using the low-level `db` surface — raw SQL, `--repl`, `--write` — against a 4.10 instance |
| **Provenance** | Original to v4, from the FTS5 + compression change (4.10-dev). `registerTextCodecFunction` was added to `openEncryptedDb`, the opener every *subcommand* uses; the raw-SQL / REPL / `--write` path in the bin predates it and opens its own connection |
| **Fix site** | `packages/quilltap/bin/quilltap.js:1024` — the `new Database(dbPath, …)` block that handles `sql`, `--repl`, `--tables` and `--count`; the registration it is missing is `registerTextCodecFunction` from `packages/quilltap/lib/text-codec.js:57` |
| **v5 status** | Not assessed (CLI is v4-only) |
| **Index** | [bugs.md](../bugs.md) |

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

Have the bin's low-level path open through `openEncryptedDb` (readonly follows `!writable`,
`friendlyName` from the target), deleting its private driver-require and key pragma. That is one
opener for every connection the CLI makes, and the next function registered there reaches the REPL
for free. If keeping the bin's own error wording matters, the smaller fix is
`registerTextCodecFunction(db)` after the key pragma — but two openers is how this happened.

Add a line under **Low-level options** in `packages/quilltap/README.md`:

> Compressed text columns (`chat_messages.content`, `llm_logs.request` / `response` and friends)
> are stored as BLOBs. Wrap them in `qt_text()` to read the text: `SELECT qt_text(content) …`.

Bump `packages/quilltap`'s patch version (it publishes at release; no manual `npm publish`).

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

Must report `Changes: 1`. A regression test in `__tests__/unit/packages/quilltap/` (or beside the
existing CLI tests) that runs the bin's raw-SQL branch against a fixture database with one
compressed row and asserts the decoded text.
