# Bug 160 — the stale-chat sweep never cleared the identity-stack cache

| | |
|---|---|
| **Status** | **FIXED in v4.10 (2026-09-21)** |
| **Found** | 2026-09-21 |
| **Fixed** | 2026-09-21 |
| **Severity** | Low (no data loss; disk cost only) |
| **Who it bites** | Anyone with a large archive of quiet chats |
| **Provenance** | Found while auditing a 2.0 GB instance for storage; `chats` was 53 MB for 971 rows, of which 17 MB was one cache column |
| **Fix site** | `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../bugs.md) |

**FIXED in v4.10 (2026-09-21)** — `compiledIdentityStacks` added to the
`chats` UPDATE in the nightly stale-chat cache collapse.

## Symptom

`chats.compiledIdentityStacks` accumulated on chats that had long gone quiet:
**13.45 MB across 841 stale chats** on the reference instance, against 4.0 MB
on the 130 active ones.

The sweep was otherwise working perfectly. Measured on the same instance, stale
chats held exactly **0 bytes** of `renderedMarkdown`, `compressionCache`,
`rawResponse`, `reasoningContent`, `reasoningSegments` and `debugMemoryLogs` —
every column on the sweep's list was clear. Only this one was never on it.

## Root cause

`collapseOneChat` cleared a hard-coded pair:

```sql
UPDATE chats SET compressionCache = NULL, renderedMarkdown = NULL
 WHERE id = ? AND (compressionCache IS NOT NULL OR renderedMarkdown IS NOT NULL)
```

`compiledIdentityStacks` was introduced later (system-prompt refactor, Phase H)
and nobody revisited the sweep. It is a plain omission, not a judgement call:
the column is a read-through cache in exactly the same class as the two beside
it. `readCurrentStacks` (`lib/services/system-prompt-compiler/compiler.ts:71`)
returns null unless the stored `version` **strictly equals**
`IDENTITY_STACK_BUILDER_VERSION`, and `buildSystemPrompt` rebuilds from the
character's own fields on a miss. A version bump already discards the whole map
wholesale — so clearing it costs precisely one recompile on the chat's next
turn, which is the same price the sweep already accepts for `renderedMarkdown`.

## Why it survived

The sweep's own summary counts rows, not columns: a chat with a cleared
`renderedMarkdown` reported `chatRowsCleared: 1` whether or not anything else
on the row was still populated. There was no signal distinguishing "swept" from
"swept incompletely", and the test asserted only on the columns already in the
SQL.

## The fix

`compiledIdentityStacks` joins the UPDATE and its `IS NOT NULL` guard, so the
pass stays idempotent. The module doc records *why* it is safe to clear —
version-stamped read-through cache, rebuilt by `buildSystemPrompt` — in the
same form as the entries around it, so the next column of this kind has a
pattern to match.

The regression test asserts the column appears in the generated SQL, alongside
the existing assertions that the sacred columns (`content`, `opaqueContent`,
`thoughtSignature`) never do.

## How to verify

```sh
npx quilltap db --instance <name> \
  "SELECT CASE WHEN lastMessageAt < datetime('now','-30 days') THEN 'stale' ELSE 'recent' END AS bucket,
          count(*) n, sum(length(coalesce(compiledIdentityStacks,''))) bytes
     FROM chats GROUP BY bucket"
```

After a nightly sweep, the `stale` row's `bytes` must be 0. Reopening a swept
chat and taking a turn must produce a correct system prompt — the recompile is
the read-through path, exercised on every version bump already.
