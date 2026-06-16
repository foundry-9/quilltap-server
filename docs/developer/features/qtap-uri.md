# Feature: `qtap://` Document URIs

**Status:** Implemented (4.7-dev)
**Author:** Drafted with Ariadne (research + design), for Claude Code to implement.
> **Note on line numbers:** the file paths in this spec are exact; the cited line numbers are
> accurate as of drafting but may drift slightly as code changes — treat them as "look here," then
> confirm by symbol/string search. CLI line numbers (`packages/quilltap/lib/docs-commands.js`) in
> particular are approximate; locate `requireMount`, `UUID_RE`, and `parseFlags` by name.

**Goal:** Make a single, first-class URI form — `qtap://…` — the primary way to address any
document/file/blob reachable through Quilltap's document-store subsystem. Every producer (CLI,
`doc_*` tools, whispers, announcements, search results, self-inventory) and every consumer (the
same tools, the CLI, the path resolver) must be able to **emit** and **accept** these URIs.

This spec leaves nothing to chance: it states the grammar, the precise resolution algorithm, the
exact files to touch, and the test/doc obligations. Read it top to bottom before writing code.

---

## 0. Design decisions (locked — do not relitigate)

These were decided by the human. Implement exactly as stated.

1. **Authority is name-first, ID-as-fallback.** A URI authority is matched as a mount-point *name*
   (case-insensitive, within the accessible set) first; if no name matches, it is matched as a
   mount-point *ID* (UUID). Producers that the system generates **for humans** (CLI output, Salon
   whispers) emit the **name** form when the name is unambiguous, and fall back to the **ID** form
   when the name is ambiguous or absent. (Rationale: names are readable; IDs are the escape hatch.)
2. **Scope is inferred by default, explicit when needed.** A bare authority (`self`, a store name,
   a UUID) implies the `document_store` scope. Two reserved authorities address the other scopes
   explicitly: `qtap://project/…` and `qtap://general/…`.
3. **Reserved authorities always win; ID is the collision escape hatch.** `self`, `project`, and
   `general` are *always* interpreted specially in the authority slot. A real store literally named
   one of those is still reachable **by its UUID**. This mirrors today's `SELF_VAULT_TOKEN` rule.
4. **Full reach this pass.** The codec is built once; *all* doc tools, the CLI, and *all*
   whispers/announcements both accept and produce `qtap://` URIs. The URI becomes the first-class
   form throughout — current `mount_point` + `path` inputs remain accepted for backward
   compatibility, but generated output is URIs.

---

## 1. Background — how addressing works today (verified against code)

A document is addressed today by a **triple**: `{ scope, mount_point, path }`.

- **`scope`** (`lib/doc-edit/path-resolver.ts`, type `DocEditScope`) is the *backing location*, one
  of `'document_store' | 'project' | 'general'`. It is **not** a tier.
  - `document_store` → a mounted store, addressed by `mount_point`.
  - `project` → the active project's "official" mount (`projects.officialMountPointId`), falling
    back to the legacy `<filesDir>/<projectId>/` layout.
  - `general` → the per-instance `<filesDir>/_general/` store.
  - A fourth value, **`group`**, appears only in `doc_list_files` / `search` as a *listing filter*
    (`lib/tools/handlers/doc-edit/text-handlers.ts:759,779-783`). It is a tag over `document_store`
    mounts that belong to a group, **not** a backing location the resolver understands. The URI
    scheme does **not** add a `group://` authority; group remains a list-time filter only.
- **`mount_point`** is a store **name** (case-insensitive) *or* **ID** (UUID), required only for
  `document_store`. The reserved literal **`self`** (`SELF_VAULT_TOKEN`, exported from
  `lib/doc-edit/path-resolver.ts:42`) means "the acting character's own vault", resolved via
  `characters.characterDocumentMountPointId` — and only when a `characterId` is in context.
- **`path`** is a relative path within the store. Absolute paths and `..` traversal are rejected
  (`resolveDocEditPath`).

**Key facts that shaped the grammar (all verified):**

- Mount-point **names are NOT unique** in the DB (`DocMountPointSchema` in
  `lib/schemas/mount-index.types.ts` has `name: z.string().min(1)`, no unique constraint) and are
  user-renameable. The CLI's `requireMount()` (`packages/quilltap/lib/docs-commands.js:240-265`)
  already handles ambiguous names by erroring and telling the user to pass the UUID. The new codec
  follows the same posture.
