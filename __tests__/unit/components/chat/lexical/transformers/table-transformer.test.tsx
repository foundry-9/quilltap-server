/**
 * The GFM table transformer belongs to the import path only.
 *
 * Lexical 0.45 tripped its "update listeners are endlessly enqueueing more
 * updates" guard when a `|…|` line was typed into the composer, and the table
 * transformer was the one in the live markdown-shortcut runner at the time.
 * Its `replace()` never did anything there — tables are only built by
 * `handleImportAfterStartMatch` — so the transformer now carries a bare
 * (non-optional) `regExpEnd`, which @lexical/markdown's live runner skips.
 * This suite pins both halves: typing a table row stays a paragraph, and
 * importing a table still yields a TableNode.
 */

import { TABLE_TRANSFORMER } from '@/components/chat/lexical/transformers/table-transformer'
import { COMPOSER_TRANSFORMERS } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

import React from 'react'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { $convertFromMarkdownString } from '@lexical/markdown'
import { $isTableNode } from '@lexical/table'
import {
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical'

import {
  renderPluginEditor,
  seedParagraph,
  flush,
  type PluginHarness,
} from '../../../../../helpers/lexicalPluginHarness'

function topLevelTypes(editor: LexicalEditor): string[] {
  let types: string[] = []
  editor.getEditorState().read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType())
  })
  return types
}

function typeText(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText(text)
    },
    { discrete: true },
  )
}

describe('TABLE_TRANSFORMER', () => {
  let harness: PluginHarness

  afterEach(() => {
    harness?.unmount()
  })

  it('declares a non-optional regExpEnd, which keeps it out of the live shortcut runner', () => {
    expect(TABLE_TRANSFORMER.regExpEnd).toBeInstanceOf(RegExp)
  })

  it('leaves a typed table row as a paragraph on space and on Enter', () => {
    harness = renderPluginEditor(<MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />)
    const { editor } = harness

    seedParagraph(editor, '| a | b |')
    expect(() => typeText(editor, ' ')).not.toThrow()
    expect(topLevelTypes(editor)).toEqual(['paragraph'])

    expect(() => {
      editor.dispatchCommand(
        KEY_ENTER_COMMAND,
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }),
      )
      flush(editor)
    }).not.toThrow()

    let hasTable = false
    let firstIsParagraph = false
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren()
      hasTable = children.some((node) => $isTableNode(node))
      firstIsParagraph = $isParagraphNode(children[0])
    })
    expect(hasTable).toBe(false)
    expect(firstIsParagraph).toBe(true)
  })

  it('still builds a TableNode when a GFM table is imported', () => {
    harness = renderPluginEditor(null)
    const { editor } = harness

    editor.update(
      () => {
        $convertFromMarkdownString('| a | b |\n| --- | --- |\n| 1 | 2 |', COMPOSER_TRANSFORMERS, undefined, true)
      },
      { discrete: true },
    )

    expect(topLevelTypes(editor)).toContain('table')
  })
})
