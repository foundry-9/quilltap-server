# Brahma SQL Access — `run_sql` tool + SQL prompt

> **Naming note:** avoid the word "Oracle" in code and identifiers — it collides with
> Oracle the database/company and confuses readers. The capability is "Brahma SQL
> access" / the `run_sql` tool. (Where this doc says "the model acts as an oracle," it
> means the dictionary sense — answering questions — not the product.)
>
> **Status:** Implemented (4.7-dev). Originally a handoff spec for Claude Code; kept as the reference for the tool contract, guard layers, and SQL prompt.
> **One-line summary:** Give the **Brahma Console** (`chatType: 'brahma'`) a single new
> **read-only** SQL tool, `run_sql`, that can query all three Quilltap databases and
> return rows as JSON, plus fold a SQL-access section into the console's system prompt
> so the model knows how and when to use it. This is **purely additive**: the console
> keeps everything it does today (document search/read/write, web/curl gated by
> profile, model switching, no persistent memory) **and** gains SQL introspection.

Spelling note: the product is **Quilltap** (quill + tap), **never** "Quilttap". Applies to every string, comment, and doc.

---

## 0. Why this is additive, not a replacement

The Brahma Console already exists (`docs/developer/features/brahma-console.md`). It is the character-less, memory-free, page-unaware floating chat that talks to a chosen connection profile and has the `doc_*` family, `search` (no memories), web search, and `curl`. **Nothing about that changes.** We are adding one tool to its tool set and appending one section to its system prompt. Both gate exclusively on the **operator surface** the console already establishes, so no other chat surface (Salon characters, Help Chat, autonomous rooms) is affected.

The two intentional tensions from the original Brahma spec still hold and are *not* loosened by this work:

- The console still forms **no persistent memories** and the `search` tool still cannot use the `memories` source. `run_sql` is read-only, so it can *read* the `memories` table for analytics (e.g. "importance distribution") without violating "no memory access via recall" — it is inspection, not recall, and it writes nothing. Call this out in the PR description so the reviewer understands the distinction.
- Web/curl remain **gated by the connection profile**; `run_sql` is independent of those (it touches local databases, not the network) and is gated by the operator surface instead.

---

## 1. The tool contract

**Tool name:** `run_sql`
**Surface:** Brahma Console only (operator surface). Never offered to character surfaces.
**Mutation:** **read-only**, enforced at the tool layer (see §4). The model is told it's read-only and need not police it.

### Input (Zod schema is the single source of truth)

Per the CLAUDE.md tool chokepoint rule: define `runSqlToolInputSchema`, derive `parameters` with `zodToOpenAISchema(...)`, and make `validateRunSqlInput` a one-line `safeParse(...).success` delegate. Field docs go on `.describe()`. Do **not** hand-write the JSON Schema.

```ts
export const runSqlToolInputSchema = z.object({
  sql: z
    .string()
    .min(1)
    .describe(
      'A single read-only SQL query (SELECT or WITH … SELECT). One statement only. ' +
      'Read-only PRAGMAs like PRAGMA table_info(<table>) are allowed for schema inspection. ' +
      'Writes (INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/REINDEX/VACUUM, mutating PRAGMAs) are ' +
      'rejected — this tool cannot change data.'
    ),
  database: z
    .enum(['main', 'llm-logs', 'mount-index'])
    .default('main')
    .describe(
      'Which Quilltap database to query. "main" (quilltap.db): characters, chats, ' +
      'chat_messages, memories, connection_profiles, projects, groups, settings. ' +
      '"llm-logs" (quilltap-llm-logs.db): the llm_logs table (full request/response JSON, ' +
      'token usage, cost, duration). "mount-index" (quilltap-mount-index.db): document stores ' +
      'and ALL character/project/group vault content. Databases are physically separate — ' +
      'you cannot JOIN across them in one query.'
    )
    .optional(),
  max_rows: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe('Maximum rows to return (hard-capped at 1000). Use aggregates for large sets rather than dumping rows.')
    .optional(),
});
export type RunSqlInput = z.infer<typeof runSqlToolInputSchema>;
export function validateRunSqlInput(input: unknown): input is RunSqlInput {
  return runSqlToolInputSchema.safeParse(input).success;
}
```