- Mount-point **IDs are UUID v4** (`crypto.randomUUID()` in `base.repository.ts`).
- `mountType` ∈ `'filesystem' | 'obsidian' | 'database'`.
- The "Quilltap General" instance store is identified by **ID**, stored in `instance_settings`
  (`getGeneralMountPointId()` in `lib/instance-settings/index.ts`). It is distinct from the
  `general` *scope* (`<filesDir>/_general/`). **Do not conflate them.** `qtap://general/…` addresses
  the `general` **scope** (the legacy `_general` storage), matching the existing
  `scope: 'general'`. The Quilltap-General *mount* is just an ordinary accessible store reachable by
  its name or ID.
- The resolver chokepoints that all read/write doc tools pass through are
  `buildReadResolutionContext` / `buildWriteResolutionContext`
  (`lib/tools/handlers/doc-edit/shared.ts:137-186`). They receive `{ scope?, mount_point? }`. This
  is the single best place to accept a URI on the tool side.
- The CLI resolves mounts **client-side** by opening the mount-index DB directly; its arg parser is
  **hand-rolled** (`parseFlags`, `docs-commands.js:204-237`). The CLI already uses a `mount:path`
  compound display for hard-links (`docs-commands.js:934-939`) — the closest existing precedent.

---

## 2. The `qtap://` grammar

```
qtap-uri    = "qtap://" authority "/" path [ "#" fragment ] [ "?" query ]
authority   = reserved / store-ref
reserved    = "self" / "project" / "general"          ; case-insensitive
store-ref   = encoded-name / uuid                       ; a store name OR a UUID
path        = path-segment *( "/" path-segment )        ; each segment percent-encoded
fragment    = encoded-heading [ ":" level ]             ; optional, markdown heading anchor
query       = key "=" value *( "&" key "=" value )      ; reserved for future use
```

### 2.1 Encoding rules (strict — write them in the codec, test them)

- The **authority** and each **path segment** are percent-encoded with `encodeURIComponent`, then
  joined with literal `/`. This is what lets a store named `Project Files: Voyages of the Covenant`
  become `qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md`.
  - **Decision point — colon encoding:** `encodeURIComponent(':')` → `%3A`. The user's example
    `qtap://Project%20Files:%20Voyages...` left the colon literal. **Accept both on parse** (a
    literal `:` inside an already-split authority segment is fine because we split on the *first*
    single `/` after `qtap://`, not on `:`), but **always emit `%3A`** so the canonical form is
    unambiguous and round-trips through any generic URL parser. Document this in the codec.
- The path is everything after the **first** `/` following the authority. Do **not** collapse,
  normalize, or resolve `.`/`..` in the codec — that's the path resolver's job, which already
  rejects `..`. The codec only decodes segments.
- A trailing `#fragment` is split off **before** decoding the path. A `?query` is split off before
  the fragment. (Parse order: strip scheme → split query → split fragment → split authority/path.)
- Empty path (`qtap://self/` or `qtap://self`) is **valid** and means "the store root" (used by
  `doc_list_files`, `doc_create_folder` with `""`, etc.). Normalize a missing path to `""`.

### 2.2 Authority → `{ scope, mount_point }` mapping

| Authority (decoded, lower-cased for reserved check) | `scope`           | `mount_point` passed to resolver |
|-----------------------------------------------------|-------------------|----------------------------------|
| `self`                                              | `document_store`  | `self` (the SELF_VAULT_TOKEN)    |
| `project`                                           | `project`         | *(none)*                         |
| `general`                                           | `general`         | *(none)*                         |
| anything else (a name or a UUID)                    | `document_store`  | the decoded authority verbatim   |

Because the resolver already (a) treats `self` specially only with a `characterId`, (b) matches
`mount_point` by name then by ID, and (c) lets a UUID escape a name collision, **the URI codec does
not need to re-implement resolution** — it only needs to produce the right `{ scope, mount_point }`
triple and hand it to the existing resolver. This is the crucial simplification: **the URI is a
serialization of the existing triple, nothing more.**

### 2.3 Worked examples (turn these into codec unit tests)

| URI | `scope` | `mount_point` | `path` | `fragment` |
|---|---|---|---|---|
| `qtap://self/Mail/1781578632981-from-friday.md` | `document_store` | `self` | `Mail/1781578632981-from-friday.md` | — |
| `qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md` | `document_store` | `Project Files: Voyages of the Covenant` | `Knowledge/rank_markings.md` | — |
| `qtap://550e8400-e29b-41d4-a716-446655440000/notes/today.md` | `document_store` | `550e8400-…` (UUID) | `notes/today.md` | — |
| `qtap://project/Outline.md` | `project` | *(none)* | `Outline.md` | — |
| `qtap://general/Scenarios/intro.md` | `general` | *(none)* | `Scenarios/intro.md` | — |
| `qtap://self/Backstory.md#Childhood:2` | `document_store` | `self` | `Backstory.md` | heading `Childhood`, level `2` |
| `qtap://self/` | `document_store` | `self` | `` (root) | — |

