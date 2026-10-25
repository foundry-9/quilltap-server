/**
 * Inventory schemas — the objects a character carries, one `.json` file per
 * object under a tier's `Inventory/` folder.
 *
 * Three shapes of one object:
 *
 *   - **{@link InventoryItemSchema}** — the full object, every field present.
 *     What a standalone, an archetype or a kit file holds (minus `folder`),
 *     and what every reader outside the writer sees after resolution
 *     (`lib/inventory/resolve.ts`).
 *   - **{@link InventoryItemFileSchema}** — the file as stored: for an
 *     instance only `id`, `parentId`, the timestamps and the fields it
 *     overrides; an omitted field inherits from the archetype. No defaults
 *     are applied (`patchSchemaOf`), so "omitted" stays omitted.
 *   - **{@link InventoryRecord}** — a parsed file with its `folder` (derived
 *     from the path): what a tier's folder holds and the writer projects.
 *
 * Client-safe.
 *
 * @module schemas/inventory.types
 */

import { z } from 'zod';
import { isValidInventoryFolderPath, INVENTORY_FOLDER, INVENTORY_FOLDER_MAX_DEPTH } from '@/lib/inventory/folders';
import { patchSchemaOf } from './patch-schema';
import { UUIDSchema, TimestampSchema } from './common.types';

export { INVENTORY_FOLDER };

/** `item` is one object; a `kit` names a list of objects equipped as one. */
export const InventoryKindSchema = z.enum(['item', 'kit']);
export type InventoryKind = z.infer<typeof InventoryKindSchema>;

/** The inline SVG glyph cap, in bytes. */
export const INVENTORY_SVG_MAX_BYTES = 16 * 1024;

/** The most members a kit may name. */
export const INVENTORY_KIT_MAX_MEMBERS = 200;

/** A folder path relative to `Inventory/` in normal form (`''` = root). */
export const InventoryFolderPathSchema = z
  .string()
  .max(900)
  .refine(isValidInventoryFolderPath, {
    message: `Inventory folder must be a clean path of at most ${INVENTORY_FOLDER_MAX_DEPTH} segments, none named "images"`,
  });

/** A folder as a request body carries it: any string, normalised by the writer. */
const InventoryFolderInputSchema = z.string().max(900);

