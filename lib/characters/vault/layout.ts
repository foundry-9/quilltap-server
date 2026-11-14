/**
 * The character vault layout — the one declarative description of which
 * character field lives in which vault file, how it is read and written, what
 * it defaults to, what a fresh vault is seeded with, and which files a
 * populated vault must have.
 *
 * Everything that knows the layout derives it from {@link CHARACTER_VAULT_LAYOUT}:
 * the hydrator (`hydrate.ts`, a fold over the table), the patch writer and the
 * full projection (`write.ts`), the scaffold (`scaffold.ts`), the adoption and
 * sync keystones, the archive keep-set, the character page's "character files"
 * health figure, and `MANAGED_FIELDS`. Adding a managed field means adding (or
 * extending) an entry here and nowhere else.
 *
 * The file layout itself — names, folders, frontmatter keys, the
 * `properties.json` shape — is fixed: hand-editing, the filesystem sync and
 * `.qtap` bundles depend on it.
 *
 * @module characters/vault/layout
 */

import { logger } from '@/lib/logger';
import type {
  Character,
  CharacterManagedField,
  CharacterScenario,
  CharacterSystemPrompt,
  PhysicalDescription,
} from '@/lib/schemas/character.types';
import { CHARACTER_MANAGED_FIELDS, characterManagedDefaults } from '@/lib/schemas/character.types';
import { diagramStyleOrDefault } from '@/lib/markdown/diagrams';
import { characterKindOrDefault } from '@/lib/characters/kind';
import { birthdayOrNull } from '@/lib/characters/birthday';
import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';
import type {
  DocMountDocumentWithLink as DocMountDocument,
} from '@/lib/database/repositories/doc-mount-documents.repository';
import {
  CharacterVaultPropertiesSchema,
  type CharacterVaultProperties,
} from './file-schemas';
import {
  markdownToNullable,
  normalizeDefaultPrompt,
  parsePromptFile,
  parseScenarioFile,
  parseScenarioFilesSorted,
  parseVaultMetadata,
  parseVaultPhysicalPrompts,
  parseVaultProperties,
  isPromptItemDocument,
  isScenarioItemDocument,
  stableUuidFromString,
} from './parsers';

// ============================================================================
// PATHS
// ============================================================================

export {
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
  CHARACTER_WARDROBE_JSON_PATH,
  type CharacterVaultFilePath,
} from './paths';
import {
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
  CHARACTER_WARDROBE_JSON_PATH,
  type CharacterVaultFilePath,
} from './paths';

// ============================================================================
// THE BROKEN-VAULT ERROR
// ============================================================================

/**
 * Thrown when a character with a linked vault has no usable vault — a
 * null/unreadable mount, or a missing `properties.json` anchor, or (on a write)
 * a present-but-invalid `properties.json` that a patch would otherwise seed
 * defaults over. The vault is the sole source of the managed fields, so a
 * broken vault is a broken invariant and fails loudly rather than returning a
 * hollowed character.
 *
 * `findById` (single) throws it — the route maps it to a 503 and the Aurora
 * page offers the vault-health report and repair. The batched reads
 * (`findAll`/`findByIds`) catch it, log at `error`, and drop the character so
 * one bad vault cannot take down the roster. Mirrors
 * `ProjectStoreUnavailableError` / `GroupStoreUnavailableError`.
 */
export class CharacterVaultUnavailableError extends Error {
  constructor(
    public readonly characterId: string,
    public readonly characterDocumentMountPointId: string | null | undefined,
    detail?: string,
  ) {
    super(
      `Character ${characterId} has no usable vault ` +
        `(characterDocumentMountPointId=${characterDocumentMountPointId ?? 'null'})` +
        (detail ? `: ${detail}` : ''),
    );
    this.name = 'CharacterVaultUnavailableError';
  }
}

// ============================================================================
// RENDERERS (the write half of each codec)
// ============================================================================