> The third row shows the collision escape hatch: if a store is literally named `project`, you reach
> it by its UUID, never by `qtap://project/…` (which is reserved).

---

## 3. The codec module (build this first)

Create **`lib/doc-edit/qtap-uri.ts`** and export it from `lib/doc-edit/index.ts`.

### 3.1 Types & API

```ts
export const QTAP_URI_SCHEME = 'qtap://';

/** The fully-decoded address a qtap:// URI denotes. */
export interface QtapUriParts {
  scope: DocEditScope;            // 'document_store' | 'project' | 'general'
  /** Present only when scope === 'document_store'. The reserved value 'self'
   *  (SELF_VAULT_TOKEN) or a store name/UUID, verbatim and decoded. */
  mountPoint?: string;
  /** Relative path within the store/scope. '' means the store root. */
  path: string;
  /** Optional markdown heading anchor (decoded), for heading-aware tools. */
  heading?: string;
  /** Optional heading level (1–6) if the fragment carried ':N'. */
  level?: number;
  /** Reserved for future use; parsed but currently unused. */
  query?: Record<string, string>;
}

export class QtapUriError extends Error {
  constructor(message: string, public code:
    'NOT_A_QTAP_URI' | 'MALFORMED' | 'EMPTY_AUTHORITY' | 'BAD_LEVEL') { super(message); }
}

/** True iff the string starts with the qtap:// scheme (cheap guard). */
export function isQtapUri(s: string): boolean;

/** Parse a qtap:// URI into its parts. Throws QtapUriError on malformed input.
 *  Does NOT touch the database or resolve anything — pure string work. */
export function parseQtapUri(uri: string): QtapUriParts;

/** Inverse of parseQtapUri. Always emits the canonical encoded form
 *  (authority + each path segment percent-encoded; ':' as %3A). */
export function formatQtapUri(parts: QtapUriParts): string;

/** Convenience: build the {scope, mount_point} the path resolver expects from
 *  a parsed URI. (mountPoint omitted for project/general.) */
export function qtapUriToResolverInput(parts: QtapUriParts):
  { scope: DocEditScope; mount_point?: string; path: string };
```

### 3.2 Producer-side helpers (so every emitter is consistent)

Producers need to turn a *resolved* document back into a URI. They already hold a
`mountPointName`, sometimes a `mountPointId`, a `scope`, and a `path`. Provide one helper that does
the name-vs-ID decision uniformly:

```ts
/** Build a human-facing qtap:// URI for a document_store document.
 *  Prefers the name; pass `nameIsAmbiguous: true` (caller decides, e.g. when a
 *  duplicate-name check fails) to force the UUID form instead. */
export function formatDocStoreUri(args: {
  mountPointName: string;
  mountPointId: string;
  path: string;
  nameIsAmbiguous?: boolean;
  heading?: string;
  level?: number;
}): string;

/** Build a qtap:// URI for project/general scope (no authority store). */
export function formatScopedUri(scope: 'project' | 'general', path: string,
  opts?: { heading?: string; level?: number }): string;

/** Build the canonical self-vault URI: qtap://self/<path>. */
export function formatSelfUri(path: string,
  opts?: { heading?: string; level?: number }): string;
```

For the **self** case specifically: when a producer knows the document lives in the acting
character's own vault, emit `qtap://self/…` rather than the vault's name/ID — it's the most stable
and readable form, and mirrors how the post office already uses `SELF_VAULT_TOKEN`.

### 3.3 Ambiguity detection for producers

Producers that emit the **name** form must know whether the name is ambiguous. Add a repository
helper (or reuse one if equivalent exists — check first) on the doc-mount-points repository:

```ts
// lib/database/repositories/doc-mount-points.repository.ts
/** Count enabled mounts whose name matches (case-insensitive). >1 ⇒ ambiguous. */
countByName(name: string): number;   // or async findByName(name): DocMountPoint[]
```

Use it to set `nameIsAmbiguous` when formatting. (The repository currently has **no** `findByName`;
this is a genuine addition. Verify before adding.)

### 3.4 Codec edge cases to test explicitly

- Round-trip: `formatQtapUri(parseQtapUri(x)) === canonical(x)` for every example in §2.3.
- Non-`qtap://` strings → `isQtapUri` false; `parseQtapUri` throws `NOT_A_QTAP_URI`.
- `qtap://` with empty authority (`qtap:///foo`) → `EMPTY_AUTHORITY`.
- Spaces, colons, `#`, `?`, and non-ASCII (e.g. a store named `Café`) survive a round-trip.
- A path segment that itself contains an encoded `/` (`%2F`) decodes to a literal slash inside one
  segment and is **not** re-split. (Document the behavior even if no current store needs it.)
