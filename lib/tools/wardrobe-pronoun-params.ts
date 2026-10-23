/**
 * The pronoun-guidance parameters the `wardrobe_*` tools share, spelled once
 * so their descriptions never drift between tools.
 *
 *  - `pronoun_guidance` (create / update) sets who an item is offered to.
 *  - `pronoun_aware` (list) turns the filter off for one call.
 *
 * The rule itself lives in `lib/wardrobe/pronoun-guidance.ts`.
 *
 * @module lib/tools/wardrobe-pronoun-params
 */

import { z } from 'zod'
import { PronounGuidanceEnum } from '@/lib/schemas/wardrobe.types'
import { STANDARD_PRONOUN_SUBJECTS } from '@/lib/characters/pronoun-presets'

const SUBJECT_LIST = STANDARD_PRONOUN_SUBJECTS.map((s) => `"${s}"`).join(', ')

/** `pronoun_guidance` — the standard pronoun sets an item is meant for. */
export function pronounGuidanceToolParam(verb: 'set' | 'replace') {
  return z
    .array(PronounGuidanceEnum)
    .describe(
      `${verb === 'set' ? 'Optional pronoun guidance' : 'Replace the pronoun guidance'}: the pronouns ` +
      `(by subject: ${SUBJECT_LIST}) of the characters this item is meant for. ` +
      'Pronoun-aware wardrobe listings offer it only to characters with one of these pronouns; ' +
      'anyone can still wear it when they ask for it by name. ' +
      (verb === 'set'
        ? 'Omit (or pass an empty array) to offer it to everyone.'
        : 'An empty array offers it to everyone. Omit to leave unchanged.'),
    )
    .optional()
}

/** `pronoun_aware` — whether a listing honours items' pronoun guidance. */
export const pronounAwareToolParam = z
  .boolean()
  .describe(
    'Whether to honour each item\'s pronoun guidance, listing only items meant for characters ' +
    'with your pronouns (plus items with no guidance, and anything you are wearing now). ' +
    'Defaults to true. Pass false to see the whole wardrobe — for instance when the scene ' +
    'calls for something you would not ordinarily be offered.',
  )
  .optional()
