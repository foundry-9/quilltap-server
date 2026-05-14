import { createHash } from 'crypto';

/** Hex-encoded SHA-256 digest of a UTF-8 string. */
export function sha256OfString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Hex-encoded SHA-256 digest of a buffer. */
export function sha256OfBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
