/**
 * Connection-profile name helpers.
 *
 * Connection-profile names must be unique per user, case-insensitively and
 * ignoring surrounding whitespace. This module is the single source of truth
 * for both the normalization rule and the "append a numeric suffix until it's
 * unique" rule, shared by the API validators, the importer, the de-dup
 * migration, and the client-side auto-name helper.
 *
 * The matching DB guarantee is the expression unique index
 * `(userId, lower(trim(name)))` created by
 * `migrations/scripts/add-connection-profile-unique-name-index.ts`.
 *
 * @module llm/connection-profile-names
 */

/**
 * Normalize a profile name for uniqueness comparison: trimmed + lower-cased.
 * Must stay in lockstep with the `lower(trim(name))` expression index.
 */
export const normalizeProfileName = (name: string): string => name.trim().toLowerCase();

/**
 * Return `desired` (trimmed), or `desired (2)`, `desired (3)`, … until the
 * result no longer collides (case-insensitively) with any name in
 * `takenNormalized`. Callers that mint several names in a row should add each
 * returned name's normalized form back into the set before the next call.
 *
 * @param desired The preferred name.
 * @param takenNormalized Set of already-taken names, each pre-normalized via {@link normalizeProfileName}.
 */
export function makeUniqueProfileName(desired: string, takenNormalized: Set<string>): string {
  const base = desired.trim();

  if (!takenNormalized.has(normalizeProfileName(base))) {
    return base;
  }

  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!takenNormalized.has(normalizeProfileName(candidate))) {
      return candidate;
    }
  }
}
