/**
 * Theme Registry Cryptography
 *
 * Ed25519 signature generation and verification for theme registries
 * and theme bundles. Uses Node.js built-in `crypto` module (Node 18+).
 *
 * @module themes/crypto
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';

const cryptoLogger = logger.child({ module: 'theme-crypto' });

// ============================================================================
// KEY PAIR GENERATION
// ============================================================================

/**
 * Generate an Ed25519 key pair for signing registries and bundles.
 * Returns base64-encoded public and private keys.
 */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  return {
    publicKey: `ed25519:${publicKey.toString('base64')}`,
    privateKey: `ed25519:${privateKey.toString('base64')}`,
  };
}

// ============================================================================
// SIGNING
// ============================================================================

/**
 * Sign data with an Ed25519 private key.
 * @param data - The data to sign (string)
 * @param privateKeyStr - Base64-encoded private key (with or without ed25519: prefix)
 * @returns Base64-encoded signature with ed25519: prefix
 */
export function signData(data: string, privateKeyStr: string): string {
  const keyBytes = parseKeyBytes(privateKeyStr);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(keyBytes, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(data, 'utf-8'), privateKey);
  return `ed25519:${signature.toString('base64')}`;
}

/**
 * Sign a JSON object by serializing it deterministically.
 */
export function signJSON(obj: unknown, privateKeyStr: string): string {
  const data = JSON.stringify(obj);
  return signData(data, privateKeyStr);
}

// ============================================================================
// VERIFICATION
// ============================================================================

/**
 * Verify an Ed25519 signature.
 * @param data - The original data that was signed
 * @param signatureStr - Base64-encoded signature (with or without ed25519: prefix)
 * @param publicKeyStr - Base64-encoded public key (with or without ed25519: prefix)
 * @returns true if the signature is valid
 */
export function verifySignature(
  data: string,
  signatureStr: string,
  publicKeyStr: string
): boolean {
  try {
    const sigBytes = parseKeyBytes(signatureStr);
    const keyBytes = parseKeyBytes(publicKeyStr);

    const publicKey = crypto.createPublicKey({
      key: Buffer.from(keyBytes, 'base64'),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(
      null,
      Buffer.from(data, 'utf-8'),
      publicKey,
      Buffer.from(sigBytes, 'base64')
    );
  } catch (error) {
    return false;
  }
}

/**
 * Verify a signed JSON object.
 */
export function verifyJSONSignature(
  obj: unknown,
  signatureStr: string,
  publicKeyStr: string
): boolean {
  const data = JSON.stringify(obj);
  return verifySignature(data, signatureStr, publicKeyStr);
}

/**
 * Verify a registry index signature.
 * The signature covers the JSON-serialized themes array.
 */
export function verifyRegistryIndex(
  index: { themes: unknown[]; signature?: string },
  publicKey: string
): boolean {
  if (!index.signature) return false;
  const data = JSON.stringify(index.themes);
  return verifySignature(data, index.signature, publicKey);
}

// ============================================================================
// FILE HASHING
// ============================================================================

/**
 * Compute SHA-256 hash of a file.
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash of a buffer.
 * @returns Hex-encoded SHA-256 hash
 */
export function hashBuffer(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ============================================================================
// BUNDLE SIGNATURE
// ============================================================================

/**
 * Bundle signature format (stored as signature.json inside the bundle)
 */
export interface BundleSignature {
  /** Signing algorithm */
  algorithm: 'ed25519';
  /** Ed25519 signature of the manifest content hash */
  signature: string;
  /** SHA-256 hash of theme.json content */
  manifestHash: string;
  /** SHA-256 hashes of all files in the bundle */
  fileHashes: Record<string, string>;
  /** ISO timestamp of when the bundle was signed */
  signedAt: string;
  /** Public key used (for key identification, not trust) */
  publicKey: string;
}

/**
 * Sign a theme bundle directory.
 * Creates a signature covering all files in the bundle.
 */
export async function signBundleDirectory(
  bundleDir: string,
  privateKeyStr: string,
  publicKeyStr: string
): Promise<BundleSignature> {
  const fileHashes: Record<string, string> = {};

  // Hash all files recursively
  await hashDirectoryFiles(bundleDir, bundleDir, fileHashes);

  // The manifest hash is special — it's the hash of theme.json
  const manifestPath = path.join(bundleDir, 'theme.json');
  const manifestHash = fileHashes['theme.json'] || await hashFile(manifestPath);

  // Sign the concatenation of all hashes (sorted by filename for determinism)
  const hashData = Object.entries(fileHashes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, hash]) => `${file}:${hash}`)
    .join('\n');

  const signature = signData(hashData, privateKeyStr);

  return {
    algorithm: 'ed25519',
    signature,
    manifestHash,
    fileHashes,
    signedAt: new Date().toISOString(),
    publicKey: publicKeyStr,
  };
}

/**
 * The signature document a bundle carries as `signature.json`, in either of
 * the two shapes in use: {@link BundleSignature} (written by
 * `signBundleDirectory`, hash lines `file:hash`) or the CLI's
 * `quilltap themes registry sign` output (`version: 1`, `files`, hash lines
 * `hash  file`).
 */
export type BundleSignatureDocument =
  | BundleSignature
  | {
      version: 1;
      algorithm: 'ed25519';
      signature: string;
      files: Record<string, string>;
      signedAt?: string;
    };

const SIGNATURE_FILENAME = 'signature.json';

/** Normalise a signature document to its signed file map and signed text. */
function signedPayload(
  sig: BundleSignatureDocument
): { fileHashes: Record<string, string>; hashData: string } | null {
  if (!sig || typeof sig !== 'object' || typeof sig.signature !== 'string') return null;
  if ('fileHashes' in sig && sig.fileHashes && typeof sig.fileHashes === 'object') {
    const fileHashes = Object.fromEntries(
      Object.entries(sig.fileHashes).filter(([file]) => file !== SIGNATURE_FILENAME)
    );
    const hashData = Object.entries(fileHashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, hash]) => `${file}:${hash}`)
      .join('\n');
    return { fileHashes, hashData };
  }
  if ('files' in sig && sig.files && typeof sig.files === 'object') {
    const fileHashes = Object.fromEntries(
      Object.entries(sig.files).filter(([file]) => file !== SIGNATURE_FILENAME)
    );
    // The CLI writes its map in sorted-path order and signs it in that order.
    const hashData = Object.keys(fileHashes)
      .sort()
      .map((file) => `${fileHashes[file]}  ${file}`)
      .join('\n');
    return { fileHashes, hashData };
  }
  return null;
}

