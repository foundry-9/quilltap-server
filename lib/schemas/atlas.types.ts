/**
 * Atlas schemas — the named things of a story that are not characters (a
 * vehicle, a house, a device, a place), one Markdown file per entry under a
 * tier's `Atlas/` folder.
 *
 * An entry is a canonical name, aliases, a short graphic prompt (what it looks
 * like) and free-form knowledge (what is known of it). On disk the knowledge
 * is the file's body and every other field rides in YAML frontmatter
 * ({@link ATLAS_FRONTMATTER_KEYS}, schema order); identity is the frontmatter
 * `id`, never the path.
 *
 *   - **{@link AtlasEntrySchema}** — the full entry, every field present.
 *   - **{@link AtlasRecord}** — a parsed file with its `folder` (derived from
 *     the path) and its current `fileStem`: what a tier's folder holds and the
 *     writer projects.
 *
 * Client-safe.
 *
 * @module schemas/atlas.types
 */

import { z } from 'zod';
import { ATLAS_FOLDER, ATLAS_FOLDER_MAX_DEPTH, isValidAtlasFolderPath } from '@/lib/atlas/folders';
import { patchSchemaOf } from './patch-schema';
import { UUIDSchema, TimestampSchema } from './common.types';

export { ATLAS_FOLDER };

/** The graphic prompt length past which the editor warns. The API never refuses. */
export const ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT = 200;

/** The most aliases one entry may carry. */
export const ATLAS_MAX_ALIASES = 50;

/** A folder path relative to `Atlas/` in normal form (`''` = root). */
export const AtlasFolderPathSchema = z
  .string()
  .max(900)
  .refine(isValidAtlasFolderPath, {
    message: `Atlas folder must be a clean path of at most ${ATLAS_FOLDER_MAX_DEPTH} segments, none named "images"`,
  });

/** A folder as a request body carries it: any string, normalised by the writer. */
const AtlasFolderInputSchema = z.string().max(900);

const AtlasTermSchema = z.string().trim().min(1).max(200);

