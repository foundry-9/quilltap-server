# Scriptorium per-document policy frontmatter (`embed`, `character_read`, `character_write`)

> **Status:** Plan for Claude Code to execute. Not yet implemented.
> **Author of plan:** Ariadne (research/scoping pass), for Charlie.
> **Scope:** Add three per-document policy flags, declared in a mounted markdown file's YAML frontmatter, that govern (a) whether the document is embedded for semantic retrieval, (b) whether any LLM character may *read* it via `doc_` tools or RAG, and (c) whether any LLM character may *mutate* it via `doc_` tools.

---

## 1. The feature in one paragraph

A mounted markdown document may carry three frontmatter properties — `embed`, `character_read`, `character_write`. Each **defaults to `true`** and is only `false` when the frontmatter says so. `embed: false` keeps the document out of the embedding pipeline **and erases any embedding it already has**. `character_read: false` makes the document invisible and unreadable to every LLM character — through the `doc_` read tools, through `doc_list_files`/`doc_grep` listing, and through semantic retrieval (RAG). `character_write: false` blocks every character-initiated mutation of the document (write, str-replace, insert, frontmatter/heading update, move, copy *as source removal is involved*, rename, delete). The human operator (Document Mode / Brahma Console, i.e. `operatorOverride`) is **never** restricted by these flags.

The reference document that motivates this is `Roleplay/ad-Daiat/ad-Daiat Recurring Scenarios.md`, whose frontmatter is:

```yaml
---
embed: "false"
character_read: "false"
character_write: "false"
---
```

Note the values are **quoted strings** (`"false"`), not bare YAML booleans. Coercion must treat `"false"`/`false`/`"no"`/`0` as false and everything-else-present (or absent) as the `true` default. See §4.

---

## 2. Design decisions already settled (do not re-litigate)

1. **Storage:** the three flags are **stored in the mount index DB**, on the **link row** (`doc_mount_file_links`), not parsed per-call from disk. The link row already holds per-document lifecycle state and is the row both the embedding scheduler and RAG search traverse via `linkId`. A migration adds three columns; the scanner/watcher/reindex path populates them by parsing frontmatter at index time.
2. **`character_read: false` is total:** it blocks the `doc_read_*` tools **and** hides the file from `doc_list_files` / `doc_grep`, **and** blocks RAG retrieval. The character must not be able to tell the file exists.
3. **RAG is in scope:** a `character_read: false` (or `embed: false`) document must never surface as a retrieved chunk, even if an embedding somehow lingers. Belt **and** suspenders: `embed: false` erases the vectors; the search path also filters by the flag.
4. **Operator override is exempt:** `operatorOverride === true` bypasses all three gates. These flags govern *characters*, not the human.
5. **Default is `true`** for all three, both for documents with no frontmatter and for the columns' SQL defaults.

---

## 3. Architecture map (where things live today)

Paths are repo-relative to `/Users/csebold/source/quilltap-server`.

**Frontmatter parsing (existing, reusable):**
- `lib/doc-edit/markdown-parser.ts` — `parseFrontmatter(content)` returns `{ data, bodyStartLine, bodyStartOffset }` using the `yaml` package (`YAML.parse`). `serializeFrontmatter(data)` round-trips. This is the canonical parser to reuse.
- `lib/mount-index/converters/markdown-converter.ts` — `stripFrontmatter()` already removes frontmatter before text extraction, so this is a place that *already* sees the raw frontmatter region during indexing.

**Mount index schema & link row:**
- `doc_mount_file_links` is the per-document/per-link row (defined in `migrations/scripts/add-doc-mount-file-links.ts`). It owns `conversionStatus`, `plainTextLength`, `chunkCount`, etc. — the right home for the new policy columns.
- `migrations/lib/mount-index-schema.ts` — `alignDocMountPointsSchema()` is the idempotent "ADD COLUMN if missing" drift-guard for `doc_mount_points`. **There must be an equivalent for `doc_mount_file_links`** (it may already exist — see §5.1; if not, add one mirroring this pattern).
- Repository: `lib/database/repositories/doc-mount-points.repository.ts` (and the file-links repo it exports — `repos.docMountFileLinks`).