/**
 * Verify a bundle signature against a map of the bundle's actual file hashes
 * (relative path, `/`-separated, to hex SHA-256). Every file must be listed
 * with a matching hash, nothing may be listed that is absent, and the
 * signature must verify under `publicKeyStr` — the key the operator trusts,
 * never the key the signature document names.
 */
export function verifyBundleSignatureHashes(
  currentHashes: Record<string, string>,
  sig: BundleSignatureDocument,
  publicKeyStr: string
): { valid: boolean; errors: string[] } {
  const payload = signedPayload(sig);
  if (!payload) {
    return { valid: false, errors: ['Unrecognised signature format'] };
  }
  const errors: string[] = [];

  for (const [file, expectedHash] of Object.entries(payload.fileHashes)) {
    const currentHash = currentHashes[file];
    if (!currentHash) {
      errors.push(`Missing file: ${file}`);
    } else if (currentHash !== expectedHash) {
      errors.push(`Modified file: ${file}`);
    }
  }

  for (const file of Object.keys(currentHashes)) {
    if (file === SIGNATURE_FILENAME) continue;
    if (!payload.fileHashes[file]) {
      errors.push(`Unexpected file: ${file}`);
    }
  }

  if (errors.length > 0) {
    cryptoLogger.debug('Bundle signature file set mismatch', { errorCount: errors.length });
    return { valid: false, errors };
  }

  if (!verifySignature(payload.hashData, sig.signature, publicKeyStr)) {
    cryptoLogger.debug('Bundle signature did not verify');
    return { valid: false, errors: ['Signature verification failed'] };
  }

  return { valid: true, errors: [] };
}

/**
 * Verify a bundle signature against files in a directory.
 */
export async function verifyBundleSignature(
  bundleDir: string,
  sig: BundleSignatureDocument,
  publicKeyStr: string
): Promise<{ valid: boolean; errors: string[] }> {
  const currentHashes: Record<string, string> = {};
  await hashDirectoryFiles(bundleDir, bundleDir, currentHashes);
  return verifyBundleSignatureHashes(currentHashes, sig, publicKeyStr);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Strip the ed25519: prefix from a key or signature string.
 */
function parseKeyBytes(prefixedKey: string): string {
  if (prefixedKey.startsWith('ed25519:')) {
    return prefixedKey.slice(8);
  }
  return prefixedKey;
}

/**
 * Recursively hash all files in a directory.
 */
async function hashDirectoryFiles(
  baseDir: string,
  currentDir: string,
  hashes: Record<string, string>
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      await hashDirectoryFiles(baseDir, fullPath, hashes);
    } else if (entry.isFile()) {
      hashes[relativePath.split(path.sep).join('/')] = await hashFile(fullPath);
    }
  }
}

// ============================================================================
// OFFICIAL REGISTRY KEY
// ============================================================================

/**
 * The official Quilltap registry public key.
 * This key is used to verify the official theme registry.
 *
 * Configurable via environment variable so deployments can set/rotate
 * the trusted key without code changes.
 */
export const OFFICIAL_REGISTRY_PUBLIC_KEY = (
  process.env.QTAP_OFFICIAL_REGISTRY_PUBLIC_KEY
  ?? process.env.QUILLTAP_OFFICIAL_REGISTRY_PUBLIC_KEY
  ?? ''
).trim();

/**
 * Official registry URL
 */
export const OFFICIAL_REGISTRY_URL = 'https://themes.quilltap.ai/registry.json';
