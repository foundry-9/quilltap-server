/**
 * Wardrobe pronoun guidance — the one rule for "is this item offered to this
 * character?" and the one normaliser for the stored value.
 *
 * An item may name the standard pronoun sets it is meant for
 * (`pronounGuidance`, values from `lib/characters/pronoun-presets.ts`). A
 * pronoun-aware listing offers it only to characters whose pronouns are one
 * of those sets. Everything else is offered to everyone:
 *
 *  - an item with no guidance (empty or absent);
 *  - any item, to a character whose pronouns are unset or custom — there is
 *    no standard set to match against, so nothing is hidden from them.
 *
 * Guidance filters what is *offered*, never what may be *worn*: an item asked
 * for by id or title still goes on. Callers that list items for a character
 * (the `wardrobe_list` tool, the "Let character choose" pass, the Wardrobe
 * UI) call `filterByPronounGuidance`; none re-derives the rule.
 *
 * Client-safe: no server imports.
 *
 * @module lib/wardrobe/pronoun-guidance
 */

import type { Pronouns } from '@/lib/schemas/character.types';
import {
  STANDARD_PRONOUN_SUBJECTS,
  standardPronounLabel,
  standardPronounSubjectOf,
  type StandardPronounSubject,
} from '@/lib/characters/pronoun-presets';
import type { PronounGuidance } from '@/lib/schemas/wardrobe.types';

const SUBJECTS: ReadonlySet<string> = new Set(STANDARD_PRONOUN_SUBJECTS);

/**
 * Normalise a raw guidance value (frontmatter, a tool argument, an imported
 * bundle) to the stored shape: known subjects only, lower-cased, de-duplicated,
 * in picker order. A single string is read as a one-item list; a full preset
 * label (`He/Him/His`) is read as its subject. Anything unreadable becomes `[]`.
 */
export function normalizePronounGuidance(raw: unknown): PronounGuidance[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const subject = value.trim().toLowerCase().split('/')[0]?.trim() ?? '';
    if (SUBJECTS.has(subject)) found.add(subject);
  }
  return STANDARD_PRONOUN_SUBJECTS.filter((s) => found.has(s));
}

/** True when the item names no pronoun guidance (offered to everyone). */
export function hasNoPronounGuidance(item: { pronounGuidance?: readonly string[] | null }): boolean {
  return (item.pronounGuidance?.length ?? 0) === 0;
}

/**
 * Is `item` offered to a character with `pronouns`? True for an item without
 * guidance, for a character without standard pronouns, and for an item whose
 * guidance names the character's set.
 */
export function fitsPronounGuidance(
  item: { pronounGuidance?: readonly string[] | null },
  pronouns: Pronouns | null | undefined,
): boolean {
  if (hasNoPronounGuidance(item)) return true;
  const subject = standardPronounSubjectOf(pronouns);
  if (!subject) return true;
  return (item.pronounGuidance ?? []).includes(subject);
}

/**
 * The items offered to a character with `pronouns`, plus how many guidance
 * held back. `keepIds` are always kept (what the character already wears, so
 * a listing never hides the clothes on their back).
 */
export function filterByPronounGuidance<T extends { id: string; pronounGuidance?: readonly string[] | null }>(
  items: readonly T[],
  pronouns: Pronouns | null | undefined,
  keepIds?: ReadonlySet<string>,
): { items: T[]; hiddenCount: number } {
  if (!standardPronounSubjectOf(pronouns)) return { items: [...items], hiddenCount: 0 };
  const kept = items.filter((item) => keepIds?.has(item.id) || fitsPronounGuidance(item, pronouns));
  return { items: kept, hiddenCount: items.length - kept.length };
}

/** A short human label for an item's guidance (`He/Him/His, They/Them/Their`), or `''` for none. */
export function formatPronounGuidance(guidance: readonly string[] | null | undefined): string {
  return normalizePronounGuidance(guidance ?? [])
    .map((s: StandardPronounSubject) => standardPronounLabel(s))
    .join(', ');
}
