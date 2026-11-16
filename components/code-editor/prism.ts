/**
 * The code editor's one door to Prism: manual mode first, then Lexical's
 * Prism highlighter, then the JSON grammar it does not bundle (CSS it does).
 * Import order is the point of this file.
 *
 * @module components/code-editor/prism
 */

import './prism-manual'
import { registerCodeHighlighting, PrismTokenizer, type Tokenizer } from '@lexical/code-prism'
import 'prismjs/components/prism-json'

export { registerCodeHighlighting, PrismTokenizer, type Tokenizer }

/**
 * Prism's CSS grammar tries a selector before a string, and lets a selector
 * start at a quote — so in `content: "{";` the quote reads as a selector and
 * the brace as punctuation. The editor's brace indentation trusts these
 * tokens, so a selector may not start at a quote here. (A brace after a space
 * inside a string, `"a {"`, is still misread; that needs a different grammar.)
 */
function tightenCssSelector(): void {
  const css = (globalThis as unknown as { Prism?: { languages?: Record<string, Record<string, unknown>> } }).Prism
    ?.languages?.css
  const selector = css?.selector as { pattern?: RegExp } | undefined
  const from = '(^|[{}\\s])[^{}\\s]'
  if (!selector?.pattern || !selector.pattern.source.startsWith(from + '(')) return
  selector.pattern = new RegExp(
    '(^|[{}\\s])[^{}\\s"\']' + selector.pattern.source.slice(from.length),
    selector.pattern.flags,
  )
}

tightenCssSelector()