function escapeYaml(value: string): string {
  if (/[:#"'\n]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * The physical description's id. Server-owned and derived from the vault, so
 * it is the same on every read and every write; no client or route mints one.
 */
export function physicalDescriptionIdFor(mountPointId: string): string {
  return stableUuidFromString(`physical:${mountPointId}`);
}

export function renderPhysicalPromptsJson(primary: Partial<PhysicalDescription> | null | undefined): string {
  return JSON.stringify(
    {
      headAndShoulders: primary?.headAndShouldersPrompt ?? null,
      short: primary?.shortPrompt ?? null,
      medium: primary?.mediumPrompt ?? null,
      long: primary?.longPrompt ?? null,
      complete: primary?.completePrompt ?? null,
      humanoid: primary?.humanoid ?? true,
    },
    null,
    2,
  );
}

/**
 * Serialize one prompt to its `Prompts/*.md` file. The frontmatter carries the
 * prompt's `id` (D5), so the id survives a rename of the file; a file without
 * one takes its path-derived id, and the next write stamps that id in.
 */
export function buildSystemPromptFile(p: CharacterSystemPrompt): string {
  const lines = [`id: ${p.id}`, `name: ${escapeYaml(p.name)}`];
  if (p.isDefault) lines.push('isDefault: true');
  return `---\n${lines.join('\n')}\n---\n\n${p.content}`;
}

/**
 * Serialize one character scenario back to its `Scenarios/*.md` file.
 *
 * The heading carries the title, as it always has. Frontmatter carries the
 * scenario's `id` (so the id survives a rename, or a move to another tier),
 * then `description` and `archived: true` when they apply.
 */
export function buildScenarioFile(s: CharacterScenario): string {
  const frontmatter: string[] = [`id: ${s.id}`];
  if (s.description && s.description.trim().length > 0) {
    frontmatter.push(`description: ${escapeYaml(s.description.trim())}`);
  }
  if (s.archived) {
    frontmatter.push('archived: true');
  }
  return `---\n${frontmatter.join('\n')}\n---\n\n# ${s.title}\n\n${s.content}`;
}

// ============================================================================
// THE TABLE
// ============================================================================

/** Who a parse or write is for — threaded into log lines and errors. */
export interface VaultContext {
  characterId: string;
  mountPointId: string;
}

/** Reads one vault file's current content for a patch write; null when absent. */
export type CurrentFileReader = (path: string) => Promise<string | null>;

/** A managed field (or group of fields) held in one file. */
export interface VaultFileEntry {
  readonly kind: 'file';
  readonly path: CharacterVaultFilePath;
  readonly fields: readonly CharacterManagedField[];
  /** A populated vault must hold this file (adoption, sync, the heal). */
  readonly keystone: boolean;
  /** Hydration throws when this file is absent. Exactly one entry: `properties.json`. */
  readonly anchor?: true;
  /** What a fresh vault is seeded with. */
  readonly seed: string;
  /** Lenient read of a present file. A malformed file yields `{}` (defaults stand). */
  parse(raw: string, ctx: VaultContext): Partial<Character>;
  /** What an absent file hydrates to. Default: nothing (defaults stand). */
  absent?(ctx: VaultContext): Partial<Character>;
  /** Full projection: the file for a whole character, or null to leave it as it is. */
  render(character: Character): string | null;
  /** Patch write: the file for a patch naming at least one of {@link fields}. */
  renderPatch(patch: Partial<Character>, current: CurrentFileReader, ctx: VaultContext): Promise<string>;
}

/** One field held across several files — the physical description. */
export interface VaultCompositeEntry {
  readonly kind: 'composite';
  readonly paths: readonly CharacterVaultFilePath[];
  readonly fields: readonly CharacterManagedField[];
  readonly keystone: false;
  readonly seeds: Readonly<Record<string, string>>;
  /** Called when at least one of {@link paths} is present. */
  parse(raws: ReadonlyMap<string, string>, ctx: VaultContext): Partial<Character>;
  render(character: Character, ctx: VaultContext): ReadonlyMap<string, string> | null;
  renderPatch(
    patch: Partial<Character>,
    current: CurrentFileReader,
    ctx: VaultContext,
  ): Promise<ReadonlyMap<string, string>>;
}

/** A sub-collection held as one file per item in a folder. */
export interface VaultFolderEntry<T extends { id: string } = { id: string }> {
  readonly kind: 'folder';
  readonly folder: string;
  readonly field: 'systemPrompts' | 'scenarios';
  readonly fields: readonly CharacterManagedField[];
  readonly keystone: false;
  /** One document's item, or null when it is not one (a draft, a note). */
  parseItem(doc: DocMountDocument, ctx: VaultContext): T | null;
  /** Folder-wide rules applied over the parsed items (exactly one default prompt). */
  normalize(items: T[]): T[];
  /** Every item the folder's documents parse to, in display order. */
  parseFolder(docs: DocMountDocument[], ctx: VaultContext): Partial<Character>;
  items(character: Character): T[];
  /** The file name an item is written under (before collision suffixing). */
  fileNameFor(item: T): string;
  renderItem(item: T): string;
  /** The files a whole-folder write owns and may sweep: those that parse as items. */
  ownsFile(doc: { relativePath: string; content?: string | null }): boolean;
}

export type VaultLayoutEntry = VaultFileEntry | VaultCompositeEntry | VaultFolderEntry<CharacterSystemPrompt> | VaultFolderEntry<CharacterScenario>;

/** A markdown file holding one nullable text field. Empty file ⇔ null. */
function markdownEntry(
  path: CharacterVaultFilePath,
  field: 'identity' | 'description' | 'manifesto' | 'personality' | 'exampleDialogues',
): VaultFileEntry {
  return {
    kind: 'file',
    path,
    fields: [field],
    keystone: true,
    seed: '',
    parse: (raw) => ({ [field]: markdownToNullable(raw) }),
    render: (c) => c[field] ?? '',
    renderPatch: async (patch) => (patch[field] as string | null | undefined) ?? '',
  };
}

/** The `properties.json` fields, in file order. */
const PROPERTIES_FIELDS = [
  'pronouns', 'birthday', 'aliases', 'title', 'firstMessage', 'talkativeness',
  'canChooseOutfit', 'canDrawDiagrams', 'diagramStyle', 'kind',
] as const satisfies readonly CharacterManagedField[];

/**
 * Aliases as stored: trimmed, blanks dropped, and each name once whatever its
 * casing (the first spelling wins). The server's rule — a client sends the
 * aliases it wants and never de-duplicates them itself (D11).
 */
export function normalizeAliases(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = alias.toLowerCase();
    if (alias.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** The `properties.json` content for a character (or a patch over defaults). */
function propertiesOf(c: Partial<Character>): CharacterVaultProperties {
  const d = characterManagedDefaults();
  return {
    pronouns: c.pronouns ?? null,
    birthday: birthdayOrNull(c.birthday),
    aliases: normalizeAliases(c.aliases ?? d.aliases),
    title: c.title ?? null,
    firstMessage: c.firstMessage ?? null,
    talkativeness: c.talkativeness ?? d.talkativeness,
    canChooseOutfit: c.canChooseOutfit ?? d.canChooseOutfit,
    canDrawDiagrams: c.canDrawDiagrams ?? d.canDrawDiagrams,
    diagramStyle: diagramStyleOrDefault(c.diagramStyle),
    kind: characterKindOrDefault(c.kind),
  };
}

/**
 * Strict read of a present `properties.json`: throws
 * {@link CharacterVaultUnavailableError} rather than return defaults, because
 * the settings it holds live nowhere else and a write that seeded defaults
 * over a corrupt-but-present file would erase them (bug 8, #148).
 */
export function parsePropertiesStrict(raw: string, ctx: VaultContext): CharacterVaultProperties {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('Vault properties.json unparseable — refusing to seed defaults over it', { ...ctx, error: detail });
    throw new CharacterVaultUnavailableError(
      ctx.characterId,
      ctx.mountPointId,
      `${CHARACTER_PROPERTIES_JSON_PATH} unparseable: ${detail}`,
    );
  }
  const parsed = CharacterVaultPropertiesSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    logger.error('Vault properties.json failed schema validation — refusing to seed defaults over it', { ...ctx, issues });
    throw new CharacterVaultUnavailableError(
      ctx.characterId,
      ctx.mountPointId,
      `${CHARACTER_PROPERTIES_JSON_PATH} unparseable: schema validation failed (${issues})`,
    );
  }
  return parsed.data;
}

const PROPERTIES_ENTRY: VaultFileEntry = {
  kind: 'file',
  path: CHARACTER_PROPERTIES_JSON_PATH,
  fields: PROPERTIES_FIELDS,
  keystone: true,
  anchor: true,
  seed: JSON.stringify(propertiesOf({}), null, 2),
  parse: (raw, ctx) => {
    const parsed = parseVaultProperties(raw, ctx.characterId);
    return parsed ? { ...parsed } : {};
  },
  render: (c) => JSON.stringify(propertiesOf(c), null, 2),
  renderPatch: async (patch, current, ctx) => {
    // Read-modify-write: a partial patch keeps the fields it does not name.
    // Absent file → start from defaults (a fresh vault); present-but-invalid
    // → throw (see parsePropertiesStrict).
    const raw = await current(CHARACTER_PROPERTIES_JSON_PATH);
    const base = raw === null ? propertiesOf({}) : parsePropertiesStrict(raw, ctx);
    const touched = PROPERTIES_FIELDS.filter((k) => k in patch);
    const merged: Partial<Character> = { ...base };
    for (const k of touched) (merged as Record<string, unknown>)[k] = patch[k];
    logger.debug('[CharacterVault] Writing properties.json', { ...ctx, touched });
    return JSON.stringify(propertiesOf(merged), null, 2);
  },
};

const METADATA_ENTRY: VaultFileEntry = {
  kind: 'file',
  path: CHARACTER_METADATA_JSON_PATH,
  fields: ['metadata'],
  // Not a keystone: vaults predating the fact sheet have no such file, and its
  // absence is a normal state (hydrates as {}), never a broken vault.
  keystone: false,
  seed: JSON.stringify({}, null, 2),
  // A fat-fingered fact sheet costs its own keys for that read and nothing else.
  parse: (raw, ctx) => ({ metadata: parseVaultMetadata(raw, ctx.characterId, ctx.mountPointId) ?? {} }),
  absent: (ctx) => {
    logger.debug('Character vault has no metadata.json; hydrating empty metadata', ctx);
    return { metadata: {} };
  },
  // `metadata` has no column and no schema default, so a caller with no
  // metadata in hand has no opinion — absence leaves the file alone rather than
  // erasing a sheet it never saw.
  render: (c) => (c.metadata != null ? JSON.stringify(c.metadata, null, 2) : null),
  // A patch REPLACES the whole object (one field, one file). The HTTP route's
  // key-level patch is `?action=patch-metadata`, which merges before it calls in.
  renderPatch: async (patch) => JSON.stringify(patch.metadata ?? {}, null, 2),
};

const PHYSICAL_ENTRY: VaultCompositeEntry = {
  kind: 'composite',
  paths: [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, CHARACTER_PHYSICAL_PROMPTS_JSON_PATH],
  fields: ['physicalDescription'],
  // The writer skips the pair when a character has no physical description,
  // so requiring them would wrongly reject a sparse vault.
  keystone: false,
  seeds: {
    [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: '',
    [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: renderPhysicalPromptsJson(null),
  },
  parse: (raws, ctx) => {
    const now = new Date().toISOString();
    const pd: PhysicalDescription = {
      id: physicalDescriptionIdFor(ctx.mountPointId),
      headAndShouldersPrompt: null,
      shortPrompt: null,
      mediumPrompt: null,
      longPrompt: null,
      completePrompt: null,
      fullDescription: null,
      createdAt: now,
      updatedAt: now,
    };
    const md = raws.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH);
    if (md !== undefined) pd.fullDescription = markdownToNullable(md);
    const json = raws.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH);
    if (json !== undefined) {
      const prompts = parseVaultPhysicalPrompts(json, ctx.characterId);
      if (prompts) {
        pd.headAndShouldersPrompt = prompts.headAndShoulders ?? null;
        pd.shortPrompt = prompts.short;
        pd.mediumPrompt = prompts.medium;
        pd.longPrompt = prompts.long;
        pd.completePrompt = prompts.complete;
        pd.humanoid = prompts.humanoid ?? true;
      }
    }
    return { physicalDescription: pd };
  },
  render: (c) => {
    const pd = c.physicalDescription ?? null;
    if (!pd) return null;
    return new Map([
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, pd.fullDescription ?? ''],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH, renderPhysicalPromptsJson(pd)],
    ]);
  },
  renderPatch: async (patch, current, ctx) => {
    // Clear means clear (#149): null empties both files. `humanoid` is a
    // setting, not generated text, so a write that does not name it (Clear,
    // the AI Wizard, the optimizer, the head-and-shoulders backfill) keeps the
    // vault's.
    const incoming: Partial<PhysicalDescription> = patch.physicalDescription ?? {};
    let humanoid = incoming.humanoid;
    if (humanoid === undefined) {
      const raw = await current(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH);
      humanoid = raw === null ? undefined : parseVaultPhysicalPrompts(raw, ctx.characterId)?.humanoid;
    }
    logger.debug('[CharacterVault] Writing the physical description', {
      ...ctx,
      cleared: patch.physicalDescription == null,
      humanoid: humanoid ?? true,
    });
    return new Map([
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, incoming.fullDescription ?? ''],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH, renderPhysicalPromptsJson({ ...incoming, humanoid })],
    ]);
  },
};

