/**
 * Formatting prompt-hint generator.
 *
 * Drafts a plain, kind-aware "how to format your replies" paragraph from a
 * template's delimiter list, for the template editor's "Draft formatting
 * instructions" button. The output is a STARTER the user edits — the template's
 * `systemPrompt` stays the source of truth sent to the model — so the text is
 * deliberately clear and literal (instructions to an LLM), not in the app's
 * usual flowery voice.
 *
 * @module lib/chat/template-prompt-hint
 */

import type { TemplateDelimiter, NarrationDelimiters } from '@/lib/schemas/template.types'
import { delimiterToPrefixSuffix } from '@/lib/chat/annotations'

/**
 * Build a starter formatting-instructions paragraph from delimiters + narration.
 * Returns '' when there is nothing to describe.
 */
export function generateFormattingPromptHint(
  delimiters: TemplateDelimiter[],
  narrationDelimiters?: NarrationDelimiters,
): string {
  const bullets: string[] = []

  // Narration first (it's the template-wide default action style).
  let narrationPrefix: string | undefined
  let narrationSuffix: string | undefined
  if (narrationDelimiters) {
    narrationPrefix = Array.isArray(narrationDelimiters) ? narrationDelimiters[0] : narrationDelimiters
    narrationSuffix = Array.isArray(narrationDelimiters) ? narrationDelimiters[1] : narrationDelimiters
    bullets.push(
      `- Narration and action: wrap in ${narrationPrefix}…${narrationSuffix} (e.g. ${narrationPrefix}she stepped closer${narrationSuffix}).`,
    )
  }

  for (const d of delimiters) {
    switch (d.kind) {
      case 'linePrefix':
        bullets.push(`- ${d.name}: begin the line with "${d.marker}" (e.g. ${d.marker}an aside).`)
        break
      case 'tagPrefix':
        bullets.push(
          `- ${d.name}: begin the line with a ${d.open}TOKEN${d.close} tag, where TOKEN is uppercase (e.g. ${d.open}CAPTAIN${d.close} All hands on deck!). The whole line is styled.`,
        )
        break
      case 'wrap':
      default: {
        const { prefix, suffix } = delimiterToPrefixSuffix(d)
        // Skip a wrap delimiter that simply restates the narration default.
        if (prefix === narrationPrefix && suffix === narrationSuffix) break
        bullets.push(`- ${d.name}: wrap in ${prefix}…${suffix} (e.g. ${prefix}example${suffix}).`)
        break
      }
    }
  }

  if (bullets.length === 0) return ''

  return ['[FORMATTING GUIDE]', 'Please format your responses as follows:', ...bullets].join('\n')
}
