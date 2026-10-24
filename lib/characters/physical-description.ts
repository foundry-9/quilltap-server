/**
 * Which of a character's physical-description variants a reader uses.
 *
 * A character's appearance is stored as one record with several lengths of
 * the same truth — a head-and-shoulders prompt, short / medium / long /
 * complete prompts, and the free-prose full description. Each reader wants a
 * different one first and falls back through the rest in its own order. Those
 * orders used to be spelled inline at every reader, and drifted; this is the
 * one place they live. A new reader picks the profile whose purpose matches
 * its own rather than writing a seventh chain.
 *
 * Pure and client-safe.
 *
 * @module characters/physical-description
 */

import type { PhysicalDescription } from '@/lib/schemas/character.types';

/** The variant fields a reader may choose between. */
export type PhysicalDescriptionVariants = Partial<Pick<
  PhysicalDescription,
  'headAndShouldersPrompt' | 'shortPrompt' | 'mediumPrompt' | 'longPrompt' | 'completePrompt' | 'fullDescription' | 'humanoid'
>>;

/**
 * What the text is for, which decides the order variants are tried in.
 *
 * - `head-and-shoulders` — a portrait crop (the avatar, a hairstyle's
 *   picture). The dedicated prompt first: it never sends below-the-crop
 *   anatomy that image-provider moderation rejects.
 * - `full-length` — one figure, head to toe (a worn wardrobe picture, a
 *   character's appearance in a resolved scene). The fullest prompt first.
 * - `scene` — one of several figures in a scene prompt, or a one-line
 *   preview. Compact first, so a cast does not swamp the prompt. Never the
 *   head-and-shoulders prompt, which is a crop rather than a figure — this is
 *   also the seed the head-and-shoulders backfill grounds a new one in.
 * - `self-image` — the character's own system prompt ("This is how you
 *   look"). Shortest first: it rides along on every turn.
 * - `fullest` — everything the operator wrote, for a reader that wants the
 *   whole account (the external prompt generator).
 */
export type PhysicalDescriptionProfile =
  | 'head-and-shoulders'
  | 'full-length'
  | 'scene'
  | 'self-image'
  | 'fullest';

type VariantKey = Exclude<keyof PhysicalDescriptionVariants, 'humanoid'>;

const ORDER: Record<PhysicalDescriptionProfile, readonly VariantKey[]> = {
  'head-and-shoulders': ['headAndShouldersPrompt', 'mediumPrompt', 'shortPrompt', 'longPrompt', 'completePrompt', 'fullDescription'],
  'full-length': ['completePrompt', 'longPrompt', 'mediumPrompt', 'shortPrompt', 'fullDescription', 'headAndShouldersPrompt'],
  scene: ['mediumPrompt', 'shortPrompt', 'longPrompt', 'completePrompt', 'fullDescription'],
  'self-image': ['shortPrompt', 'mediumPrompt', 'longPrompt', 'completePrompt', 'fullDescription'],
  fullest: ['fullDescription', 'completePrompt', 'longPrompt', 'mediumPrompt', 'shortPrompt'],
};

/**
 * The order for a character with no humanoid body (`humanoid: false`). There
 * is no head and no shoulders to crop to, so the head-and-shoulders prompt is
 * never read — a stale one would only describe a body the character lacks —
 * and a portrait takes the mid-length prompt of the whole form instead.
 */
const NON_HUMANOID_HEAD_AND_SHOULDERS_ORDER: readonly VariantKey[] =
  ['mediumPrompt', 'longPrompt', 'shortPrompt', 'completePrompt', 'fullDescription'];

/**
 * Whether the character can be drawn as a body — head, shoulders, torso,
 * limbs. `humanoid` is optional and absent means true; only an explicit
 * `false` (set in the vault's `physical-prompts.json`) marks a character such
 * as a cluster of interlocking spheres. Every image reader asks this rather
 * than reading the field.
 */
export function isHumanoid(desc: Pick<PhysicalDescriptionVariants, 'humanoid'> | null | undefined): boolean {
  return desc?.humanoid !== false;
}

/**
 * The direction every image prompt carries for a non-humanoid character, so
 * no provider gives it a face, a head or a pair of shoulders. One sentence,
 * shared by the avatar, the wardrobe picture and the Lantern's scenes.
 */
export const NON_HUMANOID_IMAGE_DIRECTION =
  'Not humanoid: no head, face, neck, shoulders, torso, arms, legs or any human or humanoid body; depict its form exactly as described and do not anthropomorphize it';

/**
 * The first non-blank variant in the profile's order, trimmed; `''` when the
 * character has none (or no description at all). Callers supply their own
 * fallback — usually the character's name.
 */
export function pickPhysicalDescription(
  desc: PhysicalDescriptionVariants | null | undefined,
  profile: PhysicalDescriptionProfile,
): string {
  if (!desc) return '';
  const order = profile === 'head-and-shoulders' && !isHumanoid(desc)
    ? NON_HUMANOID_HEAD_AND_SHOULDERS_ORDER
    : ORDER[profile];
  for (const key of order) {
    const text = desc[key]?.trim();
    if (text) return text;
  }
  return '';
}

/** Whether the character has any variant `profile` would use. */
export function hasPhysicalDescription(
  desc: PhysicalDescriptionVariants | null | undefined,
  profile: PhysicalDescriptionProfile,
): boolean {
  return pickPhysicalDescription(desc, profile) !== '';
}
