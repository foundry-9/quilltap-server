/**
 * Derive an image-prompt gender hint from a character's standard pronouns.
 *
 * Single source of truth for the `he → male` / `she → female` mapping that
 * image-prompt builders use so the generator knows a character's apparent sex.
 * Only the unambiguous binary subjects (`he`/`she`) yield a gender; `they`,
 * neopronouns, empty, or unset pronouns return `null`/`''` so we never force a
 * binary presentation onto a character who hasn't declared one.
 *
 * Used by the avatar prompt builder (`lib/wardrobe/avatar-prompt.ts`), the
 * story-background prompt builder (`lib/background-jobs/handlers/story-background.ts`),
 * and the manual image-prompt expander (`lib/image-gen/prompt-expansion.ts`).
 */

import type { Pronouns } from '@/lib/schemas/character.types';

export type BinaryGender = 'male' | 'female';

/**
 * Map standard pronouns to a binary gender, or `null` when the character's
 * pronouns are neutral, custom, or unset.
 */
export function genderFromPronouns(pronouns: Pronouns | null | undefined): BinaryGender | null {
  if (!pronouns) return null;
  const subject = pronouns.subject.trim().toLowerCase();
  if (subject === 'he') return 'male';
  if (subject === 'she') return 'female';
  return null;
}

/**
 * The gendered noun (`'man'` / `'woman'`) for a character's pronouns, or `null`
 * when neutral/unknown. Suitable for inlining as a subject noun in a prompt.
 */
export function genderNounFromPronouns(pronouns: Pronouns | null | undefined): 'man' | 'woman' | null {
  const gender = genderFromPronouns(pronouns);
  if (gender === 'male') return 'man';
  if (gender === 'female') return 'woman';
  return null;
}

/**
 * A short sentence prefix (`'A man. '` / `'A woman. '`) for image prompts, or
 * `''` when the character's pronouns are neutral/unknown.
 */
export function genderPrefixFromPronouns(pronouns: Pronouns | null | undefined): string {
  const noun = genderNounFromPronouns(pronouns);
  return noun ? `A ${noun}. ` : '';
}
