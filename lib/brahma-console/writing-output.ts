/**
 * Brahma Console Writing Assistant — the output.
 *
 * A Writing Assistant answer is the finished piece, saved with
 * `systemKind: 'writing-output'` — the one thing the client reads to draw an
 * output card. Post-processing is deliberately light: trim, and unwrap a piece
 * that arrived wholly inside a ```markdown / ```md fence. Nothing heuristic
 * ("Here is…" stripping is the prompt's job; a stripper would eventually eat a
 * real first line).
 *
 * Pure and client-safe.
 *
 * @module lib/brahma-console/writing-output
 */

/** The `systemKind` that marks a Writing Assistant output message. */
export const WRITING_OUTPUT_KIND = 'writing-output'

const WHOLE_MARKDOWN_FENCE = /^(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i

/**
 * Normalise a piece before it is saved: trim; unwrap a whole-text
 * ```markdown / ```md fence. A real code block (any other info string), or a
 * fence that does not span the whole text, is left alone.
 */
export function normalizeWritingOutput(text: string): string {
  const trimmed = text.trim()
  const match = WHOLE_MARKDOWN_FENCE.exec(trimmed)
  if (!match) return trimmed
  const fence = match[1]
  const inner = match[2]
  // An interior line that closes the same fence means the text was not one
  // fenced block (two blocks, prose between them) — leave it as written.
  const closer = new RegExp(`^${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`, 'm')
  if (closer.test(inner)) return trimmed
  return inner.trim()
}

/**
 * The download / save filename for an output: the slug of the conversation
 * title, `-2`, `-3`, … for later outputs by ordinal (1-based), `.md`.
 */
export function writingOutputFilename(title: string | null | undefined, ordinal: number): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'console-output'
  return ordinal > 1 ? `${slug}-${ordinal}.md` : `${slug}.md`
}
