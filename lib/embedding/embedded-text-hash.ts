/**
 * The hash an embedding job stamps on the text it embedded.
 *
 * An `EMBEDDING_GENERATE` job reads a chunk's text, calls the provider, and
 * writes the vector back much later — in the job child, a buffered write the
 * parent replays at commit. If the chunk was re-rendered in between, that
 * vector belongs to text the row no longer holds, and nothing would ever
 * re-embed it (the "no embedding yet" gate is satisfied). So the job passes
 * this hash with its write, and `updateEmbedding` applies the vector only
 * when the row's current text hashes the same (refactor 4.13 §5.3).
 *
 * @module embedding/embedded-text-hash
 */

import { createHash } from 'crypto';

export function embeddedTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
