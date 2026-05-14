/**
 * Character Properties Overlay
 *
 * Applies the per-character `readPropertiesFromDocumentStore` switch: when a
 * character has the flag on and a linked vault, selected fields are read from
 * the vault's files instead of the DB row.
 *
 * Nine vault targets participate, each independently:
 *
 *   - properties.json          — pronouns, aliases, title, firstMessage, talkativeness
 *   - identity.md              — character.identity
 *   - description.md           — character.description
 *   - personality.md           — character.personality
 *   - example-dialogues.md     — character.exampleDialogues
 *   - physical-description.md  — physicalDescriptions[0].fullDescription
 *   - physical-prompts.json    — physicalDescriptions[0].{short,medium,long,complete}Prompt
 *   - Wardrobe/*.md            — wardrobe items (one file per item, frontmatter
 *                                 carries id/title/types/appropriateness/
 *                                 componentItems/etc.; body is the freeform
 *                                 description). Applied by the wardrobe
 *                                 repository. Composite items reference their
 *                                 components via the `componentItems:` slug
 *                                 array (slug-first, UUID fallback). The
 *                                 retired `Outfits/` folder is tolerated on
 *                                 read but no longer parsed; a separate
 *                                 migration step cleans it up.
 *   - Prompts/*.md             — character.systemPrompts (one file per variant,
 *                                 YAML frontmatter carries {name, isDefault})
 *   - Scenarios/*.md           — character.scenarios (one file per scenario,
 *                                 first `# heading` is the title)
 *
 * Each file's overlay is all-or-nothing for the fields it owns. If the file is
 * missing, malformed, or fails schema validation, that file's fields fall back
 * to the DB (other files are unaffected). Empty markdown files map `''` → null
 * so nullable fields retain their "unset" semantics.
 *
 * Prompts/ and Scenarios/ overlays enumerate top-level `.md` files only; nested
 * paths are ignored. When either directory exists and contains at least one
 * valid file, the vault listing fully replaces the DB array (all-or-nothing
 * per directory). An empty directory falls back to the DB.
 *
 * IDs for synthesized systemPrompts/scenarios entries are derived deterministically
 * from (mountPointId, relativePath) via SHA-256 so the chat's stored
 * `selectedSystemPromptId` / `defaultScenarioId` survives across overlay reads
 * as long as the filename doesn't change.
 *
 * The physical-description.md and physical-prompts.json overlays only apply when
 * the character already has at least one physicalDescription in the DB; they
 * target index 0 (the default). Characters with an empty `physicalDescriptions`
 * array are not extended synthetically.
 *
 * The overlay is applied at the CharactersRepository layer so every read path
 * (findById/findAll/findByUserId/findByIds/findByFilter/etc.) sees overlaid
 * values transparently. Exports and the vault populator bypass via the
 * repository's `Raw` helpers.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import { PronounsSchema } from '@/lib/schemas/character.types';
import {
  WardrobeItemSchema,
  WardrobeItemTypeEnum,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  buildSystemPromptFile,
  buildScenarioFile,
  buildWardrobeItemFile,
  buildSlugByItemIdMap,
  slugifyWardrobeTitle,
  sanitizeFileName,
  renderPhysicalPromptsJson,
  CHARACTER_WARDROBE_FOLDER,
} from '@/lib/mount-index/character-vault';
import type { DocMountDocument } from '@/lib/schemas/mount-index.types';

// Mirrors the nullability of the underlying Character schema so that a vault
// whose properties.json carries null `title` / `firstMessage` (the normal
// state when those fields are unset in the DB) does not silently fail
// validation and fall back to the DB for all five fields.
export const CharacterVaultPropertiesSchema = z.object({
  pronouns: PronounsSchema.nullable(),
  aliases: z.array(z.string()),
  title: z.string().nullable(),
  firstMessage: z.string().nullable(),
  talkativeness: z.number().min(0.1).max(1.0),
  // Optional so vaults written by older Quilltap versions still parse cleanly;
  // missing in the file → leave the DB row's value untouched on read.
  systemTransparency: z.boolean().nullable().optional(),
});

export type CharacterVaultProperties = z.infer<typeof CharacterVaultPropertiesSchema>;

export const CharacterVaultPhysicalPromptsSchema = z.object({
  short: z.string().nullable(),
  medium: z.string().nullable(),
  long: z.string().nullable(),
  complete: z.string().nullable(),
});

export type CharacterVaultPhysicalPrompts = z.infer<typeof CharacterVaultPhysicalPromptsSchema>;

// Snapshot of a vault's wardrobe state — composite items live alongside leaf
// items in the same list and reference their components via
// `componentItemIds`. Returned from the folder-based reader; the legacy JSON
// parser produces the same shape so callers don't have to care which file
// layout the vault is on.
export interface CharacterVaultWardrobe {
  items: WardrobeItem[];
}

// The legacy JSON shape we still parse on migration. New vaults never write
// this; the folder format is authoritative going forward. Pre-rework vaults
// included a `presets` array that is now ignored — the migration step folds
// those into composite wardrobe items, so honoring it here would double-write.
const LegacyVaultWardrobeJsonSchema = z.object({
  items: z.array(WardrobeItemSchema),
  outfit: z
    .object({
      top: z.string().nullable().optional(),
      bottom: z.string().nullable().optional(),
      footwear: z.string().nullable().optional(),
      accessories: z.string().nullable().optional(),
    })
    .optional(),
});

/**
 * The relative paths of the overlay documents inside a character vault.
 * Mirrors `populateVaultWithCharacterData()` in character-vault.ts.
 */
export const CHARACTER_PROPERTIES_JSON_PATH = 'properties.json';
export const CHARACTER_IDENTITY_MD_PATH = 'identity.md';
export const CHARACTER_DESCRIPTION_MD_PATH = 'description.md';
export const CHARACTER_MANIFESTO_MD_PATH = 'manifesto.md';
export const CHARACTER_PERSONALITY_MD_PATH = 'personality.md';
export const CHARACTER_EXAMPLE_DIALOGUES_MD_PATH = 'example-dialogues.md';
export const CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH = 'physical-description.md';
export const CHARACTER_PHYSICAL_PROMPTS_JSON_PATH = 'physical-prompts.json';
export const CHARACTER_WARDROBE_JSON_PATH = 'wardrobe.json';

export const CHARACTER_PROMPTS_FOLDER = 'Prompts';
export const CHARACTER_SCENARIOS_FOLDER = 'Scenarios';
export { CHARACTER_WARDROBE_FOLDER };

const SINGLE_FILE_OVERLAY_PATHS = [
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
] as const;

// ============================================================================
// VAULT FIELD DESCRIPTORS
//
// Single source of truth for "which character fields live in which vault file."
// Drives both the write overlay (route patches to the right file) and the
// generic vault readers used by the sync-back action. The existing batched
// read overlay still operates on the raw paths above, but its conceptual
// mapping mirrors this table 1:1 — keep them in sync when adding a managed
// field.
// ============================================================================

