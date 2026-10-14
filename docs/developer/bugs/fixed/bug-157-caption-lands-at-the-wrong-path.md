# Bug 157 — a caption typed at one path lands at another

**FIXED in v4 (2026-09-21)** — `linkId` is now a **required** third argument
to `updateDescription` and `updateExtractedText`, and the `WHERE fileId = ?
LIMIT 1` fallback is gone. There is no such thing as "the" link for a blob:
content-addressing puts every byte-identical path on one content row, and both
of these columns are per-location. The three callers that used the two-argument
form all held the right link already — the PATCH route passes `meta.linkId`
from the view it had just resolved by path, the chat attach passes
`blob.linkId` (so its cache read and its cache write are finally the same row),
and the `.qtap` importer passes `created.linkId`. Required rather than
optional, so the next caller that has not resolved a location fails to compile
instead of failing quietly on the one store shape nobody tests against.
Regression tests in
`__tests__/unit/lib/database/repositories/doc-mount-write-metadata.integration.test.ts`.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-21, live on the `V4test` instance, in the store `Riya Character Vault (3)` (`2d9f88cd-4d71-43b3-a1a0-1da7cc290d13`) |
| **Fixed** | 2026-09-21, the day it was reported |
| **Severity** | **Medium** — a silent misdirected write. No bytes are lost and nothing errors; the caption simply appears at a location nobody asked about, and the location the operator was looking at stays blank |
| **Who it bites** | anyone describing an image that exists at two paths in one store — which, for a character vault, is **every avatar**, since each one lives at both `photos/` and `images/history/`. Reached from the Scriptorium's description field, and from the chat attach path's auto-captioner |
| **Provenance** | Original to v4, from the content/link split: `description` moved onto `doc_mount_file_links` (per location) while `updateDescription` kept taking a blob id (per content) |
| **Fix site** | `app/api/v1/mount-points/[id]/blobs/[...path]/route.ts:154` (the PATCH), `app/api/v1/chats/[id]/files/route.ts:238`, `lib/import/quilltap-import/import-document-stores.ts:341`, and the two-argument form itself in `lib/database/repositories/doc-mount-blobs.repository.ts:487-505` / `:542-560` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

`Riya Character Vault (3)` holds the same avatar at two paths, as every
character vault does:

```
photos/avatar_Riya_1789257668916.webp
images/history/avatar_Riya_1789257668916.webp
```

They are byte-identical, so the content-addressed store put both links on one
`doc_mount_files` row (`fileId c8ae9954-adb6-4e00-b5ad-e0d3b93b08ca`) and one
blob.

Describing the `photos/…` copy —

```
PATCH /api/v1/mount-points/2d9f88cd-…/blobs/photos/avatar_Riya_1789257668916.webp
{ "description": "…" }
```

— answers **200**, and the description lands on the `images/history/…` link
row. The `photos/…` link stays blank. Nothing in the response, the log, or the
UI says the write went anywhere but where it was aimed.

## Root cause

`description` is deliberately **per link**: it is a property of a
(mountPoint, path) location, not of the bytes. The repository method that
writes it, though, is keyed on the **blob**, which is per content — and a
content row can carry any number of links.

The route passes only the blob id
(`app/api/v1/mount-points/[id]/blobs/[...path]/route.ts:154`):

```ts
const meta = await repos.docMountBlobs.findByMountPointAndPath(id, relativePath);
if (!meta) return notFound('Blob');
…
const updated = await repos.docMountBlobs.updateDescription(meta.id, description);
```

and the two-argument form then invents a target
(`lib/database/repositories/doc-mount-blobs.repository.ts:499-505`):

```ts
let targetLinkId = linkId;
if (!targetLinkId) {
  const link = db.prepare(
    `SELECT id FROM doc_mount_file_links WHERE fileId = ? LIMIT 1`
  ).get(blob.fileId) as { id: string } | undefined;
  targetLinkId = link?.id;
}
```

`LIMIT 1` with no `ORDER BY` is whichever row SQLite reaches first. With one
link it is correct by luck; with two it is a coin toss the caller cannot see,
and the docstring's "used by routes that don't track linkId yet" describes a
fallback that has no correct answer to fall back *to*.

The route had already resolved the right one and thrown it away:
`findByMountPointAndPath` returns the joined view, `linkId` included.

`updateExtractedText` carries the identical fallback (`:551-557`) over the
same per-link columns.

Three callers used the two-argument form:

| Caller | What it wrote to the wrong place |
|---|---|
| `blobs/[...path]/route.ts:154` (PATCH) | the operator's typed caption |
| `chats/[id]/files/route.ts:238` | the vision model's generated caption, cached at attach time |
| `import-document-stores.ts:341` | a `.qtap` import's per-link `extractedText` sidecar |

The chat-attach one has a second face. `ensureImageDescription` *reads*
`blob.description` from the correct link and writes to an arbitrary one, so
for a shared blob the read can never see what the write left: every attach of
that image finds the field blank, runs the vision model again, and caches the
answer somewhere else. A silent, repeating LLM call.

The other two `updateDescription` / `updateExtractedText` callers were already
correct — `lib/mount-index/store-file.ts` and `lib/mount-index/sync/apply-store.ts`
pass `link.id`, the latter with a comment saying exactly why. The image
auto-captioner (`lib/photos/auto-describe-attachment.ts`) never used these
methods at all: it enumerates `findByFileId` and writes every link on purpose,
which is a different and deliberate policy.

## Why it survived

- A store where two paths hold identical bytes is unusual **except** in
  character vaults, which is where nearly all described images live — and the
  vault's own writers (`keep_image`, `save-image-to-album`) set the
  description at insert time through `linkBlobContent`, never through this
  route. Only a caption typed *afterwards* takes the broken path.
- With a single link the fallback is right, so every test and every manual
  check against an ordinary store passes.
- The failure is a 200 with a plausible body: the route returns the joined
  view for the link it wrote, so the response even carries a description — at
  the other path, which no client compares against the one it asked for.
- The signature made the bug invisible at the call site. `updateDescription(id,
  description)` reads like a complete thought; nothing about it suggests a
  second, unstated choice is being made.

## The fix

Make `linkId` **required** on both `updateDescription` and
`updateExtractedText`, and delete the `LIMIT 1` resolution. There is no such
thing as "the" link for a blob, so a method that needs one must be told which.
Every caller already holds it:

- the PATCH route passes `meta.linkId`;
- the chat attach passes `blob.linkId` (and its `ensureImageDescription`
  helper takes `linkId` on the blob shape it accepts, so the read and the
  write are the same row);
- the import passes `created.linkId`, which `docMountBlobs.create` already
  returns.

Required rather than optional-with-a-throw, so a future caller that has not
resolved a location fails to compile instead of failing at runtime on the one
store shape nobody tests against.

## How to verify

1. In a character vault, confirm the two paths share one content row:

   ```bash
   npx quilltap --instance V4test docs files "Riya Character Vault (3)" --json
   ```

2. PATCH a description at the `photos/…` path; confirm it appears on the
   `photos/…` link and that `images/history/…` is untouched.
3. PATCH a different description at `images/history/…`; confirm both
   locations now carry their own, and neither has overwritten the other.
4. Attach the same vault image to a chat twice and confirm the second attach
   does **not** re-run the vision model — the cached caption is now on the
   link the reader consults.
5. Regression tests in
   `__tests__/unit/lib/database/repositories/doc-mount-write-metadata.integration.test.ts`
   (`bug 157: a caption belongs to a location, not to the bytes`): two links on
   one blob, a description written to each, and `extractedText` written to the
   second-created link — the case the old `LIMIT 1` got wrong.
