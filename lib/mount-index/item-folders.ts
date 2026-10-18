/**
 * Item folders — the filing rules shared by every "folder of item files" in a
 * store: the wardrobe's `Wardrobe/` and the Inventory's `Inventory/`.
 *
 * A folder is a path relative to the root folder: `''` for the root,
 * otherwise `Seg/Seg/Seg` with no leading or trailing slash. It is the file's
 * path and nothing else — derived from `relativePath` on read, written back
 * as the path on projection, never stored in the file.
 *
 * Every rule is parameterised by an {@link ItemFolderRules}: the root folder,
 * the segments reserved at any depth (`images/` holds item pictures) and the
 * depth cap. `lib/wardrobe/folders.ts` and `lib/inventory/folders.ts` are
 * one-line delegates over their own rules, so neither tier copies the other.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/mount-index/item-folders
 */

import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';

/** The rules one item tree files by. */
export interface ItemFolderRules {
  /** The store folder every item lives under, e.g. `Wardrobe`. */
  root: string;
  /** Segments a folder may never use at any depth, lower-case. */
  reserved: readonly string[];
  /** The deepest a folder may nest. */
  maxDepth: number;
  /** The noun error messages use, e.g. `wardrobe`. */
  noun: string;
}

/** A folder path that breaks the rules (a 400 at the route). */
export class ItemFolderPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemFolderPathError';
  }
}

/** The folder named doesn't exist (a 404 at the route). */
export class ItemFolderNotFoundError extends Error {
  constructor(public readonly folder: string, noun = 'item') {
    super(`${capitalise(noun)} folder not found: ${folder}`);
    this.name = 'ItemFolderNotFoundError';
  }
}

/**
 * The folder change collides with what's already there — a sibling holding
 * the name, or a folder holding files that aren't items (a 409 at the route).
 */
export class ItemFolderConflictError extends Error {
  constructor(public readonly folder: string, message?: string, noun = 'item') {
    super(message ?? `A ${noun} folder named "${folder}" already exists`);
    this.name = 'ItemFolderConflictError';
  }
}

/**
 * A filing request named items that aren't filed in this tier — a borrowed
 * item seen from a character's merged view (a 400 at the route).
 */
export class ItemNotInLocationError extends Error {
  constructor(public readonly itemIds: string[], noun = 'item') {
    super(`Not in this ${noun} (shared items are filed where they live): ${itemIds.join(', ')}`);
    this.name = 'ItemNotInLocationError';
  }
}

/** A folder as the browser and the folder routes see it. */
export interface ItemFolder {
  /** Path relative to the root folder, e.g. `Formal/Evening`. Never `''`. */
  path: string;
  /** The last segment. */
  name: string;
  /** Non-archived items directly inside (not in subfolders). */
  itemCount: number;
}

/** True when `segment` is reserved by `rules`, case-insensitively. */
export function isReservedItemFolderSegment(rules: ItemFolderRules, segment: string): boolean {
  const lower = segment.toLowerCase();
  return rules.reserved.some((reserved) => reserved === lower);
}

/** Split a folder path into its segments (`''` → `[]`). */
export function folderSegments(folder: string): string[] {
  return folder.length === 0 ? [] : folder.split('/');
}

/**
 * Normalise an operator-typed folder path: trim, split on `/` (and `\`), drop
 * empty segments, sanitise each with the item-file rule. Throws `makeError`'s
 * error for `.` / `..` / a reserved segment, or more than `rules.maxDepth`
 * segments. `''` (or whitespace) is the root.
 */
export function normalizeItemFolderPath(
  rules: ItemFolderRules,
  input: string | null | undefined,
  makeError: (message: string) => Error = (message) => new ItemFolderPathError(message),
): string {
  if (input == null) return '';
  const segments = input
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const out: string[] = [];
  for (const raw of segments) {
    if (raw === '.' || raw === '..') {
      throw makeError(`A ${rules.noun} folder name may not be "${raw}"`);
    }
    const segment = sanitizeFileName(raw);
    if (isReservedItemFolderSegment(rules, segment)) {
      throw makeError(`"${segment}" is reserved for item pictures and cannot be a ${rules.noun} folder`);
    }
    out.push(segment);
  }
  if (out.length > rules.maxDepth) {
    throw makeError(`${capitalise(rules.noun)} folders nest at most ${rules.maxDepth} deep`);
  }
  return out.join('/');
}

/**
 * Normalise a folder an existing item already carries (a transfer's source
 * folder, which the Scriptorium may have made by hand): its normal form, or
 * the root when it can't be one.
 */
export function normalizeItemFolderPathOrRoot(rules: ItemFolderRules, input: string | null | undefined): string {
  try {
    return normalizeItemFolderPath(rules, input);
  } catch {
    return '';
  }
}