export const AtlasEntrySchema = z
  .object({
    id: UUIDSchema,
    /** The canonical name ("Convertible"). Unique per tier, case-insensitively. */
    name: AtlasTermSchema,
    /** Other words the thing answers to ("lander", "car"). Plurals are the operator's to add. */
    aliases: z.array(AtlasTermSchema).max(ATLAS_MAX_ALIASES).default([]),
    /** What it looks like, for image models and for a character describing it. No hard limit. */
    graphicPrompt: z.string().nullable().default(null),
    /** What is known of it — the file's Markdown body. */
    knowledge: z.string().nullable().default(null),
    /** The current picture among the entry's own images. */
    imageFileId: UUIDSchema.nullable().default(null),
    /** Free-form data; every other top-level key is reserved. */
    metadata: z.record(z.string(), z.unknown()).default({}),
    /** Derived from the file's path, never stored. */
    folder: AtlasFolderPathSchema.default(''),
    archivedAt: TimestampSchema.nullable().default(null),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type AtlasEntry = z.infer<typeof AtlasEntrySchema>;

/** Every key the frontmatter carries: all of the entry's but `knowledge` (the body) and `folder` (the path). */
export const ATLAS_FRONTMATTER_KEYS: readonly string[] = Object.keys(AtlasEntrySchema.shape).filter(
  (key) => key !== 'knowledge' && key !== 'folder',
);

/**
 * A parsed file with its folder. `fileStem` is the file's current name
 * (without `.md`), never serialised.
 */
export type AtlasRecord = AtlasEntry & { fileStem?: string };

/** The four tiers, as a Zod enum for request bodies. */
export const AtlasScopeSchema = z.enum(['character', 'group', 'project', 'general']);
export type AtlasScope = z.infer<typeof AtlasScopeSchema>;

/** Where an entry lives, as a read tags it. */
export interface AtlasOrigin {
  scope: AtlasScope;
  /** Owner id; null for General. */
  id: string | null;
  name: string;
}

/** An entry as a collection read returns it: tagged with its tier. */
export type AtlasEntryWithOrigin = AtlasRecord & { origin?: AtlasOrigin; mountPointId?: string };

/**
 * Normalise an alias list: trimmed, empty dropped, de-duplicated
 * case-insensitively (first spelling kept), and any alias equal to the name
 * dropped. Pure.
 */
export function normalizeAtlasAliases(name: string, aliases: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>([name.trim().toLocaleLowerCase()]);
  const out: string[] = [];
  for (const raw of aliases ?? []) {
    if (typeof raw !== 'string') continue;
    const alias = raw.trim();
    if (!alias) continue;
    const key = alias.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

// ============================================================================
// REQUEST BODIES
// ============================================================================

/** The editable field set (no identity, timestamps, archive stamp or picture). */
export const atlasEntryFieldsSchema = AtlasEntrySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  imageFileId: true,
  folder: true,
}).strip().extend({
  /** Folder under `Atlas/`; create defaults to the root. */
  folder: AtlasFolderInputSchema.optional(),
});

/** `POST …/atlas` body. */
export const createAtlasEntrySchema = atlasEntryFieldsSchema;
export type AtlasCreateBody = z.infer<typeof createAtlasEntrySchema>;

/** `PUT …/atlas/[entryId]` body: any field, nothing defaulted, plus the archive flag and the picture choice. */
export const updateAtlasEntrySchema = patchSchemaOf(atlasEntryFieldsSchema).extend({
  archived: z.boolean().optional(),
  imageFileId: UUIDSchema.nullable().optional(),
});
export type AtlasUpdateBody = z.infer<typeof updateAtlasEntrySchema>;

/** `POST …/atlas?action=duplicate` body. */
export const duplicateAtlasEntrySchema = z.object({
  entryId: z.string().min(1, 'entryId is required'),
});

/** `POST …/atlas?action=create-folder` / `delete-folder` body. */
export const atlasFolderPathBodySchema = z.object({
  path: AtlasFolderInputSchema.min(1, 'A folder path is required'),
});

/** `POST …/atlas?action=rename-folder` body. */
export const renameAtlasFolderSchema = z.object({
  path: AtlasFolderInputSchema.min(1, 'A folder path is required'),
  name: z.string().min(1, 'A folder name is required').max(200),
});

/** `POST …/atlas?action=move-items` / `copy-items` body. */
export const fileAtlasEntriesSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1, 'At least one entry is required').max(500),
  folder: AtlasFolderInputSchema,
});

/** `POST /api/v1/atlas/transfers` body. */
export const atlasTransferSchema = z.object({
  action: z.enum(['move', 'copy']),
  entryId: UUIDSchema,
  from: z.object({ scope: AtlasScopeSchema, id: z.string().nullable().optional() }),
  to: z.object({ scope: AtlasScopeSchema, id: z.string().nullable().optional() }),
});

// ============================================================================
// WIRE SHAPES
// ============================================================================

/** A term this tier's entries share with something else reachable, for the editor's notices. */
export interface AtlasOverlap {
  /** The term as this tier's entry spells it. */
  term: string;
  /** This tier's entry that holds it. */
  entryId: string;
  /** `entry`: another reachable entry also holds it. `character`: a character answers to it. */
  kind: 'entry' | 'character';
  /** The other entry's or character's name. */
  otherName: string;
  /** Where the other entry lives (`entry` only). */
  otherOrigin?: AtlasOrigin;
}

/** What a chip's popup shows. */
export interface AtlasCard {
  entryId: string;
  name: string;
  aliases: string[];
  graphicPrompt: string | null;
  knowledge: string | null;
  origin: AtlasOrigin;
  imageFileId: string | null;
}

/** One chip: the first message that names an entry of the cast view. */
export interface AtlasMention {
  messageId: string;
  entryId: string;
  /** The matched text as written. */
  text: string;
  card: AtlasCard;
}
