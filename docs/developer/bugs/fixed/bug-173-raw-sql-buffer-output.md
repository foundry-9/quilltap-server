# Bug 173 — raw SQL through the CLI prints compressed message text as `{"type":"Buffer"}`

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-01)** |
| **Found** | 2026-09-30, on a 4.9.x named instance, while checking a disputed memory against its source messages with `npx quilltap db --json "SELECT … content FROM chat_messages …"` |
| **Fixed** | 2026-10-01, v4.10-dev (CLI 4.10.0-dev.101) |
| **Severity** | Low. No stored data is damaged and the server reads every row correctly. The fault is in CLI output: a raw query shows long messages as byte arrays, which reads as data loss and blocks transcript checks done by hand |
| **Who it bites** | anyone who runs raw SQL (`quilltap db "<sql>"`, `--json`, `--repl`) against a compressed text column without wrapping it in `qt_text()`. The high-level verbs (`db messages`, `db message`, `db llm-log`) already decode |
| **Provenance** | Original to v4. Arrived with the compressed text columns in `186eb09cb` (bugs 159, 160, 2026-09-21). That commit added `qt_text()` to the CLI connection and the high-level verbs decode, but the raw-SQL printer passes BLOB values straight to `JSON.stringify` / `console.table` |
| **Defect site** | `packages/quilltap/bin/quilltap.js:1041–1051` (raw `sql` branch: `stmt.all()` → `JSON.stringify(rows)` / `console.table(rows)`) and the matching `--repl` SQL branch below it |
| **Fix site** | `packages/quilltap/lib/text-codec.js` (`decodeCompressedTextInRows`), called from the raw-SQL and `--repl` SQL branches of `packages/quilltap/bin/quilltap.js` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-01).** The raw-SQL printer (table and `--json`) and the `--repl` SQL branch
pass their rows through `decodeCompressedTextInRows` (`packages/quilltap/lib/text-codec.js`) before
printing. It decodes only values carrying the `0x51 0x01 0x01` header, so embedding BLOBs and other
binary columns print as before, and values that are already text (including an explicit
`qt_text()`) are untouched. Nothing on disk changes. `qt_text()` is still needed to work on the text
inside SQL (`WHERE`, `LIKE`, `substr`, `json_extract`); the CLI README says so. Pinned by
`__tests__/unit/packages/quilltap/db-raw-sql-qt-text.integration.test.js` (run under
`npm run test:integration`), whose three bug-173 cases (`--json`, table, `--repl`) fail without the call and whose embedding case
holds non-text BLOBs to their old output.

## Symptom

A raw query against `chat_messages.content` returns some rows as text and others as a serialized
Node `Buffer`:

```json
{"type": "Buffer", "data": [81, 1, 1, 27, 95, 3, 0, 4, 30, 63, 167, 238, 44, ...]}
```

On the reporting instance this hit 104 of 172 participant messages in one chat
(`d2a56e0d-b77a-4550-93bc-ed6763bf9c8e`, "The Crucible's Quiet Pop") and 15 of 33 in another
(`ea32e52a-cc0d-4f7a-bd09-8d46796fe6ff`, "Terms Held on the Cork Balcony"). Both user and assistant
rows were affected. Text rows and Buffer rows were interleaved within the same minute.

The reporter suspected a missing decryption step and possible damage to context assembly and memory
extraction. Neither is the case. See below.

## Root cause

The bytes are the compressed-text format from `lib/database/text-compression.ts` (mirrored in
`packages/quilltap/lib/text-codec.js`):

```
[0] 0x51 'Q' magic   [1] 0x01 version   [2] 0x01 codec (brotli)   [3..] brotli payload
```

The observed `81, 1, 1, …` is exactly that header. The `27` (`0x1B`) that follows is the first byte
of the brotli stream, not part of the header.

The interleaving comes from the size floor. Values under `TEXT_COMPRESSION_MIN_BYTES` (512 bytes)
stay plain TEXT and values at or above it are stored as compressed BLOBs, so short and long messages
alternate within a chat. This mix is intended (see the module doc).

Every server read goes through `blobToText` in the repository layer, so the Salon, context
assembly, memory extraction and the FTS index all see text. The CLI's high-level verbs decode too:
`db messages` (`packages/quilltap/lib/db-commands.js:484`), `db message` (`:570`) and `db llm-log`
(`:616`). Every CLI connection registers `qt_text()` (`packages/quilltap/lib/db-helpers.js:210`), so
`SELECT qt_text(content) …` returns text.

The raw-SQL path is the defect. Its printer hands each row's values straight to `JSON.stringify`
(`--json`) or `console.table`. A BLOB arrives as a `Buffer`, and `Buffer.prototype.toJSON` produces
the `{"type":"Buffer","data":[…]}` shape. The output gives no hint that the value is compressed text
or that `qt_text()` exists.

## Why it survived

The `qt_text()` requirement is written down in the CLI README ("Compressed text columns … Wrap them
in `qt_text()`") and in CLAUDE.md. But a raw `SELECT content` is the most natural query to write,
and its output looks like an encryption envelope rather than a missing function call. The CLI tests
cover the high-level verbs, which decode, and `qt_text()` itself. Nothing covers what a raw query
prints for an undecoded BLOB.

## The fix

As built. In the raw-SQL and `--repl` output paths, replace any column value that passes
`isCompressedTextBlob` with its `decodeText` result before printing. This decodes only values with
the `0x51 0x01 0x01` header, so embedding blobs (`0xEB`) and other binary columns are left alone.
Values that are already text are unchanged, and an explicit `qt_text()` still works.

If an automatic decode is judged too magical, the fallback is to leave the value alone and print a
one-line stderr hint naming `qt_text()` whenever a row contains a compressed-text Buffer.

No migration or backfill is needed, because stored rows are correct. Memory re-extraction is
unnecessary for the same reason.

## How to verify

1. On an instance with a chat holding messages over 512 bytes, run
   `npx quilltap db --json --instance <name> "SELECT id, content FROM chat_messages WHERE chatId='<id>'"`.
   Every `content` should be a string.
2. Run the same query without `--json` and with `--repl`. The text should print, not a Buffer.
3. `SELECT typeof(content), count(*) FROM chat_messages GROUP BY 1` should still report both `text`
   and `blob`, which confirms nothing was rewritten on disk.
4. A query selecting an embedding BLOB should print the same as before the fix.
5. Add a CLI test that inserts a compressed and a plain `content` row and asserts both come back as
   strings from the raw-SQL printer.
