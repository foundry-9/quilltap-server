# Feature: `quilltap sync` — mirror a database-backed document store to a directory

**Status:** plan, approved 2026-09-21, not started. Written against 4.10-dev.
The operator settled every open question the same day; the answers are
recorded in [Decisions taken](#decisions-taken-2026-09-21) at the end and are
folded into the text. Two defects found while planning are filed as
[bug 155](../bugs/bug-155-byte-write-blanks-caption.md) and
[bug 156](../bugs/bug-156-overwrite-leaves-stale-chunks.md); phase 1 fixes
them, because the sync's store-side applier depends on both.

A new top-level CLI verb, `quilltap sync <store> <path>`, keeps a
**database-backed** document store (`doc_mount_points.mountType = 'database'`)
and a directory on disk in step with each other. It compares the two sides by
SHA-256 and by modification time, copies whichever side changed to the other,
sets created and modified times on both sides to match so the next run has
nothing to do, and prints one line to stdout for every file or folder it
creates, deletes, or modifies — content or metadata. It creates the directory
if it is missing; it never creates a document store. It carries a binary's
descriptive text in a Markdown sidecar beside the binary. It does not export,
import, or edit chunks or embedding vectors.

## What exists today, and what does not

The exploration that grounds this plan (paths are the current tree):

- **The mount index already keeps everything the sync needs, per location.**
  `doc_mount_file_links` holds `relativePath`, `lastModified`, `createdAt`,
  `description`, `descriptionUpdatedAt`; `doc_mount_files.sha256` is a hard
  invariant on the bytes (`DDL.md`, "doc_mount_files"). Text bytes live in
  `doc_mount_documents.content`, binaries in `doc_mount_blobs.data`. Empty
  folders are real rows in `doc_mount_folders`.
- **Change detection is already sha-based.** The filesystem scanner decides
  "unchanged" purely by sha (`lib/mount-index/scanner.ts:169-177`), and every
  file op verifies sha end to end. A sha-driven sync is with the grain.
- **Timestamps do not round-trip today.** For database stores `lastModified`
  is always the write instant; `linkDocumentContent` / `linkBlobContent`
  (`lib/database/repositories/doc-mount-file-links.repository.ts:1004`,
  `:804`) take no timestamp and stamp `now` on every column. Nothing in the
  tree calls `fs.utimes`. No HTTP write surface accepts a timestamp —
  `expected_mtime` on `PUT …/files/<path>` is a concurrency guard, not a
  value to store. `createdAt` is only ever the row-mint instant.
- **The two existing "store to directory" paths are not sync primitives.**
  `docs export` (`packages/quilltap/lib/docs-commands.js:1497`) is a
  server-free one-way dump: no mtimes, no empty folders, no descriptions.
  `deconvert` (`lib/mount-index/conversion.ts:242`) demands an *empty* target,
  purges the byte stores, stamps every link `lastModified = now`, and drops
  descriptions and empty folders on the floor.
- **`description` has no disk representation anywhere.** It is written by
  the blob upload route, the two `PATCH` routes, the image auto-captioner
  (`lib/photos/auto-describe-attachment.ts:123-155`, which writes the same
  text to `extractedText`), and `keep_image`. The old `.meta.json` sidecars
  of the main file store were removed; nothing like them exists for the
  mount index.
- **`linkBlobContent` blanks `description` and `extractedText` on any upsert
  that omits them** (`:921-922`, `:936`, `:943`). `file-ops.writeDestBytes`
  (`lib/mount-index/file-ops.ts:736`) omits them, so re-writing an image's
  bytes through `docs write --force` already loses its caption. A sync that
  re-pushes image bytes must thread the existing values back through.
- **Bitmap uploads are transcoded to WebP and renamed** by `storeMountFile`
  (`lib/mount-index/store-file.ts:250-259`); the `write-file` action and
  `file-ops` are byte-preserving. A sync must be byte-preserving or the two
  sides never converge.
- **Chunks are per link and are rebuilt by the parent process after a
  write** (`writeDatabaseDocument`, `lib/mount-index/database-store.ts:170-195`
  → `reindexSingleFile` + `reindexLinkGroupSiblings`). Nothing reconciles
  chunks against content sha at startup: `rescanDatabaseMountPoint` only
  re-chunks links with `chunkCount === 0 || conversionStatus !== 'converted'`
  (`database-store.ts:670-672`), whatever its docstring says. A write made
  directly to SQLite while the server is down would serve stale chunks
  forever unless it also zeroed `chunkCount`.
- **The CLI's own write verbs already require the server for database
  stores** (`requireServerForDb`, `docs-commands.js:1678`), and `deconvert`
  already takes a server-local `targetPath`. A server-side engine reached
  over HTTP is the established shape, not a new one.

## Vocabulary

- **Store** — the database-backed `doc_mount_points` row being synced. Never
  a filesystem or Obsidian store; those already *are* a directory.
- **Target** — the directory on disk. Created if absent. May be non-empty.
- **Entry** — one `(relativePath)` present on either side: a file, a folder,
  or a sidecar.
- **Side** — `store` or `disk`.
- **Manifest** — `<target>/.quilltap-sync.json`, the record of what the last
  run left on both sides. It is what turns "absent on one side" into "new
  here" versus "deleted there", and what makes conflicts detectable.
- **Sidecar** — `<file>.description.md`, the on-disk home of a binary's
  `description`.
- **Action** — one unit of work the planner emits: `create`, `modify`,
  `delete`, `touch` (timestamps only), `describe` (description only),
  `mkdir`, `rmdir`, or `conflict` (nothing done; reported).

## Decisions of record

| Question | Decision |
|---|---|
| Where does the engine run? | **In the server**, as `POST /api/v1/mount-points/[id]?action=sync`, implemented in `lib/mount-index/sync/`. The CLI verb is a thin client that prints the report. Rationale: the write chokepoints, folder-row helper, link-group fan-out and post-write re-chunk hooks are TypeScript in `lib/`; the CLI is plain JS and cannot import them, so a direct-SQLite engine would be a second copy of every one of them, and a lock-gated one could not re-chunk. `deconvert`'s server-local `targetPath` is the precedent. |
| Which stores? | `mountType = 'database'` only. A filesystem/Obsidian store is refused with a pointer at its own `basePath`. `storeType = 'character'` vaults are allowed with guards (below); an **archived** character's vault is refused outright (tombstone rule). |
| Comparison currency | SHA-256 of the bytes first; timestamps second. Equal sha + unequal mtime is a `touch`, never a copy. |
| Which side wins a content difference? | The side whose `lastModified` is **newer**, unless the manifest shows both sides changed since the last run — that is a `conflict`, reported and skipped. `--prefer store\|disk` overrides both rules. |
| Deletions | Propagated **only when the manifest proves the other side deleted** (the entry was present at the last run, is now absent on one side, and unchanged on the other). With no manifest — the first run — an entry missing on one side is created there, never deleted. `--no-delete` suppresses propagation. |
| Timestamps | After every content action both sides carry the winner's `lastModified` (disk mtime ↔ link `lastModified`) and the older of the two `createdAt`s (disk birthtime ↔ link `createdAt`). See [Timestamps](#timestamps). |
| Descriptions | One Markdown sidecar per **binary** (`fileType` ∈ `blob`, `pdf`, `docx`) that has a non-empty `description`. Text documents' descriptions are not synced (reported once as `skip` if non-empty). |
| Transcoding | **None.** Bytes are stored verbatim in both directions. A `.png` pushed from disk is a `.png` in the store, not a `.webp`, unlike a Scriptorium upload. |
| Chunks and vectors | Never read, written, exported, or imported by the sync. The store's **existing** post-write hooks (`reindexSingleFile`, `reindexLinkGroupSiblings`, the debounced embedding scheduler) run exactly as they do for any other write, because the sync calls the same chokepoints. |
| Folders | Every `doc_mount_folders` row is a directory and vice versa, empty or not. Folder deletion propagates under the same manifest rule as files and only when the folder is empty on the receiving side. |
| Case | Paths compare case-insensitively, matching the store's NOCASE index. A pure-case rename follows the content winner. Two disk entries differing only by case (possible on Linux) are a `conflict`. |
| Patterns | The store's `excludePatterns` are honoured on the disk walk (they are the store's own). `includePatterns` are ignored — database stores accept any file type. The manifest and sidecars are always excluded. |
| Dotfiles | **Ignored on both sides, as if they did not exist.** A disk entry whose name — or any path segment — begins with `.` is never read, never pushed, never deleted; a store entry whose path has a dot-segment is never written to disk and never deleted from the store. The manifest is the one dotfile the verb owns. This rule is documented in the help and in the document-store help pages, not only here. |
| Concurrency | The action refuses while the store's `conversionStatus !== 'idle'` or `scanStatus === 'scanning'`, and holds a per-store in-process mutex for its duration. Each store write is compare-and-swap against the sha the planner saw; a mid-run change is reported as `conflict`, not overwritten. |
| Docker | `<path>` is server-local. Under Docker it must be inside a bind; `docs docker-mounts` is the model, and the CLI says so when the server reports `ENOENT` on an absolute path that exists on the host. |