const PROMPTS_ENTRY: VaultFolderEntry<CharacterSystemPrompt> = {
  kind: 'folder',
  folder: CHARACTER_PROMPTS_FOLDER,
  field: 'systemPrompts',
  fields: ['systemPrompts'],
  keystone: false,
  parseItem: (doc, ctx) => parsePromptFile(doc, ctx.characterId),
  normalize: normalizeDefaultPrompt,
  parseFolder: (docs, ctx) => ({
    systemPrompts: normalizeDefaultPrompt(
      docs
        .slice()
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((doc) => parsePromptFile(doc, ctx.characterId))
        .filter((p): p is CharacterSystemPrompt => p !== null),
    ),
  }),
  items: (c) => c.systemPrompts ?? [],
  fileNameFor: (p) => `${sanitizeFileName(p.name)}.md`,
  renderItem: buildSystemPromptFile,
  ownsFile: isPromptItemDocument,
};

const SCENARIOS_ENTRY: VaultFolderEntry<CharacterScenario> = {
  kind: 'folder',
  folder: CHARACTER_SCENARIOS_FOLDER,
  field: 'scenarios',
  fields: ['scenarios'],
  keystone: false,
  // Archived scenarios are KEPT in the array — filtering is the API's and the
  // UI's business, never the read's.
  parseItem: (doc, ctx) => parseScenarioFile(doc, ctx.characterId),
  normalize: (items) => items,
  parseFolder: (docs, ctx) => ({ scenarios: parseScenarioFilesSorted(docs, ctx.characterId) }),
  items: (c) => c.scenarios ?? [],
  fileNameFor: (s) => `${sanitizeFileName(s.title)}.md`,
  renderItem: buildScenarioFile,
  ownsFile: isScenarioItemDocument,
};

