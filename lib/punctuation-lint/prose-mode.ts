/**
 * Punctuation warnings — which templates are prose.
 *
 * Prose mode (the `no-dialogue` rule and the composer's narration / OOC
 * preview) is for a template that writes the way Novel does: narration is
 * unmarked prose (`narrationDelimiters: null`) and dialogue is wrapped in
 * straight double quotes. The engine's own conventions — `"` dialogue and
 * `((…))` asides — are Novel's, so this is the one question that decides
 * whether its reading of a draft can be trusted.
 *
 * Structural types only: like the engine, this file imports nothing.
 *
 * @module lib/punctuation-lint/prose-mode
 */

/** The parts of a roleplay template the decision reads. */
export interface ProseTemplateShape {
  narrationDelimiters?: unknown
  delimiters?: readonly { kind?: string; delimiters?: unknown }[] | null
}

/** True when the template leaves narration unmarked and quotes its dialogue. */
export function isProseTemplate(template: ProseTemplateShape | null | undefined): boolean {
  if (!template || template.narrationDelimiters !== null) return false
  return (template.delimiters ?? []).some(
    (d) => (d.kind ?? 'wrap') === 'wrap' && d.delimiters === '"',
  )
}
