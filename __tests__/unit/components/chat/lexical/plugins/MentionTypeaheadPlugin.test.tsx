/**
 * The composer's `@` character typeahead, against a REAL Lexical editor.
 *
 * Match rules and the keep-or-strip verdict are pinned in
 * `lib/mentions/__tests__`; this suite is about the wiring — that the menu
 * opens, that Enter / Tab / Space complete the highlighted name, and that the
 * `@` is dropped everywhere except a line-start Carina query.
 */

import React from 'react'
import { act, screen } from '@testing-library/react'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'

import { MentionTypeaheadPlugin } from '@/components/chat/lexical/plugins/MentionTypeaheadPlugin'
import {
  renderPluginEditor,
  readText,
  readCaretOffset,
  pressKey,
  flush,
  type PluginHarness,
} from '../../../../../helpers/lexicalPluginHarness'

// jsdom lays nothing out; the menu positions itself from these.
const zeroRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
const realRangeRect = Range.prototype.getBoundingClientRect
const realRangeRects = Range.prototype.getClientRects
const realResizeObserver = global.ResizeObserver
const realFetch = global.fetch

const CHARACTERS = [
  { id: 'c-aris', name: 'Aristarchus', title: 'the astronomer' },
  { id: 'c-arab', name: 'Arabella' },
  { id: 'c-barn', name: 'Barnaby' },
  { id: 'c-jean', name: 'Jean-Luc' },
]

beforeAll(() => {
  Range.prototype.getBoundingClientRect = zeroRect
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  ;(Node.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = zeroRect
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ characters: CHARACTERS }),
    text: async () => JSON.stringify({ characters: CHARACTERS }),
  })) as unknown as typeof fetch
})

