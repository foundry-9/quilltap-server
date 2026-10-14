/**
 * @jest-environment node
 *
 * The two defects that had to go before a document-store sync could push bytes
 * at a store without quietly destroying what it found there.
 *
 * Bug 155 — writing a binary's bytes over an existing path blanked its caption.
 *   `linkBlobContent` treated every omitted metadata field as "the new value,
 *   which is blank", on the UPDATE branch as well as the INSERT. Every
 *   byte-preserving writer omits them, so `docs write --force` over a described
 *   image, a re-upload onto the same path, and a cross-store copy all erased
 *   the description and the auto-captioner's extracted text.
 *
 * Bug 156 — an overwrite left the previous revision's chunks answering search.
 *   Chunks are keyed by linkId and cascade only on link deletion, so repointing
 *   a link at new content orphaned them in place — and the link went on
 *   claiming `chunkCount > 0, converted`, which is precisely the predicate
 *   `rescanDatabaseMountPoint` uses to decide a link needs nothing done.
 *
 * Bug 157 — a caption written at one path landed at another.
 *   `updateDescription` / `updateExtractedText` had a two-argument form that
 *   resolved the target link with `WHERE fileId = ? LIMIT 1`. Both are per-link
 *   (per-location) state, and content-addressing puts several links on one file
 *   row — a character vault holds every avatar at both `photos/` and
 *   `images/history/`, byte-identical — so the write landed on an arbitrary one
 *   of the sharing locations. `linkId` is now required.
 *
 * Also covers the caller-supplied `lastModified` / `createdAt` the sync needs
 * so the two sides converge instead of re-stamping `now` on every pass.
 *
 * Runs the real repository against a real in-memory SQLite database.
 *
 * Guards:
 *   - lib/database/repositories/doc-mount-file-links.repository.ts
 *     (linkBlobContent + linkDocumentContent update branches,
 *      fanOutGroupFileId, setLinkTimestamps)
 *   - lib/database/repositories/doc-mount-blobs.repository.ts
 *     (updateDescription / updateExtractedText target exactly one link)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash } from 'crypto';

function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';
import { DocMountChunksRepository } from '@/lib/database/repositories/doc-mount-chunks.repository';

const shaOf = (s: Buffer | string) =>
  createHash('sha256').update(typeof s === 'string' ? Buffer.from(s, 'utf-8') : s).digest('hex');

const PNG_A = Buffer.from('the first harbour map, in bytes');
const PNG_B = Buffer.from('a corrected harbour map, in rather different bytes');
const V1 = '# Harbour\nThe first revision mentions a lighthouse.';
const V2 = '# Harbour\nThe second revision mentions a customs house instead.';

let db: any;
let links: DocMountFileLinksRepository;
let blobs: DocMountBlobsRepository;

async function writeBlob(
  mountPointId: string,
  relativePath: string,
  data: Buffer,
  extra: Record<string, unknown> = {}
) {
  const { link } = await links.linkBlobContent({
    mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'blob',
    originalFileName: path.posix.basename(relativePath),
    originalMimeType: 'image/png',
    storedMimeType: 'image/png',
    sha256: shaOf(data),
    data,
    ...extra,
  });
  return link;
}

async function writeDoc(
  mountPointId: string,
  relativePath: string,
  content: string,
  extra: Record<string, unknown> = {}
) {
  const { link } = await links.linkDocumentContent({
    mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'markdown',
    content,
    contentSha256: shaOf(content),
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
    ...extra,
  });
  return link;
}

function linkRow(linkId: string) {
  return db.prepare(
    `SELECT id, fileId, description, descriptionUpdatedAt, extractedText,
            extractedTextSha256, extractionStatus, chunkCount, conversionStatus,
            lastModified, createdAt
     FROM doc_mount_file_links WHERE id = ?`
  ).get(linkId) as Record<string, any>;
}

/** Stand in for a completed chunking pass over this link. */
function seedChunks(linkId: string, mountPointId: string, content: string, count = 2) {
  for (let i = 0; i < count; i++) {
    db.prepare(
      `INSERT INTO doc_mount_chunks (id, linkId, mountPointId, chunkIndex, content, tokenCount, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `chunk-${linkId}-${i}`, linkId, mountPointId, i, content, 12,
      new Date().toISOString(), new Date().toISOString()
    );
  }
  db.prepare('UPDATE doc_mount_file_links SET chunkCount = ? WHERE id = ?').run(count, linkId);
}

function chunkContents(linkId: string): string[] {
  return (db.prepare(
    'SELECT content FROM doc_mount_chunks WHERE linkId = ? ORDER BY chunkIndex'
  ).all(linkId) as { content: string }[]).map(r => r.content);
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  blobs = new DocMountBlobsRepository();
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await new DocMountDocumentsRepository().findByFileId('seed');
  await blobs.findByFileId('seed');
  await new DocMountChunksRepository().findByLinkId('seed');
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

// ---------------------------------------------------------------------------
// Bug 155
// ---------------------------------------------------------------------------

describe('bug 155: a byte write says nothing about the caption', () => {
  it('keeps description, extracted text and extraction status across an overwrite', async () => {
    const link = await writeBlob('mp-1', 'lore/harbour.png', PNG_A, {
      description: 'A hand-drawn map of the harbour at dusk.',
      extractedText: 'A hand-drawn map of the harbour at dusk.',
      extractedTextSha256: shaOf('A hand-drawn map of the harbour at dusk.'),
      extractionStatus: 'converted',
    });
    const before = linkRow(link.id);
    expect(before.description).toBe('A hand-drawn map of the harbour at dusk.');

    // The byte-preserving writers (file-ops.writeDestBytes, the sync's
    // store-side applier) pass no metadata at all.
    await writeBlob('mp-1', 'lore/harbour.png', PNG_B);

    const after = linkRow(link.id);
    expect(after.fileId).not.toBe(before.fileId);           // the bytes did change
    expect(after.description).toBe(before.description);
    expect(after.descriptionUpdatedAt).toBe(before.descriptionUpdatedAt);
    expect(after.extractedText).toBe(before.extractedText);
    expect(after.extractedTextSha256).toBe(before.extractedTextSha256);
    expect(after.extractionStatus).toBe('converted');
  });

  it('still clears the description when the caller explicitly passes an empty one', async () => {
    const link = await writeBlob('mp-1', 'lore/harbour.png', PNG_A, {
      description: 'A hand-drawn map of the harbour at dusk.',
    });
    await writeBlob('mp-1', 'lore/harbour.png', PNG_B, { description: '' });

    const after = linkRow(link.id);
    expect(after.description).toBe('');
    expect(after.descriptionUpdatedAt).toBeNull();
  });

  it('a fresh insert still defaults to a blank description', async () => {
    const link = await writeBlob('mp-1', 'lore/new.png', PNG_A);
    expect(linkRow(link.id).description).toBe('');
    expect(linkRow(link.id).extractionStatus).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Bug 156
// ---------------------------------------------------------------------------

describe('bug 156: an overwrite retires the chunks it invalidated', () => {
  it('drops the old revision’s chunks and zeroes chunkCount on a repoint', async () => {
    const link = await writeDoc('mp-1', 'harbour.md', V1);
    seedChunks(link.id, 'mp-1', V1);
    expect(linkRow(link.id).chunkCount).toBe(2);

    await writeDoc('mp-1', 'harbour.md', V2);

    // Not merely "the count is wrong" — the rows themselves are gone, so a
    // search between the write and the re-chunk returns nothing rather than
    // the previous revision.
    expect(chunkContents(link.id)).toEqual([]);
    expect(linkRow(link.id).chunkCount).toBe(0);
  });

  it('leaves chunkCount alone when the bytes are unchanged', async () => {
    const link = await writeDoc('mp-1', 'harbour.md', V1);
    seedChunks(link.id, 'mp-1', V1);

    await writeDoc('mp-1', 'harbour.md', V1);

    expect(linkRow(link.id).chunkCount).toBe(2);
    expect(chunkContents(link.id)).toHaveLength(2);
  });

  it('lands the link in the rescan’s needs-rechunk predicate', async () => {
    // rescanDatabaseMountPoint re-chunks on `chunkCount === 0 ||
    // conversionStatus !== 'converted'`. Before the fix an overwrite satisfied
    // neither, so the in-child writers that defer chunking to "the next
    // rescan" deferred to a pass that would never run.
    const link = await writeDoc('mp-1', 'harbour.md', V1);
    seedChunks(link.id, 'mp-1', V1);

    await writeDoc('mp-1', 'harbour.md', V2);

    const row = linkRow(link.id);
    expect(row.chunkCount === 0 || row.conversionStatus !== 'converted').toBe(true);
  });

  it('retires a hard-link sibling’s chunks too', async () => {
    const a = await writeDoc('mp-1', 'harbour.md', V1);
    const b = await writeDoc('mp-2', 'copy.md', V1);
    await links.bindLinkGroup(a.id, b.id);
    seedChunks(a.id, 'mp-1', V1);
    seedChunks(b.id, 'mp-2', V1);

    await writeDoc('mp-1', 'harbour.md', V2);

    expect(chunkContents(b.id)).toEqual([]);
    expect(linkRow(b.id).chunkCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Caller-supplied timestamps
// ---------------------------------------------------------------------------

describe('per-location timestamps may be supplied by the writer', () => {
  const MTIME = '2026-09-19T14:02:11.000Z';
  const BIRTH = '2024-01-05T09:30:00.000Z';

  it('honours lastModified and createdAt on a document insert', async () => {
    const link = await writeDoc('mp-1', 'dated.md', V1, {
      lastModified: MTIME,
      createdAt: BIRTH,
    });
    expect(linkRow(link.id).lastModified).toBe(MTIME);
    expect(linkRow(link.id).createdAt).toBe(BIRTH);
  });

  it('honours lastModified on an update but leaves createdAt where it was', async () => {
    const link = await writeDoc('mp-1', 'dated.md', V1, { createdAt: BIRTH });
    await writeDoc('mp-1', 'dated.md', V2, {
      lastModified: MTIME,
      createdAt: '2099-01-01T00:00:00.000Z',
    });
    expect(linkRow(link.id).lastModified).toBe(MTIME);
    expect(linkRow(link.id).createdAt).toBe(BIRTH);
  });

  it('honours lastModified on a blob write', async () => {
    const link = await writeBlob('mp-1', 'dated.png', PNG_A, {
      lastModified: MTIME,
      createdAt: BIRTH,
    });
    expect(linkRow(link.id).lastModified).toBe(MTIME);
    expect(linkRow(link.id).createdAt).toBe(BIRTH);
  });

  it('still stamps now when the caller has no opinion', async () => {
    const link = await writeDoc('mp-1', 'undated.md', V1);
    const stamped = new Date(linkRow(link.id).lastModified).getTime();
    expect(Math.abs(Date.now() - stamped)).toBeLessThan(10_000);
  });

  it('setLinkTimestamps moves the clock without touching the bytes', async () => {
    const link = await writeDoc('mp-1', 'dated.md', V1);
    const fileId = linkRow(link.id).fileId;

    const ok = await links.setLinkTimestamps(link.id, { lastModified: MTIME, createdAt: BIRTH });

    expect(ok).toBe(true);
    const row = linkRow(link.id);
    expect(row.lastModified).toBe(MTIME);
    expect(row.createdAt).toBe(BIRTH);
    expect(row.fileId).toBe(fileId);
  });

  it('setLinkTimestamps reports false for an unknown link', async () => {
    await writeDoc('mp-1', 'somebody-else.md', V1);
    expect(await links.setLinkTimestamps('no-such-link', { lastModified: MTIME })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bug 157
// ---------------------------------------------------------------------------

describe('bug 157: a caption belongs to a location, not to the bytes', () => {
  const PHOTOS = 'photos/avatar_Riya_1789257668916.webp';
  const HISTORY = 'images/history/avatar_Riya_1789257668916.webp';
  const CAPTION = 'Riya at the harbour rail, hair loose in the wind.';

  /** What a character vault looks like: the same avatar at two paths. */
  async function twoPathsOneBlob() {
    const photos = await writeBlob('vault-1', PHOTOS, PNG_A);
    const history = await writeBlob('vault-1', HISTORY, PNG_A);
    // Content-addressed, so both links hang off one file row — which is the
    // whole condition for this bug.
    expect(linkRow(history.id).fileId).toBe(linkRow(photos.id).fileId);
    return { photos, history };
  }

  it('resolves each path to its own link id', async () => {
    const { photos, history } = await twoPathsOneBlob();
    expect((await blobs.findByMountPointAndPath('vault-1', PHOTOS))?.linkId).toBe(photos.id);
    expect((await blobs.findByMountPointAndPath('vault-1', HISTORY))?.linkId).toBe(history.id);
  });

  it('describes the path it was asked about and leaves the twin blank', async () => {
    const { photos, history } = await twoPathsOneBlob();
    const meta = await blobs.findByMountPointAndPath('vault-1', PHOTOS);

    const updated = await blobs.updateDescription(meta!.id, CAPTION, meta!.linkId);

    expect(updated?.relativePath).toBe(PHOTOS);
    expect(updated?.description).toBe(CAPTION);
    expect(linkRow(photos.id).description).toBe(CAPTION);
    expect(linkRow(photos.id).descriptionUpdatedAt).toBeTruthy();
    expect(linkRow(history.id).description).toBe('');
    expect(linkRow(history.id).descriptionUpdatedAt).toBeNull();
  });

  it('lets the two locations carry different captions', async () => {
    const { photos, history } = await twoPathsOneBlob();
    const a = await blobs.findByMountPointAndPath('vault-1', PHOTOS);
    const b = await blobs.findByMountPointAndPath('vault-1', HISTORY);

    await blobs.updateDescription(a!.id, CAPTION, a!.linkId);
    await blobs.updateDescription(b!.id, 'The same portrait, filed by date.', b!.linkId);

    expect(linkRow(photos.id).description).toBe(CAPTION);
    expect(linkRow(history.id).description).toBe('The same portrait, filed by date.');
  });

  it('keeps extracted text per location as well', async () => {
    const { photos, history } = await twoPathsOneBlob();
    const meta = await blobs.findByMountPointAndPath('vault-1', HISTORY);

    await blobs.updateExtractedText(meta!.id, {
      extractedText: CAPTION,
      extractedTextSha256: shaOf(CAPTION),
      extractionStatus: 'converted',
      extractionError: null,
    }, meta!.linkId);

    expect(linkRow(history.id).extractedText).toBe(CAPTION);
    expect(linkRow(history.id).extractionStatus).toBe('converted');
    expect(linkRow(photos.id).extractedText).toBeNull();
    expect(linkRow(photos.id).extractionStatus).toBe('none');
  });
});
