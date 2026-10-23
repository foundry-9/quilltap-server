/**
 * The built-in pronoun sets — the one list behind Aurora's pronoun picker and
 * the values a wardrobe item's pronoun guidance may name.
 *
 * Each preset is keyed by its subject pronoun (`he`, `she`, `they`, `it`).
 * Custom pronouns live outside this list: a character who uses them has no
 * standard subject, and so is never filtered by wardrobe pronoun guidance.
 *
 * Client-safe: type-only imports.
 *
 * @module lib/characters/pronoun-presets
 */

import type { Pronouns } from '@/lib/schemas/character.types';

/** The standard pronoun sets, in picker order. Append new sets at the end. */
export const STANDARD_PRONOUNS = [
  { label: 'He/Him/His', value: { subject: 'he', object: 'him', possessive: 'his' } },
  { label: 'She/Her/Her', value: { subject: 'she', object: 'her', possessive: 'her' } },
  { label: 'They/Them/Their', value: { subject: 'they', object: 'them', possessive: 'their' } },
  { label: 'It/It/Its', value: { subject: 'it', object: 'it', possessive: 'its' } },
] as const satisfies readonly { label: string; value: Pronouns }[];

/** A standard pronoun set, named by its subject pronoun. */
export type StandardPronounSubject = (typeof STANDARD_PRONOUNS)[number]['value']['subject'];

/** Every standard subject, in picker order (derived — never restate the list). */
export const STANDARD_PRONOUN_SUBJECTS = STANDARD_PRONOUNS.map((p) => p.value.subject) as [
  StandardPronounSubject,
  ...StandardPronounSubject[],
];

/** The picker label for a standard subject (`'he'` → `'He/Him/His'`). */
export function standardPronounLabel(subject: StandardPronounSubject): string {
  return STANDARD_PRONOUNS.find((p) => p.value.subject === subject)?.label ?? subject;
}

/**
 * The standard set a character's pronouns are, or `null` when they are unset
 * or custom. Matches on the whole set, exactly as the Aurora picker does, so
 * a character the picker shows as "Custom" is never treated as standard.
 */
export function standardPronounSubjectOf(
  pronouns: Pronouns | null | undefined,
): StandardPronounSubject | null {
  if (!pronouns) return null;
  const subject = pronouns.subject.trim().toLowerCase();
  const object = pronouns.object.trim().toLowerCase();
  const possessive = pronouns.possessive.trim().toLowerCase();
  const preset = STANDARD_PRONOUNS.find(
    (p) => p.value.subject === subject && p.value.object === object && p.value.possessive === possessive,
  );
  return preset ? preset.value.subject : null;
}