/** The layout. Order is the projection order (and `properties.json` first). */
export const CHARACTER_VAULT_LAYOUT = {
  properties: PROPERTIES_ENTRY,
  metadata: METADATA_ENTRY,
  identity: markdownEntry(CHARACTER_IDENTITY_MD_PATH, 'identity'),
  description: markdownEntry(CHARACTER_DESCRIPTION_MD_PATH, 'description'),
  manifesto: markdownEntry(CHARACTER_MANIFESTO_MD_PATH, 'manifesto'),
  personality: markdownEntry(CHARACTER_PERSONALITY_MD_PATH, 'personality'),
  exampleDialogues: markdownEntry(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, 'exampleDialogues'),
  physical: PHYSICAL_ENTRY,
  prompts: PROMPTS_ENTRY,
  scenarios: SCENARIOS_ENTRY,
} as const;

export const CHARACTER_VAULT_ENTRIES: readonly VaultLayoutEntry[] = Object.values(CHARACTER_VAULT_LAYOUT);

// ============================================================================
// DERIVED
// ============================================================================

export const CHARACTER_VAULT_FILE_ENTRIES: readonly VaultFileEntry[] = CHARACTER_VAULT_ENTRIES.filter(
  (e): e is VaultFileEntry => e.kind === 'file',
);
export const CHARACTER_VAULT_COMPOSITE_ENTRIES: readonly VaultCompositeEntry[] = CHARACTER_VAULT_ENTRIES.filter(
  (e): e is VaultCompositeEntry => e.kind === 'composite',
);
export const CHARACTER_VAULT_FOLDER_ENTRIES = [PROMPTS_ENTRY, SCENARIOS_ENTRY] as const;