## CLI surface

```
quilltap sync <store|qtap://store/> <path> [flags]

  --dry-run           plan and print; change nothing on either side
  --direction both|to-disk|to-store    (default both)
  --prefer newer|store|disk            (default newer)
  --no-delete         never propagate a deletion
  --no-manifest       do not read or write .quilltap-sync.json (first-run rules every time)
  --json              machine-readable plan + results on stdout
  -p, --port N        server port (default 3000)
  -i, -d, --passphrase   the usual instance plumbing (used only to resolve <store> by name)
```

- `<store>` resolves name-first, UUID fallback, exactly as `docs` verbs do
  (`requireMount`); a `qtap://` URI is accepted and must have an empty path.
- `<path>` is expanded (`~`), made absolute, and passed to the server
  verbatim. It is created with `mkdir -p` when absent. If it exists and is
  not a directory the verb refuses.
- The store lookup is the only thing the CLI opens the database for, and it
  opens it read-only. If the server is unreachable the verb refuses with the
  same guidance `docs write` gives for database stores; there is no offline
  mode (see open question 1).
- `sync` is a new entry in `SUBCOMMANDS` (`packages/quilltap/bin/quilltap.js:1176`),
  which means `printHelp()`, all three completion templates (own arm each,
  every long flag above listed), and the coverage test must learn it in the
  same change. `<store>` completes from the addressed instance like the
  `docs` positionals.