export type CharacterVaultDescriptor =
  | {
      kind: 'markdown';
      vaultPath: string;
      field: 'identity' | 'description' | 'manifesto' | 'personality' | 'exampleDialogues';
    }
  | { kind: 'physical-md'; vaultPath: string }
  | { kind: 'physical-json'; vaultPath: string }
  | { kind: 'properties-json'; vaultPath: string }
  | { kind: 'prompts-dir'; vaultFolder: string }
  | { kind: 'scenarios-dir'; vaultFolder: string };

export const CHARACTER_VAULT_DESCRIPTORS: readonly CharacterVaultDescriptor[] = [
  { kind: 'properties-json', vaultPath: CHARACTER_PROPERTIES_JSON_PATH },
  { kind: 'markdown', vaultPath: CHARACTER_IDENTITY_MD_PATH, field: 'identity' },
  { kind: 'markdown', vaultPath: CHARACTER_DESCRIPTION_MD_PATH, field: 'description' },
  { kind: 'markdown', vaultPath: CHARACTER_MANIFESTO_MD_PATH, field: 'manifesto' },
  { kind: 'markdown', vaultPath: CHARACTER_PERSONALITY_MD_PATH, field: 'personality' },
  { kind: 'markdown', vaultPath: CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, field: 'exampleDialogues' },
  { kind: 'physical-md', vaultPath: CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH },
  { kind: 'physical-json', vaultPath: CHARACTER_PHYSICAL_PROMPTS_JSON_PATH },
  { kind: 'prompts-dir', vaultFolder: CHARACTER_PROMPTS_FOLDER },
  { kind: 'scenarios-dir', vaultFolder: CHARACTER_SCENARIOS_FOLDER },
];

// Top-level Character keys whose writes are routed to the vault when overlay is
// on. physicalDescriptions is included because the overlay owns
// physicalDescriptions[0] — the write overlay only patches index 0 and leaves
// the rest of the array untouched on the DB row.
export const MANAGED_FIELDS: ReadonlySet<keyof Character> = new Set<keyof Character>([
  'identity',
  'description',
  'manifesto',
  'personality',
  'exampleDialogues',
  'pronouns',
  'aliases',
  'title',
  'firstMessage',
  'talkativeness',
  'systemTransparency',
  'physicalDescriptions',
  'systemPrompts',
  'scenarios',
]);

/**
 * Returns true if this character is a candidate for the overlay. A candidate
 * has the switch on AND a linked vault.
 */
function isOverlayCandidate(character: Character): boolean {
  return !!character.readPropertiesFromDocumentStore && !!character.characterDocumentMountPointId;
}

function parseVaultProperties(
  raw: string,
  characterId: string,
): CharacterVaultProperties | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in vault properties.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = CharacterVaultPropertiesSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Vault properties.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

function parseVaultPhysicalPrompts(
  raw: string,
  characterId: string,
): CharacterVaultPhysicalPrompts | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in vault physical-prompts.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = CharacterVaultPhysicalPromptsSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Vault physical-prompts.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

/**
 * Parse the legacy `wardrobe.json` payload — kept for migration so vaults that
 * shipped on the old format aren't lost when they're first read or refreshed
 * onto the folder layout. Returns just `{ items }`; the legacy `presets` array
 * is ignored here (the database-side migration folds presets into composite
 * wardrobe items, so honoring them on read would double-write), and the
 * legacy `outfit` placeholder is dropped on the floor (it was never consumed
 * by anything).
 */
function parseLegacyWardrobeJson(
  raw: string,
  characterId: string,
): CharacterVaultWardrobe | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn('Invalid JSON in legacy vault wardrobe.json; falling back to DB values', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = LegacyVaultWardrobeJsonSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Legacy vault wardrobe.json failed schema validation; falling back to DB values', {
      characterId,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return { items: parsed.data.items };
}

/**
 * Convert markdown file content into an overlay value. Empty strings become
 * null so that clearing a file collapses to the "unset" state that nullable
 * schema fields expect.
 */
function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/**
 * Build a stable, RFC 4122 v8-style UUID from a SHA-256 digest of the source
 * string. v8 is the "custom" version reserved for implementation-specific
 * content; we use it so the `z.uuid()` schema accepts the string without us
 * having to implement true v5 (which requires SHA-1). The exact version byte
 * is not load-bearing — we just need a stable string that parses as a UUID
 * and will always round-trip to itself for the same input.
 */