/** The file hydration cannot do without: its absence throws. */
export const CHARACTER_VAULT_ANCHOR_PATH = PROPERTIES_ENTRY.path;

/**
 * Every single-file path the layout owns — the managed-field documents. The
 * character page's "character files" figure counts how many are present.
 */
export const CHARACTER_VAULT_FILE_PATHS: readonly CharacterVaultFilePath[] = [
  ...CHARACTER_VAULT_FILE_ENTRIES.map((e) => e.path),
  ...CHARACTER_VAULT_COMPOSITE_ENTRIES.flatMap((e) => e.paths),
];

/**
 * The files a populated vault always holds: what adoption checks before it
 * links an orphaned vault, what the filesystem sync never propagates the
 * deletion of, and what the vault-health report lists.
 */
export const CHARACTER_VAULT_KEYSTONES: readonly string[] = CHARACTER_VAULT_ENTRIES.flatMap((e) =>
  e.kind === 'file' && e.keystone ? [e.path] : [],
);

/**
 * The §4.2a archive keep-set's managed-field documents: every layout file,
 * plus the legacy `wardrobe.json`. (Wardrobe/ and Inventory/ are kept whole by
 * the archive service itself.)
 */
export const CHARACTER_VAULT_KEEP_PATHS: readonly string[] = [
  ...CHARACTER_VAULT_FILE_PATHS,
  CHARACTER_WARDROBE_JSON_PATH,
];

