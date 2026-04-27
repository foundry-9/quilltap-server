/**
 * Custom Lexical markdown transformer for GFM tables.
 *
 * Lexical's @lexical/markdown package does not include a built-in table
 * transformer, so this handles bidirectional conversion between pipe-delimited
 * markdown table syntax and Lexical TableNode/TableRowNode/TableCellNode.
 *
 * Supports GFM column alignment via the separator row:
 *   :---  = left (default)
 *   :---: = center
 *   ---:  = right
 *
 * @module components/chat/lexical/transformers/table-transformer
 */

import type { MultilineElementTransformer } from '@lexical/markdown'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  TableCellHeaderStates,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import { $createParagraphNode, $createTextNode, $isParagraphNode, type LexicalNode } from 'lexical'

type Alignment = 'left' | 'center' | 'right'

/**
 * Parse alignment from a separator cell like `:---`, `:---:`, or `---:`
 */
function parseAlignment(sep: string): Alignment {
  const trimmed = sep.trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

/**
 * Split a pipe-delimited row into cells, trimming outer pipes and whitespace.
 * Handles escaped pipes (\|) inside cell content.
 */
function splitRow(row: string): string[] {
  // Remove leading/trailing pipe and whitespace
  let trimmed = row.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)

  // Split on unescaped pipes
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      current += '|'
      i++ // skip the pipe
    } else if (trimmed[i] === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += trimmed[i]
    }
  }
  cells.push(current.trim())
  return cells
}

/**
 * Check if a line is a valid separator row (e.g., `| --- | :---: | ---: |`)
 */
function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line)
  if (cells.length === 0) return false
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

/**
 * Format alignment into a separator cell string
 */
function alignmentToSeparator(alignment: Alignment, width: number): string {
  const dashes = '-'.repeat(Math.max(3, width))
  switch (alignment) {
    case 'center': return `:${dashes}:`
    case 'right': return `${dashes}:`
    default: return dashes
  }
}

/**
 * Escape pipe characters in cell content for markdown output
 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * Extract plain text from a TableCellNode's children
 */
function getCellText(cell: LexicalNode): string {
  if (!$isTableCellNode(cell)) return ''
  const children = cell.getChildren()
  return children
    .map(child => {
      if ($isParagraphNode(child)) {
        return child.getTextContent()
      }
      return child.getTextContent()
    })
    .join(' ')
}

/**
 * Custom multiline element transformer for GFM markdown tables.
 */
export const TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode],
  type: 'multiline-element',

  // Match the first line of a table: must contain at least one pipe
  regExpStart: /^\|(.+)\|?\s*$/,

  // Tables end when we hit a line that doesn't start with a pipe
  regExpEnd: {
    optional: true,
    regExp: /^(?!\s*\|).*/,
  },

  /**
   * Handle import after matching the start line.
   * We need to consume all contiguous pipe-rows, validate the separator,
   * and build the table node tree.
   */
  handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
    // Collect all contiguous lines that look like table rows
    const tableLines: string[] = []
    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('|') || (line.includes('|') && tableLines.length > 0)) {
        tableLines.push(line)
      } else {
        break
      }
    }

    // Need at least 2 lines (header + separator)
    if (tableLines.length < 2) return null

    // Second line must be the separator
    if (!isSeparatorRow(tableLines[1])) return null

    const headerCells = splitRow(tableLines[0])
    const separatorCells = splitRow(tableLines[1])
    const colCount = headerCells.length

    // Parse alignments from separator
    const alignments: Alignment[] = separatorCells.map(parseAlignment)
    // Pad alignments if fewer than columns
    while (alignments.length < colCount) alignments.push('left')

    // Build the table
    const tableNode = $createTableNode()

    // Header row
    const headerRow = $createTableRowNode()
    for (let c = 0; c < colCount; c++) {
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(headerCells[c] || ''))
      cell.append(paragraph)
      headerRow.append(cell)
    }
    tableNode.append(headerRow)

    // Data rows (skip header at 0 and separator at 1)
    for (let r = 2; r < tableLines.length; r++) {
      const rowCells = splitRow(tableLines[r])
      const dataRow = $createTableRowNode()
      for (let c = 0; c < colCount; c++) {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode(rowCells[c] || ''))
        cell.append(paragraph)
        dataRow.append(cell)
      }
      tableNode.append(dataRow)
    }

    // Replace the lines with our table node
    rootNode.append(tableNode)

    // Return [wasImported, lastLineIndex] tuple
    return [true, startLineIndex + tableLines.length - 1] as [boolean, number]
  },

  /**
   * Export a TableNode to markdown table syntax
   */
  export(node: LexicalNode) {
    if (!$isTableNode(node)) return null

    const rows = node.getChildren().filter($isTableRowNode)
    if (rows.length === 0) return null

    // Determine column count from the first row
    const firstRow = rows[0]
    const firstRowCells = firstRow.getChildren().filter($isTableCellNode)
    const colCount = firstRowCells.length
    if (colCount === 0) return null

    // Collect all cell texts and compute column widths
    const allRows: string[][] = rows.map(row => {
      const cells = row.getChildren().filter($isTableCellNode)
      const texts: string[] = []
      for (let c = 0; c < colCount; c++) {
        texts.push(cells[c] ? escapeCell(getCellText(cells[c])) : '')
      }
      return texts
    })

    // Calculate max width per column for nice formatting
    const widths: number[] = []
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(3, ...allRows.map(row => (row[c] || '').length))
    }

    // Determine alignments — Lexical doesn't store alignment in table cells natively,
    // so we default to left alignment for all columns
    const alignments: Alignment[] = Array(colCount).fill('left') as Alignment[]

    // Build markdown lines
    const lines: string[] = []

    // Header row
    const headerParts = allRows[0].map((text, c) => ` ${text.padEnd(widths[c])} `)
    lines.push(`|${headerParts.join('|')}|`)

    // Separator row
    const sepParts = alignments.map((a, c) => ` ${alignmentToSeparator(a, widths[c])} `)
    lines.push(`|${sepParts.join('|')}|`)

    // Data rows
    for (let r = 1; r < allRows.length; r++) {
      const parts = allRows[r].map((text, c) => ` ${text.padEnd(widths[c])} `)
      lines.push(`|${parts.join('|')}|`)
    }

    return lines.join('\n')
  },

  // replace is required by the type but handled by handleImportAfterStartMatch
  replace() {
    return false
  },
}