- Fragment `#Heading%20Text:3` → `heading='Heading Text'`, `level=3`. `:0`, `:7`, `:x` →
  `BAD_LEVEL`.
- `qtap://SELF/...` (upper-case) resolves as the reserved `self` (reserved check is
  case-insensitive); but a store named `self` is reachable only by UUID — add a test asserting the
  reserved word wins.

---

## 4. Consumer integration — `doc_*` tools

**Principle:** keep the existing `mount_point` + `path` (+ `scope`) parameters working, and add a
single optional `uri` parameter to every doc tool. When `uri` is present it is parsed and **wins**;
the parsed parts populate the resolver input. When absent, behavior is exactly as today.

Do **not** hand-write per-tool parsing. Centralize in the two context builders.

### 4.1 The chokepoint change (`lib/tools/handlers/doc-edit/shared.ts`)

`buildReadResolutionContext` and `buildWriteResolutionContext` currently take
`input: { scope?: string; mount_point?: string }`. Extend the input shape to
`{ scope?: string; mount_point?: string; path?: string; uri?: string }` and, at the top of each,
add:

```ts
if (input.uri) {
  const parts = parseQtapUri(input.uri);           // throws → surfaces as a tool error
  input = { ...input, scope: parts.scope, mount_point: parts.mountPoint, path: parts.path };
  // heading/level (parts.heading, parts.level) are forwarded by the heading tools — see §4.3
}
```

Because every read/write doc tool already funnels through these builders, this single change makes
**all** of them accept `uri`. Confirm by grepping for `buildReadResolutionContext` /
`buildWriteResolutionContext` call sites and making sure each forwards `path` from the parsed URI
(some tools currently read `input.path` directly after calling the builder — they must read the
*post-parse* path; see §4.4).

### 4.2 Tools that bypass the builders (`doc_list_files`, `doc_grep`, the blob family, `doc_copy_file`)

These don't go through `resolveDocEditPath`; they call `resolveMountPointRef` /
`getAccessibleMountPoints` directly (`lib/doc-edit/path-resolver.ts:80-89, 754-791`). For each, add a
`uri` parameter and, in the handler, parse it up front into `{ mount_point, path/folder }` before the
existing logic:

- **`doc_list_files`** — `uri` may address a store root (`qtap://self/`) or a folder
  (`qtap://self/Knowledge`). Parse → set `mount_point` and `folder`. The `group` scope stays a
  separate `scope` param (no URI authority for it).
- **`doc_grep`** — `uri` optionally narrows to a store and/or path. Parse → `mount_point` + `path`.
- **`doc_read_blob` / `doc_write_blob` / `doc_list_blobs` / `doc_delete_blob`** — `uri` → `mount_point`
  + `path` (or `folder` for list). These have no `scope`; reject a parsed `scope !== 'document_store'`
  with a clear error ("blobs live only in document stores").
- **`doc_copy_file`** — has **two** references. Add `source_uri` and `dest_uri`; when present they
  populate `source_mount_point`/`source_path` and `dest_mount_point`/`dest_path` respectively. Reject
  non-`document_store` scopes (copy is cross-store only).

### 4.3 Heading-aware tools (`doc_read_heading`, `doc_update_heading`)

Let the URI fragment carry the heading: `qtap://self/Backstory.md#Childhood:2`. When `uri` includes
a `heading`, use it as the `heading` arg (and `level` if present), but an explicit `heading`/`level`
parameter on the call still overrides the fragment. Document this precedence.

### 4.4 Tool schema changes (follow the repo's single-source-of-truth rule)

Per `CLAUDE.md`: the Zod schema is the source of truth; `parameters` is derived via
`zodToOpenAISchema`, and `validateXxxInput` delegates to `safeParse`. So for each tool file in
`lib/tools/doc-*.ts`:

1. Add `uri: z.string().describe('A qtap:// URI addressing the target, e.g.
   "qtap://self/Notes/today.md". When provided, it supersedes scope/mount_point/path.').optional()`
   to the input schema (and `source_uri`/`dest_uri` for copy).
2. Make `path` (and `mount_point`) **optional** where they are currently required, since a `uri`
   can supply them. Add a Zod `.refine(...)` asserting "either `uri` OR `path` is present" so a call
   with neither still fails cleanly. Put the human-readable reason in the refine message.
3. Update the `.describe()` on `scope`/`mount_point`/`path` to mention the URI alternative in one
   short clause.
4. Regenerate the snapshot: `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`
   (the snapshot lives at
   `lib/tools/__tests__/__snapshots__/tool-definitions-snapshot.test.ts.snap`). New tools/params
   must also be registered there per `CLAUDE.md`.

### 4.5 Tool *output* — emit URIs