/** Every file a fresh vault is seeded with, and its content. */
export const CHARACTER_VAULT_SEEDS: ReadonlyArray<{ path: string; content: string }> = [
  ...CHARACTER_VAULT_FILE_ENTRIES.map((e) => ({ path: e.path, content: e.seed })),
  ...CHARACTER_VAULT_COMPOSITE_ENTRIES.flatMap((e) =>
    e.paths.map((path) => ({ path, content: e.seeds[path] })),
  ),
];

/** Folders the layout itself writes into. */
export const CHARACTER_VAULT_LAYOUT_FOLDERS: readonly string[] = CHARACTER_VAULT_FOLDER_ENTRIES.map((e) => e.folder);

/**
 * The vault-managed fields: every key of `Character` that `CharacterRow`
 * lacks, derived from the schemas (a test holds the table to cover exactly
 * these).
 */
export const MANAGED_FIELDS: ReadonlySet<CharacterManagedField> = new Set(CHARACTER_MANAGED_FIELDS);

/** The layout entries a patch touches. */
export function entriesTouchedBy(patch: Partial<Character>): VaultLayoutEntry[] {
  return CHARACTER_VAULT_ENTRIES.filter((e) => e.fields.some((f) => f in patch));
}

/** The patch with every managed field removed — what the row may take. */
export function withoutManagedFields<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!MANAGED_FIELDS.has(k as CharacterManagedField)) out[k] = v;
  }
  return out as Partial<T>;
}