- A new `packages/quilltap/lib/sync-command.js` holds the verb;
  `sync-report.js` holds the pure formatter (unit-tested, like
  `docker-mounts.js`).

### Output

One line per action on stdout, in plan order (folders before files, parents
before children; deletions last, children before parents). Advisory text
goes to stderr so stdout stays greppable. Colour follows the `docs`
convention (`GREEN`/`YELLOW`/`DIM`, off when not a TTY).

```
mkdir    disk   lore/maps/
create   disk   lore/maps/harbour.png              (sha 3f9a…, 412 KB)
describe disk   lore/maps/harbour.png.description.md
modify   store  chapters/03.md                      (disk newer by 2h 14m)
touch    disk   chapters/01.md                      (mtime 2026-09-19T14:02:11.000Z)
delete   store  drafts/old.md                       (deleted on disk since last sync)
rmdir    disk   drafts/
conflict —      notes/ideas.md                      (both sides changed; --prefer to resolve)
skip     —      README.md                           (description on a text document is not synced)

3 created, 1 modified, 1 deleted, 1 touched, 1 conflict — 0.8 s
```

The first column is the action, the second the side that changes. `--json`
emits `{ store, targetPath, dryRun, actions: [...], summary, warnings }`.

Exit codes: `0` clean, `1` error (bad store, unreachable server, I/O
failure), `2` at least one `conflict` left unresolved. `--dry-run` uses the
same codes so scripts can gate on a clean plan.

## The engine — `lib/mount-index/sync/`

```
lib/mount-index/sync/
  index.ts          syncMountPoint(opts) — entry point used by the route
  walk-store.ts     one read of the store: links + files + folders → StoreEntry[]
  walk-disk.ts      one read of the target: files, dirs, sidecars → DiskEntry[]
  manifest.ts       read / validate (Zod) / write .quilltap-sync.json
  planner.ts        PURE: (store, disk, manifest, opts) → Action[]   ← the unit-test surface
  apply-store.ts    executes store-side actions through the repository chokepoints
  apply-disk.ts     executes disk-side actions (write, utimes, mkdir, rm)
  sidecar.ts        <file>.description.md naming, parse, render
  types.ts          StoreEntry / DiskEntry / Action / SyncReport (Zod)
```

### Walk

Both walks produce the same shape, keyed by lower-cased relative path:

```ts
interface Entry {
  relativePath: string;        // stored casing on the store side, on-disk casing on the disk side
  kind: 'file' | 'folder';
  sha256?: string;             // files only
  sizeBytes?: number;
  lastModified: string;        // ISO-8601 ms
  createdAt: string | null;    // ISO-8601 ms; null when the side cannot say
  description?: string;        // store: link.description; disk: sidecar body
  descriptionUpdatedAt?: string | null;
  // store-side extras the applier needs and the planner ignores:
  linkId?, fileId?, linkGroupId?, fileType?
}
```

- **Store walk** is one SQL join (links → files, plus folders), the query
  `docs export` already runs with the metadata columns added. Text
  documents' sha is `doc_mount_files.sha256`, which equals `sha256OfString(content)`
  = the sha of the UTF-8 bytes on disk, so the two sides hash the same
  thing. Blobs likewise.
- **Disk walk** is a recursive `readdir` honouring the store's
  `excludePatterns` (through the scanner's `matchesPattern`), skipping
  every dot-entry (which covers the manifest and `.DS_Store`) and its
  subtree, and pulling out any path whose name ends in `.description.md` —
  those are collected separately as sidecars and attached to their partner
  entry. The **store walk applies the same dot rule**: a link or folder row
  with a dot-segment anywhere in its path is dropped before planning, so it
  is neither materialised nor deleted. A sidecar with no partner is a warning,
  not an entry. Text-native files are hashed as bytes; a text-native file
  that is not valid UTF-8 is an error entry (skipped, reported), because the
  store cannot hold it verbatim.
- Disk timestamps come from `fs.stat`: `mtime` → `lastModified`, `birthtime`
  → `createdAt` (null where the platform reports the epoch or equals `ctime`
  on filesystems that fake it).

### Manifest — `<target>/.quilltap-sync.json`

```json
{
  "version": 1,
  "storeId": "…uuid…",
  "storeName": "Lore",
  "lastSyncAt": "2026-09-21T10:15:30.120Z",
  "entries": {
    "chapters/01.md": { "kind": "file", "sha256": "…", "lastModified": "…", "createdAt": "…" },
    "lore/maps/harbour.png": { "kind": "file", "sha256": "…", "lastModified": "…", "createdAt": "…",
                               "descriptionSha256": "…", "descriptionUpdatedAt": "…" },
    "lore/maps/": { "kind": "folder", "createdAt": "…" }
  }
}
```

Keys are the store's stored casing. The manifest records the state **both
sides agreed on at the end of the last run**, so on the next run each side is
compared against it independently: `changedOnStore = store.sha !== base.sha`,
`changedOnDisk = disk.sha !== base.sha`, and absence on a side that was
present in the base is a deletion on that side. A manifest whose `storeId`
does not match the store is refused (the directory belongs to another
store); `--no-manifest` ignores it entirely. It is written atomically
(temp + rename) after apply, and never written under `--dry-run`. It is
excluded from the walk and never enters the store.

The manifest is also the authoritative carrier of `createdAt` on the disk
side, because birthtime is not settable on Linux and only indirectly on
macOS (below). When a disk entry's birthtime is unavailable the planner uses
the manifest's value.

### Planner (pure)

For each key in the union of store, disk, and manifest entries:

| Store | Disk | Base | Action |
|---|---|---|---|
| present | absent | absent | `create disk` |
| absent | present | absent | `create store` |
| present | absent | present, store unchanged | `delete store` (unless `--no-delete`) |
| present | absent | present, store changed | `conflict` (edited on store, deleted on disk) |
| absent | present | present, disk unchanged | `delete disk` |
| absent | present | present, disk changed | `conflict` |
| absent | absent | present | drop from manifest, no action |
| both, sha equal | | | `touch` whichever side's timestamps differ from the winner's; `describe` if descriptions differ |
| both, sha differ | | absent, or changed on one side only | `modify` the other side from the newer / preferred side |
| both, sha differ | | changed on both sides | `conflict` unless `--prefer` |

Folders follow the same table with `mkdir`/`rmdir`, and an `rmdir` is only
planned when the receiving side's directory is empty *after* this plan's
file deletions. `--direction to-disk` / `to-store` filters the plan to
actions on that side and turns the rest into `skip` lines.

Timestamp rule for `touch` and after every `create`/`modify`: the winner's
`lastModified` is applied to the other side; `createdAt` becomes the
**older** of the two sides' values (null loses), so a file's creation date
never moves later just because it was copied. Comparison tolerance is
1000 ms, which covers filesystems with one- or two-second resolution.

Link groups: two store paths sharing a `linkGroupId` are still two entries.
A `modify store` on one of them fans out to its siblings through
`fanOutGroupFileId` exactly as any write does; the planner marks the
siblings' disk copies stale for the *same* run (a second `modify disk`
action reading the new bytes), so the run converges without a second
invocation. If two members of one group changed differently on disk in one
run, both are `conflict`.

