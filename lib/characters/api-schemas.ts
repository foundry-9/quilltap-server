/**
 * The character API's request schemas, derived from the entity schema (D9 of
 * refactor-character-repository-and-vault.md).
 *
 * The PUT and the create used to restate `Character` field by field, each
 * vault-managed field carrying a comment that it "must be named here or the
 * parse strips it" — which is how a System Prompt field was silently discarded
 * (#146). Now both derive from `CharacterSchema`, minus what the server owns,
 * and both are `.strict()`: an unknown key is a 400, not a silent drop.
 *
 * @module characters/api-schemas
 */

import { z } from 'zod';
import {
  CharacterSchema,
  CharacterScenarioSchema,
  CharacterSystemPromptSchema,
  PhysicalDescriptionSchema,
} from '@/lib/schemas/character.types';
import { UUIDSchema, TimestampSchema } from '@/lib/schemas/common.types';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';

/**
 * Fields the server owns: identity and timestamps, the archive tombstone, the
 * vault pointer, and the fields with their own actions (`?action=avatar`,
 * `add-tag` / `remove-tag`, the partner and avatar-override routes).
 */
const SERVER_OWNED = {
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  archiveFileId: true,
  archivedAvatarFileId: true,
  characterDocumentMountPointId: true,
  defaultImageId: true,
  tags: true,
  partnerLinks: true,
  avatarOverrides: true,
} as const;

/** The sub-collections, which have their own per-item routes. */
const SUB_COLLECTIONS = { systemPrompts: true, scenarios: true } as const;

/** A select's "none" arrives as `''`; it means "clear". */
const emptyAsNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema);

/**
 * A physical description as a client writes it: the text and the prompt
 * tiers. Its id and timestamps are the server's (the id is derived from the
 * vault, `physicalDescriptionIdFor`).
 */
export const PhysicalDescriptionWriteSchema = PhysicalDescriptionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PhysicalDescriptionWrite = z.infer<typeof PhysicalDescriptionWriteSchema>;

/** Every field a client may write on a character, with its entity rules. */
export const CharacterWritableSchema = CharacterSchema.omit({ ...SERVER_OWNED, ...SUB_COLLECTIONS }).extend({
  name: z.string().min(1, 'Name is required').max(100),
  physicalDescription: PhysicalDescriptionWriteSchema.nullable().optional(),
  defaultConnectionProfileId: emptyAsNull(UUIDSchema.nullable().optional()),
  defaultImageProfileId: emptyAsNull(UUIDSchema.nullable().optional()),
  defaultRoleplayTemplateId: emptyAsNull(UUIDSchema.nullable().optional()),
  defaultPartnerId: emptyAsNull(UUIDSchema.nullable().optional()),
});

/**
 * `PUT /api/v1/characters/[id]`: any writable field, nothing defaulted, and no
 * unknown key (a 400 names it). `defaultSystemPromptId` is accepted here but
 * the handler routes it through `setDefaultSystemPrompt`.
 */
export const updateCharacterSchema = patchSchemaOf(CharacterWritableSchema).strict();

export type CharacterUpdateBody = z.infer<typeof updateCharacterSchema>;

/** A prompt as a create carries it: the server mints a missing id and timestamps. */
const SystemPromptCreateSchema = CharacterSystemPromptSchema.extend({
  id: UUIDSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});

/** A scenario as a create carries it: the server mints a missing id and timestamps. */
const ScenarioCreateSchema = CharacterScenarioSchema.extend({
  id: UUIDSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});

/**
 * `POST /api/v1/characters`: the writable shape with a required name and the
 * sub-collections allowed, so a new character arrives whole in one request.
 */
export const createCharacterSchema = patchSchemaOf(CharacterWritableSchema)
  .extend({
    name: z.string().min(1, 'Name is required').max(100),
    systemPrompts: z.array(SystemPromptCreateSchema).optional(),
    scenarios: z.array(ScenarioCreateSchema).optional(),
  })
  .strict();

export type CharacterCreateBody = z.infer<typeof createCharacterSchema>;