afterAll(() => {
  Range.prototype.getBoundingClientRect = realRangeRect
  Range.prototype.getClientRects = realRangeRects
  delete (Node.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect
  global.ResizeObserver = realResizeObserver
  global.fetch = realFetch
})

describe('MentionTypeaheadPlugin', () => {
  let harness: PluginHarness

  afterEach(() => harness?.unmount())

  function mount(priorityCharacterIds?: string[]): LexicalEditor {
    harness = renderPluginEditor(<MentionTypeaheadPlugin priorityCharacterIds={priorityCharacterIds} />)
    harness.editor.getRootElement()?.focus()
    return harness.editor
  }

  /** Seed `lines` as one paragraph joined by soft line breaks; caret at the end. */
  function seed(editor: LexicalEditor, ...lines: string[]) {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        lines.forEach((line, index) => {
          if (index > 0) paragraph.append($createLineBreakNode())
          if (line) paragraph.append($createTextNode(line))
        })
        root.append(paragraph)
        paragraph.selectEnd()
      },
      { discrete: true },
    )
  }

  async function settle() {
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
  }

  async function openMenu(editor: LexicalEditor, ...lines: string[]) {
    seed(editor, ...lines)
    await settle()
  }

  function type(editor: LexicalEditor, text: string) {
    editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText(text)
      },
      { discrete: true },
    )
    flush(editor)
  }

  function press(editor: LexicalEditor, command: typeof KEY_ENTER_COMMAND | typeof KEY_TAB_COMMAND) {
    const event = new KeyboardEvent('keydown', { cancelable: true })
    act(() => {
      editor.dispatchCommand(command, event)
    })
    flush(editor)
    return event.defaultPrevented
  }

  function optionLabels() {
    return screen.queryAllByRole('option').map((option) => option.textContent)
  }

  describe('the menu', () => {
    it('opens on a bare @ with every character', async () => {
      const editor = mount()
      await openMenu(editor, 'hello @')
      expect(screen.queryAllByRole('option')).toHaveLength(CHARACTERS.length)
    })

    it('narrows as the writer types', async () => {
      const editor = mount()
      await openMenu(editor, 'hello @ar')
      expect(optionLabels()).toEqual([
        expect.stringContaining('Arabella'),
        expect.stringContaining('Aristarchus'),
      ])
    })

    it('puts the chat cast first', async () => {
      const editor = mount(['c-aris'])
      await openMenu(editor, '@ar')
      expect(optionLabels()[0]).toContain('Aristarchus')
    })

    it('stays shut inside an email address', async () => {
      const editor = mount()
      await openMenu(editor, 'mail name@ar')
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })
  })

  describe('completing mid-line', () => {
    it('Enter takes the first name and drops the @', async () => {
      const editor = mount()
      await openMenu(editor, 'hello @ari')
      expect(press(editor, KEY_ENTER_COMMAND)).toBe(true)
      expect(readText(editor)).toBe('hello Aristarchus')
    })

    it('Tab does the same', async () => {
      const editor = mount()
      await openMenu(editor, 'hello @bar')
      press(editor, KEY_TAB_COMMAND)
      expect(readText(editor)).toBe('hello Barnaby')
    })

    it('Space completes and keeps its space', async () => {
      const editor = mount()
      await openMenu(editor, 'hello @ari')
      const { defaultPrevented } = pressKey(editor, ' ')
      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe('hello Aristarchus ')
      expect(readCaretOffset(editor)).toBe('hello Aristarchus '.length)
    })

    it('Space after a bare @ is just a space', async () => {
      const editor = mount()
      await openMenu(editor, 'meet me @')
      const { defaultPrevented } = pressKey(editor, ' ')
      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('meet me @')

      // Not consumed, so the browser inserts the space itself — apply it the
      // way the editor would and confirm nothing else happens to the text.
      type(editor, ' ')
      await settle()
      expect(readText(editor)).toBe('meet me @ ')
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })
  })

  describe('completing at the start of a line', () => {
    it('keeps the @ while undecided', async () => {
      const editor = mount()
      await openMenu(editor, '@ari')
      press(editor, KEY_ENTER_COMMAND)
      await settle()
      expect(readText(editor)).toBe('@Aristarchus')
      // and does not reopen the menu on the completed name
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it.each([':', '?'])('keeps the @ for a Carina query (%s)', async (separator) => {
      const editor = mount()
      await openMenu(editor, '@ari')
      press(editor, KEY_ENTER_COMMAND)
      type(editor, separator)
      type(editor, ' ')
      type(editor, 'what is the hour')
      expect(readText(editor)).toBe(`@Aristarchus${separator} what is the hour`)
    })

    it('drops the @ when anything else follows the name', async () => {
      const editor = mount()
      await openMenu(editor, '@ari')
      press(editor, KEY_ENTER_COMMAND)
      type(editor, ',')
      expect(readText(editor)).toBe('Aristarchus,')
      expect(readCaretOffset(editor)).toBe('Aristarchus,'.length)
    })

    it('drops the @ when the separator is not followed by a space', async () => {
      const editor = mount()
      await openMenu(editor, '@ari')
      press(editor, KEY_ENTER_COMMAND)
      type(editor, ':')
      type(editor, 'x')
      expect(readText(editor)).toBe('Aristarchus:x')
    })

    it('Space completion drops the @ straight away', async () => {
      const editor = mount()
      await openMenu(editor, '@ari')
      pressKey(editor, ' ')
      expect(readText(editor)).toBe('Aristarchus ')
    })

    it('drops the @ at once for a name the Carina parser cannot address', async () => {
      const editor = mount()
      await openMenu(editor, '@jea')
      press(editor, KEY_ENTER_COMMAND)
      expect(readText(editor)).toBe('Jean-Luc')
    })

    it('treats the line after a soft break as a line start', async () => {
      const editor = mount()
      await openMenu(editor, 'first line', '@ari')
      press(editor, KEY_ENTER_COMMAND)
      type(editor, ':')
      type(editor, ' ')
      expect(readText(editor)).toBe('first line\n@Aristarchus: ')
    })

    it('one undo takes back the keystroke and the dropped @ together', async () => {
      const editor = mount()
      await openMenu(editor, '@ari')
      press(editor, KEY_ENTER_COMMAND)
      await settle()
      type(editor, ',')
      await settle()
      expect(readText(editor)).toBe('Aristarchus,')

      act(() => {
        editor.dispatchCommand(UNDO_COMMAND, undefined)
      })
      flush(editor)
      expect(readText(editor)).toBe('@Aristarchus')
    })
  })
})
