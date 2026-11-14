/**
 * Trust decisions for themes fetched from a registry.
 *
 * Rules held here:
 *   - a registry index is used only if it verifies under its source's public
 *     key when the source has one; a cached copy is re-verified every time it
 *     is read, never trusted by a stored flag;
 *   - a downloaded bundle that carries `signature.json` is verified under the
 *     source's public key before it is installed, and refused if it fails.
 *
 * @module themes/registry-trust
 */

import yauzl from 'yauzl';
import { logger } from '@/lib/logger';
import {
  hashBuffer,
  verifyRegistryIndex,
  verifyBundleSignatureHashes,
  type BundleSignatureDocument,
} from '@/lib/themes/crypto';
import type { RegistryIndex, RegistrySource } from '@/lib/themes/types';

const trustLogger = logger.child({ module: 'theme-registry-trust' });

/** Most entries read from a downloaded bundle while hashing it. */
const MAX_BUNDLE_ENTRIES = 200;

/** Thrown when a source has a key and its index does not verify under it. */
export class RegistryVerificationError extends Error {
  constructor(sourceName: string) {
    super(`Registry "${sourceName}" has a public key and its index signature did not verify; it will not be used`);
    this.name = 'RegistryVerificationError';
  }
}

/**
 * Decide whether an index may be used for `source`. Returns `verified: true`
 * when it verifies under the source's key, `false` when the source has no key,
 * and throws {@link RegistryVerificationError} when the source has a key and
 * verification fails.
 */
export function assessRegistryIndex(index: RegistryIndex, source: RegistrySource): { verified: boolean } {
  if (!source.publicKey) {
    trustLogger.debug('Registry source has no public key; index is unverified', { source: source.name });
    return { verified: false };
  }
  if (!verifyRegistryIndex(index, source.publicKey)) {
    trustLogger.warn('Registry signature verification failed; refusing index', {
      source: source.name,
      url: source.url,
    });
    throw new RegistryVerificationError(source.name);
  }
  trustLogger.debug('Registry signature verified', { source: source.name });
  return { verified: true };
}

interface ZipFileHashes {
  /** Hex SHA-256 per file, keyed by path relative to the bundle root. */
  hashes: Record<string, string>;
  /** Raw `signature.json` from the bundle root, when present. */
  signatureJson: Buffer | null;
}

function readEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('Unable to read bundle entry'));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

/** Hash every file in a bundle archive held in memory. */
async function hashBundleZip(buffer: Buffer): Promise<ZipFileHashes> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) reject(err ?? new Error('Unable to open bundle'));
      else resolve(zf);
    });
  });

  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    let count = 0;
    zipFile.on('entry', async (entry: yauzl.Entry) => {
      try {
        count++;
        if (count > MAX_BUNDLE_ENTRIES) {
          zipFile.close();
          reject(new Error(`Bundle holds more than ${MAX_BUNDLE_ENTRIES} entries`));
          return;
        }
        if (!/\/$/.test(entry.fileName)) {
          files.set(entry.fileName, await readEntry(zipFile, entry));
        }
        zipFile.readEntry();
      } catch (err) {
        zipFile.close();
        reject(err);
      }
    });
    zipFile.on('end', () => resolve());
    zipFile.on('error', reject);
    zipFile.readEntry();
  });

  // The bundle root is where theme.json sits (some archives wrap it in one
  // folder); signature paths are relative to it.
  const themeJsonPaths = [...files.keys()].filter((n) => n === 'theme.json' || n.endsWith('/theme.json'));
  themeJsonPaths.sort((a, b) => a.length - b.length);
  const root = themeJsonPaths[0] ? themeJsonPaths[0].slice(0, -'theme.json'.length) : '';

  const hashes: Record<string, string> = {};
  let signatureJson: Buffer | null = null;
  for (const [name, data] of files) {
    const rel = root && name.startsWith(root) ? name.slice(root.length) : name;
    if (rel === 'signature.json') {
      signatureJson = data;
      continue;
    }
    hashes[rel] = hashBuffer(data);
  }
  return { hashes, signatureJson };
}

/**
 * Check a downloaded bundle's own signature. A bundle without
 * `signature.json` returns `signed: false`. A signed bundle from a source with
 * a key must verify under that key, or `ok` is false. A signed bundle from a
 * source with no key cannot be checked against anything the operator trusts
 * and is treated as unsigned.
 */
export async function checkBundleSignature(
  buffer: Buffer,
  source: RegistrySource
): Promise<{ ok: boolean; signed: boolean; verified: boolean; errors: string[] }> {
  let zip: ZipFileHashes;
  try {
    zip = await hashBundleZip(buffer);
  } catch (err) {
    return { ok: false, signed: false, verified: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  if (!zip.signatureJson) {
    trustLogger.debug('Downloaded bundle carries no signature', { source: source.name });
    return { ok: true, signed: false, verified: false, errors: [] };
  }

  if (!source.publicKey) {
    trustLogger.debug('Bundle is signed but its source has no public key; not verifiable', { source: source.name });
    return { ok: true, signed: true, verified: false, errors: [] };
  }

  let sig: BundleSignatureDocument;
  try {
    sig = JSON.parse(zip.signatureJson.toString('utf-8')) as BundleSignatureDocument;
  } catch {
    return { ok: false, signed: true, verified: false, errors: ['signature.json is not valid JSON'] };
  }

  const result = verifyBundleSignatureHashes(zip.hashes, sig, source.publicKey);
  trustLogger.debug('Bundle signature checked', { source: source.name, valid: result.valid });
  return { ok: result.valid, signed: true, verified: result.valid, errors: result.errors };
}