### Output

Return a small JSON envelope (the handler stringifies it into the tool result, mirroring how `search` returns `{ formattedText, results, … }`):

```ts
export interface RunSqlOutput {
  database: 'main' | 'llm-logs' | 'mount-index';
  columns: string[];         // column names, in order
  rows: Array<Record<string, unknown>>;
  rowCount: number;          // rows returned (after max_rows cap)
  truncated: boolean;        // true if the result hit max_rows
  // BLOB columns (embeddings, blob data) are NOT inlined — see §4.5.
}
```

On rejection (non-read-only SQL, multiple statements, unknown database, degraded/uninitialized DB, SQLite error), return `{ success: false, error: '<message>' }` through the normal tool-result path so the model can read the error and retry. **Errors are data, not exceptions** — let the model self-correct via trial and error.

---

## 2. Files to create

| File | Purpose |
|---|---|
| `lib/tools/run-sql-tool.ts` | `runSqlToolInputSchema`, `RunSqlInput`, `validateRunSqlInput`, `runSqlToolDefinition`, `RunSqlOutput` type. Mirror `lib/tools/doc-grep-tool.ts` structure exactly. |
| `lib/tools/handlers/run-sql-handler.ts` | `executeRunSqlTool(args, context)` — the read-only guard + query execution + JSON shaping. |
| `lib/tools/__tests__/run-sql-tool.test.ts` (or fold into handler tests) | Read-only guard unit tests (see §6). |

## 3. Files to modify

| File | Change |
|---|---|
| `lib/tools/plugin-tool-builder.ts` | (a) add `sqlAccess?: boolean` to `BuildToolsOptions` (near `excludeMemorySearch`, line ~265); (b) in `buildToolsForProvider`, push `runSqlToolDefinition` when `options.sqlAccess` is true; (c) add `sqlAccess: options.sqlAccess` to the debug-log object (~line 320). |
| `lib/services/chat-message/streaming.service.ts` | Add a trailing positional param `sqlAccess?: boolean` to `buildTools(...)` (after `excludeMemorySearch`, line ~171) and pass it into the `buildToolsForProvider({ …, sqlAccess: !!sqlAccess })` options object (~line 242). |
| `lib/services/brahma-console/orchestrator.service.ts` | Pass `true` as the new trailing `sqlAccess` arg to `buildTools(...)` (after the `true /* excludeMemorySearch */` arg, ~line 188). Add a one-line comment. |
| `lib/chat/tool-executor.ts` | Add a `run_sql` branch in `executeToolCallWithContext` (alongside the `search` branch, ~line 933), **gated on `context.operatorSurface === true`** (reject otherwise). |
| `lib/brahma-console/system-prompt-builder.ts` | Add an `includeSqlAccess?: boolean` option; when true, append the SQL-access prompt section (§5). |
| `lib/tools/__tests__/tool-definitions-snapshot.test.ts` | Register `run_sql` and run `npx jest -u` to refresh the snapshot. |
| `docs/developer/DDL.md` | Add a short "Querying via the Brahma `run_sql` tool" note pointing here; no schema change. |
| `docs/CHANGELOG.md` | Terse plain-English entry. |
| `help/*.md` | Document the new console ability (user-visible). `url` frontmatter + In-Chat Navigation section with a matching `help_navigate(url: "...")`. |

> **No migration, no schema change, no `.qtap`/export change.** The tool reads existing tables; it adds no columns and no new persisted state.

---

## 4. The handler — `executeRunSqlTool`

This is the load-bearing safety surface. Get it right.

### 4.1 Surface gate (in `tool-executor.ts`)

