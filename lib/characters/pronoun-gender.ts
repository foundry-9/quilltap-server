/**
 * Derive an image-prompt gender hint from a character's standard pronouns.
 *
 * Single source of truth for the `he → male` / `she → female` mapping that
 * image-prompt builders use so the generator knows a character's apparent sex.
 * Only the unambiguous binary subjects (`he`/`she`) yield a gender; `they`,
 * neopronouns, empty, or unset pronouns return `null`/`''` so we never force a
 * binary presentation onto a character who hasn't declared one.
 *
 * Image-prompt builders ask through the `figure*` functions below, which
 * take the character's physical description as well: a non-humanoid character
 * (`humanoid: false`) has no man's or woman's body to anchor, whatever its
 * pronouns, so they answer no gender for one. The pronoun-only functions are
 * the mapping those are built on; a new image pipeline uses the `figure*` ones.
 */

import type { PhysicalDescription, Pronouns } from '@/lib/schemas/character.types';
import { isHumanoid } from '@/lib/characters/physical-description';

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

/** What the `figure*` functions need to know about a character. */
export interface FigureGenderSource {
  pronouns?: Pronouns | null;
  physicalDescription?: Pick<PhysicalDescription, 'humanoid'> | null;
}

/** {@link genderFromPronouns}, or `null` for a non-humanoid character. */
export function figureGender(figure: FigureGenderSource): BinaryGender | null {
  return isHumanoid(figure.physicalDescription) ? genderFromPronouns(figure.pronouns) : null;
}

/** {@link genderNounFromPronouns}, or `null` for a non-humanoid character. */
export function figureGenderNoun(figure: FigureGenderSource): 'man' | 'woman' | null {
  return isHumanoid(figure.physicalDescription) ? genderNounFromPronouns(figure.pronouns) : null;
}

/** {@link genderPrefixFromPronouns}, or `''` for a non-humanoid character. */
export function figureGenderPrefix(figure: FigureGenderSource): string {
  return isHumanoid(figure.physicalDescription) ? genderPrefixFromPronouns(figure.pronouns) : '';
}