function stableUuidFromString(source: string): string {
  const hash = crypto.createHash('sha256').update(source).digest();
  const bytes = Buffer.alloc(16);
  hash.copy(bytes, 0, 0, 16);
  // Set version to 8 (custom) in byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  // Set variant to RFC 4122 in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parse a prompt-variant file. The YAML frontmatter carries the display name
 * and isDefault flag; the body (after the closing ---) becomes the prompt
 * content. Files without frontmatter or without a `name` field are skipped.
 */
function parsePromptFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterSystemPrompt | null {
  const parsed = parseFrontmatter(doc.content);
  if (!parsed.data) {
    logger.warn('Prompts/*.md file has no parseable frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const name = parsed.data.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    logger.warn('Prompts/*.md file missing `name` in frontmatter; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  const isDefault = parsed.data.isDefault === true;
  const body = doc.content.slice(parsed.bodyStartOffset).trimStart();
  if (body.length === 0) {
    logger.warn('Prompts/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`prompt:${doc.mountPointId}:${doc.relativePath}`),
    name: name.trim().slice(0, 100),
    content: body,
    isDefault,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Parse a `Wardrobe/<title>.md` file. Frontmatter carries the structured
 * fields (id, title, types, appropriateness, default flag, archive flag,
 * componentItems, timestamps); the body is the freeform description.
 * Hand-edited files may omit `id` and timestamps — both are filled in on the
 * next sync.
 *
 * Returns null when the file can't yield a valid `WardrobeItem` (no usable
 * title, no valid types, etc.) so the read overlay keeps falling back to the
 * DB value for that single file rather than blowing up the whole list.
 *
 * `componentItemIds` is initially populated with the raw refs from the file
 * (slug or UUID strings, in author-given order). The caller is responsible
 * for resolving these to canonical UUIDs against the freshly-built itemBySlug
 * / itemById maps once every item in the folder has been parsed; see
 * `resolveAndCheckComponentItems` below.
 */
function parseWardrobeItemFile(
  doc: DocMountDocument,
  characterId: string,
): WardrobeItem | null {
  const parsed = parseFrontmatter(doc.content);

  let title: string | null = null;
  if (parsed.data) {
    const t = parsed.data.title;
    if (typeof t === 'string' && t.trim().length > 0) {
      title = t.trim();
    }
  }
  const afterFrontmatter = doc.content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;
  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }
  if (title === null) {
    title = doc.fileName.replace(/\.md$/i, '').trim();
  }
  if (title.length === 0) {
    logger.warn('Wardrobe/*.md file has no usable title; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }

  const types = parseWardrobeTypesField(parsed.data?.types);
  if (types === null) {
    logger.warn('Wardrobe/*.md frontmatter has no valid `types` list; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
      raw: parsed.data?.types,
    });
    return null;
  }

  const id =
    typeof parsed.data?.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.data.id as string)
      ? (parsed.data.id as string)
      : stableUuidFromString(`wardrobe-item:${doc.mountPointId}:${doc.relativePath}`);

  const appropriateness =
    typeof parsed.data?.appropriateness === 'string' && parsed.data.appropriateness.length > 0
      ? (parsed.data.appropriateness as string)
      : null;

  const isDefault =
    parsed.data?.default === true || parsed.data?.isDefault === true;

  let archivedAt: string | null = null;
  const archivedAtRaw = parsed.data?.archivedAt;
  if (typeof archivedAtRaw === 'string' && archivedAtRaw.length > 0) {
    archivedAt = archivedAtRaw;
  } else if (parsed.data?.archived === true) {
    archivedAt = doc.updatedAt;
  }

  const migratedFromClothingRecordId =
    typeof parsed.data?.migratedFromClothingRecordId === 'string'
      ? (parsed.data.migratedFromClothingRecordId as string)
      : null;

  // Raw componentItems refs (slug or UUID strings). We deliberately store
  // these as-written into componentItemIds; `resolveAndCheckComponentItems`
  // rewrites them to canonical UUIDs in a second pass once the slug/id maps
  // exist. Treating them as UUIDs here would force per-item resolution and
  // re-thread the parser through the lookup maps.
  const componentItemIdsRaw = parseComponentItemsField(parsed.data?.componentItems);

  const createdAt =
    typeof parsed.data?.createdAt === 'string'
      ? (parsed.data.createdAt as string)
      : doc.createdAt;
  const updatedAt =
    typeof parsed.data?.updatedAt === 'string'
      ? (parsed.data.updatedAt as string)
      : doc.updatedAt;

  const bodyText = (titleLineIndex >= 0
    ? lines.slice(titleLineIndex + 1).join('\n')
    : afterFrontmatter
  ).trim();
  const description = bodyText.length > 0 ? bodyText : null;

  return {
    id,
    characterId,
    title: title.slice(0, 200),
    description,
    types,
    appropriateness,
    isDefault,
    componentItemIds: componentItemIdsRaw,
    migratedFromClothingRecordId,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

/**
 * Parse the `componentItems:` frontmatter array. Accepts a list of strings
 * (slug or UUID); anything else is dropped with a warning-level no-op (the
 * caller logs once at file scope rather than on every entry). Empty/missing
 * arrays return `[]` so leaf items get the canonical empty value.
 */
function parseComponentItemsField(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function parseWardrobeTypesField(raw: unknown): WardrobeItemType[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const allowed = new Set(WardrobeItemTypeEnum.options);
  const out: WardrobeItemType[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') return null;
    if (!allowed.has(v as WardrobeItemType)) return null;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as WardrobeItemType);
  }
  return out.length > 0 ? out : null;
}

/**
 * Resolve the raw `componentItems:` strings that `parseWardrobeItemFile`
 * stashed on each item into canonical UUIDs, then run a cycle check across
 * the resolved list. Items whose composites would form a cycle have their
 * `componentItemIds` cleared (read-tolerant — the item itself stays so the
 * user doesn't lose a hand-edit, but the bad reference is dropped). Unknown
 * refs (no slug or UUID match) are logged and dropped from that item's list.
 *
 * Mutates `items` in place because the array is freshly built by the caller
 * and not yet exposed elsewhere.
 */
function resolveAndCheckComponentItems(
  items: WardrobeItem[],
  itemBySlug: ReadonlyMap<string, WardrobeItem>,
  itemById: ReadonlyMap<string, WardrobeItem>,
  characterId: string,
  mountPointId: string,
): void {
  // First pass — slug/UUID → canonical UUID, dropping unknown refs.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const resolved: string[] = [];
    for (const ref of item.componentItemIds) {
      const bySlug = itemBySlug.get(ref);
      if (bySlug) {
        resolved.push(bySlug.id);
        continue;
      }
      const byId = itemById.get(ref);
      if (byId) {
        resolved.push(byId.id);
        continue;
      }
      logger.warn('Wardrobe item references unknown component; dropping ref', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        ref,
      });
    }
    item.componentItemIds = resolved;
  }

  // Second pass — cycle check using the now-resolved IDs. A cycle in the
  // declared graph wipes that item's components rather than the item itself,
  // so the user doesn't lose anything irrecoverable to a vault edit slip.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const cycles = detectComponentCycles(item.id, item.componentItemIds, itemById);
    if (cycles.length > 0) {
      logger.warn('Wardrobe item declares a component cycle in vault; dropping its components', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        cycles,
      });
      item.componentItemIds = [];
    }
  }
}

/**
 * Parse a scenario file. Frontmatter — when present — supplies `name` (title)
 * and `description`; the body after the closing `---` becomes the scenario
 * content. When no frontmatter is present, falls back to the legacy heading
 * convention: the first `# heading` is the title and everything after it is
 * the body. Files with neither fall back to the filename-without-extension as
 * the title so malformed files are still visible rather than silently dropped.
 *
 * Project Scenarios in `lib/mount-index/project-scenarios.ts` use the same
 * shape (frontmatter-first, heading-fallback) for symmetry between vault and
 * project scenario authoring.
 */
function parseScenarioFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterScenario | null {
  const content = doc.content;
  const parsed = parseFrontmatter(content);

  // Title resolution — frontmatter `name` wins, then first `# heading`,
  // then filename-without-extension.
  let title: string | null = null;
  let frontmatterDescription: string | undefined;

  if (parsed.data) {
    const name = parsed.data.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      title = name.trim();
    }
    const description = parsed.data.description;
    if (typeof description === 'string' && description.trim().length > 0) {
      frontmatterDescription = description.trim().slice(0, 500);
    }
  }

  // Body excludes the frontmatter block (parsed.bodyStartOffset is 0 when
  // no frontmatter was present, so this is safe in either case).
  const afterFrontmatter = content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;

  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }

  if (title === null) {
    const fileName = doc.fileName.replace(/\.md$/i, '');
    title = fileName.trim().slice(0, 200);
    if (title.length === 0) {
      logger.warn('Scenarios/*.md file has no title; skipping', {
        characterId,
        mountPointId: doc.mountPointId,
        relativePath: doc.relativePath,
      });
      return null;
    }
  }

  // Body: when a `# heading` was used as the title, drop that line; otherwise
  // use everything after the frontmatter block.
  let body: string;
  if (titleLineIndex >= 0) {
    body = lines.slice(titleLineIndex + 1).join('\n').trim();
  } else {
    body = afterFrontmatter.trim();
  }
  if (body.length === 0) {
    logger.warn('Scenarios/*.md body is empty; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: stableUuidFromString(`scenario:${doc.mountPointId}:${doc.relativePath}`),
    title: title.slice(0, 200),
    content: body,
    ...(frontmatterDescription !== undefined && { description: frontmatterDescription }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Apply the vault file overlay to a list of characters. Characters not flagged
 * for overlay (switch off OR no linked vault) are returned unchanged. Batched:
 * performs one IN(...) query per vault path plus two directory listings.
 */
export async function applyDocumentStoreOverlay(
  characters: Character[],
): Promise<Character[]> {
  if (characters.length === 0) {
    return characters;
  }

  const candidates = characters.filter(isOverlayCandidate);
  if (candidates.length === 0) {
    return characters;
  }

  const mountPointIds = Array.from(
    new Set(candidates.map((c) => c.characterDocumentMountPointId as string)),
  );

  const repos = getRepositories();

  const contentByMountByPath = new Map<string, Map<string, string>>();
  for (const path of SINGLE_FILE_OVERLAY_PATHS) {
    contentByMountByPath.set(path, new Map<string, string>());
  }
  const promptsByMount = new Map<string, DocMountDocument[]>();
  const scenariosByMount = new Map<string, DocMountDocument[]>();

  try {
    const singleFileResults = await Promise.all(
      SINGLE_FILE_OVERLAY_PATHS.map((path) =>
        repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
      ),
    );
    for (let i = 0; i < SINGLE_FILE_OVERLAY_PATHS.length; i++) {
      const path = SINGLE_FILE_OVERLAY_PATHS[i];
      const byMount = contentByMountByPath.get(path)!;
      for (const doc of singleFileResults[i]) {
        byMount.set(doc.mountPointId, doc.content);
      }
    }

    const [promptDocs, scenarioDocs] = await Promise.all([
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_PROMPTS_FOLDER,
        '.md',
      ),
      repos.docMountDocuments.findManyByMountPointsInFolder(
        mountPointIds,
        CHARACTER_SCENARIOS_FOLDER,
        '.md',
      ),
    ]);
    for (const doc of promptDocs) {
      let list = promptsByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        promptsByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
    for (const doc of scenarioDocs) {
      let list = scenariosByMount.get(doc.mountPointId);
      if (!list) {
        list = [];
        scenariosByMount.set(doc.mountPointId, list);
      }
      list.push(doc);
    }
  } catch (error) {
    logger.warn('Failed to load vault files for character overlay; falling back to DB values', {
      error: error instanceof Error ? error.message : String(error),
      mountPointIdCount: mountPointIds.length,
    });
    return characters;
  }

  const propsByMount = contentByMountByPath.get(CHARACTER_PROPERTIES_JSON_PATH)!;
  const idByMount = contentByMountByPath.get(CHARACTER_IDENTITY_MD_PATH)!;
  const descByMount = contentByMountByPath.get(CHARACTER_DESCRIPTION_MD_PATH)!;
  const manifestoByMount = contentByMountByPath.get(CHARACTER_MANIFESTO_MD_PATH)!;
  const persByMount = contentByMountByPath.get(CHARACTER_PERSONALITY_MD_PATH)!;
  const dialoguesByMount = contentByMountByPath.get(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)!;
  const physDescByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)!;
  const physPromptsByMount = contentByMountByPath.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!;

  return characters.map((character) => {
    if (!isOverlayCandidate(character)) {
      return character;
    }
    const mountId = character.characterDocumentMountPointId as string;
    let out: Character = character;

    // properties.json: pronouns, aliases, title, firstMessage, talkativeness, systemTransparency
    const propsRaw = propsByMount.get(mountId);
    if (propsRaw !== undefined) {
      const parsed = parseVaultProperties(propsRaw, character.id);
      if (parsed) {
        out = {
          ...out,
          pronouns: parsed.pronouns,
          aliases: parsed.aliases,
          title: parsed.title,
          firstMessage: parsed.firstMessage,
          talkativeness: parsed.talkativeness,
          // systemTransparency is optional in the vault schema. When absent,
          // preserve the DB value rather than nulling it out.
          ...(parsed.systemTransparency !== undefined
            ? { systemTransparency: parsed.systemTransparency }
            : {}),
        };
      }
    }

    // identity.md
    const idRaw = idByMount.get(mountId);
    if (idRaw !== undefined) {
      out = { ...out, identity: markdownToNullable(idRaw) };
    }

    // description.md
    const descRaw = descByMount.get(mountId);
    if (descRaw !== undefined) {
      out = { ...out, description: markdownToNullable(descRaw) };
    }

    // manifesto.md
    const manifestoRaw = manifestoByMount.get(mountId);
    if (manifestoRaw !== undefined) {
      out = { ...out, manifesto: markdownToNullable(manifestoRaw) };
    }

    // personality.md
    const persRaw = persByMount.get(mountId);
    if (persRaw !== undefined) {
      out = { ...out, personality: markdownToNullable(persRaw) };
    }

    // example-dialogues.md
    const dialoguesRaw = dialoguesByMount.get(mountId);
    if (dialoguesRaw !== undefined) {
      out = { ...out, exampleDialogues: markdownToNullable(dialoguesRaw) };
    }

    // physical-description.md + physical-prompts.json target physicalDescriptions[0]
    const physDescRaw = physDescByMount.get(mountId);
    const physPromptsRaw = physPromptsByMount.get(mountId);
    const hasPhysicalOverlayInput = physDescRaw !== undefined || physPromptsRaw !== undefined;

    if (hasPhysicalOverlayInput) {
      if (!out.physicalDescriptions || out.physicalDescriptions.length === 0) {
      } else {
        const first = out.physicalDescriptions[0];
        const patched: PhysicalDescription = { ...first };

        if (physDescRaw !== undefined) {
          patched.fullDescription = markdownToNullable(physDescRaw);
        }

        if (physPromptsRaw !== undefined) {
          const parsedPrompts = parseVaultPhysicalPrompts(physPromptsRaw, character.id);
          if (parsedPrompts) {
            patched.shortPrompt = parsedPrompts.short;
            patched.mediumPrompt = parsedPrompts.medium;
            patched.longPrompt = parsedPrompts.long;
            patched.completePrompt = parsedPrompts.complete;
          }
        }

        out = {
          ...out,
          physicalDescriptions: [patched, ...out.physicalDescriptions.slice(1)],
        };
      }
    }

    // Prompts/*.md → systemPrompts
    const promptDocs = promptsByMount.get(mountId);
    if (promptDocs && promptDocs.length > 0) {
      const parsedPrompts = promptDocs
        .slice()
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((doc) => parsePromptFile(doc, character.id))
        .filter((p): p is CharacterSystemPrompt => p !== null);
      if (parsedPrompts.length > 0) {
        // Ensure exactly one isDefault. If the frontmatter declares multiple
        // defaults, keep only the first; if none are marked default, promote
        // the first alphabetically so downstream consumers can always pick a
        // default without falling through to the empty-array branch.
        let seenDefault = false;
        const normalized: CharacterSystemPrompt[] = parsedPrompts.map((p) => {
          if (p.isDefault) {
            if (seenDefault) {
              return { ...p, isDefault: false };
            }
            seenDefault = true;
            return p;
          }
          return p;
        });
        if (!seenDefault) {
          normalized[0] = { ...normalized[0], isDefault: true };
        }
        out = { ...out, systemPrompts: normalized };
      }
    }

    // Scenarios/*.md → scenarios
    const scenarioDocs = scenariosByMount.get(mountId);
    if (scenarioDocs && scenarioDocs.length > 0) {
      const parsedScenarios = scenarioDocs
        .slice()
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((doc) => parseScenarioFile(doc, character.id))
        .filter((s): s is CharacterScenario => s !== null);
      if (parsedScenarios.length > 0) {
        out = { ...out, scenarios: parsedScenarios };
      }
    }

    return out;
  });
}

/**
 * Apply the overlay to a single character (or null). Convenience wrapper
 * around the batched function.
 */
export async function applyDocumentStoreOverlayOne(
  character: Character | null,
): Promise<Character | null> {
  if (!character) {
    return character;
  }
  const [overlaid] = await applyDocumentStoreOverlay([character]);
  return overlaid ?? character;
}

/**
 * Read a character's vault properties.json and return a validated snapshot,
 * or null if the file is missing/malformed/invalid. Used by the sync-back
 * action to copy vault values into the DB.
 */
export async function readCharacterVaultProperties(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultProperties | null> {
  const content = await readVaultTextFile(mountPointId, CHARACTER_PROPERTIES_JSON_PATH, characterId);
  if (content === null) return null;
  return parseVaultProperties(content, characterId ?? mountPointId);
}

/**
 * Read the raw markdown content of identity.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultIdentity(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_IDENTITY_MD_PATH, characterId);
}

/**
 * Read the raw markdown content of description.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_DESCRIPTION_MD_PATH, characterId);
}

/**
 * Read the raw markdown content of manifesto.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultManifesto(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_MANIFESTO_MD_PATH, characterId);
}

export async function readCharacterVaultPersonality(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PERSONALITY_MD_PATH, characterId);
}

export async function readCharacterVaultExampleDialogues(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultPhysicalPrompts | null> {
  const content = await readVaultTextFile(
    mountPointId,
    CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
    characterId,
  );
  if (content === null) return null;
  return parseVaultPhysicalPrompts(content, characterId ?? mountPointId);
}

/**
 * Enumerate Prompts/*.md inside a vault and return the parsed prompt array.
 * Returns an empty array if the folder is missing or empty. Invalid files are
 * skipped with a warning. Used by the sync-back action.
 */
export async function readCharacterVaultSystemPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterSystemPrompt[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_PROMPTS_FOLDER,
    '.md',
  );
  const parsed = docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parsePromptFile(doc, characterId ?? mountPointId))
    .filter((p): p is CharacterSystemPrompt => p !== null);
  if (parsed.length === 0) return [];
  let seenDefault = false;
  const normalized: CharacterSystemPrompt[] = parsed.map((p) => {
    if (p.isDefault) {
      if (seenDefault) return { ...p, isDefault: false };
      seenDefault = true;
      return p;
    }
    return p;
  });
  if (!seenDefault) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }
  return normalized;
}