```ts
if (toolCall.name === 'run_sql') {
  if (!context.operatorSurface) {
    return { toolName: 'run_sql', success: false, result: null,
             error: 'run_sql is only available in the Brahma Console.' };
  }
  const result = await executeRunSqlTool(toolCall.arguments, { userId });
  return { toolName: 'run_sql', success: result.success, result: result.success ? result : null,
           error: result.success ? undefined : result.error };
}
```

`operatorSurface` is already set to `true` by the Brahma orchestrator (`orchestrator.service.ts:395`) and threaded through the tool context (`tool-executor.ts:223`). Reuse it — do **not** invent a new flag. Because the tool definition is only *offered* when `sqlAccess` is true (Brahma only) **and** execution is *gated* on `operatorSurface`, there is no path for a character surface to reach it even if a tool name leaked into history.

> Identifier naming: `sqlAccess` (builder option/flag), `includeSqlAccess` (prompt option), `run_sql` (tool name), `BRAHMA_SQL_PROMPT` (prompt constant), `BrahmaSql` (logger context). Deliberately no "Oracle" in any identifier.

### 4.2 Resolve the database handle

The server already holds all three databases open and decrypted. Reuse the raw accessors — **do not open new connections, do not touch the CLI, do not re-key:**

```ts
import { getRawDatabase }          from '@/lib/database/backends/sqlite/client';
import { getRawLLMLogsDatabase }   from '@/lib/database/backends/sqlite/llm-logs-client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';

const db =
  database === 'llm-logs'    ? getRawLLMLogsDatabase() :
  database === 'mount-index' ? getRawMountIndexDatabase() :
                               getRawDatabase();
if (!db) return { success: false, error: `The ${database} database is not available (uninitialized or degraded).` };
```

(The llm-logs and mount-index databases can be degraded/absent on some instances — both accessors return `null` in that case. Handle it as a clean error, not a throw.)

### 4.3 Read-only enforcement (defense in depth — three layers)

These handles are the server's **read-write** handles, so the tool must guarantee read-only itself. Layer the guards; any one failing closed is enough.

1. **Single-statement + keyword guard (pre-parse).** Trim; reject if it contains `;` followed by more non-whitespace (multiple statements). Reject (case-insensitive, word-boundary) any leading/standalone `INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|REINDEX|VACUUM|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|PRAGMA <x> = …`. Allow `SELECT`, `WITH … SELECT`, `EXPLAIN`, and read-only `PRAGMA <name>(<args>)` / bare `PRAGMA <name>` (e.g. `table_info`, `index_list`) — reject the `PRAGMA <name> = <value>` *assignment* form.
2. **`better-sqlite3` `.readonly` check (authoritative).** `const stmt = db.prepare(sql);` then **`if (!stmt.readonly) return { success:false, error:'Only read-only queries are permitted.' };`**. `better-sqlite3` sets `stmt.readonly === true` only for statements that do not write — this is the real guarantee and catches anything the keyword scan misses. (`stmt.reader` likewise indicates a row-returning statement.)
3. **Statement timeout / row cap.** Apply `max_rows` via `stmt.all()` then slice, or iterate and stop at the cap. Wrap execution so a pathological query can't hang the process indefinitely (e.g. a busy-timeout PRAGMA on the connection is already set by the server; additionally cap result materialization at `max_rows`).

> Prefer **failing closed**: if `stmt.readonly` is anything but exactly `true`, reject.

### 4.4 Execute and shape

```ts
const stmt = db.prepare(sql);
if (!stmt.readonly) return { success: false, error: 'Only read-only queries are permitted.' };
const raw = stmt.all();                       // better-sqlite3 returns plain objects
const truncated = raw.length > maxRows;
const rows = raw.slice(0, maxRows).map(sanitizeRow);   // see §4.5
const columns = rows.length ? Object.keys(rows[0]) : (stmt.columns?.() ?? []).map(c => c.name);
return { success: true, database, columns, rows, rowCount: rows.length, truncated };
```