/** Normalise a folder *name* — one segment, as a rename takes it. */
export function normalizeItemFolderName(
  rules: ItemFolderRules,
  input: string | null | undefined,
  makeError: (message: string) => Error = (message) => new ItemFolderPathError(message),
): string {
  if (input != null && /[\\/]/.test(input)) {
    throw makeError('A folder name may not contain "/"');
  }
  const name = normalizeItemFolderPath(rules, input, makeError);
  if (!name) throw makeError('A folder needs a name');
  return name;
}

/**
 * True when `path` is structurally safe to write under the root, whatever its
 * spelling: no empty, `.` or `..` segment, no backslash, not under a reserved
 * first-level segment, within the path cap. Every folder the reader can
 * produce from a real store passes — including hand-made ones the normaliser
 * would respell — while an imported `../x` does not.
 */
export function isSafeItemFolderPath(rules: ItemFolderRules, path: string): boolean {
  if (path === '') return true;
  if (path.length > 900 || path.includes('\\')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s.length === 0 || s.trim() !== s || s === '.' || s === '..')) return false;
  return !isReservedItemFolderSegment(rules, segments[0]);
}

/**
 * Resolve an operator's requested folder against the folders a tier already
 * has. A folder that exists (in any casing) is answered exactly as stored.
 * Otherwise the longest existing ancestor keeps its stored spelling and only
 * the new remainder is normalised (and the whole must stay within the cap).
 */
export function resolveItemFolder(
  rules: ItemFolderRules,
  existing: readonly string[],
  requested: string | null | undefined,
  makeError: (message: string) => Error = (message) => new ItemFolderPathError(message),
): string {
  const raw = (requested ?? '')
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (raw.length === 0) return '';

  const byKey = new Map(existing.map((path) => [path.toLowerCase(), path]));
  for (let depth = raw.length; depth > 0; depth--) {
    const stored = byKey.get(raw.slice(0, depth).join('/').toLowerCase());
    if (!stored) continue;
    if (depth === raw.length) return stored;
    const rest = normalizeItemFolderPath(rules, raw.slice(depth).join('/'), makeError);
    const joined = joinFolder(stored, rest);
    if (folderSegments(joined).length > rules.maxDepth) {
      throw makeError(`${capitalise(rules.noun)} folders nest at most ${rules.maxDepth} deep`);
    }
    return joined;
  }
  return normalizeItemFolderPath(rules, raw.join('/'), makeError);
}

/** True when `path` is already in normal form. */
export function isValidItemFolderPath(rules: ItemFolderRules, path: string): boolean {
  try {
    return normalizeItemFolderPath(rules, path) === path;
  } catch {
    return false;
  }
}

/**
 * The folder a document under the root lives in: `Root/A/B/x.md` → `A/B`,
 * `Root/x.md` → `''`. A path outside the root reads as the root.
 */
export function folderOfItemPath(rules: ItemFolderRules, relativePath: string): string {
  const prefix = `${rules.root}/`;
  if (!relativePath.toLowerCase().startsWith(prefix.toLowerCase())) return '';
  const rest = relativePath.slice(prefix.length);
  const slash = rest.lastIndexOf('/');
  return slash < 0 ? '' : rest.slice(0, slash);
}

/** The store path of a folder: `''` → `Root`, `A/B` → `Root/A/B`. */
export function itemFolderStorePath(rules: ItemFolderRules, folder: string): string {
  return folder ? `${rules.root}/${folder}` : rules.root;
}

/**
 * The folder path under the root for a store folder path, or null when the
 * path is the root itself, outside it, or under a reserved first segment.
 */
export function folderUnderItemRoot(rules: ItemFolderRules, storePath: string): string | null {
  const prefix = `${rules.root}/`;
  if (!storePath.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const folder = storePath.slice(prefix.length);
  if (!folder) return null;
  if (isReservedItemFolderSegment(rules, folderSegments(folder)[0])) return null;
  return folder;
}

/**
 * True for a document path that can hold an item: a file ending `ext`
 * anywhere under the root, except under a reserved first-level segment
 * (`images/`) and except a file named `skipFileName` (case-insensitive) at
 * any depth. Content is not consulted — see each tier's document predicate.
 */
export function isItemDocumentPath(
  rules: ItemFolderRules,
  relativePath: string,
  ext: string,
  skipFileName?: (fileName: string) => boolean,
): boolean {
  const prefix = `${rules.root}/`.toLowerCase();
  const pathLower = relativePath.toLowerCase();
  if (!pathLower.startsWith(prefix)) return false;
  const rest = pathLower.slice(prefix.length);
  if (rest.length === 0 || !rest.endsWith(ext.toLowerCase())) return false;
  const segments = rest.split('/');
  if (segments.some((segment) => segment.length === 0)) return false;
  if (segments.length > 1 && isReservedItemFolderSegment(rules, segments[0])) return false;
  return !(skipFileName && skipFileName(segments[segments.length - 1]));
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

function capitalise(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}
