/**
 * Bug 260 — which blobs get their text extracted. The extension list is the
 * startup backfill's worklist filter, so it must agree with the predicates.
 */
import {
  EXTRACTABLE_BLOB_EXTENSIONS,
  detectNativeText,
  isExtractableBlobPath,
} from '../path-utils';

describe('isExtractableBlobPath', () => {
  it('accepts native text, PDF and DOCX, case-insensitively', () => {
    for (const p of ['CHANGELOG.md', 'a.MARKDOWN', 'n.txt', 'd.json', 'e.jsonl', 'f.ndjson', 'r.PDF', 'w.docx']) {
      expect(isExtractableBlobPath(p)).toBe(true);
    }
  });

  it('rejects images and other binaries', () => {
    for (const p of ['avatar.webp', 'photo.png', 'song.mp3', 'archive.zip', 'noext']) {
      expect(isExtractableBlobPath(p)).toBe(false);
    }
  });

  it('lists exactly the native-text extensions plus .pdf and .docx', () => {
    const nonNative = EXTRACTABLE_BLOB_EXTENSIONS.filter((ext) => detectNativeText(`x${ext}`) === null);
    expect([...nonNative].sort()).toEqual(['.docx', '.pdf']);
    for (const ext of ['.md', '.markdown', '.txt', '.json', '.jsonl', '.ndjson']) {
      expect(detectNativeText(`x${ext}`)).not.toBeNull();
      expect(EXTRACTABLE_BLOB_EXTENSIONS).toContain(ext);
    }
  });
});