/**
 * Enumerate Scenarios/*.md inside a vault and return the parsed scenario array.
 * Returns an empty array if the folder is missing or empty. Used by the
 * sync-back action.
 */
export async function readCharacterVaultScenarios(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterScenario[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_SCENARIOS_FOLDER,
    '.md',
  );
  return docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parseScenarioFile(doc, characterId ?? mountPointId))
    .filter((s): s is CharacterScenario => s !== null);
}

/**
 * Read a character's vault wardrobe and return a validated snapshot, or null
 * if neither the new folder layout nor the legacy `wardrobe.json` is usable.
 *
 * Read order:
 *   1. `Wardrobe/*.md` (current format). Composite items reference their
 *      components via the `componentItems:` slug array, resolved here against
 *      the in-vault slug map (slug-first, UUID fallback).
 *   2. legacy `wardrobe.json` (still honored so existing vaults don't lose
 *      hand-edits between this change shipping and the migration running).
 *
 * The retired `Outfits/` folder is intentionally not read — pre-rework
 * presets are handled by a separate database-side migration that folds them
 * into composite wardrobe items, so re-parsing them here would double-write.
 * Stale `Outfits/*.md` files left on disk are tolerated; cleanup happens via
 * the migration.
 *
 * Cycle and unknown-ref handling: cycles in the declared component graph
 * wipe the offending item's `componentItemIds` (logged) but leave the item
 * itself intact so vault hand-edits aren't silently destructive. Unknown
 * refs (slug or UUID that doesn't match anything in this vault) are dropped
 * from that item's component list with a warning.
 */