Character vaults (`storeType = 'character'`): the planner refuses a
`delete store` of a keystone (`properties.json`, the six required `.md`
files, `Wardrobe/instructions.md`) and reports it as `conflict` with the
reason; everything else syncs. An archived character's vault id (from
`character-vault.ts`'s archived set) is refused before planning.

### Apply — store side

All store writes go through the existing chokepoints; the sync never issues
SQL of its own.

- `create store` / `modify store` for text-native types →
  `linkDocumentContent` followed by the parent-process re-chunk block that
  `writeDatabaseDocument` runs (`reindexSingleFile`, `reindexLinkGroupSiblings`),
  then `emitDocumentWritten`. Factoring that block out of
  `writeDatabaseDocument` into a shared helper is part of the
  [bug 156](../bugs/bug-156-overwrite-leaves-stale-chunks.md) fix, which
  lands first; the sync calls the helper rather than copying the block.
- `create store` / `modify store` for binaries → `linkBlobContent` with the
  bytes verbatim, `storedMimeType = originalMimeType = mimeForExtension`,
  and **no** `description` / `extractedText` / `extractionStatus` in the
  input — which is safe only once
  [bug 155](../bugs/bug-155-byte-write-blanks-caption.md) has taught the
  update branch that an omitted field means "keep what is there". Until that
  fix lands the sync must not be merged. No `transcodeToWebP`. The reader
  side is indifferent: the blob route serves `storedMimeType` as-is, and the
  LLM transport budget (`shrinkImageForLlmTransport`) accepts any bitmap
  `sharp` can decode, so a `.png` in the store is served and shown like any
  other image.
- `describe store` → `docMountBlobs.updateDescription(fileId, text, linkId)`
  (three-arg form; the two-arg form picks an arbitrary link).
- `delete store` → `docMountFileLinks.deleteWithGC(linkId)`.
- `mkdir store` → `ensureFolderPath`; `rmdir store` → `deleteDatabaseFolder`
  (which refuses non-empty; the planner already guarantees empty).
- `touch store` → a new repository method `setLinkTimestamps(linkId, { lastModified, createdAt? })`.

Every content write is compare-and-swap: the applier re-reads the link's
current sha and aborts that action as `conflict` if it differs from what
the planner saw.

### Apply — disk side

- `create disk` / `modify disk` → write to `<name>.quilltap-tmp`, `fsync`,
  rename over the destination; then set timestamps.
- `describe disk` → write the sidecar; `delete disk` removes the sidecar
  with its partner.
- `delete disk` → `fs.rm`; `mkdir` / `rmdir` → `fs.mkdir` / `fs.rmdir`
  (non-recursive, so a non-empty directory fails loudly).
- Path safety: every disk path is resolved and must stay under the target
  (`fsAbsolute`-style check), and no entry may traverse a symlink out of it.

### Timestamps

- **Disk mtime** is set with `fs.utimes(path, atime = mtime = lastModified)`.
- **Disk birthtime** cannot be set by Node on any platform. On macOS (APFS
  and HFS+) the kernel lowers birthtime to match when `utimes` sets an
  mtime *earlier* than the current birthtime, so the applier uses a
  two-step: `utimes(createdAt, createdAt)` then `utimes(lastModified,
  lastModified)`. On Linux birthtime is immutable from user space and the
  step is skipped; on Windows Node has no `SetFileTime`, likewise skipped.
  In every case the manifest carries `createdAt`, and the planner reads it
  from there when the filesystem cannot answer, so the *comparison* is
  right even where the *display* in Finder or `stat` is not. The report says
  which it did (`touch disk … (birthtime not settable here; recorded in manifest)`) once per run.
- **Store side** is exact: `setLinkTimestamps` writes the ISO strings as
  given. `createdAt` on `doc_mount_files` (the content row) is left alone —
  it is the content's mint time and is shared across links; the per-location
  `doc_mount_file_links.createdAt` is the "created" this feature means.