Every doc tool that echoes a location in its result should add a `uri` field (keep the existing
`path`/`mount_point` fields for compatibility). Concretely:

- `doc_read_file`, `doc_write_file`, `doc_str_replace`, `doc_insert_text`, `doc_*_frontmatter`,
  `doc_*_heading`, `doc_create_folder`, `doc_delete_folder`, `doc_move_file`, `doc_move_folder`,
  `doc_delete_file`, `doc_open_document`: add `uri` (built from the `ResolvedPath` via
  `formatDocStoreUri`/`formatScopedUri`/`formatSelfUri`).
- `doc_list_files` / `doc_grep` results: add a `uri` per row.
- blob tools: add a `uri` per blob.
- `self_inventory`'s `SelfInventoryContextFile.howToReach` (`lib/tools/self-inventory-tool.ts`):
  change/augment the copy-pasteable hint to a `qtap://` URI **and** keep a `doc_read_file(...)`
  example. `SelfInventoryVaultFile` rows gain a `uri` field. (The vault files are always the
  character's own vault → use `formatSelfUri`.)
- `search` (`search-scriptorium-handler.ts:350-356`): add `uri` to the document/knowledge result
  metadata alongside `mountPointName`/`filePath`.

> Building a URI from a `ResolvedPath`: it carries `scope`, `mountPointId`, `mountPointName`,
> `relativePath`. For `document_store`, prefer `formatSelfUri` when the store is the acting
> character's own vault (compare `mountPointId` to `resolveSelfVaultMountPointId(characterId)`),
> else `formatDocStoreUri`. For `project`/`general`, use `formatScopedUri`.

---

## 5. Consumer/producer integration — the CLI (`packages/quilltap/`)

The CLI is a **separate published package** (`packages/quilltap`). Per `CLAUDE.md`, bump its version
but do **not** ask for a manual `npm publish` (it publishes automatically at release). It has its own
hand-rolled parser and its own client-side mount resolution, so it needs its **own** small copy of
the codec (the server module isn't importable here).

### 5.1 Add a CLI-local URI codec

Create `packages/quilltap/lib/qtap-uri.js` — a dependency-free JS port of `parseQtapUri` /
`formatQtapUri` / `isQtapUri` (same grammar, same tests). Keep it deliberately small; it must not
import server code. Add a focused test file mirroring §3.4.

### 5.2 Accept URIs anywhere a `<mount> <path>` pair is taken

In `docs-commands.js`, every subcommand that currently takes positional `<mount> <relativePath>`
(`read`, `write`, `delete`, `mkdir`, `ls`, `tree`, `files`, `move`, `copy`, `link`, `rmdir`, `mvdir`,
`grep --mount`, `find --mount`) must also accept a single `qtap://…` positional in place of the pair.

Implement one helper used by every subcommand:

```js
// Returns { mountSpec, relPath } from either a single qtap:// arg or a (mount, path) pair.
function resolveDocTarget(positionalArgs) {
  if (positionalArgs.length >= 1 && isQtapUri(positionalArgs[0])) {
    const p = parseQtapUri(positionalArgs[0]);
    if (p.scope !== 'document_store')
      die('The CLI addresses document stores only; project/general scopes are not CLI-addressable.');
    // 'self' has no meaning without a character context in the CLI — reject with guidance.
    if (p.mountPoint === 'self')
      die('"self" requires a character context and is not resolvable from the CLI; pass a store name or UUID.');
    return { mountSpec: p.mountPoint, relPath: p.path };
  }
  return { mountSpec: positionalArgs[0], relPath: positionalArgs[1] };
}
```

Then `requireMount(db, mountSpec)` (`docs-commands.js:240-265`) works unchanged — it already takes a
name or UUID. For two-target commands (`move`, `copy`, `link`, `mvdir`) accept **two** `qtap://`
args (or the legacy four positionals).

> **`self` in the CLI:** there is no acting character, so `qtap://self/…` cannot resolve. Reject it
> with the message above rather than guessing. (This is the one place the reserved-word set is
> narrower than in-app.)

### 5.3 Emit URIs in CLI output

Add a `--uri` output flag (and/or include a `uri` column/field in `--json`) to `find`, `grep`, `ls`,
`tree`, `files`. Reuse the existing `mount:path` rendering as the *fallback* plain form, but make
`qtap://<name-or-uuid>/<path>` the canonical machine-readable form. For `--json`, add a `uri`
property to each row built with the CLI-local `formatQtapUri` (prefer name; fall back to UUID when
`requireMount` reported the name as ambiguous — reuse that ambiguity signal).

### 5.4 CLI docs

Update `docs/developer/CLI.md`: a new "Addressing documents with `qtap://` URIs" section, plus a note
on each affected subcommand that it accepts a URI in place of `<mount> <path>`. Note the `self`
limitation.

---

## 6. Producer integration — whispers & announcements

Switch every human-/model-facing document reference to emit a `qtap://` URI. Keep the surrounding
persona voice (steampunk/Wodehouse) intact — only the *reference token* changes. For each, the URI is
built with the §3.2 helpers.

| Producer | File · lines | Today | Change |
|---|---|---|---|
| **Prospero** store announcements | `lib/services/prospero-notifications/writer.ts:219-246,367-390,438-441` | `` use `mount_point: "X"` (ID `…` also works) `` | Emit `` reachable at `qtap://X/` (or `qtap://<uuid>/` if the name is ambiguous) `` — still mention the tool, but lead with the URI. |
| **Librarian** open/rename/delete/folder/attach | `lib/services/librarian-notifications/writer.ts:156-161,178-187,300-324,382-407` | `path: "…", scope: "…", mount_point: "…"` | Replace the `pathDetails` triple with a single `qtap://…` URI built from the same scope/mount/path it already has. Keep one line; drop the three-part form. |
| **Suparṇā** mail whispers | `lib/services/suparna-notifications/writer.ts:71` | `(id: <path>)` | `(qtap://self/<path>)` — mail always lives in the recipient's own vault, so `formatSelfUri`. |
| **Post office** letter actions | `lib/post-office/instructions.ts:20-22` | `doc_read_file({ scope:"document_store", mount_point:"self", path:"…" })` | Lead with the URI: `` Read it again: `doc_read_file({ uri: "qtap://self/<path>" })` ``. Keep `send_mail` `in_reply_to` as-is (it's a letter id, not a doc ref). |
| **Knowledge injector** | `lib/chat/context/knowledge-injector.ts:367,375,382,390` | `doc_read_file(scope=…, mount_point=…, path=…)` | `Read with: doc_read_file(uri="qtap://<name-or-uuid>/<path>")`. (Model-only context — safe to switch fully.) |
| **send_mail** confirmation | `lib/tools/handlers/send-mail-handler.ts:88` | `…rest in their postbox as <path>.` | `…rest in their postbox at <uri>.` where `<uri>` is the **recipient's** store via `formatDocStoreUri` (recipient vault name, UUID fallback). **Not** `qtap://self/…` — see §9.1. |
| **list_email** headings/actions | `lib/tools/handlers/list-email-handler.ts:69-72` + `instructions.ts:34` | `id: <path>` + per-letter actions | Same as post office: URIs in the action lines; the letter heading can show `qtap://self/<path>`. |
| **search** result metadata | `lib/tools/handlers/search-scriptorium-handler.ts:350-356` | name/path fields | Add `uri` (see §4.5). |

**Test obligation:** several of these have existing snapshot/writer tests
(`lib/services/prospero-notifications/__tests__/`, `suparna-notifications/__tests__/writer.test.ts`,
`tools/handlers/__tests__/list-email-handler.test.ts`, `send-mail-handler.test.ts`,
`search-scriptorium-handler.test.ts`, `mailbox-action.test.ts`). Update expectations to the URI form
and run them.

---

## 7. Schema / export / persistence

- **Export schema** `public/schemas/qtap-export.schema.json`: the stored `ChatDocument` triple
  (`scope`/`mount_point`/`path`, around line 760) **stays as-is** — we are not changing the storage
  model, only adding a serialization. Do **not** migrate stored data to URIs. (Per `CLAUDE.md`, a
  storage change would force `.qtap`/SillyTavern/backup/migration updates; we are deliberately
  avoiding that.) If you add a `uri` to any *exported* surface, it must be derived/optional, never
  the source of truth. Update `DDL.md` only if you actually change a column (you should not).
- **No new DB columns** are required. The codec is pure; resolution reuses existing tables.
- **No migration** is required (and therefore no `prettify.ts` label). If a later pass persists URIs,
  that's a separate spec with its own migration obligations.

---

## 8. Help docs (required by `CLAUDE.md`)

All user-visible changes must be documented in `help/*.md` with the `url` frontmatter +
"In-Chat Navigation" section.

- Update `help/document-editing-tools.md`: a "`qtap://` URIs" section explaining the form, the three
  reserved authorities, name-vs-UUID, and that any `doc_*` tool accepts a `uri`. Show the worked
  examples from §2.3.
- Update `help/post-office.md` if its examples show the old `mount_point:"self"` form.
- Keep the voice steampunk/Wodehouse per the standing rule (help is user-facing).
- Update `docs/CHANGELOG.md` (plain voice) and the docs listed in
  `.claude/commands/update-documentation.md`.

---

## 9. Resolved decisions (previously open — now locked)

1. **`send_mail` confirmation.** The confirmation in `send-mail-handler.ts:88` describes the
   *recipient's* mailbox, not the sender's, so `qtap://self/…` would be wrong from the sender's
   vantage. **Decision: emit the recipient store's name/ID URI** via `formatDocStoreUri` (the
   recipient's vault name, UUID fallback if ambiguous). Do **not** use `formatSelfUri` here.
2. **Clickable `qtap://` links in the Salon UI — IN SCOPE this pass, for definite existing
   documents only.** See §9a for the full sub-spec. (Longer term, the human wants *all* `qtap://`
   URIs clickable; this pass linkifies only those that resolve to a confirmed existing document, and
   leaves the rest as plain text.)
3. **`group` authority.** *Not* added — group is a list filter, not a backing location.
   `qtap://group/…` as sugar for "search my group stores" would be a separate, larger resolver
   change, out of scope here.

---

## 9a. Clickable `qtap://` links in the Salon (definite existing documents)

`qtap://` URIs appear first inside `systemSender` whispers/announcements (§6), which render through
the **same** markdown pipeline as ordinary messages. So one renderer change covers system and normal
messages alike.

### 9a.1 Where to render

The link renderer is the `a()` component in **`components/chat/MessageContent.tsx`** (verified at
lines 362-380). It already discriminates internal app routes (`isInternalHref`, → Next.js `<Link>`)
from external links (→ `<a target="_blank">`). Add a **third branch above the internal check**: when
`href` starts with `qtap://`, render a Quilltap-document link instead.

```tsx
a({ href, children }) {
  if (href && isQtapUri(href)) {
    return <QtapDocLink href={href}>{children}</QtapDocLink>;
  }
  if (isInternalHref(href)) { /* …existing… */ }
  /* …existing external… */
}
```

> Reuse the **server** codec's `isQtapUri`/`parseQtapUri` — they're pure and safe to import into a
> client component (no DB, no Node-only deps). Keep them dependency-free so the bundle stays clean.

### 9a.2 The `QtapDocLink` component (new)

Create `components/chat/QtapDocLink.tsx`. Behavior:

1. Parse the `href` with `parseQtapUri`. On parse error, render the children as plain text (no link).
2. **Existence gate (definite-document rule).** Confirm the target exists before presenting it as an
   active link. Two acceptable strategies — pick the cheaper that fits:
   - *Preferred:* a lightweight existence check via the chat-scoped read path. There's already a
     `read-document` action (`POST /api/v1/chats/{chatId}?action=read-document`,
     `documentModeApi.readDocumentForChat`) and the server's `resolvedPathExists()` helper in
     `app/api/v1/chats/[id]/actions/documents.ts` (verified) which handles both database-backed and
     filesystem scopes. Add a tiny `?action=resolve-document` (or `head-document`) that runs
     `resolveDocEditPath` + `resolvedPathExists` and returns `{ exists: boolean }` **without**
     reading bytes. Use it to gate the link.
   - *Alternative:* the mount-points file index `GET /api/v1/mount-points/{id}/files` (an indexed
     listing) — but that needs a mount-point **id**, so you'd resolve name→id first; the chat-scoped
     action above avoids that and respects the same access rules as the tools. Prefer it.
3. While the check is pending, render the children as **plain styled text** (not yet a link) so the
   message never flashes a broken link. When it resolves `exists: true`, upgrade to an active link
   (class `qt-link`, plus a small document affordance/icon to distinguish it from web links). When
   `exists: false` (or the check errors), leave it as plain text.
   - Debounce/limit: a long announcement could contain several URIs. Batch or cache existence checks
     by `(scope, mountPoint, path)` for the lifetime of the message list; don't fire one request per
     render.
4. **On click**: `e.preventDefault()`, then open the document via the existing Document-Mode hook —
   `openDocumentForChat(chatId, { filePath, scope, mountPoint, mode: 'split' })` (verified signature
   in `app/salon/[id]/hooks/documentModeApi.ts:112-135`). Map parsed parts:
   - `scope` ← `parts.scope`
   - `mountPoint` ← `parts.mountPoint` (omit for project/general; `'self'` passes straight through —
     the server resolver handles it given the chat's character context)
   - `filePath` ← `parts.path`
   - If `parts.heading` is present, after opening call the existing `doc_focus`-style anchor
     behavior to scroll to it (optional polish; the open itself is the must-have).

### 9a.3 Wiring the click handler down the tree

`MessageContent` is a pure renderer and has no chat context. Thread an `onOpenQtapDoc(parts)`
callback (or the `chatId` + the Document-Mode `openDocument` fn) down the existing prop chain that
already carries message-render props: `page.tsx` → `VirtualizedMessageList` →
`MessageRow` → `LazyMessageContent` → `MessageContent`. The Salon page already owns the
Document-Mode hook (`useDocumentMode`, used at `page.tsx:1147-1149`), so the callback is a thin
wrapper around its `openDocument`. Prefer a React context (`QtapDocOpenContext`) over deep
prop-drilling if the chain is awkward — one provider at the Salon page, consumed by `QtapDocLink`.

### 9a.4 Guardrails

- **Only `qtap://`.** The renderer must never treat a `qtap://` URI as a web URL or pass it to
  `window.open`. It is an in-app action exclusively.
- **Access is server-enforced.** The existence check and the open both run through chat-scoped
  actions that reuse `resolveDocEditPath`'s access control — a URI the current chat can't reach
  resolves to `exists: false` and stays plain text. The client never bypasses that.
- **No new history/navigation.** Opening a document is Document-Mode (split view), not a route
  change; don't use `help_navigate` or the router for `qtap://`.

### 9a.5 Tests

- Unit: `QtapDocLink` renders plain text on parse failure, plain text while pending, an active link
  on `exists:true`, plain text on `exists:false`.
- The `a()` branch: a `qtap://` href routes to `QtapDocLink`; `/settings` still → `<Link>`;
  `https://…` still → `<a target="_blank">`.
- Integration (Playwright, if feasible): a Librarian announcement containing a `qtap://self/…` URI
  for an existing doc shows a clickable link that opens Document-Mode; a URI for a missing doc shows
  plain text.
- New API action `resolve-document`/`head-document`: returns `{exists:true}` for a real file,
  `{exists:false}` for a missing one and for an inaccessible store, never reads bytes.

---

## 10. Implementation order (suggested for Claude Code)

1. **Codec + tests** (`lib/doc-edit/qtap-uri.ts`, export from `index.ts`, unit tests from §3.4/§2.3).
   Land this alone, green, first.
2. **Repository ambiguity helper** (`countByName`/`findByName` on doc-mount-points repo) + test.
3. **Tool inputs**: add `uri` to the two context builders + the bypass tools (§4.1–4.4), make
   `path`/`mount_point` optional with a `.refine`, regenerate the tool-definition snapshot.
4. **Tool outputs**: add `uri` to results + self-inventory + search metadata (§4.5).
5. **Whispers/announcements** (§6) + update their tests.
6. **CLI**: local codec, `resolveDocTarget`, `--uri` output, CLI docs; bump `packages/quilltap`
   version (no manual publish).
7. **Clickable Salon links** (§9a): the `resolve-document`/`head-document` API action, the
   `QtapDocLink` component, the `a()` branch, and the callback/context wiring. Land after the
   whispers (step 5) so there are real `qtap://` URIs in messages to click.
8. **Help docs + CHANGELOG** (§8).
9. **Full verification**: `npx tsc`, the affected Jest suites, and `npx jest -u` on the snapshot.
   Manually exercise: `doc_read_file({ uri: "qtap://self/…" })`, a named-store URI, a project URI,
   an ambiguous-name → UUID fallback, a CLI `quilltap docs read qtap://<name>/<path>`, and clicking
   a `qtap://` link in a Librarian announcement (existing doc → opens; missing doc → plain text).

---

## 11. Acceptance criteria

- [ ] Every example in §2.3 round-trips through `parseQtapUri`/`formatQtapUri`.
- [ ] Every read/write `doc_*` tool accepts a `uri` and resolves it identically to the equivalent
      `scope`/`mount_point`/`path` triple; the bypass tools (`list_files`, `grep`, blobs, `copy`) do
      too.
- [ ] Every doc tool result, self-inventory file row, and search document result carries a `uri`.
- [ ] Prospero, Librarian, Suparṇā, post office, knowledge injector, list_email, and send_mail emit
      `qtap://` URIs (name form when unambiguous, UUID otherwise; `self` for own-vault mail).
- [ ] The CLI accepts `qtap://` in place of `<mount> <path>` on all doc subcommands and can emit
      URIs via `--uri`/`--json`; rejects `qtap://self/…`, `qtap://project/…`, `qtap://general/…` with
      clear guidance.
- [ ] Reserved words win; a store literally named `self`/`project`/`general` is reachable by UUID.
- [ ] In the Salon, a `qtap://` URI pointing to a **confirmed existing, accessible** document renders
      as a clickable link that opens Document-Mode; a URI for a missing/inaccessible document (or one
      that fails to parse) renders as plain text. The renderer never treats `qtap://` as a web URL.
- [ ] `send_mail`'s confirmation emits the **recipient's** store URI, not `qtap://self/…`.
- [ ] No DB migration, no storage-model change, no `.qtap`/backup schema change.
- [ ] `npx tsc` clean; affected Jest suites + regenerated snapshot green; help + CHANGELOG updated;
      `packages/quilltap` version bumped.
