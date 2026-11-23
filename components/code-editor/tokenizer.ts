/**
 * The code editor's Prism tokenizer for Lexical's highlighter.
 *
 * Lexical's own `PrismTokenizer` builds a new node for every token of the
 * whole file on every keystroke, then keeps only the ones that differ. On a
 * 2,000-line JSON file that is some sixty thousand nodes made and thrown
 * away per key — most of the time a keystroke took. This one tokenizes the
 * same way (Prism over the whole text, so the colours are identical) but
 * hands back the block's existing children wherever the tokens at the start
 * and the end are unchanged, and makes nodes only for the stretch between.
 * Lexical's diff then finds nothing to do at either end.
 *
 * The flattening below mirrors `$mapTokensToLexicalStructure` in
 * `@lexical/code-prism` (FacadePrism.ts): strings split on line breaks and
 * tabs, a token's string content takes the token's type, nested content takes
 * the outer token's type unless the inner token has its own.
 *
 * @module components/code-editor/tokenizer
 */

import {
  $createCodeHighlightNode,
  $isCodeHighlightNode,
  type CodeHighlightNode,
  type CodeNode,
} from '@lexical/code'
import {
  $createLineBreakNode,
  $createTabNode,
  $isLineBreakNode,
  $isTabNode,
  tokenizeRawText,
  type LexicalNode,
} from 'lexical'
import type { Token, TokenStream } from 'prismjs'
import { PrismTokenizer, type Tokenizer } from './prism'

type Piece = { kind: 'br' } | { kind: 'tab' } | { kind: 'text'; text: string; type: string | undefined }

const BR: Piece = { kind: 'br' }
const TAB: Piece = { kind: 'tab' }

function prism(): typeof import('prismjs') {
  return (globalThis as unknown as { Prism: typeof import('prismjs') }).Prism
}

function flatten(stream: TokenStream, type: string | undefined, out: Piece[]): void {
  const parts = Array.isArray(stream) ? stream : [stream]
  for (const part of parts) {
    if (typeof part === 'string') {
      tokenizeRawText(part, {
        linebreak: () => out.push(BR),
        tab: () => out.push(TAB),
        text: (text) => out.push({ kind: 'text', text, type }),
      })
      continue
    }
    const token = part as Token
    if (typeof token.content === 'string') {
      const own = token.type === 'prefix' && typeof token.alias === 'string' ? token.alias : token.type
      flatten(token.content, own, out)
    } else if (Array.isArray(token.content)) {
      flatten(token.content, token.type === 'unchanged' ? undefined : token.type, out)
    }
  }
}

/** The pieces a text tokenizes to, exactly as Lexical's Prism highlighter would make nodes of them. */
export function tokenizeToPieces(text: string, language: string): Piece[] {
  const P = prism()
  const out: Piece[] = []
  flatten(P.tokenize(text, P.languages[language] ?? {}), undefined, out)
  return out
}

function same(node: LexicalNode, piece: Piece): boolean {
  if (piece.kind === 'br') return $isLineBreakNode(node)
  if (piece.kind === 'tab') return $isTabNode(node)
  return (
    $isCodeHighlightNode(node) &&
    (node as CodeHighlightNode).__text === piece.text &&
    ((node as CodeHighlightNode).__highlightType ?? undefined) === piece.type
  )
}

function create(piece: Piece): LexicalNode {
  if (piece.kind === 'br') return $createLineBreakNode()
  if (piece.kind === 'tab') return $createTabNode()
  return $createCodeHighlightNode(piece.text, piece.type)
}

export const ReusingPrismTokenizer: Tokenizer = {
  defaultLanguage: PrismTokenizer.defaultLanguage,
  tokenize: (code, language) => PrismTokenizer.tokenize(code, language),
  $tokenize(codeNode: CodeNode, language?: string): LexicalNode[] {
    const lang = language || this.defaultLanguage
    if (!lang || !prism().languages[lang]) return PrismTokenizer.$tokenize(codeNode, language)

    const pieces = tokenizeToPieces(codeNode.getTextContent(), lang)
    const children = codeNode.getChildren()
    const max = Math.min(children.length, pieces.length)

    let lead = 0
    while (lead < max && same(children[lead], pieces[lead])) lead++
    let trail = 0
    while (trail < max - lead && same(children[children.length - 1 - trail], pieces[pieces.length - 1 - trail])) trail++

    const out: LexicalNode[] = children.slice(0, lead)
    for (let i = lead; i < pieces.length - trail; i++) out.push(create(pieces[i]))
    for (let i = children.length - trail; i < children.length; i++) out.push(children[i])
    return out
  },
}
