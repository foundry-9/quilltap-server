/**
 * Float32 ↔ Buffer conversion helpers for embedding BLOBs.
 *
 * Embeddings are stored on disk as raw Float32 byte buffers. The "to blob"
 * direction takes any ArrayLike<number> (so callers can hand us plain
 * arrays or Float32Array). The "from blob" direction always returns a
 * fresh Float32Array — the source Buffer's backing ArrayBuffer may be
 * pooled or reused by Node, so callers must not alias it.
 *
 * The `blobToEmbedding` / `embeddingToBlob` names are the legacy spelling
 * used in the SQLite backend; the `blobToFloat32` / `float32ToBlob` names
 * are the embedding-layer spelling. Both are exported here so call sites
 * read naturally in their own context.
 */

/** Convert a Float32-coded Buffer back to a Float32Array (fresh copy). */
export function blobToFloat32(blob: Buffer): Float32Array {
  const view = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return new Float32Array(view);
}

/** Convert any ArrayLike<number> into a Float32 Buffer suitable for storage. */
export function float32ToBlob(embedding: ArrayLike<number>): Buffer {
  const float32 = embedding instanceof Float32Array
    ? embedding
    : new Float32Array(Array.from(embedding as ArrayLike<number>));
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/** Alias for {@link blobToFloat32} — SQLite-backend spelling. */
export const blobToEmbedding = blobToFloat32;

/** Alias for {@link float32ToBlob} — SQLite-backend spelling. */
export const embeddingToBlob = float32ToBlob;