**Embedding pipeline:**
- `lib/mount-index/embedding-scheduler.ts` — `enqueueEmbeddingJobsForMountPoint(mountPointId)` finds chunks with no embedding and enqueues `EMBEDDING_GENERATE` jobs. This is where `embed: false` must (a) skip enqueue and (b) trigger erase.
- `lib/doc-edit/reindex-file.ts` — `reindexSingleFile()` re-chunks a single file after an edit (sets `embedding: null` on new chunks; caller enqueues). Frontmatter flags should be (re)parsed and persisted to the link row here.
- `lib/mount-index/scanner.ts` / `lib/mount-index/scan-runner.ts` — full-scan indexing path; also must persist flags.
- `lib/mount-index/watcher.ts` — `handleAddOrChange()` → `processMountFile()` → `scheduleEmbedding()`; filesystem-change path.
- `lib/mount-index/store-file.ts` — writes file/link/chunk rows during indexing (`processMountFile` lives here or nearby); the natural place to set the flags when the link row is created/updated.

**`doc_` tools (read/write chokepoints):**
- `lib/tools/handlers/doc-edit/shared.ts` — `buildReadResolutionContext()` and `buildWriteResolutionContext()` are the two funnels every doc tool passes through. Existing guards here: character vault opacity (`actingCharacterIsOpaqueToVaults`), cross-character read opt-in, peer-vault write block (`assertWriteDoesNotTargetPeerVault`). **This is where `character_read` / `character_write` gates belong.**
- `lib/doc-edit/path-resolver.ts` — `resolveDocEditPath()` resolves scope+path → `ResolvedPath` (carries `mountPointId`, absolute path). Throws `PathResolutionError` (with codes). The flag lookup happens *after* this resolves a mount-point file.
- Handler groups: `lib/tools/handlers/doc-edit/{text,markdown,file-management,blob}-handlers.ts`.
  - **Reads:** `handleReadFile`, `handleReadFrontmatter`, `handleReadHeading`, `handleGrep`, `handleListFiles`, `handleReadBlob`, `handleListBlobs`.
  - **Writes/mutations:** `handleWriteFile`, `handleStrReplace`, `handleInsertText`, `handleUpdateFrontmatter`, `handleUpdateHeading`, `handleMoveFile`, `handleCopyFile`, `handleDeleteFile`, `handleMoveFolder`, blob writes/deletes.