export async function readCharacterVaultWardrobe(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultWardrobe | null> {
  const repos = getRepositories();
  const charId = characterId ?? mountPointId;

  const itemDocs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_WARDROBE_FOLDER,
    '.md',
  );

  if (itemDocs.length > 0) {
    const items = itemDocs
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((doc) => parseWardrobeItemFile(doc, charId))
      .filter((item): item is WardrobeItem => item !== null);

    const itemById = new Map<string, WardrobeItem>();
    const itemBySlug = new Map<string, WardrobeItem>();
    const claimedSlugs = new Set<string>();
    for (const item of items) {
      itemById.set(item.id, item);
      const slug = slugifyWardrobeTitle(item.title);
      if (slug.length === 0 || claimedSlugs.has(slug)) {
        if (slug.length > 0) {
          logger.warn('Wardrobe items share a slug; later item only addressable by UUID', {
            characterId: charId,
            mountPointId,
            slug,
            itemId: item.id,
            title: item.title,
          });
        }
        continue;
      }
      claimedSlugs.add(slug);
      itemBySlug.set(slug, item);
    }

    // Seed shared archetypes into the lookup maps so bundles in this vault can
    // reference them. Without this, refs to shared items (Fitbit, Apple Watch,
    // etc.) get stripped on every read of any outfit that bundles them, since
    // archetypes don't live in the character's vault folder. Personal items
    // win slug collisions; archetypes are pure fallback.
    const hasComponentRefs = items.some((item) => item.componentItemIds.length > 0);
    if (hasComponentRefs) {
      const archetypes = await repos.wardrobe.findArchetypes(true);
      for (const arche of archetypes) {
        if (!itemById.has(arche.id)) {
          itemById.set(arche.id, arche);
        }
        const slug = slugifyWardrobeTitle(arche.title);
        if (slug.length > 0 && !claimedSlugs.has(slug)) {
          claimedSlugs.add(slug);
          itemBySlug.set(slug, arche);
        }
      }
    }

    resolveAndCheckComponentItems(items, itemBySlug, itemById, charId, mountPointId);

    return { items };
  }

  // Folder empty (or missing) — fall through to legacy wardrobe.json so
  // pre-migration vaults still surface their items.
  const legacyContent = await readVaultTextFile(
    mountPointId,
    CHARACTER_WARDROBE_JSON_PATH,
    characterId,
  );
  if (legacyContent === null) return null;
  return parseLegacyWardrobeJson(legacyContent, charId);
}

export interface WardrobeOverlayOptions {
  /** Include items whose archivedAt is non-null. Default false. */
  includeArchived?: boolean;
  /** Only return items with isDefault=true. */
  defaultsOnly?: boolean;
}

/**
 * Overlay a wardrobe-items list read. If the character has
 * `readPropertiesFromDocumentStore` on and a linked vault, the vault's
 * `Wardrobe/*.md` files (or the legacy wardrobe.json on a not-yet-migrated
 * vault) are the source of truth; the caller's DB loader is skipped.
 * Otherwise the DB loader runs and its result is returned.
 *
 * Items parsed from the vault have their `characterId` coerced to the lookup
 * ID — a wardrobe file scoped to one character's vault always belongs to that
 * character, and coercing keeps downstream consumers from tripping over a
 * hand-edited characterId that doesn't match.
 */