### 4.5 BLOBs and oversized text

- **BLOB columns** (`memories.embedding`, `doc_mount_chunks.embedding`, `doc_mount_blobs.data`, `chat_messages` binary-ish fields) come back as Node `Buffer`. **Do not inline them** — they're huge and meaningless to the model. In `sanitizeRow`, replace any `Buffer`/`Uint8Array` value with a placeholder string like `"<blob: 1536 bytes>"`. The model can still test presence with `embedding IS NOT NULL` in SQL.
- **Oversized text** (`llm_logs.request`/`response` can be very large): don't special-case in the handler, but the prompt (§5) tells the model to avoid selecting these columns wholesale and to use `json_extract`/`substr`/`length()` instead. The `max_rows` cap is the backstop.

### 4.6 Logging

Per CLAUDE.md, fire debug logs on this new backend path: a `logger.child({ context: 'BrahmaSql' })` (no "Oracle" in the context name) logging the target database, a truncated SQL preview, `stmt.readonly`, rowCount, and durationMs. **Never log full result rows** (could contain private content) — counts and timings only.

---

## 5. System-prompt integration — `buildBrahmaSystemPrompt`

The console's existing prompt says "You do NOT have access to the operator's memories" and "nothing is remembered." Both stay true for *recall/persistence*. Add a clearly-scoped SQL-access section, behind an `includeSqlAccess` option, that explains the read-only inspection power and resolves the apparent tension explicitly.

### 5.1 Builder change

```ts
export interface BrahmaSystemPromptOptions {
  profile: ConnectionProfile;
  toolInstructions?: string;
  /** When true, append the SQL-access section (the run_sql tool is enabled). */
  includeSqlAccess?: boolean;
}
```

In `buildBrahmaSystemPrompt`, after the base paragraphs and before `toolInstructions`, push `BRAHMA_SQL_PROMPT` (below) when `includeSqlAccess` is true. The orchestrator passes `includeSqlAccess: true` (it always enables `run_sql` for the console per your instruction). Keep the base prompt's existing sentence about memories, but the SQL-access section adds the read-only-inspection nuance so the two don't read as contradictory.

### 5.2 The SQL-access prompt section (verbatim — paste as a string constant)

> Store this as an exported constant `BRAHMA_SQL_PROMPT` in `lib/brahma-console/system-prompt-builder.ts` (or a sibling `brahma-sql-prompt.ts` it imports). It is the model's instruction, so it stays in plain English. The canonical copy also lives at `Prompts/Brahma SQL.md` in the operator's Quilltap vault for reference; keep them in sync if edited.

