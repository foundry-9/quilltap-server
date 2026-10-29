/**
 * The composer's Enter handling, against a real editor.
 *
 * The code-block escape ("Enter on a blank trailing line leaves the block")
 * never fired: after Shift+Enter Lexical leaves the caret as an element point
 * on the CodeNode, not inside its last child, and the check only recognised the
 * latter — so in chat mode the Enter fell through and sent the message. These
 * tests seed the block the way typing does (text, then a line break) so both
 * caret shapes are exercised.
 */

import KeyboardPlugin from '@/components/chat/lexical/plugins/KeyboardPlugin'

import React from 'react'
import { $createCodeNode, $isCodeNode } from '@lexical/code'
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical'

import { renderPluginEditor, flush, seedParagraph, type PluginHarness } from '../../../../../helpers/lexicalPluginHarness'

function seedCodeWithText(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const code = $createCodeNode()
      const textNode = $createTextNode(text)
      code.append(textNode)
      root.append(code)
      textNode.select(text.length, text.length)
    },
    { discrete: true },
  )
}

function insertLineBreak(editor: LexicalEditor): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertLineBreak(false)
    },
    { discrete: true },
  )
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

function pressEnter(editor: LexicalEditor, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true, ...init })
  editor.dispatchCommand(KEY_ENTER_COMMAND, event)
  flush(editor)
  return event
}

function readShape(editor: LexicalEditor): { blocks: string[]; codeText: string | null; caretInParagraphAfterCode: boolean } {
  let result = { blocks: [] as string[], codeText: null as string | null, caretInParagraphAfterCode: false }
  editor.getEditorState().read(() => {
    const children = $getRoot().getChildren()
    const code = children.find($isCodeNode) ?? null
    const selection = $getSelection()
    const caretBlock = $isRangeSelection(selection) ? selection.anchor.getNode().getTopLevelElement() : null
    result = {
      blocks: children.map((node) => node.getType()),
      codeText: code ? code.getTextContent() : null,
      caretInParagraphAfterCode:
        caretBlock !== null && $isParagraphNode(caretBlock) && caretBlock.getPreviousSibling() === code,
    }
  })
  return result
}

describe('KeyboardPlugin', () => {
  let harness: PluginHarness

  afterEach(() => {
    harness?.unmount()
  })

  function mount(documentEditingMode: boolean) {
    const onSubmit = jest.fn()
    harness = renderPluginEditor(<KeyboardPlugin documentEditingMode={documentEditingMode} onSubmit={onSubmit} />)
    return { editor: harness.editor, onSubmit }
  }

  describe('code-block escape', () => {
    it.each([
      ['chat mode', false],
      ['document mode', true],
    ])('Enter after a trailing line break leaves the block without submitting (%s)', (_label, documentMode) => {
      const { editor, onSubmit } = mount(documentMode)
      seedCodeWithText(editor, 'let x = 1')
      insertLineBreak(editor)

      const event = pressEnter(editor)

      expect(onSubmit).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
      expect(readShape(editor)).toEqual({
        blocks: ['code', 'paragraph'],
        codeText: 'let x = 1',
        caretInParagraphAfterCode: true,
      })
    })

    it('also escapes when the blank line holds only whitespace', () => {
      const { editor, onSubmit } = mount(false)
      seedCodeWithText(editor, 'a')
      insertLineBreak(editor)
      typeText(editor, '  ')

      pressEnter(editor)

      expect(onSubmit).not.toHaveBeenCalled()
      expect(readShape(editor)).toMatchObject({ blocks: ['code', 'paragraph'], codeText: 'a' })
    })

    it('keeps earlier lines intact when escaping a multi-line block', () => {
      const { editor } = mount(false)
      seedCodeWithText(editor, 'one')
      insertLineBreak(editor)
      typeText(editor, 'two')
      insertLineBreak(editor)

      pressEnter(editor)

      expect(readShape(editor)).toMatchObject({ blocks: ['code', 'paragraph'], codeText: 'one\ntwo' })
    })

    it('does not escape when the last line has content (chat mode submits)', () => {
      const { editor, onSubmit } = mount(false)
      seedCodeWithText(editor, 'let x = 1')

      pressEnter(editor)

      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(readShape(editor).blocks).toEqual(['code'])
    })

    it('does not escape when the caret is not at the end of the block', () => {
      const { editor, onSubmit } = mount(false)
      seedCodeWithText(editor, 'ab')
      insertLineBreak(editor)
      editor.update(
        () => {
          const code = $getRoot().getFirstChildOrThrow()
          if ($isCodeNode(code)) code.select(0, 0)
        },
        { discrete: true },
      )

      pressEnter(editor)

      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(readShape(editor).blocks).toEqual(['code'])
    })
  })

  describe('submit keys', () => {
    it('submits on plain Enter in chat mode and not on Shift+Enter', () => {
      const { editor, onSubmit } = mount(false)
      seedParagraph(editor, 'hello')

      pressEnter(editor, { shiftKey: true })
      expect(onSubmit).not.toHaveBeenCalled()

      pressEnter(editor)
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('does not submit on plain Enter in document mode', () => {
      const { editor, onSubmit } = mount(true)
      seedParagraph(editor, 'hello')

      pressEnter(editor)

      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