export async function getOverlaidWardrobeItems(
  characterId: string,
  loadDbItems: () => Promise<WardrobeItem[]>,
  options: WardrobeOverlayOptions = {},
): Promise<WardrobeItem[]> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !isOverlayCandidate(character)) {
    return loadDbItems();
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) {
    return loadDbItems();
  }

  let items: WardrobeItem[] = vault.items.map((item) => ({
    ...item,
    characterId,
  }));
  if (!options.includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }
  if (options.defaultsOnly) {
    items = items.filter((item) => item.isDefault);
  }

  return items;
}

/**
 * Per-character write chain. The overlay treats the vault Wardrobe/ folder
 * as authoritative on read, so each mutation of wardrobe items must project
 * the new DB state back out into `Wardrobe/*.md`. Composite items emit
 * their `componentItems:` slug arrays in the same projection. Chaining per
 * characterId prevents two concurrent sync calls from each reading a stale
 * DB snapshot and writing files that lose one of the changes.
 */
const wardrobeSyncChains = new Map<string, Promise<void>>();

/**
 * After a wardrobe-item write, re-project the character's DB state into the
 * vault's Wardrobe/ folder. No-ops for archetype rows (characterId null),
 * missing characters, and characters that aren't overlay candidates (flag
 * off or no linked vault).
 *
 * Failures are logged but not propagated — the DB write is already committed,
 * and the next successful sync (or the startup refresh) will reconcile. We'd
 * rather report success and leave a warning in the log than throw and leave
 * the caller to retry into a duplicate DB row.
 *
 * `excludeIds` is a tombstone set of wardrobe-item ids that should not be
 * promoted from vault to DB during the ingestion phase. The delete path uses
 * this so the vault file for the just-deleted row is treated as unmanaged
 * and swept by the projection step. Without it, the ingestion would
 * re-promote the file (preserving the same id), and the delete would be a
 * no-op for vault-overlay characters.
 */
export async function syncCharacterVaultWardrobe(
  characterId: string | null | undefined,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  if (!characterId) return;

  const prev = wardrobeSyncChains.get(characterId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => performVaultWardrobeSync(characterId, excludeIds));
  wardrobeSyncChains.set(characterId, next);
  try {
    await next;
  } finally {
    if (wardrobeSyncChains.get(characterId) === next) {
      wardrobeSyncChains.delete(characterId);
    }
  }
}

