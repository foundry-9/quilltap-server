/**
 * Zod schemas for the character vault's JSON files. Their leniency rules are
 * load-bearing (a hand-edited file that fails a strict parse would hollow every
 * field the file owns), so each optional-with-default carries its reason.
 *
 * @module characters/vault/file-schemas
 */

import { z } from 'zod';
import { PronounsSchema } from '@/lib/schemas/character.types';
import { JsonSchema } from '@/lib/schemas/common.types';
import { DEFAULT_DIAGRAM_STYLE, DIAGRAM_STYLES, diagramStyleOrDefault } from '@/lib/markdown/diagrams';
import { CHARACTER_KINDS, DEFAULT_CHARACTER_KIND, characterKindOrDefault } from '@/lib/characters/kind';
import { birthdayOrNull } from '@/lib/characters/birthday';

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
  // Optional-with-default so the vaults written before this field existed
  // still parse (their properties.json has no `canChooseOutfit` key) and
  // hydrate as false, rather than failing validation and falling back to the
  // DB for every managed field. "Absent means false" is the intended default.
  canChooseOutfit: z.boolean().optional().default(false),
  // Diagrams in the Salon. Optional-with-default for the same reason as
  // `canChooseOutfit`: absent means the character may not draw.
  canDrawDiagrams: z.boolean().optional().default(false),
  // How this character's diagrams look. Hand-editable, so lenient like
  // physical-prompts.json's `humanoid`: an unrecognized value (a typo, null)
  // reads as the default instead of failing the strict parse and hollowing
  // every field this file owns.
  diagramStyle: z.preprocess(
    diagramStyleOrDefault,
    z.enum(DIAGRAM_STYLES).optional().default(DEFAULT_DIAGRAM_STYLE),
  ),
  // How the character is performed (roleplay / assistant). Lenient for the
  // same reason as `diagramStyle`: absent (every vault written before kinds
  // existed) or unrecognized reads as the default instead of failing the
  // strict parse and hollowing every field this file owns.
  kind: z.preprocess(
    characterKindOrDefault,
    z.enum(CHARACTER_KINDS).optional().default(DEFAULT_CHARACTER_KIND),
  ),
  // Optional real birthday (YYYY-MM-DD). Lenient like `kind`: absent (every
  // vault written before birthdays existed) or not a real date reads as null.
  birthday: z.preprocess(birthdayOrNull, z.string().nullable()),
});

export type CharacterVaultProperties = z.infer<typeof CharacterVaultPropertiesSchema>;

export const CharacterVaultPhysicalPromptsSchema = z.object({
  // Optional: legacy physical-prompts.json files written before this field
  // existed only carry {short,medium,long,complete}. A non-optional key here
  // would make the strict safeParse reject them and wipe ALL prompt tiers.
  headAndShoulders: z.string().nullable().optional(),
  short: z.string().nullable(),
  medium: z.string().nullable(),
  long: z.string().nullable(),
  complete: z.string().nullable(),
  // Optional for the same reason: absent means humanoid. `false` marks a
  // character with no humanoid body for every image pipeline. Hand-edited, so
  // lenient: "false"/"true" strings count, and anything else (null, a typo)
  // reads as absent rather than failing the strict parse and wiping every
  // prompt tier above.
  humanoid: z.preprocess(
    (v) => (v === false || v === 'false' ? false : v === true || v === 'true' ? true : undefined),
    z.boolean().optional(),
  ),
});

export type CharacterVaultPhysicalPrompts = z.infer<typeof CharacterVaultPhysicalPromptsSchema>;

/**
 * `metadata.json` — one flat object of user-authored keys, values of any JSON
 * type. Nothing about the contents is constrained: the keys are the user's
 * vocabulary, not ours, so the schema's whole job is to insist the file is a
 * JSON *object* and refuse an array or a bare scalar.
 *
 * `JsonSchema` (record of string → unknown) is exactly that shape, and is
 * already what `sillyTavernData` uses — reused rather than restated so the two
 * can't drift into disagreeing about what "arbitrary JSON" means.
 */
export const CharacterVaultMetadataSchema = JsonSchema;

export type CharacterVaultMetadata = z.infer<typeof CharacterVaultMetadataSchema>;
