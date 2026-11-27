/**
 * Word-boundary trigger characters for text replacement: the keys whose press
 * ends a word and may fire a rule. Shared by the composer / Document Mode
 * plugin (`components/chat/lexical/plugins/TextReplacementPlugin.tsx`) and the
 * settings card's "Try it" box, so the preview fires exactly when the editor
 * would. Newline is excluded — submit/paragraph handlers own that key.
 *
 * @module text-replacement/boundary
 */

export const TEXT_REPLACEMENT_TRIGGER_CHARS: ReadonlySet<string> = new Set([
  ' ',
  ' ', // NBSP
  '\t',
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
])

/** Whether `ch` ends a word for text replacement. */
export function isTextReplacementBoundary(ch: string): boolean {
  return TEXT_REPLACEMENT_TRIGGER_CHARS.has(ch)
}
