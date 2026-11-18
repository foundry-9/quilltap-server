/**
 * The "Reference Query" block of a Carina answerer's system prompt: the part
 * that tells the answerer they are being consulted, by whom, and how to answer.
 *
 * Two variants, chosen by the answerer's kind (`KindPolicy.toolRules`, the
 * same variant that picks their tool-rules preamble):
 *
 *   - `assistant` — answer from your knowledge and tools. Byte-identical to
 *     the block as it stood before kinds reached Carina.
 *   - `roleplay` — the same, followed by `ROLEPLAY_REFERENCE_QUERY_CLOSE`: look
 *     first, and where memory and tools are silent, answer with the
 *     particulars someone in the answerer's place would have instead of
 *     pleading ignorance. An authority consulted in a story is assumed by the
 *     asking characters to know its own records.
 *
 * The Brahma Console never reaches this module: `@Brahma` leaves
 * `runCarinaQuery` before the character prompt is built, and Brahma never
 * invents (`BRAHMA_ACCURACY_RULE`). A grep-test keeps the consoles off it.
 *
 * Pure: no I/O, no logger.
 *
 * Design of record: docs/developer/features/roleplay-character-latitude.md §5.8
 */

import type { ToolRulesVariant } from '@/lib/characters/kind'

/**
 * What a roleplay answerer is told after the standard framing. "Look first"
 * is the only place a Carina call states that order — it sends no tool-rules
 * preamble. The last sentence stands in for "the conversation outranks you":
 * the answerer cannot see the conversation, so it stays off that ground.
 */
export const ROLEPLAY_REFERENCE_QUERY_CLOSE =
  'You are being asked because this is yours to know. Look first: if your memory or a tool holds ' +
  'the answer, give it as it is. Where they are silent and nothing established contradicts you, ' +
  'answer with the particulars someone in your place would have — the date, the name, the figure, ' +
  'what the record says — instead of saying you do not know. You cannot see the conversation, so ' +
  'say nothing of what anyone there has said or done.'

/**
 * Build the Reference Query block.
 *
 * @param askerCard The asker's public identity card, or null when the asker
 *   could not be resolved (the anonymous framing)
 * @param variant The answerer's kind variant
 */
export function buildReferenceQueryBlock(
  askerCard: string | null,
  variant: ToolRulesVariant,
): string {
  const close = variant === 'roleplay' ? ` ${ROLEPLAY_REFERENCE_QUERY_CLOSE}` : ''
  if (askerCard) {
    return (
      '## Reference Query\nYou are being consulted for a quick, standalone question by the ' +
      'individual described below. Use this to know who is addressing you, then answer them ' +
      'directly and concisely from your own knowledge and the tools available to you. You do not ' +
      'have the surrounding conversation in view.' +
      close +
      `\n\n### Who Is Asking\n${askerCard}`
    )
  }
  return (
    '## Reference Query\nYou are being consulted for a quick, standalone question. ' +
    'Answer it directly and concisely from your own knowledge and the tools available to you. ' +
    'You do not have the surrounding conversation in view.' +
    close
  )
}
