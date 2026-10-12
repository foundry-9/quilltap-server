/**
 * Wardrobe folders — the rules for the operator's filing inside a tier's
 * `Wardrobe/` folder.
 *
 * A folder is a path relative to `Wardrobe/`: `''` for the root, otherwise
 * `Seg/Seg/Seg` with no leading or trailing slash. It is the file's path and
 * nothing else — derived from `relativePath` on read, written back as the
 * path on projection, never stored in frontmatter. Folders organise what the
 * operator sees; they carry no meaning for what a character can wear.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/wardrobe/folders
 */

import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';

/** The deepest a wardrobe folder may nest. */
export const WARDROBE_FOLDER_MAX_DEPTH = 8;

/**
 * Segments a wardrobe folder may never use, compared case-insensitively.
 * `Wardrobe/images/<itemId>/` holds item pictures.
 */
export const WARDROBE_RESERVED_FOLDER_SEGMENTS: readonly string[] = ['images'];

/** The folder every tier's items live under, as a path prefix. */
const WARDROBE_ROOT = 'Wardrobe';

/** A folder path that breaks the rules (a 400 at the route). */
export class WardrobeFolderPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WardrobeFolderPathError';
  }
}

/** The folder named doesn't exist (a 404 at the route). */
export class WardrobeFolderNotFoundError extends Error {
  constructor(public readonly folder: string) {
    super(`Wardrobe folder not found: ${folder}`);
    this.name = 'WardrobeFolderNotFoundError';
  }
}

/**
 * The folder change collides with what's already there — a sibling holding
 * the name, or a folder holding files that aren't items (a 409 at the route).
 */
export class WardrobeFolderConflictError extends Error {
  constructor(public readonly folder: string, message?: string) {
    super(message ?? `A wardrobe folder named "${folder}" already exists`);
    this.name = 'WardrobeFolderConflictError';
  }
}

/** A folder as the browser and the folder routes see it. */
export interface WardrobeFolder {
  /** Path relative to `Wardrobe/`, e.g. `Formal/Evening`. Never `''`. */
  path: string;
  /** The last segment. */
  name: string;
  /** Non-archived items directly inside (not in subfolders). */
  itemCount: number;
}

function isReservedSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return WARDROBE_RESERVED_FOLDER_SEGMENTS.some((reserved) => reserved === lower);
}

/**
 * Normalise an operator-typed folder path: trim, split on `/` (and `\`), drop
 * empty segments, sanitise each with the item-file rule. Throws
 * {@link WardrobeFolderPathError} for `.` / `..` / a reserved segment, or more
 * than {@link WARDROBE_FOLDER_MAX_DEPTH} segments. `''` (or whitespace) is the
 * root.
 */
export function normalizeWardrobeFolderPath(input: string | null | undefined): string {
  if (input == null) return '';
  const segments = input
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const out: string[] = [];
  for (const raw of segments) {
    if (raw === '.' || raw === '..') {
      throw new WardrobeFolderPathError(`A wardrobe folder name may not be "${raw}"`);
    }
    const segment = sanitizeFileName(raw);
    if (isReservedSegment(segment)) {
      throw new WardrobeFolderPathError(
        `"${segment}" is reserved for item pictures and cannot be a wardrobe folder`,
      );
    }
    out.push(segment);
  }
  if (out.length > WARDROBE_FOLDER_MAX_DEPTH) {
    throw new WardrobeFolderPathError(
      `Wardrobe folders nest at most ${WARDROBE_FOLDER_MAX_DEPTH} deep`,
    );
  }
  return out.join('/');
}

/**
 * Normalise a folder an existing item already carries (a transfer's source
 * folder, which the Scriptorium may have made by hand): its normal form, or
 * the root when it can't be one.
 */
export function normalizeWardrobeFolderPathOrRoot(input: string | null | undefined): string {
  try {
    return normalizeWardrobeFolderPath(input);
  } catch {
    return '';
  }
}

/**
 * Normalise a folder *name* — one segment, as a rename takes it. Throws
 * {@link WardrobeFolderPathError} for an empty name or one with a `/`.
 */
export function normalizeWardrobeFolderName(input: string | null | undefined): string {
  if (input != null && /[\\/]/.test(input)) {
    throw new WardrobeFolderPathError('A folder name may not contain "/"');
  }
  const name = normalizeWardrobeFolderPath(input);
  if (!name) throw new WardrobeFolderPathError('A folder needs a name');
  return name;
}

/**
 * True when `path` is already in normal form: the root, or segments that are
 * non-empty, unsanitisable-further, not `.`/`..`/reserved, at most eight.
 */
export function isValidWardrobeFolderPath(path: string): boolean {
  try {
    return normalizeWardrobeFolderPath(path) === path;
  } catch {
    return false;
  }
}

/** Split a folder path into its segments (`''` → `[]`). */
export function folderSegments(folder: string): string[] {
  return folder.length === 0 ? [] : folder.split('/');
}

/**
 * The folder a `Wardrobe/` document lives in: `Wardrobe/A/B/x.md` → `A/B`,
 * `Wardrobe/x.md` → `''`. A path outside `Wardrobe/` reads as the root.
 */
export function folderOfWardrobePath(relativePath: string): string {
  const prefix = `${WARDROBE_ROOT}/`;
  if (!relativePath.toLowerCase().startsWith(prefix.toLowerCase())) return '';
  const rest = relativePath.slice(prefix.length);
  const slash = rest.lastIndexOf('/');
  return slash < 0 ? '' : rest.slice(0, slash);
}

/** The store path of a wardrobe folder: `''` → `Wardrobe`, `A/B` → `Wardrobe/A/B`. */
export function wardrobeFolderStorePath(folder: string): string {
  return folder ? `${WARDROBE_ROOT}/${folder}` : WARDROBE_ROOT;
}

/** The folder above `folder`; the root's parent is the root. */
export function parentFolder(folder: string): string {
  const slash = folder.lastIndexOf('/');
  return slash < 0 ? '' : folder.slice(0, slash);
}

/** The last segment of `folder`; `''` for the root. */
export function folderName(folder: string): string {
  const slash = folder.lastIndexOf('/');
  return slash < 0 ? folder : folder.slice(slash + 1);
}

/** Join path pieces, skipping empty ones: `joinFolder('', 'x.md')` → `x.md`. */
export function joinFolder(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('/');
}

/** Folder names are case-insensitive: `Formal` and `formal` are one folder. */
export function isSameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** True when `folder` is `ancestor` or nested anywhere beneath it. */
export function isUnderFolder(folder: string, ancestor: string): boolean {
  if (ancestor.length === 0) return true;
  const f = folder.toLowerCase();
  const a = ancestor.toLowerCase();
  return f === a || f.startsWith(`${a}/`);
}

/**
 * Re-root `folder` from under `fromAncestor` to under `toAncestor`
 * (`Formal/Evening`, `Formal` → `Dress` gives `Dress/Evening`). A folder not
 * under `fromAncestor` is returned unchanged.
 */
export function rebaseFolder(folder: string, fromAncestor: string, toAncestor: string): string {
  if (!isUnderFolder(folder, fromAncestor)) return folder;
  const rest = folder.slice(fromAncestor.length).replace(/^\//, '');
  return joinFolder(toAncestor, rest);
}

/** The display form of a folder: `Formal › Evening`. */
export function folderCrumb(folder: string): string {
  return folderSegments(folder).join(' › ');
}