async function performVaultWardrobeSync(
  characterId: string,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !isOverlayCandidate(character)) return;

  const mountPointId = character.characterDocumentMountPointId as string;

  try {
    // Promote any vault-only wardrobe items into the DB before projecting
    // back out. The projection sweep deletes any Wardrobe/ file not
    // represented in the DB-derived list, so vault-only files (created by
    // hand or via Document Mode, with no DB row) would get wiped on every
    // sync without this step.
    await ingestVaultOnlyWardrobeIntoDb(mountPointId, characterId, excludeIds);

    const items = await repos.wardrobe.findByCharacterIdRaw(characterId);

    await projectVaultWardrobe(mountPointId, characterId, items);
  } catch (err) {
    logger.error('Failed to sync wardrobe folder from DB; vault is now stale', {
      characterId,
      mountPointId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Read the character's vault wardrobe folder and copy any items that aren't
 * yet in the DB into the DB, preserving their ids and timestamps. The
 * downstream projection sees them as managed rows and leaves their files in
 * place; without this step it would delete them as unmanaged.
 *
 * Items whose id is in `excludeIds` are skipped (and *not* promoted), so the
 * subsequent projection sweep treats their vault files as unmanaged and
 * deletes them. The delete path uses this to make a wardrobe-item delete
 * actually delete on vault-overlay characters.
 *
 * Failures on individual items are logged but don't abort the rest of the
 * ingestion or the sync — losing one item to a validation error is better
 * than rolling back and clobbering the whole vault on the projection step.
 */
async function ingestVaultOnlyWardrobeIntoDb(
  mountPointId: string,
  characterId: string,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const repos = getRepositories();
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) return;

  if (vault.items.length > 0) {
    const dbItems = await repos.wardrobe.findByCharacterIdRaw(characterId, true);
    const dbItemIds = new Set(dbItems.map((i) => i.id));
    for (const item of vault.items) {
      if (dbItemIds.has(item.id)) continue;
      if (excludeIds?.has(item.id)) {
        continue;
      }
      try {
        await repos.wardrobe.createFromVault(item);
        logger.info('Promoted vault-only wardrobe item into DB before sync', {
          characterId,
          mountPointId,
          itemId: item.id,
          title: item.title,
        });
      } catch (err) {
        logger.warn('Failed to promote vault-only wardrobe item into DB; will be deleted by projection', {
          characterId,
          mountPointId,
          itemId: item.id,
          title: item.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Project an authoritative wardrobe-item list into the vault's `Wardrobe/`
 * folder, deleting any stale legacy `wardrobe.json` so the new format is the
 * single source on disk. Composite items emit their `componentItems:` slug
 * arrays via the slug map built here. Shared between the per-write sync
 * chain, the full-character writer, and the startup migration so they all
 * produce the same on-disk shape.
 *
 * The retired `Outfits/` folder is intentionally not touched — pre-rework
 * preset files left on disk are removed by a separate database-side
 * migration, not by every wardrobe sync.
 */
export async function projectVaultWardrobe(
  mountPointId: string,
  characterId: string,
  items: readonly WardrobeItem[],
): Promise<void> {
  const slugByItemId = buildSlugByItemIdMap(items);

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_WARDROBE_FOLDER,
    items,
    (item) => ({
      fileName: `${sanitizeFileName(item.title)}.md`,
      content: buildWardrobeItemFile(item, slugByItemId),
    }),
    characterId,
  );

  // The legacy single-JSON file is always cleaned up after a successful
  // projection so it can't drift back to authoritative-on-read.
  try {
    await deleteDatabaseDocument(mountPointId, CHARACTER_WARDROBE_JSON_PATH);
  } catch (err) {
    if (!(err instanceof DatabaseStoreError && err.code === 'NOT_FOUND')) {
      logger.warn('Failed to delete legacy wardrobe.json after folder projection', {
        characterId,
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function readVaultTextFile(
  mountPointId: string,
  path: string,
  characterId?: string,
): Promise<string | null> {
  try {
    const doc = await readDatabaseDocument(mountPointId, path);
    return doc.content;
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      return null;
    }
    logger.warn('Failed to read vault file', {
      mountPointId,
      path,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// CONSOLIDATED VAULT READERS
//
// Single descriptor-driven entry point that the sync-back action and any
// future "give me everything the vault has for this character" caller can use
// instead of stitching together the nine standalone readCharacterVault*
// helpers above.
// ============================================================================

/**
 * Snapshot of all vault-managed fields for a character, in Character-row
 * shape. Fields whose vault file is missing/malformed are omitted (not set to
 * null), so callers can spread this object into a patch without clobbering
 * unrelated DB-only fields.
 *
 * `physicalDescriptions` is included as the full array (with index 0 patched
 * from physical-description.md / physical-prompts.json) only when the
 * character already has at least one physicalDescription — vault overlay
 * never synthesizes one.
 */
export interface VaultManagedFieldsSnapshot extends Partial<Character> {
  /** True if vault has any physical-* file but the character has no physicalDescriptions to patch. */
  physicalSkippedNoPrimary?: boolean;
}

export async function readCharacterVaultManagedFields(
  mountPointId: string,
  characterId: string,
  existingPhysicalDescriptions: readonly PhysicalDescription[] = [],
): Promise<VaultManagedFieldsSnapshot> {
  const snapshot: VaultManagedFieldsSnapshot = {};

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'properties-json': {
        const props = await readCharacterVaultProperties(mountPointId, characterId);
        if (props) {
          snapshot.pronouns = props.pronouns;
          snapshot.aliases = props.aliases;
          snapshot.title = props.title;
          snapshot.firstMessage = props.firstMessage;
          snapshot.talkativeness = props.talkativeness;
          if (props.systemTransparency !== undefined) {
            snapshot.systemTransparency = props.systemTransparency;
          }
        }
        break;
      }
      case 'markdown': {
        const md = await readVaultTextFile(mountPointId, descriptor.vaultPath, characterId);
        if (md !== null) {
          // Empty file → null so nullable fields keep their unset semantics.
          (snapshot as Record<string, unknown>)[descriptor.field] = md === '' ? null : md;
        }
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Handled together below to keep both files patched onto the same
        // physicalDescriptions[0] copy. We process physical-md first; the
        // physical-json branch is a no-op the second time around.
        if (descriptor.kind === 'physical-md') {
          const physDescMd = await readVaultTextFile(
            mountPointId,
            CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
            characterId,
          );
          const physPromptsJson = await readCharacterVaultPhysicalPrompts(
            mountPointId,
            characterId,
          );
          if (physDescMd === null && physPromptsJson === null) break;
          if (existingPhysicalDescriptions.length === 0) {
            snapshot.physicalSkippedNoPrimary = true;
            break;
          }
          const first = existingPhysicalDescriptions[0];
          const patched: PhysicalDescription = { ...first };
          if (physDescMd !== null) {
            patched.fullDescription = physDescMd === '' ? null : physDescMd;
          }
          if (physPromptsJson !== null) {
            patched.shortPrompt = physPromptsJson.short;
            patched.mediumPrompt = physPromptsJson.medium;
            patched.longPrompt = physPromptsJson.long;
            patched.completePrompt = physPromptsJson.complete;
          }
          patched.updatedAt = new Date().toISOString();
          snapshot.physicalDescriptions = [patched, ...existingPhysicalDescriptions.slice(1)];
        }
        break;
      }
      case 'prompts-dir': {
        const prompts = await readCharacterVaultSystemPrompts(mountPointId, characterId);
        if (prompts.length > 0) {
          snapshot.systemPrompts = prompts;
        }
        break;
      }
      case 'scenarios-dir': {
        const scenarios = await readCharacterVaultScenarios(mountPointId, characterId);
        if (scenarios.length > 0) {
          snapshot.scenarios = scenarios;
        }
        break;
      }
    }
  }

  return snapshot;
}

// ============================================================================
// FULL-CHARACTER VAULT WRITER
//
// Counterpart to readCharacterVaultManagedFields: given a raw (non-overlaid)
// character plus its wardrobe/outfit-preset rows, project every vault-managed
// field out to the vault's files. Used by the sync-properties-to-vault action
// to push the DB row's state into the vault wholesale.
//
// This intentionally writes every managed file (not just a patch), so after a
// successful call the vault is a faithful snapshot of the DB. Prompts/ and
// Scenarios/ folders are reprojected — files that don't correspond to a DB
// entry are deleted so the vault listing matches the DB arrays exactly.
// ============================================================================

export interface VaultManagedFieldsWriteInput {
  character: Character;
  wardrobeItems: readonly WardrobeItem[];
}

export interface VaultManagedFieldsWriteResult {
  /** Number of single-file writes performed (not counting Prompts/ or Scenarios/ folder contents). */
  singleFileWriteCount: number;
  systemPromptsWritten: number;
  scenariosWritten: number;
  wardrobeItemsWritten: number;
  /** True when the character has no physicalDescriptions[0] and the physical-* files were skipped. */
  physicalSkippedNoPrimary: boolean;
}

export async function writeCharacterVaultManagedFields(
  mountPointId: string,
  { character, wardrobeItems }: VaultManagedFieldsWriteInput,
): Promise<VaultManagedFieldsWriteResult> {
  const result: VaultManagedFieldsWriteResult = {
    singleFileWriteCount: 0,
    systemPromptsWritten: 0,
    scenariosWritten: 0,
    wardrobeItemsWritten: 0,
    physicalSkippedNoPrimary: false,
  };

  await writeDatabaseDocument(
    mountPointId,
    CHARACTER_PROPERTIES_JSON_PATH,
    JSON.stringify(
      {
        pronouns: character.pronouns ?? null,
        aliases: character.aliases ?? [],
        title: character.title ?? null,
        firstMessage: character.firstMessage ?? null,
        talkativeness: character.talkativeness ?? 0.5,
        systemTransparency: character.systemTransparency ?? null,
      },
      null,
      2,
    ),
  );
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_IDENTITY_MD_PATH, character.identity ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_DESCRIPTION_MD_PATH, character.description ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_MANIFESTO_MD_PATH, character.manifesto ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_PERSONALITY_MD_PATH, character.personality ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(
    mountPointId,
    CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
    character.exampleDialogues ?? '',
  );
  result.singleFileWriteCount++;

  const primaryPhysical = character.physicalDescriptions?.[0];
  if (primaryPhysical) {
    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
      primaryPhysical.fullDescription ?? '',
    );
    result.singleFileWriteCount++;
    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
      renderPhysicalPromptsJson(primaryPhysical),
    );
    result.singleFileWriteCount++;
  } else {
    result.physicalSkippedNoPrimary = true;
  }

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_PROMPTS_FOLDER,
    character.systemPrompts ?? [],
    (p) => ({
      fileName: `${sanitizeFileName(p.name)}.md`,
      content: buildSystemPromptFile(p),
    }),
    character.id,
  );
  result.systemPromptsWritten = character.systemPrompts?.length ?? 0;

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_SCENARIOS_FOLDER,
    character.scenarios ?? [],
    (s) => ({
      fileName: `${sanitizeFileName(s.title)}.md`,
      content: buildScenarioFile(s),
    }),
    character.id,
  );
  result.scenariosWritten = character.scenarios?.length ?? 0;

  await projectVaultWardrobe(mountPointId, character.id, wardrobeItems);
  result.wardrobeItemsWritten = wardrobeItems.length;

  return result;
}

// ============================================================================
// WRITE OVERLAY
//
// Symmetric counterpart to applyDocumentStoreOverlay: when an update() patch
// includes managed fields and the character is in vault mode, route those
// fields to vault files instead of the DB row. Returns the unmanaged
// remainder so the caller can still do its DB write for the rest.
//
// "Vault is source of truth" semantics: managed fields written here do NOT
// also update the DB column. The DB row stays at the value it held when
// overlay was toggled on. Toggling overlay off restores those frozen DB
// values; the user can run sync-properties-from-vault first to copy recent
// vault edits into the DB before flipping the switch.
// ============================================================================

/**
 * Decide whether a Character-row update needs to be routed to the vault, and
 * if so, write the managed fields and strip them from the DB-bound patch.
 *
 * Returns the portion of `patch` that should go to the DB (unmanaged fields
 * always; managed fields only when the character is not in vault mode).
 *
 * Throws if a vault write fails — the caller should NOT then proceed with the
 * DB write, so that callers can't end up with a partial commit where DB and
 * vault disagree on which fields are "current."
 */
export async function applyDocumentStoreWriteOverlay(
  characterId: string,
  patch: Partial<Character>,
): Promise<Partial<Character>> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    // Caller will hit the same not-found in _update; let it surface there.
    return patch;
  }
  if (!isOverlayCandidate(character)) {
    return patch;
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const dbPatch: Partial<Character> = { ...patch };
  let routedFieldCount = 0;

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'markdown': {
        if (!(descriptor.field in patch)) break;
        const value = patch[descriptor.field] as string | null | undefined;
        await writeDatabaseDocument(mountPointId, descriptor.vaultPath, value ?? '');
        delete dbPatch[descriptor.field];
        routedFieldCount++;
        break;
      }
      case 'properties-json': {
        const propsKeys = ['pronouns', 'aliases', 'title', 'firstMessage', 'talkativeness', 'systemTransparency'] as const;
        const touched = propsKeys.filter((k) => k in patch);
        if (touched.length === 0) break;
        // Read-modify-write so a partial patch doesn't blow away unspecified
        // fields in the same JSON file.
        const current = (await readCharacterVaultProperties(mountPointId, characterId)) ?? {
          pronouns: character.pronouns ?? null,
          aliases: character.aliases ?? [],
          title: character.title ?? null,
          firstMessage: character.firstMessage ?? null,
          talkativeness: character.talkativeness ?? 0.5,
          systemTransparency: character.systemTransparency ?? null,
        };
        const next: CharacterVaultProperties = {
          pronouns: 'pronouns' in patch ? (patch.pronouns ?? null) : current.pronouns,
          aliases: 'aliases' in patch ? (patch.aliases ?? []) : current.aliases,
          title: 'title' in patch ? (patch.title ?? null) : current.title,
          firstMessage:
            'firstMessage' in patch ? (patch.firstMessage ?? null) : current.firstMessage,
          talkativeness:
            'talkativeness' in patch ? (patch.talkativeness ?? 0.5) : current.talkativeness,
          systemTransparency:
            'systemTransparency' in patch ? (patch.systemTransparency ?? null) : (current.systemTransparency ?? null),
        };
        await writeDatabaseDocument(
          mountPointId,
          descriptor.vaultPath,
          JSON.stringify(next, null, 2),
        );
        for (const k of touched) delete dbPatch[k];
        routedFieldCount += touched.length;
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Only routed once, on the physical-md descriptor pass; physical-json
        // is handled in the same write because both target physicalDescriptions[0].
        if (descriptor.kind !== 'physical-md') break;
        if (!('physicalDescriptions' in patch)) break;
        const incoming = patch.physicalDescriptions ?? [];
        if (incoming.length === 0) {
          // The DB array still owns membership; deleting an entry should go to
          // DB, not the vault. Drop the vault overlay only when the new array
          // is non-empty so we don't accidentally clear the file when the
          // caller is just emptying the DB row.
          break;
        }
        const primary = incoming[0];
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
          primary.fullDescription ?? '',
        );
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
          renderPhysicalPromptsJson(primary),
        );
        // Strip primary's overlaid fields from the DB-bound patch so the DB
        // row's index 0 stays frozen at the pre-overlay value. Non-overlaid
        // fields on the primary, plus the rest of the array, still go to DB.
        const dbPrimary: PhysicalDescription = {
          ...primary,
          fullDescription: character.physicalDescriptions?.[0]?.fullDescription ?? null,
          shortPrompt: character.physicalDescriptions?.[0]?.shortPrompt ?? null,
          mediumPrompt: character.physicalDescriptions?.[0]?.mediumPrompt ?? null,
          longPrompt: character.physicalDescriptions?.[0]?.longPrompt ?? null,
          completePrompt: character.physicalDescriptions?.[0]?.completePrompt ?? null,
        };
        dbPatch.physicalDescriptions = [dbPrimary, ...incoming.slice(1)];
        routedFieldCount++;
        break;
      }
      case 'prompts-dir': {
        if (!('systemPrompts' in patch)) break;
        const incoming = patch.systemPrompts ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (p) => ({
            fileName: `${sanitizeFileName(p.name)}.md`,
            content: buildSystemPromptFile(p),
          }),
          characterId,
        );
        delete dbPatch.systemPrompts;
        routedFieldCount++;
        break;
      }
      case 'scenarios-dir': {
        if (!('scenarios' in patch)) break;
        const incoming = patch.scenarios ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (s) => ({
            fileName: `${sanitizeFileName(s.title)}.md`,
            content: buildScenarioFile(s),
          }),
          characterId,
        );
        delete dbPatch.scenarios;
        routedFieldCount++;
        break;
      }
    }
  }

  if (routedFieldCount > 0) {
  }

  return dbPatch;
}

/**
 * Replace a vault folder's contents with a fresh projection of an array.
 * Files corresponding to items in `items` are written; any other files
 * currently in the folder are deleted, so the vault listing matches the
 * incoming array exactly. Naming collisions are disambiguated with
 * `-1`, `-2`, … suffixes.
 */
async function projectArrayIntoVaultFolder<T>(
  mountPointId: string,
  folder: string,
  items: readonly T[],
  mapper: (item: T) => { fileName: string; content: string },
  characterId: string,
): Promise<void> {
  const repos = getRepositories();
  const existing = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folder,
    '.md',
  );
  const existingByPath = new Map(existing.map((d) => [d.relativePath, d]));

  if (items.length > 0) {
    await ensureFolderPath(mountPointId, folder);
  }

  const writtenPaths = new Set<string>();
  const seen = new Set<string>();
  for (const item of items) {
    const mapped = mapper(item);
    let candidate = mapped.fileName;
    let n = 1;
    while (seen.has(candidate.toLowerCase())) {
      const dot = mapped.fileName.lastIndexOf('.');
      const base = dot >= 0 ? mapped.fileName.slice(0, dot) : mapped.fileName;
      const ext = dot >= 0 ? mapped.fileName.slice(dot) : '';
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    seen.add(candidate.toLowerCase());
    const relPath = `${folder}/${candidate}`;
    writtenPaths.add(relPath);
    await writeDatabaseDocument(mountPointId, relPath, mapped.content);
  }

  for (const [relPath, doc] of existingByPath) {
    if (writtenPaths.has(relPath)) continue;
    try {
      await deleteDatabaseDocument(mountPointId, relPath);
    } catch (err) {
      logger.warn('Failed to delete stale vault file during folder projection', {
        characterId,
        mountPointId,
        relativePath: relPath,
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