```text
## You can also run read-only SQL

In addition to everything above, you can run **read-only SQL** against the databases that back this Quilltap instance, using the `run_sql` tool. Use this to answer questions the operator asks in the language of their world — about characters, memories, documents, conversations, models, costs — by translating those questions into queries, running them, reading the JSON back, and answering in their terms. The operator does not think in tables; you do.

`run_sql` is **read-only at the tool layer** — writes and schema changes are rejected before they run, so query freely and let the tool be the guardrail. Reading a table for analysis (including the `memories` table, e.g. to summarize importance) is inspection, not recall: it changes nothing and is not remembered after this conversation. You still form no persistent memories and your `search` tool still cannot use memories as a source; `run_sql` is a separate, read-only window for answering questions about the data.

Always prefer running a query and reading real rows over guessing. When a query errors or returns nothing, treat it as a clue, adjust, and try again — trial and error is expected.

### Three separate databases (no cross-database JOINs)

Pick the `database` argument per call. They are physically separate files — you cannot JOIN across them in one query. When a question spans databases, query one, carry the IDs in your reasoning, and query the next with `WHERE … IN (…)`.

- **main** — characters, chats, chat_messages, memories, connection_profiles, projects, groups, files, folders, settings, jobs.
- **llm-logs** — the `llm_logs` table: full request/response JSON, token usage, cost, duration, per model call.
- **mount-index** — the document stores, and the **actual text of every document, including all character/project/group vault content**.

### Conventions
- Columns are **camelCase** (`createdAt`, `chatType`, `aboutCharacterId`); most table names are snake_case (`chat_messages`, `doc_mount_file_links`).
- IDs are UUID strings; timestamps are ISO 8601 strings that sort and compare directly (`ORDER BY createdAt DESC`, `WHERE createdAt >= '2026-06-01'`).
- Many TEXT columns hold JSON (e.g. `chats.participants`, `characters.tags`, `memories.keywords`). Use `json_extract(col,'$.x')`, `json_each(col)`, `json_array_length(col)`.
- Almost no foreign keys are enforced; orphan rows can exist — LEFT JOIN and check for NULL when it matters.
- To learn a table's real columns at runtime: `SELECT * FROM <table> LIMIT 1`, or `PRAGMA table_info(<table>)`.
- BLOB columns (embeddings, blobs) come back as a `<blob: N bytes>` placeholder, not bytes — test presence with `embedding IS NOT NULL`.
- `llm_logs.request`/`response` can be very large — select narrow columns and use `json_extract(...)`, `length(...)`, or `substr(...)` rather than dumping them. Keep result sets small; prefer aggregates.

### The vault trap — read before querying character content
The `characters` row in **main** holds only identity scaffolding, flags, and a pointer. The actual content — identity, description, personality, manifesto, example dialogues, scenarios, system prompts, physical descriptions, wardrobe, pronouns, aliases, title, first message — lives in each character's **document vault**, a database-backed store in **mount-index**. So "what is X's personality?" is a two-database operation:
1. **main:** `SELECT id, name, characterDocumentMountPointId FROM characters WHERE name LIKE '%X%';`
2. **mount-index:** the vault file at a known relativePath; its text is in `doc_mount_documents.content`, reached by joining links → files → documents:
   ```sql
   SELECT l.relativePath, COALESCE(d.content, l.extractedText) AS text
   FROM doc_mount_file_links l
   LEFT JOIN doc_mount_documents d ON d.fileId = l.fileId
   WHERE l.mountPointId = :mountPointId AND l.relativePath = 'personality.md';
   ```
Vault paths: identity.md, description.md, personality.md, manifesto.md, example-dialogues.md, physical-description.md, physical-prompts.json, properties.json (pronouns/aliases/title/firstMessage/talkativeness), Prompts/<name>.md, Scenarios/<title>.md, Wardrobe/*.md. The same pattern applies to projects (`projects.officialMountPointId`) and groups (`groups.officialMountPointId`) — the slim row only carries the pointer. If a content column you expect is missing from `characters`, that is the vault trap: go read the vault.

### Memories (the importance question)
`memories` columns that matter: `characterId` (the holder), `aboutCharacterId` (who it's about — equal to holder = self-knowledge; different = about another character/user persona; NULL = legacy), `content`, `summary`, `importance` (raw REAL, default 0.5), `reinforcedImportance` (REAL — the score recall actually uses, and the default sort), `reinforcementCount`, `source` ('AUTO'|'MANUAL'), `chatId`/`projectId` (provenance), `witnessedContext`, `relatedMemoryIds` (JSON graph), `embedding` (BLOB). When asked about "importance," show both `importance` and `reinforcedImportance` and say which is which; lead with `reinforcedImportance`. For a distribution, resolve the holder's id in main, then one aggregate over `memories` with `CASE` buckets, `AVG`, `MIN`, `MAX`, and `source` splits — return the histogram, not raw rows.

### Chats and messages
`chats.chatType` is 'salon' | 'help' | 'autonomous' | 'brahma'. "My chats/conversations" almost always means `chatType = 'salon'` — filter to it unless they mean otherwise. `chats.participants` is a JSON array (each entry has a `characterId`). `chat_messages` carries `chatId`, `role`, `content`, `participantId`, token/cost columns; system/feature messages set `systemSender` (lantern/aurora/host/prospero/carina/…) — filter `WHERE systemSender IS NULL` for only real conversational turns.

### How to work a question
1. Translate the question to rows/databases/joins. If it names a character/chat/project, first resolve the name → UUID (names are fuzzy; say what you matched).
2. Mind boundaries: content → vault (main → mount-index); cross-database → stage it and carry IDs.
3. Explore cheaply first (LIMIT 5 / COUNT(*) / inspect one row).
4. Compute in SQL (aggregates) rather than dumping rows.
5. Answer in the operator's terms — UUIDs back to names, scores into plain language, JSON into readable facts. Offer the query if useful; don't make them read SQL unless they ask.
6. Be honest about empty results, orphans, NULLs, missing vault files. Never fabricate rows, counts, or content.
```

