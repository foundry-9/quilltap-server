/**
 * The own-vault core guard — which parts of a character's OWN vault the doc
 * tools keep from a character without `systemTransparency`.
 *
 * An opaque character may work in her own vault the way she works in any other
 * store she can reach, except for the files that make her who she is: every
 * root-level file (identity, description, manifesto, personality, physical
 * description, properties, metadata, …) and the managed folders below. She may
 * make, fill, rename and delete folders of her own at the root, and everything
 * else under a non-core folder — Scenarios, Knowledge, Tools, lore, files, and
 * whatever she makes — is hers to use.
 *
 * Pure and client-safe. The doc-tool gates (`lib/doc-edit/path-resolver.ts`,
 * `lib/tools/handlers/doc-edit/shared.ts`) are the callers; nothing else should
 * re-derive the rule.
 *
 * @module characters/vault/core-guard
 */

import { CHARACTER_PROMPTS_FOLDER } from './paths';

/**
 * Root folders of a character vault that an opaque character may neither read
 * nor change through the doc tools. Matched case-insensitively against the
 * first path segment. The wardrobe, inventory and mail have their own tools
 * (`wardrobe_*`, `inventory_*`, the Post Office), which this guard does not
 * touch; `images/` holds the avatar and the photo gallery, reached through
 * `keep_image` / `list_images`.
 */
export const CHARACTER_VAULT_CORE_FOLDERS: readonly string[] = [
  CHARACTER_PROMPTS_FOLDER,
  'Wardrobe',
  'Outfits',
  'Inventory',
  'Atlas',
  'Mail',
  'images',
];

const CORE_FOLDER_KEYS = new Set(CHARACTER_VAULT_CORE_FOLDERS.map((f) => f.toLowerCase()));

/**
 * What the caller means to do at a path.
 * - `file`: read, write, create, delete or move a document or blob.
 * - `folder`: create, delete or move a folder.
 * - `list`: enumerate a folder's contents (the root may be listed; its core
 *   entries are filtered out with {@link isOwnVaultEntryHidden}).
 */
export type OwnVaultOperation = 'file' | 'folder' | 'list';

/** Split a store-relative path into its non-empty segments. */
export function ownVaultPathSegments(relativePath: string): string[] {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
}

/** True when the path is, or lies under, one of the core folders. */
export function isUnderCoreFolder(relativePath: string): boolean {
  const [first] = ownVaultPathSegments(relativePath);
  return first !== undefined && CORE_FOLDER_KEYS.has(first.toLowerCase());
}

/**
 * True when the operation at this path touches the vault's core and must be
 * refused for an opaque character in her own vault.
 */
export function isOwnVaultCorePath(relativePath: string, operation: OwnVaultOperation): boolean {
  const segments = ownVaultPathSegments(relativePath);
  if (isUnderCoreFolder(relativePath)) return true;
  switch (operation) {
    case 'file':
      // Root-level files are the character's own definition.
      return segments.length <= 1;
    case 'folder':
      // The root itself is not a folder she may create, delete or move.
      return segments.length === 0;
    case 'list':
      return false;
  }
}

/**
 * True when a listing or search entry in her own vault must be left out:
 * a root-level file, a core folder, or anything beneath one.
 */
export function isOwnVaultEntryHidden(relativePath: string, kind: 'file' | 'folder'): boolean {
  return isOwnVaultCorePath(relativePath, kind === 'folder' ? 'folder' : 'file');
}

/** The refusal an opaque character hears. Names the boundary so a model stops retrying. */
export function ownVaultCoreRefusal(relativePath: string): string {
  const shown = relativePath === '' ? '(the vault root)' : relativePath;
  return (
    `"${shown}" is part of the core of your own vault, which is closed to you: its root-level files ` +
    `and the ${CHARACTER_VAULT_CORE_FOLDERS.join(', ')} folders. ` +
    `Work in a folder of your own (Scenarios, Knowledge, Tools, or one you create) instead.`
  );
}
