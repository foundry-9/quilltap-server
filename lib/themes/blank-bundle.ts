/**
 * A blank version 2 theme bundle: the files a new theme starts from.
 *
 * The one place a blank bundle is made. The Atelier's `createDraft` writes
 * these files into a new draft, and `quilltap themes create` (through the
 * CLI's engine bundle, `lib/themes/cli/index.ts`) writes them into a new
 * directory, so a theme begun at the command line is the same document set
 * as one begun in the Atelier.
 *
 * A blank theme is the default theme: an empty tokens document. Both files
 * name their published schema, and the manifest carries the current hook
 * catalogue version.
 *
 * Pure: no store, no logger, no Node built-ins.
 *
 * @module themes/blank-bundle
 */

import { HOOK_CATALOGUE_VERSION } from './hooks';
import { THEME_MANIFEST_SCHEMA_URL, THEME_TOKENS_SCHEMA_URL } from './schemas';

/** The version a new theme starts at. */
export const BLANK_THEME_VERSION = '0.1.0';

/** The manifest's file name and the tokens document's, as a blank bundle names them. */
export const BLANK_THEME_MANIFEST_FILE = 'theme.json';
export const BLANK_THEME_TOKENS_FILE = 'tokens.json';

export interface BlankThemeFile {
  /** Path inside the bundle. */
  path: string;
  text: string;
}

/**
 * A theme id from a name, as the Atelier derives one: lowercase, hyphenated,
 * starting with a letter, at most 56 characters.
 */
export function themeIdFromName(name: string): string {
  let slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = 'theme';
  if (!/^[a-z]/.test(slug)) slug = `theme-${slug}`;
  return slug.slice(0, 56).replace(/-+$/, '');
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The files of a blank theme with this id and name, in write order: the
 * manifest last, since a folder with a `theme.json` is a theme (a draft
 * interrupted part-way never lists as a broken one).
 */
export function blankThemeBundle({ id, name }: { id: string; name: string }): BlankThemeFile[] {
  const tokens = {
    $schema: THEME_TOKENS_SCHEMA_URL,
    primitives: {},
    tokens: {},
    choices: {},
  };
  const manifest = {
    $schema: THEME_MANIFEST_SCHEMA_URL,
    format: 'qtap-theme',
    formatVersion: 2,
    id,
    name,
    version: BLANK_THEME_VERSION,
    author: 'Anonymous',
    supportsDarkMode: true,
    tokensPath: BLANK_THEME_TOKENS_FILE,
    hooksVersion: HOOK_CATALOGUE_VERSION,
  };
  return [
    { path: BLANK_THEME_TOKENS_FILE, text: jsonText(tokens) },
    { path: BLANK_THEME_MANIFEST_FILE, text: jsonText(manifest) },
  ];
}
