'use client'

/**
 * Formatting Command Plugin
 *
 * Registers custom Lexical commands for each formatting action that the
 * FormattingToolbar dispatches. Handles bold, italic, headings, lists,
 * and roleplay delimiter insertion.
 *
 * Roleplay delimiters are inserted as literal text (not Lexical formatting)
 * because they must survive the markdown roundtrip as plain text markers.
 *
 * @module components/chat/lexical/plugins/FormattingCommandPlugin
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  $createParagraphNode,
  createCommand,
  type LexicalCommand,
} from 'lexical'
import { $setBlocksType } from '@lexical/selection'
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $insertList } from '@lexical/list'
import { $createCodeNode, $isCodeNode } from '@lexical/code'

/**
 * Command to set the current block to a heading.
 * Payload is the heading tag ('h1', 'h2', 'h3').
 */
export const INSERT_HEADING_COMMAND: LexicalCommand<HeadingTagType> =
  createCommand('INSERT_HEADING_COMMAND')

/**
 * Command to insert an unordered list.
 */
export const INSERT_UNORDERED_LIST_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_UL_COMMAND')

/**
 * Command to insert an ordered list.
 */
export const INSERT_ORDERED_LIST_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_OL_COMMAND')

/**
 * Command to convert the current block(s) to a blockquote.
 */
export const INSERT_BLOCKQUOTE_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_BLOCKQUOTE_COMMAND')

/**
 * Command to wrap the current selection with delimiter text.
 * Payload is { prefix, suffix } strings to insert around selection.
 */
export const INSERT_DELIMITER_COMMAND: LexicalCommand<{ prefix: string; suffix: string }> =
  createCommand('INSERT_DELIMITER_COMMAND')

/**
 * Command to toggle a code block. If the cursor is in a code block,
 * exit it (convert to paragraph). If not, convert the current block
 * to a code block.
 */
export const TOGGLE_CODE_BLOCK_COMMAND: LexicalCommand<void> =
  createCommand('TOGGLE_CODE_BLOCK_COMMAND')

export function FormattingCommandPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterHeading = editor.registerCommand(
      INSERT_HEADING_COMMAND,
      (tag: HeadingTagType) => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(tag))
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterUL = editor.registerCommand(
      INSERT_UNORDERED_LIST_COMMAND,
      () => {
        $insertList('bullet')
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterOL = editor.registerCommand(
      INSERT_ORDERED_LIST_COMMAND,
      () => {
        $insertList('number')
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterBlockquote = editor.registerCommand(
      INSERT_BLOCKQUOTE_COMMAND,
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode())
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterDelimiter = editor.registerCommand(
      INSERT_DELIMITER_COMMAND,
      ({ prefix, suffix }: { prefix: string; suffix: string }) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const selectedText = selection.getTextContent()
        if (selectedText) {
          // Check if the selection is already wrapped in these delimiters
          if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
            // Unwrap: remove the delimiters
            const inner = selectedText.slice(prefix.length, selectedText.length - suffix.length)
            selection.insertRawText(inner)
          } else {
            // Wrap selection with delimiters
            selection.insertRawText(`${prefix}${selectedText}${suffix}`)
          }
        } else {
          // No selection: insert delimiters with cursor between them
          const placeholderText = `${prefix}${suffix}`
          selection.insertRawText(placeholderText)
          // Move cursor to between the delimiters
          const nodes = selection.getNodes()
          if (nodes.length > 0) {
            const lastNode = nodes[nodes.length - 1]
            if (lastNode.getType() === 'text') {
              const textContent = lastNode.getTextContent()
              const cursorPos = textContent.length - suffix.length
              const key = lastNode.getKey()
              selection.setTextNodeRange(
                lastNode as import('lexical').TextNode,
                cursorPos,
                lastNode as import('lexical').TextNode,
                cursorPos,
              )
            }
          }
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterCodeBlock = editor.registerCommand(
      TOGGLE_CODE_BLOCK_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        // With a non-collapsed selection, toggle inline code formatting
        if (!selection.isCollapsed()) {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
          return true
        }

        // Collapsed cursor: toggle code block
        const anchorNode = selection.anchor.getNode()
        const codeBlock = anchorNode.getParent()

        if (codeBlock && $isCodeNode(codeBlock)) {
          // Exit the code block: convert its text content to a paragraph
          const text = codeBlock.getTextContent()
          const paragraph = $createParagraphNode()
          if (text) {
            paragraph.append($createTextNode(text))
          }
          codeBlock.replace(paragraph)
          paragraph.selectEnd()
        } else {
          // Enter a code block: convert current block to CodeNode
          $setBlocksType(selection, () => $createCodeNode())
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    return () => {
      unregisterHeading()
      unregisterUL()
      unregisterOL()
      unregisterBlockquote()
      unregisterDelimiter()
      unregisterCodeBlock()
    }
  }, [editor])

  return null
}