### Sidecars — `<file>.description.md`

- Name: the binary's full name plus `.description.md`
  (`harbour.png` → `harbour.png.description.md`). Body: the description
  text verbatim, no frontmatter. The sidecar's mtime is set to
  `descriptionUpdatedAt`.
- Direction: a sidecar newer than the store's `descriptionUpdatedAt` (or
  present where the store has none) → `describe store`; the reverse →
  `describe disk`; an empty store description with no sidecar → nothing.
  A sidecar deleted on disk while the store's description is unchanged since
  the base → the description is cleared (reported as `describe store` with
  "(cleared)"). Both changed → `conflict`.
- `extractedText` is **not** touched by a sidecar change. When the
  auto-captioner ran, it wrote the caption to both columns; after a sidecar
  edit the two diverge and the chunks still index the old caption. That is
  the price of "nothing for chunks", accepted in decision 5 below; a
  `docs reindex --force` on the path refreshes the index when wanted.
- Reserved name: a store file whose own name ends in `.description.md` is
  reported as `conflict (reserved name)` and skipped in both directions.
  The disk walk never treats such a file as a document.

## The route — `POST /api/v1/mount-points/[id]?action=sync`

Added to the existing dispatch table (`app/api/v1/mount-points/[id]/route.ts:767`),
beside `convert` / `deconvert`. Body (Zod):

```ts
{
  targetPath: string,                 // absolute, server-local
  dryRun?: boolean,                   // default false
  direction?: 'both' | 'to-disk' | 'to-store',
  prefer?: 'newer' | 'store' | 'disk',
  propagateDeletes?: boolean,         // default true
  useManifest?: boolean,              // default true
}
```

Response: the `SyncReport` (actions with their outcome, summary, warnings).
The handler validates the store type and archive tombstone, checks the
concurrency gate, and calls `syncMountPoint`. Errors map through
`file-op-status.ts` like the other actions. Debug logs at every phase
(walk counts, plan counts, per-action results) via the built-in logger.

The route's input schema is the single source of truth for the CLI's flag
validation, as with the other actions — the CLI does not re-validate.

## Repository changes

In `doc-mount-file-links.repository.ts`:

- `LinkDocumentInput` and `LinkBlobInput` gain optional `lastModified?: string`
  and `createdAt?: string`. `lastModified` replaces `now` on both INSERT and
  UPDATE branches when supplied; `createdAt` is honoured on INSERT only. All
  existing callers are unaffected (they omit both).
- New `setLinkTimestamps(linkId, { lastModified?, createdAt? })`.
- No schema change. No migration. `DDL.md` gains a sentence under
  `doc_mount_file_links` noting that `lastModified`/`createdAt` may now be
  caller-supplied by the sync, and that `descriptionUpdatedAt` is the
  sidecar's clock.

Nothing about the `.qtap` export, backups, or `qtap-export.schema.json`
changes: no new columns, and the manifest and sidecars are disk-side
artefacts the store never contains.

## Documentation and housekeeping (same change)

- `docs/developer/CLI.md` — a "Sync CLI (`npx quilltap sync`)" section.
- `docs/developer/API.md` — the new action.
- `help/cli-sync.md` (new, `url: /scriptorium`, with the In-Chat Navigation
  section) in the house voice, plus a cross-reference from `help/cli-docs.md`.
- **The dotfile rule goes wherever document stores are explained**, not just
  in the sync page: a short paragraph in `help/scriptorium.md` and
  `help/mount-points.md` saying that files and folders whose names begin
  with a dot are invisible to the sync in both directions, with
  `.quilltap-sync.json` named as the one exception the verb keeps for itself.
  The sidecar convention (`<file>.description.md`) is documented in the same
  places, since a user browsing the synced directory will meet both.
- `docs/CHANGELOG.md` — plain voice.
- `packages/quilltap/README.md` — the verb in the command list.
- `packages/quilltap/package.json` — patch bump (auto-published at release;
  no manual `npm publish`).
- `.claude/commands/update-documentation.md` — add this file and the help doc.
- Move this document to `features/complete/` once the live walkthrough
  (below) has been run.

## Tests

- **Planner (Jest, pure):** table-driven cases for every row of the
  decision table, both directions, with and without a manifest; link-group
  fan-out marking; case-only rename; keystone refusal; reserved sidecar
  name; 1000 ms tolerance; `createdAt` = older-wins.
