/**
 * Memory Format Utilities
 *
 * Shared formatting helpers used across memory extraction modules.
 */

import type { Pronouns } from '@/lib/schemas/character.types'

/**
 * Formats a name with pronouns appended, e.g. "Friday (she/her/her)"
 * Returns just the name if pronouns are not available.
 */
export function formatNameWithPronouns(name: string, pronouns?: Pronouns | null): string {
  if (!pronouns) return name
  return `${name} (${pronouns.subject}/${pronouns.object}/${pronouns.possessive})`
}