**RAG retrieval:**
- `lib/mount-index/document-search.ts` — `searchDocumentChunks()` loads embedded chunks (via `mount-chunk-cache.ts`), scores, and maps surviving chunks back to link rows for display. **Filter out chunks whose link has `character_read: false` here** (and ideally don't cache/score them at all).
- `lib/mount-index/mount-chunk-cache.ts` — `getChunksForMountPoints()` in-memory cache of embedded chunks; the cleanest filter point so blocked chunks never enter scoring.

**Tests:**
- `__tests__/unit/lib/mount-index/embedding-scheduler.test.ts`
- `__tests__/unit/lib/mount-index/reindex.test.ts`, `.../store-file.test.ts`, `.../read-file.test.ts`
- `__tests__/unit/lib/doc-edit/path-resolver.test.ts`
- `__tests__/unit/lib/tools/handlers/doc-edit-handler-*.test.ts`
- `lib/tools/__tests__/tool-definitions-snapshot.test.ts` (only if a tool's schema changes — it should **not** for this feature).

---

## 4. The flag-coercion contract (single source of truth)

Create one pure helper and use it **everywhere** the three flags are read off frontmatter. Do **not** duplicate coercion logic.

Suggested location: `lib/doc-edit/document-policy.ts` (new file).

```ts
// lib/doc-edit/document-policy.ts
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';

export interface DocumentPolicy {
  embed: boolean;          // default true
  characterRead: boolean;  // default true
  characterWrite: boolean; // default true
}

export const DEFAULT_DOCUMENT_POLICY: DocumentPolicy = {
  embed: true,
  characterRead: true,
  characterWrite: true,
};

/**
 * Coerce a frontmatter value to a policy boolean.
 * Treats the QUOTED-STRING forms ("false"/"no"/"0"/"off") and the bare
 * YAML `false`/0 as false; absent or anything-else as the `true` default.
 * Case-insensitive, whitespace-trimmed.
 */
export function coercePolicyBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '') return fallback;
    if (['false', 'no', '0', 'off', 'n'].includes(v)) return false;
    if (['true', 'yes', '1', 'on', 'y'].includes(v)) return true;
    return fallback; // unrecognized string → default
  }
  return fallback;
}

/** Read the three policy flags from already-parsed frontmatter data. */
export function policyFromFrontmatterData(
  data: Record<string, unknown> | null
): DocumentPolicy {
  if (!data) return { ...DEFAULT_DOCUMENT_POLICY };
  return {
    embed:          coercePolicyBool(data['embed']),
    characterRead:  coercePolicyBool(data['character_read']),
    characterWrite: coercePolicyBool(data['character_write']),
  };
}

/** Parse raw file text → policy. Non-markdown / no-frontmatter → all-true. */
export function policyFromContent(content: string): DocumentPolicy {
  try {
    const { data } = parseFrontmatter(content);
    return policyFromFrontmatterData(data);
  } catch {
    return { ...DEFAULT_DOCUMENT_POLICY };
  }
}
```

Unit-test this helper directly (table-driven: `"false"`, `false`, `"FALSE"`, `"no"`, `0`, `"true"`, missing key, non-string junk, no frontmatter at all). It is the load-bearing correctness surface of the whole feature.

> Only markdown files carry frontmatter. For non-markdown link rows the columns simply stay at their `true` defaults — correct behaviour (a PDF can still be read/written/embedded unless someone builds a policy mechanism for it later).

---

## 5. Implementation steps (ordered, for Claude Code)

Work in dependency order. Follow the repo's standing rules: `npx tsc` for type-checking (not `npm run build`), update `docs/CHANGELOG.md` (plain voice), update `help/*.md` for user-visible behaviour, register nothing in the tool snapshot unless a tool schema actually changes (it shouldn't), and respect the migration loading-screen rules.

### 5.1 Schema: add three columns to `doc_mount_file_links`

1. **Migration** — add `migrations/scripts/add-doc-mount-file-policy-flags.ts` (mount-index DB), mirroring the structure of `add-doc-mount-file-links.ts` (open mount-index DB with the pepper key, `foreign_keys` handling, `shouldRun` gated on the columns being absent). It runs:
   ```sql
   ALTER TABLE "doc_mount_file_links" ADD COLUMN "allowEmbed"          INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE "doc_mount_file_links" ADD COLUMN "allowCharacterRead"  INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE "doc_mount_file_links" ADD COLUMN "allowCharacterWrite" INTEGER NOT NULL DEFAULT 1;
   ```
   - Column naming: use `allow*` (positive sense) so SQL default `1` == permissive == matches the frontmatter `true` default. The frontmatter key `embed:false` ⇒ `allowEmbed = 0`.
   - `shouldRun()`: return true only if `doc_mount_file_links` exists and any of the three columns is missing (PRAGMA table_info check, like `hasColumn` in the existing migration).
   - `run()`: after adding the columns, **backfill is required** (committed decision — protect existing documents the instant the release lands). For every markdown link row, read its current bytes (filesystem mounts: the file on disk; database-backed: `doc_mount_documents.content`), parse the policy with `policyFromContent(...)` (§4), and `UPDATE` the three `allow*` columns. Non-markdown links keep the permissive defaults — skip them. Wrap the loop in a transaction and call `reportProgress(i, total, 'documents')` (throttled; safe every iteration). Count the total upfront with `SELECT COUNT(*)` over the markdown links so progress is meaningful. Because this runs inside the migration's DB connection (not the app), call `parseFrontmatter` directly on the raw bytes rather than going through repository helpers — keep the migration self-contained, the way `add-doc-mount-file-links.ts` inlines its row shapes.
     - **Erase embeddings for `embed:false` links during backfill too:** in the same loop, when a link resolves to `allowEmbed = 0`, `UPDATE doc_mount_chunks SET embedding = NULL WHERE linkId = ?` so an already-indexed protected document (like the ad-Daiat file) is stripped of its vectors on upgrade, not merely on the next reindex. (The runtime scheduler in §5.4 is the steady-state enforcement point; this is the one-time catch-up for documents indexed before the feature existed.)
   - Register the migration in `migrations/scripts/index.ts`.
   - Add a **pretty label** in `lib/startup/prettify.ts` `PRETTY_LABELS` for this migration ID, in the steampunk-Wodehouse voice (terse, present-continuous, about the user's data, e.g. *"Noting which manuscripts wish to remain unread."*).
   - The migration writes both `doc_mount_file_links` (the flags) and `doc_mount_chunks` (NULLing embeddings for `embed:false`). The mount-chunk in-memory cache (`mount-chunk-cache.ts`) lives in the running app, not the migration process, and the index isn't serving retrieval mid-startup, so no explicit cache invalidation is needed from the migration — the cache is built fresh after startup. (Runtime flag flips *do* require invalidation; see §5.4.)

2. **Drift guard** — add an `alignDocMountFileLinksSchema(db)` helper (new, or extend an existing align function for the links table if one exists) listing these three columns as addable, mirroring `alignDocMountPointsSchema` in `migrations/lib/mount-index-schema.ts`. Wire it into wherever `alignDocMountPointsSchema` is called at startup so pre-existing mount-index DBs gain the columns even outside the formal migration. **First check whether a `doc_mount_file_links` align list already exists** — if so, append to it instead of creating a parallel one.

3. **DDL docs** — update `docs/developer/DDL.md`: add the three columns to the `doc_mount_file_links` definition with a one-line note on semantics and defaults.

### 5.2 Repository & types: surface the columns

1. In the file-links repository (`lib/database/repositories/doc-mount-points.repository.ts` or its links sibling), add `allowEmbed`, `allowCharacterRead`, `allowCharacterWrite` to:
   - the row's TS interface / model type,
   - the SELECT column lists and row-mapping (coerce SQLite `0/1` → boolean in the mapper, matching how `enabled` is handled),
   - the INSERT/UPDATE statements (`linkFilesystemFile`, the update used by reindex, any database-store link writer in `lib/mount-index/store-file.ts`),
   - add a small `updatePolicyFlags(linkId, { allowEmbed, allowCharacterRead, allowCharacterWrite })` method if the existing update signature is awkward to extend.
2. Keep the boolean⇄integer coercion in the repository layer (DB stores `0/1`; the rest of the code sees booleans), consistent with existing `enabled` handling.

### 5.3 Populate flags at index time

Everywhere a markdown link row is created or refreshed from file bytes, parse the policy and write it to the link row. Use `policyFromContent(plainTextOrRawBytes)` — **important:** parse from the **raw file content that still contains frontmatter**, not the frontmatter-stripped plain text used for chunking. In `reindex-file.ts` the raw markdown is read before `convertToPlainText`/`stripFrontmatter`; capture the policy there.

Touch points:
- `lib/doc-edit/reindex-file.ts` — `reindexSingleFile()`: for markdown files, parse policy from the source bytes and pass it into the `linkFilesystemFile(...)` / link `update(...)` calls (both the database-backed and filesystem branches). For non-markdown, leave defaults.
- `lib/mount-index/store-file.ts` / `scanner.ts` — the full-scan path that creates link rows: same parse-and-set, for markdown files only.
- Database-backed stores: parse from `doc_mount_documents.content`.

> Because `embed:false` means "no embedding", the indexer should also **not bother** enqueuing embeddings for that link (the scheduler will skip it anyway per §5.4, but skipping chunk embedding work early is cheaper).

### 5.4 Embedding pipeline: honor `embed: false`

In `lib/mount-index/embedding-scheduler.ts` `enqueueEmbeddingJobsForMountPoint()`:

1. Load the link rows for the mount point (`repos.docMountFileLinks.findByMountPointId(mountPointId)`), build a `linkId → allowEmbed` map.
2. **Skip** enqueue for any chunk whose link has `allowEmbed === false`:
   ```ts
   const unembeddedChunks = allChunks.filter(
     c => (!c.embedding || c.embedding.length === 0) && allowEmbedByLink.get(c.linkId) !== false
   );
   ```
3. **Erase** existing embeddings for `allowEmbed === false` links. Add an explicit step before/after enqueue:
   ```ts
   const blockedLinkIds = links.filter(l => !l.allowEmbed).map(l => l.id);
   for (const linkId of blockedLinkIds) {
     await repos.docMountChunks.clearEmbeddingsByLinkId(linkId); // sets embedding = NULL
   }
   ```
   Add `clearEmbeddingsByLinkId(linkId)` to the chunks repository if absent (`UPDATE doc_mount_chunks SET embedding = NULL WHERE linkId = ?`). Prefer NULLing over row-deletion so the chunk text still exists for non-RAG uses and re-embedding is possible if the flag flips back; the RAG filter (§5.5) already excludes the link regardless.
4. After erasing, **invalidate the mount-chunk cache** for the mount point (see `mount-chunk-cache.ts`) so freshly-NULLed embeddings don't linger in memory.

Also: when a file is reindexed and its policy flips to `embed:false`, ensure the reindex path (or the scheduler call that follows it) runs the erase. The simplest invariant: **the scheduler is the single enforcement point** — it both skips and erases on every run — and reindex always calls the scheduler afterward.

### 5.5 RAG: honor `character_read: false`

In `lib/mount-index/document-search.ts` `searchDocumentChunks()`:

1. Build the set of link IDs that are readable: when assembling `chunksInScope`, exclude any chunk whose link has `allowCharacterRead === false`. The function already iterates `repos.docMountFileLinks.findByMountPointId(mpId)` in the `pathPrefix` branch — extend that to always collect a `blockedLinkIds` set (independent of `pathPrefix`) and filter `chunksInScope` by it.
2. Cleaner still: filter inside `lib/mount-index/mount-chunk-cache.ts` `getChunksForMountPoints()` so blocked chunks never even enter scoring. If the cache is shared with operator surfaces, gate the filter on a parameter (operator path passes everything; character RAG path passes "exclude blocked"). Since the RAG injector is always character-facing here, the simplest correct move is to filter in `document-search.ts`, which is exclusively the semantic-retrieval-for-characters path.
3. With `embed:false` already erasing vectors, a blocked file usually has no chunks to score anyway — this filter is the suspenders to that belt, covering the window between a flag flip and the next scheduler run.

> Confirm whether `searchDocumentChunks` is ever called on behalf of the **operator** (Document Mode search). If it is, thread an `includeBlocked`/`operatorOverride` option so the human still searches everything. Grep callers of `searchDocumentChunks` before deciding.

### 5.6 `doc_` tools: enforce `character_read` and `character_write`

This is the security-critical part. Enforce in the **two resolution-context builders** in `lib/tools/handlers/doc-edit/shared.ts`, so every tool inherits the gate without per-handler edits.

1. After `resolveDocEditPath(...)` yields a `ResolvedPath` with a `mountPointId` and relative path, look up the link row (`repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath)`).
2. **In `buildReadResolutionContext`:** if `context.operatorOverride !== true` and the link has `allowCharacterRead === false`, throw a `PathResolutionError` with a not-found-style code so the character can't even confirm existence (mirror the message used for genuinely missing files — do **not** say "access denied", which leaks existence). Reuse the existing not-found error shape from `path-resolver.ts`.
3. **In `buildWriteResolutionContext`:** if `context.operatorOverride !== true` and the link has `allowCharacterWrite === false`, throw a `PathResolutionError` (an explicit "this document is read-only to characters" message is fine here — write attempts on a *visible* file may legitimately report read-only; but if the file is *also* `character_read:false`, prefer the not-found message to avoid leaking existence — see edge cases §6).
4. **Listing & grep:** `handleListFiles` and `handleGrep` don't necessarily pass through the per-file resolution builder for *every* candidate. They enumerate a mount point's files. Add a filter there: when not `operatorOverride`, drop any link with `allowCharacterRead === false` from results. Pull the link rows once and filter by `allowCharacterRead`.
5. **Copy semantics:** `handleCopyFile` reads a source and writes a destination. Gate the **source** by `character_read` (you can't copy what you can't read) and the **destination** by `character_write`. Since the source ad-Daiat file is `character_read:false`, copy is blocked at the read gate — good.
6. **Move/rename semantics:** moving removes the source path — gate by `character_write` on the source (and `character_write` on any destination-overwrite). A blocked file cannot be moved or renamed.
7. **Folder operations:** `handleDeleteFolder` / `handleMoveFolder` can affect a blocked file transitively. Decide policy: a folder delete/move that would remove/relocate a `character_write:false` file must **fail** (don't silently skip — fail the whole op with a clear error naming the protected document), so a character can't delete a protected file by deleting its parent folder. Enforce by checking all contained links' `allowCharacterWrite` before executing the folder op.

> **Single chokepoint discipline:** prefer adding one helper in `shared.ts`, e.g. `assertCharacterMayRead(resolved, context)` and `assertCharacterMayWrite(resolved, context)`, each a no-op when `operatorOverride`. Call them from the two context builders (and the list/grep/folder paths that bypass the builders). Do not scatter raw flag checks across handlers.

### 5.7 Make policy changes take effect when frontmatter is edited

If a character (or the operator) edits frontmatter via `doc_update_frontmatter`, or a file changes on disk, the link row's flags must update. The reindex path (§5.3) already re-parses on every edit/change, so this is automatic **provided** `triggerReindexIfNeeded` runs for frontmatter updates (it does, per the architecture map) and the reindex persists the freshly parsed policy. Add an explicit test for "edit frontmatter `embed:true→false` ⇒ embeddings erased on next reindex+schedule" (§5.8).

> Operator note: a character is normally blocked from writing the protected file, so in practice only the operator (or an on-disk edit in Obsidian) changes these flags. That's the intended control surface.

### 5.8 Tests

Add/extend:
- `__tests__/unit/lib/doc-edit/document-policy.test.ts` (new) — table-driven coercion (§4). Highest priority.
- `__tests__/unit/lib/mount-index/embedding-scheduler.test.ts` — chunks of an `allowEmbed:false` link are not enqueued; existing embeddings are NULLed; cache invalidated.
- `__tests__/unit/lib/mount-index/document-search.test.ts` (new or extend) — chunks of an `allowCharacterRead:false` link never appear in results, even if an embedding is present.
- `__tests__/unit/lib/doc-edit/path-resolver.test.ts` and a `doc-edit-handler-policy.test.ts` (new) —
  - character read of a `character_read:false` file ⇒ not-found error; operator read ⇒ succeeds;
  - character write/str-replace/insert/update-frontmatter/update-heading on `character_write:false` ⇒ blocked; operator ⇒ succeeds;
  - `doc_list_files` / `doc_grep` omit the blocked file for characters, include for operator;
  - `doc_copy_file` with blocked source ⇒ blocked; `doc_move_file` of blocked file ⇒ blocked;
  - folder delete/move containing a `character_write:false` file ⇒ whole op fails naming the protected file.
- Reindex round-trip: parsing `"false"` strings from real frontmatter sets `allow* = 0` on the link row.
- Run `npx tsc` and the touched Jest suites. The tool-definitions snapshot should be **unchanged** (no tool schema changed); if it changed, you introduced an unintended schema edit — investigate rather than running `-u` blindly.

### 5.9 Docs, changelog, help, voice

- `docs/CHANGELOG.md` — reverse-chronological, plain American English, no steampunk. e.g. *"Scriptorium: markdown documents may set `embed`, `character_read`, and `character_write` frontmatter flags (default true). `embed:false` removes embeddings; `character_read:false` hides a file from characters and RAG; `character_write:false` blocks character edits. Operator surfaces are unaffected."*
- `help/*.md` — this is user-visible. Add/extend the Scriptorium help doc describing the three flags, their default-true semantics, the quoted-vs-bare value note, and that the operator is never restricted. Include the required `url` frontmatter field and an "In-Chat Navigation" section whose `help_navigate(url: "...")` matches. Voice: steampunk + Roaring 20s + Wodehouse + Lemony Snicket.
- Keep `docs/developer/DDL.md` current (done in §5.1.3).
- If `update-documentation` lists docs that mention Scriptorium/mount flags, refresh them.

---

## 6. Edge cases & decisions to confirm during implementation

1. **Existence leakage.** A `character_read:false` file must produce the *same* error as a missing file (not "access denied"), so a character can't probe for protected filenames. For a file that is `character_write:false` but `character_read:true`, a write attempt may legitimately return a read-only error (the character can see it). Implement: write gate checks read-gate first — if not readable, throw not-found; else throw read-only.
2. **Non-markdown files.** Columns default permissive; no frontmatter to parse. Leave them fully accessible/embeddable. Don't invent a policy channel for blobs in this change (YAGNI).
3. **Operator search.** Confirm `searchDocumentChunks` callers; the human's Document-Mode search must still see blocked files. Thread an option if needed (§5.5).
4. **Cache coherence.** After erasing embeddings or flipping `character_read`, invalidate `mount-chunk-cache` for the mount point so retrieval reflects the change immediately.
5. **Backfill on upgrade (committed).** The migration backfills: it parses each markdown link's current bytes, sets the three `allow*` columns, and NULLs embeddings for `embed:false` links — so the ad-Daiat file is protected and de-embedded the moment the release lands, not on the next reindex. See §5.1.1. Non-markdown links keep permissive defaults.
6. **`.qtap` / SillyTavern export & backup.** Per CLAUDE.md, check whether the new link columns must be reflected in `qtap-export.schema.json`, backups, and `migrations/`. Link-row policy is index-derived metadata (re-derivable from file bytes), so it likely does **not** need to be a first-class export field — but confirm: if a backup/restore re-imports documents without reindexing, the flags should be re-derived on import. Grep `backup/restore` and `import-document-stores.ts` (both reference mount chunks) and ensure restore triggers reindex or carries the flags.
7. **Cross-character vault reads.** The existing `allowCrossCharacterVaultReads` opt-in must not override `character_read:false`. The per-document gate is stricter and wins — verify ordering so a peer-vault read still hits the policy gate.

---

## 7. Suggested commit slicing

1. `document-policy.ts` helper + its unit test (no behavior change yet).
2. Migration + drift-guard + repository columns + DDL.md (schema lands, defaults permissive).
3. Index-time population (reindex/scanner/store-file) + reindex tests.
4. Embedding scheduler skip+erase + cache invalidation + scheduler tests.
5. RAG filter + document-search tests.
6. `doc_` read/write/list/grep/folder gates in `shared.ts` + handler tests.
7. CHANGELOG + help docs.

Each slice type-checks (`npx tsc`) and passes its suites before the next. Use the repo's `/commit` flow (it handles lint/test/type-check/version bump) per CLAUDE.md.

---

## 8. Quick reference — the three flags

| Frontmatter key | Link column | Default | `false` effect |
|---|---|---|---|
| `embed` | `allowEmbed` | `true` / `1` | Not embedded; existing embeddings erased (chunks' `embedding` set NULL); cache invalidated. |
| `character_read` | `allowCharacterRead` | `true` / `1` | Invisible to characters: `doc_read_*` ⇒ not-found, hidden from `doc_list_files`/`doc_grep`, excluded from RAG. Operator unaffected. |
| `character_write` | `allowCharacterWrite` | `true` / `1` | No character mutation: write/replace/insert/update-frontmatter/update-heading/move/rename/delete blocked; copy-source blocked via read gate; folder ops that would touch it fail. Operator unaffected. |

Values may be quoted strings (`"false"`) or bare (`false`); coercion is case-insensitive and treats `false/no/0/off` as false, absent/unrecognized as the `true` default.