- **Sidecar module:** naming, partner attachment, orphan warning.
- **Manifest:** Zod round trip, `storeId` mismatch refusal, atomic write.
- **Engine (Jest, real SQLCipher via the absolute-path driver rule):**
  a temp database store and a temp directory; run twice and assert the
  second run is a no-op; edit each side and assert convergence; assert that
  `doc_mount_chunks` rows are only ever touched by the existing reindex
  hook (spy), never by the sync module; assert the caption survives a byte
  update.
- **Route:** schema rejection, wrong store type, archived vault, concurrency
  gate.
- **CLI:** `sync-report.js` formatting; completion coverage and behaviour
  tests pick up the new verb automatically and must pass.

## Live verification (V4test, never Friday)

1. `quilltap sync Lore ~/tmp/lore-sync --dry-run` on a store with text,
   images with captions, and an empty folder: the plan lists every entry as
   `create disk`, the empty folder as `mkdir`, each captioned image with a
   `describe disk`.
2. Run without `--dry-run`; confirm files, sidecars, and directories; `stat`
   shows mtimes equal to the store's `lastModified`; on macOS birthtime
   equals `createdAt`.
3. Run again: zero actions, exit 0.
4. Edit a Markdown file on disk, edit a different one in the Scriptorium,
   change a sidecar, delete a file on disk, add a new file in a new
   directory on disk. Run: one `modify store`, one `modify disk`, one
   `describe store`, one `delete store`, one `mkdir store` + `create store`.
   Confirm in the Scriptorium and with `docs ls`; confirm the edited store
   document's chunks were rebuilt by the existing hook (`docs status`).
5. Edit the same file on both sides; run: `conflict`, exit 2, nothing
   changed. Re-run with `--prefer disk`: resolved.
6. Push a `.png` from disk; confirm it is stored as `.png` with byte-equal
   sha, and that its later caption (set in the Scriptorium) survives a
   second byte edit from disk.
7. Point the verb at a filesystem store and at an archived character's
   vault: both refused with the expected messages.

## Phases

1. Fix [bug 155](../bugs/bug-155-byte-write-blanks-caption.md) and
   [bug 156](../bugs/bug-156-overwrite-leaves-stale-chunks.md) — the
   omitted-means-keep update branch, `chunkCount = 0` on repoint, the shared
   post-write re-chunk helper, the docstring. Then the repository additions
   (`lastModified`/`createdAt` inputs, `setLinkTimestamps`). Tests. This
   phase can ship on its own.
2. `lib/mount-index/sync/` walk, manifest, sidecar, planner. Planner tests.
3. Appliers + `syncMountPoint` + the route. Engine and route tests.
4. CLI verb, report formatter, completions, help, docs, changelog, bump.
5. Live walkthrough on V4test; move to `complete/`.

## Decisions taken (2026-09-21)

The questions the exploration raised, and the operator's answers. Each is
already reflected in the sections above; this list is the record.

1. **Server-side engine, reached over HTTP.** Accepted. The server must be
   running, as it already must for `docs write` on a database store. No
   offline direct-SQLite mode.
2. **Sync state in a dotfile.** Accepted: `.quilltap-sync.json` in the
   target directory, as described under [Manifest](#manifest--targetquilltap-syncjson).
   No database table.
3. **Sidecar naming.** Accepted as proposed: `<file>.description.md`,
   binaries only, body verbatim.
4. **No WebP transcoding.** Accepted, on the understanding that the rest of
   the system handles non-WebP bitmaps — it does: the blob route serves
   whatever `storedMimeType` says, and the LLM transport shrinker decodes
   anything `sharp` can.
5. **Caption edits leave `extractedText` and chunks alone.** Accepted; the
   default stands.
6. **Character vaults allowed**, with keystone-deletion refusal and
   archived-vault refusal.
7. **Dotfiles are invisible to the sync on both sides**, never copied and
   never deleted, with the manifest as the verb's one exception. To be
   documented in the help and in the document-store help pages, not only
   here.
8. **The two pre-existing defects are filed** as
   [bug 155](../bugs/bug-155-byte-write-blanks-caption.md) (a byte write
   over a described binary blanks the caption) and
   [bug 156](../bugs/bug-156-overwrite-leaves-stale-chunks.md) (an
   overwrite leaves stale chunks and the rescan docstring promises a check
   the code does not make). Both are fixed in phase 1, ahead of the sync.