---

## 6. Tests (required)

- **Read-only guard (unit, the critical ones):** assert `executeRunSqlTool` rejects `UPDATE`, `DELETE`, `INSERT`, `DROP`, `ALTER`, `VACUUM`, `PRAGMA journal_mode = WAL`, a multi-statement `SELECT …; DELETE …`, and a CTE that wraps a write; assert it allows `SELECT`, `WITH … SELECT`, `EXPLAIN`, `PRAGMA table_info(memories)`. Drive the `stmt.readonly === false` path with a real prepared write against an in-memory `better-sqlite3` (tests fall back `better-sqlite3-multiple-ciphers` → `better-sqlite3`, per CLAUDE.md).
- **Surface gate:** assert `run_sql` returns the "only available in the Brahma Console" error when `operatorSurface` is falsy, and executes when true.
- **Database routing:** assert `database: 'llm-logs'` / `'mount-index'` resolve to the right accessor and that a `null` (degraded) handle yields a clean error, not a throw.
- **Shaping:** BLOB → placeholder; `max_rows` cap sets `truncated: true`; `columns` populated even for an empty result.
- **Builder/orchestrator:** assert the Brahma `buildTools(...)` call includes `run_sql` in the tool set, and that a character-surface `buildTools(...)` (Salon/help) does **not**.
- **Snapshot:** refresh `tool-definitions-snapshot.test.ts` (`npx jest -u`).
- **Type-check** with `npx tsc` (not `npm run build`).

---

## 7. Build order

1. `lib/tools/run-sql-tool.ts` (schema, definition, types) → register in the snapshot test → `npx jest -u`.
2. `lib/tools/handlers/run-sql-handler.ts` (guard + execute + shape) → guard unit tests.
3. `tool-executor.ts` `run_sql` branch (operator-surface gate).
4. `BuildToolsOptions.sqlAccess` + push in `buildToolsForProvider` → `buildTools` positional param → Brahma orchestrator passes `true`.
5. `buildBrahmaSystemPrompt` `includeSqlAccess` + `BRAHMA_SQL_PROMPT` constant; orchestrator passes `includeSqlAccess: true`.
6. Tests (guard, surface, routing, shaping, builder); `npx tsc`; relevant Jest suites.
7. Docs: `help/*.md`, `docs/CHANGELOG.md`, DDL.md pointer note. Then `/commit`.

---

## 8. Guardrails recap (so the reviewer can check them fast)

- `run_sql` is **offered** only when `sqlAccess` is true (Brahma only) **and executed** only when `operatorSurface` is true — two independent gates.
- Read-only is enforced by (1) a keyword/statement scan, (2) the authoritative `better-sqlite3` `stmt.readonly` check (fail closed), and (3) a row cap. The tool never writes; no `--write`, no new connection, no re-key.
- No schema change, no migration, no export/backup change.
- The console's existing guarantees are untouched: no persistent memory, `search` still excludes the `memories` source, web/curl still gated by the profile. `run_sql` is additive read-only inspection.
- Spelling: **Quilltap**, never "Quilttap".
```