export const InventoryItemSchema = z
  .object({
    id: UUIDSchema,
    kind: InventoryKindSchema.default('item'),
    /** The official name ("sword"). Kin share it, case-insensitively. */
    name: z.string().min(1).max(200),
    /** A proper title ("Excalibur"), shown first when set. */
    title: z.string().max(200).nullable().optional(),
    /** What characters read: told to the model while the object is equipped. */
    description: z.string().max(4000).nullable().optional(),
    /** Rendering hints for the image pipelines, while equipped; the subject of its own picture. */
    imageDescription: z.string().max(2000).nullable().optional(),
    /** Carried by every character who can reach it, on arrival in a chat. */
    equippedByDefault: z.boolean().default(false),
    /** At most this many kin equipped by one character in one chat. */
    maxEquipped: z.number().int().min(1).max(999).default(1),
    /** `false` refuses every copy path (move and instantiate stay allowed). */
    canCopy: z.boolean().default(false),
    /** A class of object, never carried; instances derive from it. */
    isArchetype: z.boolean().default(false),
    /** The archetype an instance derives from; null otherwise. */
    parentId: UUIDSchema.nullable().default(null),
    /** A kit's members; `[]` for an item. */
    itemIds: z.array(UUIDSchema).max(INVENTORY_KIT_MAX_MEMBERS).default([]),
    /** An emoji (or short code) glyph. */
    emoji: z.string().max(16).nullable().optional(),
    /** An inline SVG glyph, sanitised on write. */
    svg: z.string().max(INVENTORY_SVG_MAX_BYTES).nullable().optional(),
    /** The current picture among the object's own images. */
    imageFileId: UUIDSchema.nullable().optional(),
    /** Free-form data; every other top-level key is reserved. */
    metadata: z.record(z.string(), z.unknown()).default({}),
    /** Derived from the file's path, never stored. */
    folder: InventoryFolderPathSchema.default(''),
    archivedAt: TimestampSchema.nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** Every key a file may carry (all of the object's but `folder`). */
export const INVENTORY_FILE_KEYS: readonly string[] = Object.keys(InventoryItemSchema.shape).filter(
  (key) => key !== 'folder',
);

/**
 * The fields an instance inherits from its archetype when its file omits
 * them. Identity, shape (`kind`, `isArchetype`, `parentId`, `itemIds`),
 * filing and timestamps are always the instance's own.
 */
export const INVENTORY_INHERITABLE_FIELDS = [
  'name',
  'title',
  'description',
  'imageDescription',
  'equippedByDefault',
  'maxEquipped',
  'canCopy',
  'emoji',
  'svg',
  'imageFileId',
  'metadata',
] as const;
export type InventoryInheritableField = (typeof INVENTORY_INHERITABLE_FIELDS)[number];

/** The stored file: sparse, nothing defaulted, identity and timestamps required. */
export const InventoryItemFileSchema = patchSchemaOf(InventoryItemSchema.omit({ folder: true })).extend({
  id: UUIDSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type InventoryItemFile = z.infer<typeof InventoryItemFileSchema>;

/**
 * A parsed file with its folder: what a tier's `Inventory/` holds.
 * `fileStem` is the file's current name (without `.json`): the projection
 * names a file `title ?? name`, falling back to the stem for an instance that
 * inherits both, so its file keeps its name across writes. Never serialised.
 */
export type InventoryRecord = InventoryItemFile & { folder: string; fileStem?: string };

/** Where an object lives, as a collection read tags it. */
export interface InventoryOrigin {
  scope: 'character' | 'group' | 'project' | 'general';
  id: string | null;
  name: string;
}

/** An object as every reader outside the writer sees it. */
export type ResolvedInventoryItem = InventoryItem & {
  /** For an instance, the inheritable fields its own file sets. */
  overriddenFields?: InventoryInheritableField[];
  /** An instance whose archetype could not be found resolves to its own fields. */
  parentMissing?: boolean;
  /** The archetype's display name, for "Instance of X". */
  parentName?: string | null;
  origin?: InventoryOrigin;
};

/** `chats.equippedInventory`: object ids carried per character in this chat. */
export const EquippedInventorySchema = z.record(UUIDSchema, z.array(UUIDSchema));
export type EquippedInventory = z.infer<typeof EquippedInventorySchema>;

/** A kit's state in a chat: how many of its resolvable members are equipped. */
export type KitState = 'all' | 'some' | 'none';

/**
 * The shape rules every object obeys (§5.2): an archetype is a parentless
 * item; a kit is a parentless non-archetype with members; an item names no
 * members; an instance is never an archetype. Returns the problems found.
 */
export function inventoryShapeIssues(item: {
  kind?: InventoryKind;
  isArchetype?: boolean;
  parentId?: string | null;
  itemIds?: readonly string[];
}): string[] {
  const kind = item.kind ?? 'item';
  const issues: string[] = [];
  if (item.isArchetype) {
    if (item.parentId) issues.push('An archetype cannot derive from another archetype');
    if (kind !== 'item') issues.push('A kit cannot be an archetype');
  }
  if (kind === 'kit') {
    if (item.parentId) issues.push('A kit cannot be an instance');
    if ((item.itemIds ?? []).length === 0) issues.push('A kit needs at least one member');
  } else if ((item.itemIds ?? []).length > 0) {
    issues.push('Only a kit names members');
  }
  return issues;
}

// ============================================================================
// REQUEST BODIES
// ============================================================================

/** The editable field set (no identity, timestamps, archive flag or picture). */
export const inventoryItemFieldsSchema = InventoryItemSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  imageFileId: true,
  folder: true,
}).strip().extend({
  /** Folder under `Inventory/`; create defaults to the root. */
  folder: InventoryFolderInputSchema.optional(),
});

/** `POST …/inventory` body. */
export const createInventorySchema = inventoryItemFieldsSchema.superRefine((body, ctx) => {
  for (const message of inventoryShapeIssues(body)) ctx.addIssue({ code: 'custom', message });
  if (body.parentId) {
    ctx.addIssue({ code: 'custom', message: 'Create an instance with ?action=instantiate', path: ['parentId'] });
  }
});
export type InventoryCreateBody = z.infer<typeof createInventorySchema>;

/**
 * `PUT …/inventory/[itemId]` body: any field, nothing defaulted, plus the
 * archive flag and the picture choice. A field set to `null` on an instance
 * stores an explicit null (overriding the archetype with "none"); removing an
 * override is `?action=clear-override`.
 */
export const updateInventorySchema = patchSchemaOf(inventoryItemFieldsSchema)
  .omit({ parentId: true })
  .extend({
    archived: z.boolean().optional(),
    imageFileId: UUIDSchema.nullable().optional(),
  });
export type InventoryUpdateBody = z.infer<typeof updateInventorySchema>;

/** `PUT …/inventory/[itemId]?action=clear-override` body. */
export const clearInventoryOverrideSchema = z.object({
  fields: z.array(z.enum(INVENTORY_INHERITABLE_FIELDS)).min(1),
});

/** `POST …/inventory?action=instantiate` body. */
export const instantiateInventorySchema = z.object({
  archetypeId: UUIDSchema,
  folder: InventoryFolderInputSchema.optional(),
  /** The project tier a character's archetype may come from (no chat). */
  projectId: z.string().nullable().optional(),
  /** Or the chat whose project tier it may come from. */
  chatId: z.string().nullable().optional(),
  overrides: patchSchemaOf(InventoryItemSchema.pick({
    name: true,
    title: true,
    description: true,
    imageDescription: true,
    equippedByDefault: true,
    maxEquipped: true,
    canCopy: true,
    emoji: true,
    svg: true,
    metadata: true,
  })).optional(),
});

/** `POST …/inventory?action=duplicate` body. */
export const duplicateInventorySchema = z.object({
  itemId: z.string().min(1, 'itemId is required'),
});

/** `POST …/inventory?action=create-folder` / `delete-folder` body. */
export const inventoryFolderPathBodySchema = z.object({
  path: InventoryFolderInputSchema.min(1, 'A folder path is required'),
});

/** `POST …/inventory?action=rename-folder` body. */
export const renameInventoryFolderSchema = z.object({
  path: InventoryFolderInputSchema.min(1, 'A folder path is required'),
  name: z.string().min(1, 'A folder name is required').max(200),
});

/** `POST …/inventory?action=move-items` / `copy-items` body. */
export const fileInventoryItemsSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1, 'At least one item is required').max(500),
  folder: InventoryFolderInputSchema,
});

/** `POST /api/v1/chats/[id]?action=inventory-equip` / `inventory-unequip` body. */
export const chatInventoryEquipSchema = z.object({
  characterId: z.string().min(1),
  ids: z.array(UUIDSchema).min(1).max(INVENTORY_KIT_MAX_MEMBERS),
});

/** `POST /api/v1/chats/[id]?action=inventory-reset-defaults` body. */
export const chatInventoryResetSchema = z.object({
  characterId: z.string().min(1),
});

/** The four tiers, as a Zod enum for request bodies. */
export const InventoryScopeSchema = z.enum(['character', 'group', 'project', 'general']);
export type InventoryScope = z.infer<typeof InventoryScopeSchema>;

/** `POST /api/v1/inventory/transfers` body. */
export const inventoryTransferSchema = z.object({
  action: z.enum(['move', 'copy']),
  itemId: UUIDSchema,
  from: z.object({ scope: InventoryScopeSchema, id: z.string().nullable().optional() }),
  to: z.object({ scope: InventoryScopeSchema, id: z.string().nullable().optional() }),
});
