/**
 * Where a source line of a Markdown document sits in Document Mode's rich
 * editor.
 *
 * `doc_focus` names a 1-based line of the file, the same line the JSON / CSS
 * code editor reveals. The Markdown pane has no lines, only top-level blocks,
 * and blocks do not map one-to-one onto lines: a list, a quote, a fenced code
 * block or a table spans several (#309). Rather than re-derive Lexical's
 * import rules, the lines up to the target are imported into a throwaway
 * editor with the pane's own nodes and importer; the last block that import
 * makes is the one the target line belongs to, because a line that continues
 * a list or a code block lands in the block already open.
 *
 * @module app/salon/[id]/components/markdown-source-lines
 */

import { createEditor, $getRoot, type Klass, type LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { $importComposerMarkdown } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

/** The nodes Document Mode's Markdown editor registers. */
export const DOCUMENT_EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
  TableNode,
  TableCellNode,
  TableRowNode,
]

/** How many lines a frontmatter block (`---` … `---\n`) occupies; 0 for none. */
export function frontmatterLineCount(rawBlock: string | null): number {
  if (!rawBlock) return 0
  let lines = 0
  for (let i = rawBlock.indexOf('\n'); i !== -1; i = rawBlock.indexOf('\n', i + 1)) lines++
  // A block that ends the file without a trailing newline still fills its last line.
  return rawBlock.endsWith('\n') ? lines : lines + 1
}

/**
 * The 0-based index of the top-level block that 1-based `bodyLine` of
 * `markdown` imports into. A line before the first (frontmatter, or 0) is
 * block 0; a line past the end is the last block.
 */
export function markdownBlockIndexForLine(markdown: string, bodyLine: number): number {
  if (!Number.isFinite(bodyLine) || bodyLine <= 1) return 0
  const prefix = markdown.split('\n').slice(0, Math.floor(bodyLine)).join('\n')

  const editor = createEditor({
    namespace: 'DocumentSourceLines',
    nodes: [...DOCUMENT_EDITOR_NODES],
    onError: (error: Error) => {
      console.warn('[markdown-source-lines] Import failed', { message: error.message })
    },
  })
  let count = 0
  editor.update(() => {
    $getRoot().clear()
    $importComposerMarkdown(editor, prefix)
  }, { discrete: true })
  editor.getEditorState().read(() => {
    count = $getRoot().getChildrenSize()
  })
  console.debug('[markdown-source-lines] Resolved source line to block', { bodyLine, block: Math.max(0, count - 1) })
  return Math.max(0, count - 1)
}
