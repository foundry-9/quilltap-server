/**
 * What a file uploaded into a theme draft may be, and where it goes
 * (Calliope Live, Spec F decisions 8 and 9). Pure.
 *
 * An uploaded name is never trusted: the stored name is built here, inside a
 * fixed folder (`fonts/`, `images/`, `icons/`), from characters a bundle path
 * may use, with a suffix on a collision. The extension must be one the kind
 * accepts, and for fonts and raster images it must agree with the file's
 * leading bytes. Every upload is held to the bundle's own limits, so a draft
 * cannot grow into something that will not install.
 *
 * @module lib/themes/drafts/uploads
 */

import { MAX_BUNDLE_SIZE, MAX_FILE_COUNT, MAX_FILE_SIZE } from '../bundle-archive';
import { IMAGE_EXTENSIONS, isSafeBundlePath } from '../engine/css-text';
import { fontExtensionMatches, sniffFontFormat } from '../font-info';

export type DraftUploadKind = 'font' | 'licence' | 'image' | 'icon';

/** The folder each kind is stored in. */
export const UPLOAD_FOLDERS: Readonly<Record<DraftUploadKind, string>> = {
  font: 'fonts',
  licence: 'fonts',
  image: 'images',
  icon: 'icons',
};

export const UPLOAD_EXTENSIONS: Readonly<Record<DraftUploadKind, readonly string[]>> = {
  font: ['.woff2', '.woff', '.ttf', '.otf'],
  licence: ['.txt', '.md'],
  image: IMAGE_EXTENSIONS,
  icon: ['.svg', '.webp'],
};

export const DRAFT_LIMITS = { fileBytes: MAX_FILE_SIZE, files: MAX_FILE_COUNT, totalBytes: MAX_BUNDLE_SIZE } as const;

/** An upload refused, with the reason in words. */
export class DraftUploadRefusedError extends Error {
  /** `content` for a file that is not what it claims; `limit` for one past a bundle limit. */
  constructor(message: string, readonly reason: 'content' | 'limit' = 'content') {
    super(message);
    this.name = 'DraftUploadRefusedError';
  }
}

/** `.Ext` of a name, lowercased (empty when there is none). */
export function extensionOf(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

type RasterFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif';

/** The raster format the leading bytes announce, or null. */
export function sniffRasterFormat(bytes: Uint8Array): RasterFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'avif';
  return null;
}

const RASTER_EXTENSIONS: Readonly<Record<string, RasterFormat>> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.avif': 'avif',
};

/** Whether the text reads as an SVG document: markup whose root element is `<svg`. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes.subarray(0, 4096)).toString('utf-8').replace(/^﻿/, '');
  const stripped = text.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '').trimStart();
  return /^<svg[\s>]/i.test(stripped);
}

/** Text a licence file may hold: UTF-8 without NUL bytes. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  const text = Buffer.from(bytes).toString('utf-8');
  return !text.includes('�');
}

/**
 * Check an upload's extension against its kind and its bytes. Returns the
 * extension the stored file will carry; throws DraftUploadRefusedError.
 */
export function checkUploadContent(kind: DraftUploadKind, fileName: string, bytes: Uint8Array): string {
  const ext = extensionOf(fileName);
  const allowed = UPLOAD_EXTENSIONS[kind];
  if (!allowed.includes(ext)) {
    throw new DraftUploadRefusedError(`${fileName || 'The file'}: a ${kind === 'licence' ? 'licence file' : kind} must be ${allowed.join(', ')}`);
  }
  if (bytes.length === 0) throw new DraftUploadRefusedError(`${fileName}: the file is empty`);
  if (kind === 'font') {
    const format = sniffFontFormat(bytes);
    if (!format) throw new DraftUploadRefusedError(`${fileName}: the file does not begin like a font`);
    if (!fontExtensionMatches(ext, format)) throw new DraftUploadRefusedError(`${fileName}: the file is a ${format.toUpperCase()} font, not ${ext}`);
  } else if (kind === 'image' || kind === 'icon') {
    if (ext === '.svg') {
      if (!looksLikeSvg(bytes)) throw new DraftUploadRefusedError(`${fileName}: the file is not an SVG document`);
    } else {
      const format = sniffRasterFormat(bytes);
      if (!format) throw new DraftUploadRefusedError(`${fileName}: the file does not begin like an image`);
      if (RASTER_EXTENSIONS[ext] !== format) throw new DraftUploadRefusedError(`${fileName}: the file is a ${format.toUpperCase()} image, not ${ext}`);
    }
  } else if (!looksLikeText(bytes)) {
    throw new DraftUploadRefusedError(`${fileName}: a licence file must be plain text`);
  }
  return ext === '.jpeg' ? '.jpg' : ext;
}

/**
 * A stem made safe for a bundle path: diacritics folded, anything outside
 * letters, digits, `.`, `_` and `-` turned into `-`, runs collapsed, no
 * leading dot or dash. Never empty.
 */
export function safeStem(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const safe = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-_]+|[.\-]+$/g, '')
    .slice(0, 80)
    .replace(/[.\-]+$/, '');
  return safe || 'file';
}

/**
 * The path a new upload is stored at: `<folder>/<safe stem><ext>`, with `-2`,
 * `-3`… on a collision with `taken` (compared without case, so it stays
 * distinct on a case-insensitive disk after install).
 */
export function storedUploadPath(kind: DraftUploadKind, name: string, ext: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((p) => p.toLowerCase()));
  const folder = UPLOAD_FOLDERS[kind];
  const stem = safeStem(name);
  for (let n = 1; ; n++) {
    const candidate = `${folder}/${n === 1 ? stem : `${stem}-${n}`}${ext}`;
    if (!lower.has(candidate.toLowerCase())) {
      if (!isSafeBundlePath(candidate)) throw new DraftUploadRefusedError(`Could not make a safe name for ${name}`);
      return candidate;
    }
  }
}

/** Refuse an upload that would take the draft past a bundle limit. */
export function checkUploadLimits(
  fileName: string,
  size: number,
  existing: ReadonlyArray<{ path: string; size: number }>,
  replacing?: string,
): void {
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  if (size > DRAFT_LIMITS.fileBytes) throw new DraftUploadRefusedError(`${fileName}: larger than ${mb(DRAFT_LIMITS.fileBytes)}, the most a theme file may be`, 'limit');
  const others = existing.filter((f) => f.path !== replacing);
  if (others.length + 1 > DRAFT_LIMITS.files) throw new DraftUploadRefusedError(`The draft already holds ${others.length} files, the most a theme may carry`, 'limit');
  const total = others.reduce((sum, f) => sum + f.size, 0) + size;
  if (total > DRAFT_LIMITS.totalBytes) throw new DraftUploadRefusedError(`${fileName}: the draft would come to ${mb(total)}, past the ${mb(DRAFT_LIMITS.totalBytes)} a theme may weigh`, 'limit');
}
