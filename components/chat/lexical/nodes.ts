/**
 * The node set every Quilltap rich-text editor registers: the chat composer
 * and the Markdown editor. One list, so a node added for one is never missing
 * from the other (Markdown written in one must parse in both).
 *
 * @module components/chat/lexical/nodes
 */

import type { Klass, LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'

export const COMPOSER_NODES: ReadonlyArray<Klass<LexicalNode>> = [
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
