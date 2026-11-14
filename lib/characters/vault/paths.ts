/**
 * The character vault's file and folder names.
 *
 * Split out of `layout.ts` so client code (field semantics, the Aurora
 * generators) can name a vault file without pulling the layout's parsers —
 * and through them `node:crypto` — into the browser bundle. `layout.ts`
 * re-exports every name here; server code may import from either.
 *
 * @module characters/vault/paths
 */

export const CHARACTER_PROPERTIES_JSON_PATH = 'properties.json';
export const CHARACTER_METADATA_JSON_PATH = 'metadata.json';
export const CHARACTER_IDENTITY_MD_PATH = 'identity.md';
export const CHARACTER_DESCRIPTION_MD_PATH = 'description.md';
export const CHARACTER_MANIFESTO_MD_PATH = 'manifesto.md';
export const CHARACTER_PERSONALITY_MD_PATH = 'personality.md';
export const CHARACTER_EXAMPLE_DIALOGUES_MD_PATH = 'example-dialogues.md';
export const CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH = 'physical-description.md';
export const CHARACTER_PHYSICAL_PROMPTS_JSON_PATH = 'physical-prompts.json';
/** A single-file path the layout owns. */
export type CharacterVaultFilePath =
  | typeof CHARACTER_PROPERTIES_JSON_PATH
  | typeof CHARACTER_METADATA_JSON_PATH
  | typeof CHARACTER_IDENTITY_MD_PATH
  | typeof CHARACTER_DESCRIPTION_MD_PATH
  | typeof CHARACTER_MANIFESTO_MD_PATH
  | typeof CHARACTER_PERSONALITY_MD_PATH
  | typeof CHARACTER_EXAMPLE_DIALOGUES_MD_PATH
  | typeof CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH
  | typeof CHARACTER_PHYSICAL_PROMPTS_JSON_PATH;
export const CHARACTER_PROMPTS_FOLDER = 'Prompts';
export const CHARACTER_SCENARIOS_FOLDER = 'Scenarios';
/** The legacy (pre-folder) wardrobe file. Read, never written; kept by the archive. */
export const CHARACTER_WARDROBE_JSON_PATH = 'wardrobe.json';
