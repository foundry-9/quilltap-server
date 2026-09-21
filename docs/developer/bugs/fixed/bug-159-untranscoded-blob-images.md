# Bug 159 — eight write paths stored images at full bulk

| | |
|---|---|
| **Status** | **FIXED in v4.10 (2026-09-21)** |
| **Found** | 2026-09-21 |
| **Fixed** | 2026-09-21 |
| **Severity** | Medium (no data loss; disk cost only) |
| **Who it bites** | Anyone with images in a database-backed document store — character vaults, project stores, the Lantern's backgrounds |
| **Provenance** | Found while auditing a 2.0 GB instance for storage; `doc_mount_blobs` was 743 MB, the single largest table in any Quilltap database |
| **Fix site** | `lib/mount-index/normalize-blob-image.ts` (new), `lib/mount-index/blob-transcode.ts`, `lib/database/repositories/doc-mount-file-links.repository.ts` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../bugs.md) |

**FIXED in v4.10 (2026-09-21)** — image normalization moved from eight optional
call sites into `linkBlobContent`, the one method every blob write funnels
through. `recompress-oversized-mount-blobs-v1` re-encodes what landed before.

## Symptom

`doc_mount_blobs` grew far beyond what the stored pictures warrant. On the
reference instance (Friday), 731 MB of image data contained:

- **68 untranscoded bitmaps**, 96.5 MB — including three personified-feature
  avatars at 6.25–6.77 MB each, where the version shipped in the repo is ~50 KB.
  Re-encoded at quality 85 they measure **7%** of their stored size.
- **71 lossless WebP**, 112 MB, averaging 1.6 MB at 1536×1024 — AI-generated
  story backgrounds, photographic content for which lossless is simply the
  wrong encoding. Re-encoded they measure **15%**.

Nothing malfunctioned. The pictures displayed correctly; they just cost ten
times what they needed to.

## Root cause

Two independent holes, both in the same design flaw: **transcoding was a
courtesy each call site could decline, rather than a chokepoint.**

**(a) Lossless WebP was never re-encoded.**
`lib/mount-index/blob-transcode.ts:21` excluded `image/webp` from
`TRANSCODABLE_MIME_TYPES`, with the comment *"already-WebP uploads are stored
as-is"*. That is correct for **lossy** WebP — re-encoding lossy→lossy is
generation loss for a modest saving. It is wrong for **lossless** WebP, which
is exactly the case worth re-encoding. The set could not express the
distinction because it keyed on MIME type, and both variants share one.

**(b) Eight write paths never called the transcoder at all.**
`transcodeToWebP` was invoked by four call sites and skipped by eight:
`lib/mount-index/conversion.ts:146` (deliberately, *"so original bytes
survive"*), `lib/mount-index/file-ops.ts:737` (copy/move),
`lib/mount-index/sync/apply-store.ts:104`, the three photo-gallery services
(`character-gallery-service.ts:172`, `user-gallery-service.ts:201`,
`save-image-to-album.ts:294`), plus the import and restore paths.

The dated evidence separates the two: **78 of the files were written on a
single day, 2026-04-23** — the filesystem→DB project-store cutover running
through `conversion.ts`'s bypass. The remaining twelve trickled in between
2026-05 and 2026-09 through the character photo gallery, which was still
producing new untranscoded PNGs the day the bug was found.

## Why it survived

Nothing was broken, so nothing complained. `storedMimeType` faithfully recorded
`image/png`, the serving routes set `Content-Type` from it, and every image
rendered correctly. The only symptom was disk, and disk is not something any
test asserts on.

The existing test suite actively **locked in** half the defect:
`__tests__/unit/lib/chat-files-v2-stored-sha256.test.ts:126` asserts that an
already-WebP upload is left alone — correct for its lossy fixture, and exactly
the behaviour that let lossless WebP through.

## The fix

**The chokepoint.** `linkBlobContent` — the one method that inserts into
`doc_mount_blobs`, and which already recomputes `sha256` from the actual bytes
rather than trusting callers — now calls `normalizeLinkBlobImage` before
hashing. The bytes, `storedMimeType`, `relativePath` and `fileName` are
rewritten together, so a row can never claim one format while holding another.
All eight bypasses are closed at once, and a *new* write path cannot reopen
one by forgetting.

The one sanctioned opt-out is `normalizeImages: false`, passed by `.qtap`
import and archive rehydrate, where bytes must round-trip exactly as archived.

**The sniffer.** `isLosslessWebP` walks the RIFF chunk list looking for `VP8L`
(and stops at `VP8 `), rather than reading only the first fourcc — a `VP8X`
extended file carries its image data behind `ICCP`/`ANIM`/`ALPH` chunks. It
returns false for any malformed buffer, so a truncated file is left alone
rather than re-encoded on a guess. Re-encoding is gated on
`LOSSLESS_WEBP_REENCODE_MIN_BYTES` (512 KB), which spares small lossless assets
— icons, diagrams, hard-edged screenshots — where lossless is the right choice.

**The cleanup.** `recompress-oversized-mount-blobs-v1` re-encodes rows written
before the chokepoint existed, updating `doc_mount_blobs`, `doc_mount_files`
and the cross-database `files.sha256` invariant (bug 117) in step. It
deliberately does **not** rename `relativePath`: stored Markdown references
`.../blobs/<path>`, and the serving routes take `Content-Type` from
`storedMimeType`, so a `.png` holding WebP bytes serves correctly while every
existing reference keeps resolving.

## How to verify

```sh
# Before: bitmaps and large lossless WebP present
npx quilltap db --instance <name> --mount-points \
  "SELECT storedMimeType, count(*), sum(length(data))/1048576 AS mb
     FROM doc_mount_blobs GROUP BY storedMimeType ORDER BY mb DESC"
```

Start the server so the migration runs, then compact and re-measure:

```sh
npx quilltap db --instance <name> optimize mount-points
```

On the reference instance: 149 images re-encoded, image data 699.7 MB → 507.9 MB,
the file 781.4 MB → 586.3 MB, `integrity_check: ok`, dimensions unchanged
(`foundryman-avatar.png`: 6.77 MB → 0.51 MB, still 1696×2528).

Regression coverage: `__tests__/unit/lib/mount-index/blob-transcode-lossless-webp.test.ts`
(the sniffer against real RIFF layouts, and that a **lossy** WebP stays
byte-identical) and `__tests__/unit/lib/mount-index/normalize-blob-image.test.ts`
(that normalization is the **default**, that it drags mime/path/name along with
the bytes, and that `normalizeImages: false` is honoured).
